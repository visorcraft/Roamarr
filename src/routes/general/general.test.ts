import { test, expect, vi, beforeEach } from 'vitest';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});
vi.mock('$lib/server/notify', () => ({
	sendMail: vi.fn(async () => true),
	deliver: vi.fn(async () => undefined)
}));

import { _saveAdminSettings as saveAdminSettings, actions, load } from './+page.server';
import { getMapSettings, updateSettings, getSettings } from '$lib/server/settings';
import { users, auditLogs, settings } from '$lib/server/db/mongrelSchema';
import { decrypt } from '$lib/server/crypto';
import { resolveTileConfig } from '$lib/server/mapTiles';
import { eq } from '@visorcraft/mongreldb-kit';
import * as usersRepo from '$lib/server/repositories/usersRepo';
import { checkRateLimit, resetRateLimit, DEFAULT_MAX_ATTEMPTS } from '$lib/server/rateLimit';

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
	resetRateLimit();
	const kit = (ctx as { kit: import('@visorcraft/mongreldb-kit').KitDatabase }).kit;
	kit.deleteFrom(settings).executeSync();
	kit.deleteFrom(auditLogs).executeSync();
	kit.deleteFrom(users).executeSync();
});

test('saves settings, default leads and encrypts smtp pass', () => {
	const kit = (ctx as { kit: import('@visorcraft/mongreldb-kit').KitDatabase }).kit;
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
		allowUserImap: false,
		allowUserSmtp: true,
		allowUserParsingProviders: true,
		globalImapEnabled: true,
		globalImapHost: 'imap.x',
		globalImapPassword: 'imap-pw',
		globalAiEnabled: true,
		globalAiBaseUrl: 'https://ai.example/v1',
		globalAiModel: 'travel',
		globalAiToken: 'ai-token',
		webhookUrl: 'https://hooks.example.com/roamarr'
	});
	const s = getSettings();
	expect(s.allowRegistration).toBe(true);
	expect(s.defaultCurrency).toBe('USD');
	expect(s.defaultFlightCheckinLeadHours).toBe(48);
	expect(s.defaultDocumentExpiryLeadDays).toBe(60);
	expect(decrypt(s.smtpPass!)).toBe('pw');
	expect([s.allowUserImap, s.allowUserSmtp, s.allowUserParsingProviders]).toEqual([false, true, true]);
	expect(decrypt(s.globalImapPassword!)).toBe('imap-pw');
	expect(decrypt(s.globalAiToken!)).toBe('ai-token');
	expect(s.webhookUrl).toBe('https://hooks.example.com/roamarr');

	const logs = kit.selectFrom(auditLogs).where(eq(auditLogs.user_id, BigInt(u.id))).executeSync();
	expect(logs).toHaveLength(1);
	expect(logs[0].action).toBe('settings_update');
	expect(logs[0].entity_type).toBe('settings');
	expect(JSON.parse(logs[0].meta_json as string).smtpPassSet).toBe(true);
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
	const kit = (ctx as { kit: import('@visorcraft/mongreldb-kit').KitDatabase }).kit;
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

	const logs = kit.selectFrom(auditLogs).where(eq(auditLogs.user_id, BigInt(u.id))).executeSync();
	expect(logs).toHaveLength(1);
	expect(JSON.parse(logs[0].meta_json as string).smtpPassSet).toBe(false);
});

