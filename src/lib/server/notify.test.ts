import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never, kit: null as never }));
vi.mock('./db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});
const sent = vi.hoisted(() => [] as Array<Record<string, unknown>>);
vi.mock('nodemailer', () => ({
	default: {
		createTransport: () => ({ sendMail: async (m: Record<string, unknown>) => sent.push(m) })
	}
}));
const fetches = vi.hoisted(() => [] as Array<{ url: string; init: RequestInit }>);
vi.stubGlobal('fetch', async (url: string | URL | Request, init?: RequestInit) => {
	fetches.push({ url: String(url), init: init ?? {} });
	return new Response('ok', { status: 200 });
});

import { deliver } from './notify';
import { notifications } from './db/schema';
import * as usersRepo from './repositories/usersRepo';
import { encrypt } from './crypto';
import { updateSettings } from './settings';

type MakeUserOver = Partial<import('./repositories/usersRepo').CreateUserInput> & {
	email_notifications?: boolean;
	webhook_notifications?: boolean;
};

function makeUser(over: MakeUserOver = {}) {
	const n = Math.random().toString(36).slice(2);
	return usersRepo.createUser({
		email: over.email ?? `u-${n}@x.c`,
		password_hash: 'x',
		display_name: over.display_name ?? `U${n}`,
		calendar_token: null,
		calendar_token_expires_at: null,
		email_notifications: over.email_notifications ?? true,
		webhook_notifications: over.webhook_notifications ?? true,
		...over
	} as import('./repositories/usersRepo').CreateUserInput);
}

test('always writes in-app; emails only when SMTP configured', async () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = makeUser({ email: 'a@x.c', display_name: 'A' });
	await deliver(Number(u.id), { title: 'Hi', body: 'There' });
	expect(db.select().from(notifications).all().length).toBe(1);
	expect(sent.length).toBe(0);
	updateSettings({
		smtpHost: 'smtp.x',
		smtpPort: 587,
		smtpFrom: 'r@x.c',
		smtpPass: encrypt('pw')
	});
	await deliver(Number(u.id), { title: 'Hi2', body: 'There2' });
	expect(sent.length).toBe(1);
	expect(sent[0].to).toBe('a@x.c');
});

test('POSTs JSON to webhookUrl when configured', async () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = makeUser({ email: 'b@x.c', display_name: 'B' });
	updateSettings({ webhookUrl: 'https://hooks.example.com/roamarr' });
	await deliver(Number(u.id), { title: 'T', body: 'B', link: 'https://r/l' });
	expect(fetches.length).toBe(1);
	expect(fetches[0].url).toBe('https://hooks.example.com/roamarr');
	expect(fetches[0].init.method).toBe('POST');
	const headers = fetches[0].init.headers as Record<string, string>;
	expect(headers['Content-Type']).toBe('application/json');
	expect(headers['X-Roamarr-Signature']).toMatch(/^[0-9a-f]{64}$/);
	expect(headers['X-Roamarr-Timestamp']).toMatch(/^\d+$/);
	expect(JSON.parse(fetches[0].init.body as string)).toEqual({
		title: 'T',
		body: 'B',
		link: 'https://r/l'
	});
});

test('respects user channel toggles', async () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = makeUser({
		email: 't@x.c',
		display_name: 'T',
		email_notifications: false,
		webhook_notifications: false
	});
	updateSettings({
		smtpHost: 'smtp.x',
		smtpPort: 587,
		smtpFrom: 'r@x.c',
		smtpPass: encrypt('pw'),
		webhookUrl: 'https://hooks.example.com/roamarr'
	});
	const before = fetches.length;
	const beforeSent = sent.length;
	await deliver(Number(u.id), { title: 'T', body: 'B' });
	expect(db.select().from(notifications).all().length).toBeGreaterThan(0);
	expect(fetches.length).toBe(before);
	expect(sent.length).toBe(beforeSent);
});

test('skips webhook when webhookUrl is not set', async () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const before = fetches.length;
	const u = makeUser({ email: 'c@x.c', display_name: 'C' });
	updateSettings({ webhookUrl: null });
	await deliver(Number(u.id), { title: 'T', body: 'B' });
	expect(fetches.length).toBe(before);
});
