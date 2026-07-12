import { expect, test, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { GET, POST } from './+server';
import { validateOAuthUser } from '$lib/server/auth';
import { makeKitUser } from '../../../../tests/kitHelpers';
import { getSettings } from '$lib/server/settings';

test('admin endpoint rejects ordinary users and strips credential fields', async () => {
	const ordinary = makeKitUser({ email: 'user@example.com', password_hash: 'secret', display_name: 'User' });
	expect(() => GET({ locals: { user: validateOAuthUser(Number(ordinary.id)) } } as any)).toThrow();
	const admin = makeKitUser({ email: 'admin@example.com', password_hash: 'secret', display_name: 'Admin', role: 'admin' });
	const response = GET({ locals: { user: validateOAuthUser(Number(admin.id)) } } as any) as Response;
	const body = await response.json();
	expect(body.users).toHaveLength(2);
	expect(body.users[0]).not.toHaveProperty('passwordHash');
	expect(JSON.stringify(body)).not.toContain('secret');
});

test('admin can create a user through the mobile endpoint', async () => {
	const admin = makeKitUser({ email: 'admin2@example.com', password_hash: 'secret', display_name: 'Admin', role: 'admin' });
	const response = await POST({
		locals: { user: validateOAuthUser(Number(admin.id)) }, url: new URL('https://roamarr.example/api/mobile-admin'),
		request: new Request('https://roamarr.example/api/mobile-admin', { method: 'POST', body: JSON.stringify({ action: 'create', email: 'new@example.com', displayName: 'New' }) })
	} as any) as Response;
	expect(response.status).toBe(201);
	expect(await response.json()).toHaveProperty('temporaryPassword');
});

test('admin maintenance checks run and destructive actions require confirmation', async () => {
	const admin = makeKitUser({ id: 100n, email: 'system@example.com', password_hash: 'secret', display_name: 'Admin', role: 'admin' });
	const event = (action: string, confirm?: boolean) => ({
		locals: { user: validateOAuthUser(Number(admin.id)) }, url: new URL('https://roamarr.example/api/mobile-admin'), getClientAddress: () => '127.0.0.1',
		request: new Request('https://roamarr.example/api/mobile-admin', { method: 'POST', body: JSON.stringify({ action, confirm }) })
	} as any);
	const checked = await POST(event('db-check')) as Response;
	expect(checked.status).toBe(200);
	expect(await checked.json()).toHaveProperty('result');
	await expect(POST(event('db-gc'))).rejects.toMatchObject({ status: 400 });
	const settingsEvent = event('settings') as any;
	settingsEvent.request = new Request('https://roamarr.example/api/mobile-admin', { method: 'POST', body: JSON.stringify({ action: 'settings', instanceName: 'Mobile Managed', allowRegistration: true, defaultTimezone: 'UTC', defaultCurrency: 'USD', defaultDateFormat: 'yyyy-MM-dd', defaultDatetimeFormat: 'yyyy-MM-dd h:mm a', defaultFlightCheckinLeadHours: 24, defaultDocumentExpiryLeadDays: 90, emailPollIntervalMinutes: 5, sessionCookieSameSite: 'strict', mapsTileProvider: 'openstreetmap', globalAiEnabled: true, globalAiAuthMode: 'token', globalAiBaseUrl: 'https://ai.example.com', globalAiModel: 'parser', globalAiToken: 'private-token' }) });
	const saved = await POST(settingsEvent) as Response;
	expect(saved.status).toBe(200);
	expect(getSettings()).toMatchObject({ instanceName: 'Mobile Managed', allowRegistration: true, sessionCookieSameSite: 'strict' });
	const read = GET({ locals: { user: validateOAuthUser(Number(admin.id)) } } as any) as Response;
	const text = await read.text();
	expect(text).not.toContain('private-token');
	expect(JSON.parse(text).settings.globalAiTokenSet).toBe(true);
});
