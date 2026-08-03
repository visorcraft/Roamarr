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
import { getSettings, updateSettings } from '$lib/server/settings';

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

// Baseline fields the settings action requires (numeric fields have no defaults).
const settingsBaseline = {
	action: 'settings', instanceName: 'Roamarr', defaultTimezone: 'UTC', defaultCurrency: 'USD',
	defaultDateFormat: 'yyyy-MM-dd', defaultDatetimeFormat: 'yyyy-MM-dd h:mm a',
	defaultFlightCheckinLeadHours: 24, defaultDocumentExpiryLeadDays: 90, emailPollIntervalMinutes: 5,
	mapsTileProvider: 'openstreetmap'
};

function settingsEvent(admin: { id: number | bigint }, patch: Record<string, unknown>) {
	return {
		locals: { user: validateOAuthUser(Number(admin.id)) }, url: new URL('https://roamarr.example/api/mobile-admin'),
		getClientAddress: () => '127.0.0.1',
		request: new Request('https://roamarr.example/api/mobile-admin', { method: 'POST', body: JSON.stringify({ ...settingsBaseline, ...patch }) })
	} as any;
}

test('backup and ntfy settings round-trip with the token masked', async () => {
	const admin = makeKitUser({ id: 200n, email: 'admin3@example.com', password_hash: 'secret', display_name: 'Admin', role: 'admin' });
	const saved = await POST(settingsEvent(admin, {
		backupAutoEnabled: true, backupIntervalHours: 12, backupRetentionCount: 3,
		ntfyServerUrl: 'https://ntfy.example.com', ntfyTopic: 'roamarr-alerts', ntfyToken: 'mobile-ntfy-secret'
	})) as Response;
	expect(saved.status).toBe(200);
	expect(getSettings()).toMatchObject({
		backupAutoEnabled: true, backupIntervalHours: 12, backupRetentionCount: 3,
		ntfyServerUrl: 'https://ntfy.example.com', ntfyTopic: 'roamarr-alerts'
	});

	const read = GET({ locals: { user: validateOAuthUser(Number(admin.id)) } } as any) as Response;
	const text = await read.text();
	expect(text).not.toContain('mobile-ntfy-secret');
	const settings = JSON.parse(text).settings;
	expect(settings).toMatchObject({
		backupAutoEnabled: true, backupIntervalHours: 12, backupRetentionCount: 3,
		ntfyServerUrl: 'https://ntfy.example.com', ntfyTopic: 'roamarr-alerts', ntfyTokenSet: true
	});
	expect(typeof settings.backupStoredCount).toBe('number');
	expect(settings.backupStoredCount).toBeGreaterThanOrEqual(0);
});

test('GET exposes the last auto-backup timestamp', async () => {
	const admin = makeKitUser({ id: 201n, email: 'admin4@example.com', password_hash: 'secret', display_name: 'Admin', role: 'admin' });
	updateSettings({ backupLastAutoAt: '2026-08-01T00:00:00.000Z' });
	const read = GET({ locals: { user: validateOAuthUser(Number(admin.id)) } } as any) as Response;
	const settings = (await read.json()).settings;
	expect(settings.backupLastAutoAt).toBe('2026-08-01T00:00:00.000Z');
	updateSettings({ backupLastAutoAt: null });
});

test('omitted backup and ntfy fields keep their current values', async () => {
	const admin = makeKitUser({ id: 202n, email: 'admin5@example.com', password_hash: 'secret', display_name: 'Admin', role: 'admin' });
	await POST(settingsEvent(admin, {
		backupAutoEnabled: true, backupIntervalHours: 48, backupRetentionCount: 5,
		ntfyServerUrl: 'https://ntfy.example.com', ntfyTopic: 'keep-me', ntfyToken: 'keep-secret'
	}));
	const saved = await POST(settingsEvent(admin, { instanceName: 'Renamed Instance' })) as Response;
	expect(saved.status).toBe(200);
	const current = getSettings();
	expect(current).toMatchObject({
		backupAutoEnabled: true, backupIntervalHours: 48, backupRetentionCount: 5,
		ntfyServerUrl: 'https://ntfy.example.com', ntfyTopic: 'keep-me'
	});
	expect(current.ntfyToken).toBeTruthy();
});

test('ntfy token clears on explicit null and via clearNtfyToken', async () => {
	const admin = makeKitUser({ id: 203n, email: 'admin6@example.com', password_hash: 'secret', display_name: 'Admin', role: 'admin' });
	await POST(settingsEvent(admin, { ntfyToken: 'clear-me' }));
	expect(getSettings().ntfyToken).toBeTruthy();
	await POST(settingsEvent(admin, { ntfyToken: null }));
	expect(getSettings().ntfyToken).toBeNull();
	await POST(settingsEvent(admin, { ntfyToken: 'clear-me-again' }));
	await POST(settingsEvent(admin, { clearNtfyToken: true }));
	expect(getSettings().ntfyToken).toBeNull();
});

test('backup and ntfy validation rejects out-of-range or malformed values', async () => {
	const admin = makeKitUser({ id: 204n, email: 'admin7@example.com', password_hash: 'secret', display_name: 'Admin', role: 'admin' });
	const before = getSettings();
	await expect(POST(settingsEvent(admin, { backupIntervalHours: 0 }))).rejects.toMatchObject({ status: 400 });
	await expect(POST(settingsEvent(admin, { backupIntervalHours: 721 }))).rejects.toMatchObject({ status: 400 });
	await expect(POST(settingsEvent(admin, { backupIntervalHours: 1.5 }))).rejects.toMatchObject({ status: 400 });
	await expect(POST(settingsEvent(admin, { backupRetentionCount: 0 }))).rejects.toMatchObject({ status: 400 });
	await expect(POST(settingsEvent(admin, { backupRetentionCount: 101 }))).rejects.toMatchObject({ status: 400 });
	await expect(POST(settingsEvent(admin, { ntfyTopic: 'bad topic!' }))).rejects.toMatchObject({ status: 400 });
	await expect(POST(settingsEvent(admin, { ntfyServerUrl: 'http://ntfy.example.com' }))).rejects.toMatchObject({ status: 400 });
	await expect(POST(settingsEvent(admin, { ntfyServerUrl: 'https://user:pass@ntfy.example.com' }))).rejects.toMatchObject({ status: 400 });
	// Failed validation must not partially save anything.
	const after = getSettings();
	expect(after).toMatchObject({
		backupAutoEnabled: before.backupAutoEnabled,
		backupIntervalHours: before.backupIntervalHours,
		backupRetentionCount: before.backupRetentionCount,
		ntfyServerUrl: before.ntfyServerUrl,
		ntfyTopic: before.ntfyTopic
	});
});
