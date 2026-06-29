import { test, expect, vi, beforeEach } from 'vitest';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});
vi.mock('$lib/server/notify', () => ({
	sendMail: vi.fn(async () => true)
}));

import { actions, load } from './+page.server';
import { sendMail } from '$lib/server/notify';
import { getUserSmtpOverride } from '$lib/server/smtpConfig';
import { users, auditLogs } from '$lib/server/db/mongrelSchema';
import { makeUser } from '../../../../tests/helpers';
import { checkRateLimit, resetRateLimit, DEFAULT_MAX_ATTEMPTS } from '$lib/server/rateLimit';
import type { KitDatabase } from '@mongreldb/kit';

function kitDb(): KitDatabase {
	return (ctx as { kit: KitDatabase }).kit;
}

function makeLocals(u: { id: number; role: string; email?: string }) {
	return { user: { id: u.id, role: u.role, email: u.email } } as App.Locals;
}

function makeFormEvent(
	u: { id: number; role: string; email: string },
	record: Record<string, string>,
	action: string,
	ip = '1.2.3.4'
) {
	const form = new FormData();
	for (const [k, v] of Object.entries(record)) form.set(k, v);
	return {
		locals: makeLocals(u),
		cookies: { set: vi.fn(), get: vi.fn() },
		getClientAddress: () => ip,
		request: new Request(`http://localhost/profile/notifications?/${action}`, {
			method: 'POST',
			body: form
		})
	} as any;
}

beforeEach(() => {
	resetRateLimit();
	const kit = kitDb();
	kit.deleteFrom(auditLogs).executeSync();
	kit.deleteFrom(users).executeSync();
	vi.clearAllMocks();
});

test('load returns no override by default', async () => {
	const u = makeUser(kitDb(), { email: 'u@x.c' });
	const data = (await load({ locals: makeLocals(u) } as any)) as { override: unknown };
	expect(data.override).toBeNull();
});

test('save action persists an SMTP override and redirects', async () => {
	const u = makeUser(kitDb(), { email: 'u@x.c' });
	const event = makeFormEvent(
		u,
		{
			enabled: 'on',
			host: 'smtp.x.c',
			port: '587',
			security: 'starttls',
			username: 'u@x.c',
			password: 'secret',
			fromAddress: 'u@x.c'
		},
		'save'
	);
	await expect(actions.save(event)).rejects.toMatchObject({
		status: 303,
		location: '/profile/notifications'
	});
	const override = getUserSmtpOverride(u.id);
	expect(override).not.toBeNull();
	expect(override!.enabled).toBe(true);
	expect(override!.host).toBe('smtp.x.c');
	expect(override!.security).toBe('starttls');
	expect(override!.passwordSet).toBe(true);
	expect(event.cookies.set).toHaveBeenCalledWith(
		'flash',
		'SMTP override saved and enabled.',
		expect.any(Object)
	);
});

test('save action rejects invalid transport security', async () => {
	const u = makeUser(kitDb(), { email: 'u@x.c' });
	const result = (await actions.save(
		makeFormEvent(u, { enabled: 'on', host: 'smtp.x.c', fromAddress: 'u@x.c', security: 'tls' }, 'save')
	)) as { status: number; data: { error: string } };
	expect(result.status).toBe(400);
	expect(result.data.error).toBe('Invalid transport security');
});

test('disable action removes the override and redirects', async () => {
	const u = makeUser(kitDb(), { email: 'u@x.c' });
	const event = makeFormEvent(u, { enabled: 'on', host: 'smtp.x.c', fromAddress: 'u@x.c' }, 'save');
	await expect(actions.save(event)).rejects.toMatchObject({ status: 303 });
	expect(getUserSmtpOverride(u.id)).not.toBeNull();

	const disableEvent = {
		locals: makeLocals(u),
		cookies: { set: vi.fn(), get: vi.fn() },
		getClientAddress: () => '1.2.3.4',
		request: new Request('http://localhost/profile/notifications?/disable', { method: 'POST' })
	} as any;
	await expect(actions.disable(disableEvent)).rejects.toMatchObject({
		status: 303,
		location: '/profile/notifications'
	});
	expect(getUserSmtpOverride(u.id)).toBeNull();
});

test('testEmail action sends a test message and redirects', async () => {
	const u = makeUser(kitDb(), { email: 'u@x.c' });
	const event = {
		locals: makeLocals(u),
		cookies: { set: vi.fn(), get: vi.fn() },
		getClientAddress: () => '1.2.3.4',
		request: new Request('http://localhost/profile/notifications?/testEmail', { method: 'POST' })
	} as any;
	await expect(actions.testEmail(event)).rejects.toMatchObject({
		status: 303,
		location: '/profile/notifications'
	});
	expect(sendMail).toHaveBeenCalledWith(
		u.email,
		expect.objectContaining({ title: expect.stringContaining('SMTP test') }),
		u.id
	);
	expect(event.cookies.set).toHaveBeenCalledWith('flash', 'Test email sent.', expect.any(Object));
});

test('testEmail action returns 429 when rate limited', async () => {
	const ip = '9.9.9.9';
	for (let i = 0; i < DEFAULT_MAX_ATTEMPTS; i++) checkRateLimit(ip, 'profile_notifications_test_email');
	const u = makeUser(kitDb(), { email: 'rl@x.c' });
	const result = (await actions.testEmail({
		locals: makeLocals(u),
		cookies: { set: vi.fn() },
		getClientAddress: () => ip,
		request: new Request('http://localhost/profile/notifications?/testEmail', { method: 'POST' })
	} as any)) as { status: number; data: { error: string; retryAfter?: number } };
	expect(result.status).toBe(429);
	expect(result.data.error).toMatch(/too many/i);
	expect(result.data.retryAfter).toBeGreaterThan(0);
});
