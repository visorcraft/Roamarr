import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { _saveAdminSettings as saveAdminSettings, actions, load } from './+page.server';
import { getMapSettings, updateSettings } from '$lib/server/settings';
import { settings, auditLogs } from '$lib/server/db/schema';
import { decrypt } from '$lib/server/crypto';
import { resolveTileConfig } from '$lib/server/mapTiles';
import { makeUser } from '../../../tests/helpers';
import { eq } from 'drizzle-orm';
import { beforeEach } from 'vitest';

beforeEach(() => {
	(ctx as any).sqlite.exec('delete from users;');
});

test('saves settings, default leads and encrypts smtp pass', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = makeUser(db);
	saveAdminSettings(u.id, {
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
	const s = db.select().from(settings).where(eq(settings.id, 1)).get()!;
	expect(s.allowRegistration).toBe(true);
	expect(s.defaultCurrency).toBe('USD');
	expect(s.defaultFlightCheckinLeadHours).toBe(48);
	expect(s.defaultDocumentExpiryLeadDays).toBe(60);
	expect(decrypt(s.smtpPass!)).toBe('pw');
	expect(s.webhookUrl).toBe('https://hooks.example.com/roamarr');

	const logs = db.select().from(auditLogs).where(eq(auditLogs.userId, u.id)).all();
	expect(logs).toHaveLength(1);
	expect(logs[0].action).toBe('settings_update');
	expect(logs[0].entityType).toBe('settings');
	expect(JSON.parse(logs[0].metaJson).smtpPassSet).toBe(true);
});

test('rejects invalid default reminder leads', () => {
	const u = makeUser((ctx as { db: import('$lib/server/db').DB }).db, { email: 'leads@x.c' });
	expect(() =>
		saveAdminSettings(u.id, {
			instanceName: 'R',
			allowRegistration: true,
			defaultTimezone: 'UTC',
			defaultCurrency: 'USD',
			defaultFlightCheckinLeadHours: -1,
			defaultDocumentExpiryLeadDays: 90
		})
	).toThrow('Default flight check-in lead must be a non-negative integer');
	expect(() =>
		saveAdminSettings(u.id, {
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
	const u = makeUser(db, { email: 'preserve@x.c' });
	const before = db.select().from(settings).where(eq(settings.id, 1)).get()!.smtpPass;
	saveAdminSettings(u.id, {
		instanceName: 'R2',
		allowRegistration: false,
		defaultTimezone: 'UTC',
		defaultCurrency: 'EUR',
		defaultFlightCheckinLeadHours: 24,
		defaultDocumentExpiryLeadDays: 90
	});
	const after = db.select().from(settings).where(eq(settings.id, 1)).get()!.smtpPass;
	expect(after).toBe(before);

	const logs = db.select().from(auditLogs).where(eq(auditLogs.userId, u.id)).all();
	expect(logs).toHaveLength(1);
	expect(JSON.parse(logs[0].metaJson).smtpPassSet).toBe(false);
});

test('saves empty webhookUrl as null', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = makeUser(db, { email: 'webhook@x.c' });
	saveAdminSettings(u.id, {
		instanceName: 'R',
		allowRegistration: false,
		defaultTimezone: 'UTC',
		defaultCurrency: 'GBP',
		defaultFlightCheckinLeadHours: 24,
		defaultDocumentExpiryLeadDays: 90,
		webhookUrl: ''
	});
	const s = db.select().from(settings).where(eq(settings.id, 1)).get()!;
	expect(s.webhookUrl).toBeNull();
});

test('load includes recent audit log entries for admins', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = makeUser(db, { email: 'audit-admin@x.c', role: 'admin' });
	saveAdminSettings(u.id, {
		instanceName: 'R',
		allowRegistration: false,
		defaultTimezone: 'UTC',
		defaultCurrency: 'USD',
		defaultFlightCheckinLeadHours: 24,
		defaultDocumentExpiryLeadDays: 90
	});

	const data = load({ locals: { user: u } as App.Locals } as any) as { recentLogs: { action: string }[] };
	expect(data.recentLogs).toHaveLength(1);
	expect(data.recentLogs[0].action).toBe('settings_update');
});

test('save action sets a flash cookie and redirects', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = makeUser(db, { email: 'admin@x.c', role: 'admin' });
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
	const locals = { user: u } as App.Locals;
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
	const u = makeUser(db, { email: 'tilekey@x.c' });
	saveAdminSettings(u.id, {
		instanceName: 'R',
		allowRegistration: false,
		defaultTimezone: 'UTC',
		defaultCurrency: 'USD',
		defaultFlightCheckinLeadHours: 24,
		defaultDocumentExpiryLeadDays: 90,
		mapsTileApiKey: 'secret-tile-key'
	});

	const raw = db.select().from(settings).where(eq(settings.id, 1)).get()!.mapsTileApiKey;
	expect(raw).not.toBe('secret-tile-key');
	expect(decrypt(raw!)).toBe('secret-tile-key');

	const config = resolveTileConfig();
	expect(config?.apiKey).toBe('secret-tile-key');
	expect(getMapSettings().mapsTileApiKey).toBe('********');
});