test('saves empty webhookUrl as null', () => {
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

test('save action sets a flash cookie and redirects', async () => {
	const u = makeUser('admin@x.c', 'Admin', 'admin');
	const cookies = { set: vi.fn(), get: vi.fn() };
	const request = new Request('http://x/general', {
		method: 'POST',
		body: new URLSearchParams({
			instanceName: 'R',
			allowRegistration: 'on',
			defaultTimezone: 'UTC',
			defaultCurrency: 'USD',
			defaultFlightCheckinLeadHours: '24',
			defaultDocumentExpiryLeadDays: '90',
			sessionCookieSameSite: 'lax'
		})
	});
	const locals = { user: { id: Number(u.id), role: 'admin' } } as App.Locals;
	await expect(actions.save({ request, locals, cookies, url: new URL('http://x/general') } as any)).rejects.toMatchObject({
		status: 303,
		location: '/general'
	});
	expect(cookies.set).toHaveBeenCalledWith('flash', 'Settings saved.', expect.any(Object));
});

test('email section save preserves other email settings', async () => {
	const u = makeUser('email-sections@x.c', 'Admin', 'admin');
	updateSettings({ smtpHost: 'smtp.example.com', allowUserImap: false });
	const request = new Request('http://x/general/email?section=access', {
		method: 'POST', body: new URLSearchParams({ section: 'access', allowUserImap: 'on' })
	});
	await expect(actions.saveEmail({ request, locals: { user: { id: Number(u.id), role: 'admin' } }, cookies: { set: vi.fn() } } as any))
		.rejects.toMatchObject({ status: 303, location: '/general/email?section=access' });
	expect(getSettings()).toMatchObject({ allowUserImap: true, smtpHost: 'smtp.example.com' });
});

test('getMapSettings reflects imported city count', () => {
	updateSettings({ mapsEnabled: true, mapsTileProvider: 'carto' });
	const m = getMapSettings();
	expect(m.mapsEnabled).toBe(true);
	expect(m.mapsTileProvider).toBe('carto');
	expect(m.cityCount).toBe(0);
});

test('disable maps stays on the Maps tab', async () => {
	const u = makeUser('maps-disable@x.c', 'Admin', 'admin');
	updateSettings({ mapsEnabled: true });
	const cookies = { set: vi.fn() };

	await expect(
		actions.disableMaps({
			locals: { user: { id: Number(u.id), role: 'admin' } } as App.Locals,
			cookies
		} as any)
	).rejects.toMatchObject({ status: 303, location: '/general/maps' });
	expect(getMapSettings().mapsEnabled).toBe(false);
	expect(cookies.set).toHaveBeenCalledWith('flash', expect.stringContaining('Maps disabled'), expect.any(Object));
});

test('map tile API key is encrypted at rest and decrypts for tile config', () => {
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

test('place search provider config: encryption round-trip, masking, provider switch', () => {
	// Defaults: Nominatim, no key.
	expect(getSettings().placeSearchProvider).toBe('nominatim');
	expect(getSettings().placeSearchGoogleApiKey).toBeNull();
	expect(getMapSettings().placeSearchGoogleApiKey).toBe('');

	const u = makeUser('placesearch@x.c');
	saveAdminSettings(Number(u.id), {
		placeSearchProvider: 'google',
		placeSearchGoogleApiKey: 'google-secret-key'
	});

	const raw = getSettings().placeSearchGoogleApiKey;
	expect(raw).not.toBe('google-secret-key');
	expect(decrypt(raw!)).toBe('google-secret-key');
	expect(getSettings().placeSearchProvider).toBe('google');
	expect(getMapSettings().placeSearchProvider).toBe('google');
	expect(getMapSettings().placeSearchGoogleApiKey).toBe('********');

	// Switching provider without touching the key keeps the stored secret.
	saveAdminSettings(Number(u.id), { placeSearchProvider: 'nominatim' });
	expect(getSettings().placeSearchProvider).toBe('nominatim');
	expect(decrypt(getSettings().placeSearchGoogleApiKey!)).toBe('google-secret-key');

	// Explicit clear removes the key and unmasks the UI value.
	saveAdminSettings(Number(u.id), { placeSearchGoogleApiKey: null });
	expect(getSettings().placeSearchGoogleApiKey).toBeNull();
	expect(getMapSettings().placeSearchGoogleApiKey).toBe('');

	// Unknown providers are rejected.
	expect(() => saveAdminSettings(Number(u.id), { placeSearchProvider: 'bogus' as never })).toThrow(
		'Invalid place search provider'
	);
});

test('smtpSecurity round-trips', () => {
	const u = makeUser('smtpsec@x.c');
	saveAdminSettings(Number(u.id), {
		instanceName: 'R',
		allowRegistration: false,
		defaultTimezone: 'UTC',
		defaultCurrency: 'USD',
		defaultFlightCheckinLeadHours: 24,
		defaultDocumentExpiryLeadDays: 90,
		smtpSecurity: 'ssl/tls'
	});
	expect(getSettings().smtpSecurity).toBe('ssl/tls');
});

test('sessionCookieSameSite round-trips and defaults to lax', () => {
	const u = makeUser('samesite@x.c');
	saveAdminSettings(Number(u.id), {
		instanceName: 'R',
		allowRegistration: false,
		defaultTimezone: 'UTC',
		defaultCurrency: 'USD',
		defaultFlightCheckinLeadHours: 24,
		defaultDocumentExpiryLeadDays: 90
	});
	expect(getSettings().sessionCookieSameSite).toBe('lax');

	saveAdminSettings(Number(u.id), {
		instanceName: 'R',
		allowRegistration: false,
		defaultTimezone: 'UTC',
		defaultCurrency: 'USD',
		defaultFlightCheckinLeadHours: 24,
		defaultDocumentExpiryLeadDays: 90,
		sessionCookieSameSite: 'strict'
	});
	expect(getSettings().sessionCookieSameSite).toBe('strict');
});

test('save action rejects invalid sessionCookieSameSite', async () => {
	const u = makeUser('samesite-bad@x.c', 'Admin', 'admin');
	const request = new Request('http://x/general', {
		method: 'POST',
		body: new URLSearchParams({
			instanceName: 'R',
			allowRegistration: 'on',
			defaultTimezone: 'UTC',
			defaultCurrency: 'USD',
			defaultFlightCheckinLeadHours: '24',
			defaultDocumentExpiryLeadDays: '90',
			sessionCookieSameSite: 'none'
		})
	});
	const result = (await actions.save({
		request,
		locals: { user: { id: Number(u.id), role: 'admin' } } as App.Locals,
		cookies: { set: vi.fn() }
	} as any)) as { status: number; data: { error: string } };
	expect(result.status).toBe(400);
	expect(result.data.error).toMatch(/invalid SameSite value/i);
});

test('oauthClientAllowList round-trips and clears when empty', () => {
	const u = makeUser('oauth-allow@x.c');
	saveAdminSettings(Number(u.id), {
		instanceName: 'R',
		allowRegistration: false,
		defaultTimezone: 'UTC',
		defaultCurrency: 'USD',
		defaultFlightCheckinLeadHours: 24,
		defaultDocumentExpiryLeadDays: 90,
		allowUserMcpClients: false,
		allowMcpPii: true,
		oauthClientAllowList: ['client-a', 'client-b']
	});
	expect(getSettings().allowUserMcpClients).toBe(false);
	expect(getSettings().allowMcpPii).toBe(true);
	expect(getSettings().oauthClientAllowList).toEqual(['client-a', 'client-b']);

	saveAdminSettings(Number(u.id), {
		instanceName: 'R',
		allowRegistration: false,
		defaultTimezone: 'UTC',
		defaultCurrency: 'USD',
		defaultFlightCheckinLeadHours: 24,
		defaultDocumentExpiryLeadDays: 90,
		oauthClientAllowList: null
	});
	expect(getSettings().oauthClientAllowList).toBeNull();
});

test('private MCP details are disabled by default', () => {
	expect(getSettings().allowMcpPii).toBe(false);
});

test('saveOauth updates the private MCP details gate', async () => {
	const u = makeUser('mcp-admin@x.c', 'Admin', 'admin');
	const save = async (enabled: boolean) => {
		const form = new FormData();
		if (enabled) form.set('allowMcpPii', 'on');
		await expect(actions.saveOauth({
			request: { formData: async () => form },
			locals: { user: { id: Number(u.id), role: 'admin' } } as App.Locals,
			cookies: { set: vi.fn() }
		} as any)).rejects.toMatchObject({
			status: 303,
			location: '/general/mcp-clients'
		});
	};

	await save(true);
	expect(getSettings().allowMcpPii).toBe(true);
	await save(false);
	expect(getSettings().allowMcpPii).toBe(false);
});

test('saveOidc stores provider config and encrypts the client secret', async () => {
	const u = makeUser('oidc-admin@x.c', 'Admin', 'admin');
	const form = new FormData();
	form.set('oidcEnabled', 'on');
	form.set('oidcDiscoveryUrl', 'https://idp.example.com');
	form.set('oidcClientId', 'roamarr');
	form.set('oidcClientSecret', 'shh-secret');
	form.set('oidcDisplayName', 'Authentik');
	await expect(actions.saveOidc({
		request: { formData: async () => form },
		locals: { user: { id: Number(u.id), role: 'admin' } } as App.Locals,
		cookies: { set: vi.fn() }
	} as any)).rejects.toMatchObject({
		status: 303,
		location: '/general/mcp-clients'
	});
	const s = getSettings();
	expect(s.oidcEnabled).toBe(true);
	expect(s.oidcDiscoveryUrl).toBe('https://idp.example.com');
	expect(s.oidcClientId).toBe('roamarr');
	expect(s.oidcClientSecret).not.toBe('shh-secret');
	expect(decrypt(s.oidcClientSecret!)).toBe('shh-secret');
	expect(s.oidcDisplayName).toBe('Authentik');
});

test('saveOidc keeps the stored secret on the masked value and clears on request', async () => {
	const u = makeUser('oidc-admin2@x.c', 'Admin', 'admin');
	const run = (form: FormData) =>
		actions.saveOidc({
			request: { formData: async () => form },
			locals: { user: { id: Number(u.id), role: 'admin' } } as App.Locals,
			cookies: { set: vi.fn() }
		} as any);
	const base = () => {
		const form = new FormData();
		form.set('oidcEnabled', 'on');
		form.set('oidcDiscoveryUrl', 'https://idp.example.com');
		form.set('oidcClientId', 'roamarr');
		return form;
	};
	const withSecret = base();
	withSecret.set('oidcClientSecret', 'shh-secret');
	await expect(run(withSecret)).rejects.toMatchObject({ status: 303 });
	const stored = getSettings().oidcClientSecret;
	expect(stored).toBeTruthy();

	// Masked placeholder: keep the stored secret.
	const masked = base();
	masked.set('oidcClientSecret', '********');
	await expect(run(masked)).rejects.toMatchObject({ status: 303 });
	expect(getSettings().oidcClientSecret).toBe(stored);

	// Explicit clear: drop it.
	const clearing = base();
	clearing.set('clearOidcClientSecret', 'on');
	await expect(run(clearing)).rejects.toMatchObject({ status: 303 });
	expect(getSettings().oidcClientSecret).toBeNull();
});

test('saveOidc requires discovery URL and client ID when enabling', async () => {
	const u = makeUser('oidc-admin3@x.c', 'Admin', 'admin');
	const form = new FormData();
	form.set('oidcEnabled', 'on');
	const result = (await actions.saveOidc({
		request: { formData: async () => form },
		locals: { user: { id: Number(u.id), role: 'admin' } } as App.Locals,
		cookies: { set: vi.fn() }
	} as any)) as { status: number; data: { error: string } };
	expect(result.status).toBe(400);
	expect(result.data.error).toMatch(/discovery url and client id/i);
});

test('testEmail action returns 429 when rate limited', async () => {
	const ip = '9.9.9.9';
	for (let i = 0; i < DEFAULT_MAX_ATTEMPTS; i++) checkRateLimit(ip, 'settings_test_email');
	const u = makeUser('rl@x.c', 'Admin', 'admin');
	const result = (await actions.testEmail({
		locals: { user: { id: Number(u.id), role: 'admin' } } as App.Locals,
		cookies: { set: vi.fn() },
		getClientAddress: () => ip
	} as any)) as { status: number; data: { error: string; retryAfter?: number } };
	expect(result.status).toBe(429);
	expect(result.data.error).toMatch(/too many/i);
	expect(result.data.retryAfter).toBeGreaterThan(0);
});

test('map download actions return 429 when rate limited', async () => {
	const ip = '8.8.4.4';
	for (let i = 0; i < 3; i++) checkRateLimit(ip, 'maps:texture-download', { maxAttempts: 3, windowMs: 60_000 });
	const u = makeUser('maps-rl@x.c', 'Admin', 'admin');
	const result = (await actions.reimportTexture({
		locals: { user: { id: Number(u.id), role: 'admin' } } as App.Locals,
		cookies: { set: vi.fn() },
		getClientAddress: () => ip
	} as any)) as { status: number; data: { error: string; retryAfter?: number } };
	expect(result.status).toBe(429);
	expect(result.data.error).toMatch(/too many/i);
	expect(result.data.retryAfter).toBeGreaterThan(0);
});
