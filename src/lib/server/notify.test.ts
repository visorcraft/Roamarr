import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
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
import { users, notifications, settings } from './db/schema';
import { eq } from 'drizzle-orm';
import { encrypt } from './crypto';

test('always writes in-app; emails only when SMTP configured', async () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db
		.insert(users)
		.values({ email: 'a@x.c', passwordHash: 'x', displayName: 'A' })
		.returning()
		.get();
	await deliver(u.id, { title: 'Hi', body: 'There' });
	expect(db.select().from(notifications).all().length).toBe(1);
	expect(sent.length).toBe(0);
	db.update(settings)
		.set({
			smtpHost: 'smtp.x',
			smtpPort: 587,
			smtpFrom: 'r@x.c',
			smtpPass: encrypt('pw')
		})
		.where(eq(settings.id, 1))
		.run();
	await deliver(u.id, { title: 'Hi2', body: 'There2' });
	expect(sent.length).toBe(1);
	expect(sent[0].to).toBe('a@x.c');
});

test('POSTs JSON to webhookUrl when configured', async () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db
		.insert(users)
		.values({ email: 'b@x.c', passwordHash: 'x', displayName: 'B' })
		.returning()
		.get();
	db.update(settings)
		.set({ webhookUrl: 'https://hooks.example.com/roamarr' })
		.where(eq(settings.id, 1))
		.run();
	await deliver(u.id, { title: 'T', body: 'B', link: 'https://r/l' });
	expect(fetches.length).toBe(1);
	expect(fetches[0].url).toBe('https://hooks.example.com/roamarr');
	expect(fetches[0].init.method).toBe('POST');
	expect(fetches[0].init.headers).toEqual({ 'Content-Type': 'application/json' });
	expect(JSON.parse(fetches[0].init.body as string)).toEqual({
		title: 'T',
		body: 'B',
		link: 'https://r/l'
	});
});

test('skips webhook when webhookUrl is not set', async () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const before = fetches.length;
	const u = db
		.insert(users)
		.values({ email: 'c@x.c', passwordHash: 'x', displayName: 'C' })
		.returning()
		.get();
	db.update(settings).set({ webhookUrl: null }).where(eq(settings.id, 1)).run();
	await deliver(u.id, { title: 'T', body: 'B' });
	expect(fetches.length).toBe(before);
});
