import { test, expect, vi, beforeEach } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never, kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { _saveAdminSettings as saveAdminSettings, actions, load } from './+page.server';
import { getMapSettings, updateSettings, getSettings } from '$lib/server/settings';
import { users, auditLogs } from '$lib/server/db/schema';
import { users as kitUsers, auditLogs as kitAuditLogs } from '$lib/server/db/mongrelSchema';
import { decrypt } from '$lib/server/crypto';
import { resolveTileConfig } from '$lib/server/mapTiles';
import { eq } from 'drizzle-orm';
import * as usersRepo from '$lib/server/repositories/usersRepo';

function makeUser(email: string, displayName = 'U', role: 'admin' | 'user' = 'user') {
	return usersRepo.createUser({
		email,
		password_hash: 'x',
		display_name: displayName,
		calendar_token: null,
		calendar_token_expires_at: null,
		...(role === 'admin' ? { role: 'admin' } : {})
	} as any);
}

beforeEach(() => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const kit = (ctx as { kit: import('@mongreldb/kit').KitDatabase }).kit;
	db.delete(auditLogs).run();
	db.delete(users).run();
	kit.deleteFrom(kitAuditLogs).executeSync();
	kit.deleteFrom(kitUsers).executeSync();
});

test('saves settings, default leads and encrypts smtp pass', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = makeUser('u@x.c');
	saveAdminSettings(Number(u.id), {
		instanceName: 'R',
		allowRegistration: true,
		defaultTimezone: 'UTC',
		defaultCurrency: 'USD',
		defaultFlightCheckinLeadHours: 48,
		defaultDocumentExpiryLeadDays: 60,
		smtpHost: 'smtp.x',
		smtpPort: 587,
		smtpUser: 'u',
		smtpPass: 'pw',
		smtpFrom: 'r@x.c',
		webhookUrl: 'https://hooks.example.com/roamarr'
	});
	const s = getSettings();
	expect(s.allowRegistration).toBe(true);
	expect(s.defaultCurrency).toBe('USD');
	expect(s.defaultFlightCheckinLeadHours).toBe(48);
	expect(s.defaultDocumentExpiryLeadDays).toBe(60);
	expect(decrypt(s.smtpPass!)).toBe('pw');
	expect(s.webhookUrl).toBe('https://hooks.example.com/roamarr');

	const logs = db.select().from(auditLogs).where(eq(auditLogs.userId, Number(u.id))).all();
	expect(logs).toHaveLength(1);
	expect(logs[0].action).toBe('settings_update');
	expect(logs[0].entityType).toBe('settings');
	expect(JSON.parse(logs[0].metaJson).smtpPassSet).toBe(true);
});

test('rejects invalid default reminder leads', () => {
	const u = makeUser('leads@x.c');
	expect(() =>
		saveAdminSettings(Number(u.id), {
			instanceName: 'R',
			allowRegistration: true,
			defaultTimezone: 'UTC',
			defaultCurrency: 'USD',
			defaultFlightCheckinLeadHours: -1,
			defaultDocumentExpiryLeadDays: 90
		})
	).toThrow('Default flight check-in lead must be a non-negative integer');
	expect(() =>
		saveAdminSettings(Number(u.id), {
			instanceName: 'R',
			allowRegistration: true,
			defaultTimezone: 'UTC',
			defaultCurrency: 'USD',
			defaultFlightCheckinLeadHours: 24,
			defaultDocumentExpiryLeadDays: 1.5
		})
	).toThrow('Default document expiry lead must be a non-negative integer');
});

test('omitting smtpPass preserves the existing encrypted value', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = makeUser('preserve@x.c');
	const before = getSettings().smtpPass;
	saveAdminSettings(Number(u.id), {
		instanceName: 'R2',
		allowRegistration: false,
		defaultTimezone: 'UTC',
		defaultCurrency: 'EUR',
		defaultFlightCheckinLeadHours: 24,
		defaultDocumentExpiryLeadDays: 90
	});
	const after = getSettings().smtpPass;
	expect(after).toBe(before);

	const logs = db.select().from(auditLogs).where(eq(auditLogs.userId, Number(u.id))).all();
	expect(logs).toHaveLength(1);
	expect(JSON.parse(logs[0].metaJson).smtpPassSet).toBe(false);
});

test('saves empty webhookUrl as null', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = makeUser('webhook@x.c');
	saveAdminSettings(Number(u.id), {
		instanceName: 'R',
		allowRegistration: false,
		defaultTimezone: 'UTC',
		defaultCurrency: 'GBP',
		defaultFlightCheckinLeadHours: 24,
		defaultDocumentExpiryLeadDays: 90,
		webhookUrl: ''
	});
	const s = getSettings();
	expect(s.webhookUrl).toBeNull();
});

test('load includes recent audit log entries for admins', () => {
	const u = makeUser('audit-admin@x.c', 'Admin', 'admin');
	saveAdminSettings(Number(u.id), {
		instanceName: 'R',
		allowRegistration: false,
		defaultTimezone: 'UTC',
		defaultCurrency: 'USD',
		defaultFlightCheckinLeadHours: 24,
		defaultDocumentExpiryLeadDays: 90
	});

	const data = load({ locals: { user: { id: Number(u.id), role: 'admin' } } as App.Locals } as any) as {
		recentLogs: { action: string }[];
	};
	expect(data.recentLogs).toHaveLength(1);
	expect(data.recentLogs[0].action).toBe('settings_update');
});

test('save action sets a flash cookie and redirects', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = makeUser('admin@x.c', 'Admin', 'admin');
	const cookies = { set: vi.fn(), get: vi.fn() };
	const request = new Request('http://x/settings', {
		method: 'POST',
		body: new URLSearchParams({
			instanceName: 'R',
			allowRegistration: 'on',
			defaultTimezone: 'UTC',
			defaultCurrency: 'USD',
			defaultFlightCheckinLeadHours: '24',
			defaultDocumentExpiryLeadDays: '90'
		})
	});
	const locals = { user: { id: Number(u.id), role: 'admin' } } as App.Locals;
	await expect(actions.save({ request, locals, cookies } as any)).rejects.toMatchObject({
		status: 303,
		location: '/settings'
	});
	expect(cookies.set).toHaveBeenCalledWith('flash', 'Settings saved.', expect.any(Object));
});

test('getMapSettings reflects imported city count', () => {
	updateSettings({ mapsEnabled: true, mapsTileProvider: 'carto' });
	const m = getMapSettings();
	expect(m.mapsEnabled).toBe(true);
	expect(m.mapsTileProvider).toBe('carto');
	expect(m.cityCount).toBe(0);
});

test('map tile API key is encrypted at rest and decrypts for tile config', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = makeUser('tilekey@x.c');
	saveAdminSettings(Number(u.id), {
		instanceName: 'R',
		allowRegistration: false,
		defaultTimezone: 'UTC',
		defaultCurrency: 'USD',
		defaultFlightCheckinLeadHours: 24,
		defaultDocumentExpiryLeadDays: 90,
		mapsTileApiKey: 'secret-tile-key'
	});

	const raw = getSettings().mapsTileApiKey;
	expect(raw).not.toBe('secret-tile-key');
	expect(decrypt(raw!)).toBe('secret-tile-key');

	const config = resolveTileConfig();
	expect(config?.apiKey).toBe('secret-tile-key');
	expect(getMapSettings().mapsTileApiKey).toBe('********');
});
