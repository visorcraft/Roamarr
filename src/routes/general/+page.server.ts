import { fail, redirect, type Actions } from '@sveltejs/kit';
import { Readable } from 'node:stream';
import { requireAdmin } from '$lib/server/auth';
import { getMapSettings, getSettings, updateSettings } from '$lib/server/settings';
import { importMapTexture, hasMapTexture } from '$lib/server/mapsAssets';
import { encrypt } from '$lib/server/crypto';
import { listAuditLogs, logAudit, getAdminStats } from '$lib/server/audit';
import { setFlash } from '$lib/server/flash';
import { deliver } from '$lib/server/notify';
import { checkRateLimit } from '$lib/server/rateLimit';
import { currency as parseCurrency, nonNegativeInteger } from '$lib/server/validation';
import { importCitiesFromReadable, importCitiesFromUrl } from '$lib/server/geonames';
import { MAP_TILE_PROVIDERS, type MapTileProvider } from '$lib/server/mapTiles';
import { SESSION_COOKIE_SAME_SITE_VALUES } from '$lib/server/db/mongrelSchema';
import type { SessionCookieSameSite } from '$lib/server/db/mongrelSchema';
import {
	DATE_FORMAT_OPTIONS,
	DATETIME_FORMAT_OPTIONS
} from '$lib/dateFormat';
import type { PageServerLoad } from './$types';

function userFacingError(e: unknown, fallback: string): string {
	console.error(fallback, e);
	return fallback;
}

const MAP_RATE_LIMITS = {
	enable: { maxAttempts: 3, windowMs: 60_000 },
	cities: { maxAttempts: 3, windowMs: 60_000 },
	texture: { maxAttempts: 3, windowMs: 60_000 },
	upload: { maxAttempts: 3, windowMs: 60_000 }
} as const;

function rateLimitFailure(ip: string, route: string, opts: { maxAttempts: number; windowMs: number }) {
	const limit = checkRateLimit(ip, route, opts);
	if (limit.allowed) return null;
	return fail(429, { error: 'Too many attempts. Try again later.', retryAfter: limit.retryAfter });
}

export function _saveAdminSettings(
	userId: number,
	i: {
		instanceName?: string;
		allowRegistration?: boolean;
		defaultTimezone?: string;
		defaultCurrency?: string;
		defaultDateFormat?: string;
		defaultDatetimeFormat?: string;
		defaultFlightCheckinLeadHours?: number;
		defaultDocumentExpiryLeadDays?: number;
		smtpHost?: string;
		smtpPort?: number;
		smtpSecurity?: string;
		smtpUser?: string;
		smtpPass?: string | null;
		smtpFrom?: string;
		webhookUrl?: string;
		mapsTileProvider?: MapTileProvider;
		mapsTileUrl?: string | null;
		mapsTileAttribution?: string | null;
		mapsTileApiKey?: string;
		sessionCookieSameSite?: SessionCookieSameSite;
		oauthClientAllowList?: string[] | null;
	}
) {
	if (
		i.defaultFlightCheckinLeadHours !== undefined &&
		!nonNegativeInteger(i.defaultFlightCheckinLeadHours)
	)
		throw new Error('Default flight check-in lead must be a non-negative integer');
	if (
		i.defaultDocumentExpiryLeadDays !== undefined &&
		!nonNegativeInteger(i.defaultDocumentExpiryLeadDays)
	)
		throw new Error('Default document expiry lead must be a non-negative integer');
	if (i.defaultCurrency !== undefined) {
		const defaultCurrency = parseCurrency(i.defaultCurrency, 'Default currency');
		if (!defaultCurrency.ok) throw new Error(defaultCurrency.error);
		i = { ...i, defaultCurrency: defaultCurrency.value };
	}
	if (i.defaultDateFormat !== undefined && !DATE_FORMAT_OPTIONS.some((o) => o.value === i.defaultDateFormat)) {
		throw new Error('Invalid default date format');
	}
	if (
		i.defaultDatetimeFormat !== undefined &&
		!DATETIME_FORMAT_OPTIONS.some((o) => o.value === i.defaultDatetimeFormat)
	) {
		throw new Error('Invalid default date/time format');
	}
	if (
		i.sessionCookieSameSite !== undefined &&
		!SESSION_COOKIE_SAME_SITE_VALUES.includes(i.sessionCookieSameSite)
	) {
		throw new Error('Session cookie SameSite must be lax or strict');
	}
	const patch: Record<string, unknown> = {};
	if (i.instanceName !== undefined) patch.instanceName = i.instanceName;
	if (i.allowRegistration !== undefined) patch.allowRegistration = i.allowRegistration;
	if (i.defaultTimezone !== undefined) patch.defaultTimezone = i.defaultTimezone;
	if (i.defaultCurrency !== undefined) patch.defaultCurrency = i.defaultCurrency;
	if (i.defaultDateFormat !== undefined) patch.defaultDateFormat = i.defaultDateFormat;
	if (i.defaultDatetimeFormat !== undefined) patch.defaultDatetimeFormat = i.defaultDatetimeFormat;
	if (i.defaultFlightCheckinLeadHours !== undefined)
		patch.defaultFlightCheckinLeadHours = i.defaultFlightCheckinLeadHours;
	if (i.defaultDocumentExpiryLeadDays !== undefined)
		patch.defaultDocumentExpiryLeadDays = i.defaultDocumentExpiryLeadDays;
	if (i.smtpHost !== undefined) patch.smtpHost = i.smtpHost || null;
	if (i.smtpPort !== undefined) patch.smtpPort = i.smtpPort ?? null;
	if (i.smtpSecurity !== undefined) patch.smtpSecurity = i.smtpSecurity || null;
	if (i.smtpUser !== undefined) patch.smtpUser = i.smtpUser || null;
	if (i.smtpFrom !== undefined) patch.smtpFrom = i.smtpFrom || null;
	if (i.webhookUrl !== undefined) patch.webhookUrl = i.webhookUrl || null;
	if (i.mapsTileProvider !== undefined) patch.mapsTileProvider = i.mapsTileProvider ?? 'openstreetmap';
	if (i.mapsTileUrl !== undefined) patch.mapsTileUrl = i.mapsTileUrl ?? null;
	if (i.mapsTileAttribution !== undefined) patch.mapsTileAttribution = i.mapsTileAttribution ?? null;
	if (i.sessionCookieSameSite !== undefined) patch.sessionCookieSameSite = i.sessionCookieSameSite ?? 'lax';
	if (i.oauthClientAllowList !== undefined) patch.oauthClientAllowList = i.oauthClientAllowList ?? null;
	if (i.smtpPass !== undefined) patch.smtpPass = i.smtpPass ? encrypt(i.smtpPass) : null;
	if (i.mapsTileApiKey !== undefined)
		patch.mapsTileApiKey = i.mapsTileApiKey ? encrypt(i.mapsTileApiKey) : null;
	updateSettings(patch);
	logAudit(userId, 'settings_update', 'settings', 1, {
		changed: Object.keys(patch).filter((k) => k !== 'smtpPass'),
		smtpPassSet: patch.smtpPass !== undefined
	});
}

export const load: PageServerLoad = ({ locals, url }) => {
	requireAdmin(locals);
	const s = getSettings();
	const stats = getAdminStats();
	const recentLogs = listAuditLogs({ limit: 5 }).logs;
	const mapSettings = getMapSettings();
	const allowedTabs = ['general', 'maps', 'email', 'webhook', 'oauth'] as const;
	const tabParam = url?.searchParams.get('tab') ?? 'general';
	const tab: (typeof allowedTabs)[number] = (allowedTabs as readonly string[]).includes(tabParam)
		? (tabParam as (typeof allowedTabs)[number])
		: 'general';
	return {
		settings: { ...s, smtpPass: s.smtpPass ? '********' : '' },
		stats,
		recentLogs,
		mapSettings,
		tab
	};
};

function parseLead(value: FormDataEntryValue | null, fallback: number): number {
	const s = String(value ?? '').trim();
	if (s === '') return fallback;
	const n = Number(s);
	return Number.isNaN(n) ? fallback : n;
}

const TAB_REDIRECTS = {
	general: '/general?tab=general',
	maps: '/general?tab=maps',
	email: '/general?tab=email',
	webhook: '/general?tab=webhook',
	oauth: '/general?tab=oauth'
} as const;

export const actions: Actions = {
	saveGeneral: async ({ request, locals, cookies }) => {
		const u = requireAdmin(locals);
		const f = await request.formData();
		const sessionCookieSameSite = String(f.get('sessionCookieSameSite') || 'lax');
		if (!SESSION_COOKIE_SAME_SITE_VALUES.includes(sessionCookieSameSite as SessionCookieSameSite)) {
			return fail(400, { error: 'Invalid SameSite value' });
		}
		_saveAdminSettings(u.id, {
			instanceName: String(f.get('instanceName') || 'Roamarr'),
			allowRegistration: f.get('allowRegistration') === 'on',
			defaultTimezone: String(f.get('defaultTimezone') || 'UTC'),
			defaultCurrency: String(f.get('defaultCurrency') || ''),
			defaultDateFormat: String(f.get('defaultDateFormat') || 'yyyy-MM-dd'),
			defaultDatetimeFormat: String(f.get('defaultDatetimeFormat') || 'yyyy-MM-dd h:mm a'),
			defaultFlightCheckinLeadHours: parseLead(f.get('defaultFlightCheckinLeadHours'), 24),
			defaultDocumentExpiryLeadDays: parseLead(f.get('defaultDocumentExpiryLeadDays'), 90),
			sessionCookieSameSite: sessionCookieSameSite as SessionCookieSameSite
		});
		setFlash(cookies, 'General settings saved.');
		throw redirect(303, TAB_REDIRECTS.general);
	},

	saveMaps: async ({ request, locals, cookies }) => {
		const u = requireAdmin(locals);
		const f = await request.formData();
		const mapsTileProvider = String(f.get('mapsTileProvider') || 'openstreetmap');
		if (!(MAP_TILE_PROVIDERS as readonly string[]).includes(mapsTileProvider)) {
			return fail(400, { error: 'Invalid tile provider' });
		}
		const tileApiKey = String(f.get('mapsTileApiKey') || '');
		_saveAdminSettings(u.id, {
			mapsTileProvider: mapsTileProvider as MapTileProvider,
			mapsTileUrl: String(f.get('mapsTileUrl') || '') || null,
			mapsTileAttribution: String(f.get('mapsTileAttribution') || '') || null,
			mapsTileApiKey: tileApiKey && tileApiKey !== '********' ? tileApiKey : undefined
		});
		setFlash(cookies, 'Map settings saved.');
		throw redirect(303, TAB_REDIRECTS.maps);
	},

	saveEmail: async ({ request, locals, cookies }) => {
		const u = requireAdmin(locals);
		const f = await request.formData();
		const pass = String(f.get('smtpPass') || '');
		const clearSmtpPass = f.get('clearSmtpPass') === 'on';
		_saveAdminSettings(u.id, {
			smtpHost: String(f.get('smtpHost') || '') || undefined,
			smtpPort: f.get('smtpPort') ? Number(f.get('smtpPort')) : undefined,
			smtpSecurity: String(f.get('smtpSecurity') || '') || undefined,
			smtpUser: String(f.get('smtpUser') || '') || undefined,
			smtpPass: clearSmtpPass ? null : pass && pass !== '********' ? pass : undefined,
			smtpFrom: String(f.get('smtpFrom') || '') || undefined
		});
		setFlash(cookies, 'Email settings saved.');
		throw redirect(303, TAB_REDIRECTS.email);
	},

	saveWebhook: async ({ request, locals, cookies }) => {
		const u = requireAdmin(locals);
		const f = await request.formData();
		_saveAdminSettings(u.id, {
			webhookUrl: String(f.get('webhookUrl') || '') || undefined
		});
		setFlash(cookies, 'Webhook settings saved.');
		throw redirect(303, TAB_REDIRECTS.webhook);
	},

	saveOauth: async ({ request, locals, cookies }) => {
		const u = requireAdmin(locals);
		const f = await request.formData();
		const allowListRaw = String(f.get('oauthClientAllowList') || '')
			.split('\n')
			.map((s) => s.trim())
			.filter(Boolean);
		_saveAdminSettings(u.id, {
			oauthClientAllowList: allowListRaw.length > 0 ? allowListRaw : null
		});
		setFlash(cookies, 'OAuth client settings saved.');
		throw redirect(303, TAB_REDIRECTS.oauth);
	},

	testNotification: async ({ locals, cookies, getClientAddress }) => {
		const u = requireAdmin(locals);
		const limit = checkRateLimit(getClientAddress(), 'settings_test_notification');
		if (!limit.allowed) {
			return fail(429, { error: 'Too many attempts. Try again later.', retryAfter: limit.retryAfter });
		}
		try {
			await deliver(u.id, { title: 'Test notification', body: 'This is a test notification from Roamarr.', link: '/' });
			setFlash(cookies, 'Test notification sent.');
		} catch (e) {
			return fail(400, { error: userFacingError(e, 'Failed to send test notification') });
		}
		throw redirect(303, TAB_REDIRECTS.general);
	},

	testEmail: async ({ locals, cookies, getClientAddress }) => {
		const u = requireAdmin(locals);
		const limit = checkRateLimit(getClientAddress(), 'settings_test_email');
		if (!limit.allowed) {
			return fail(429, { error: 'Too many attempts. Try again later.', retryAfter: limit.retryAfter });
		}
		try {
			const { sendMail } = await import('$lib/server/notify');
			const ok = await sendMail(
				u.email,
				{ title: 'Roamarr SMTP test', body: 'This is a test email from Roamarr to verify SMTP delivery.' },
				u.id
			);
			logAudit(u.id, 'smtp_test', 'settings', 1, { delivered: ok });
			setFlash(cookies, ok ? 'Test email sent.' : 'SMTP is not configured.');
		} catch (e) {
			return fail(400, { error: userFacingError(e, 'Failed to send test email') });
		}
		throw redirect(303, TAB_REDIRECTS.email);
	},

	// Legacy alias kept so any external caller still posting to ?/save keeps
	// working. New forms should target the per-tab action.
	save: async ({ request, locals, cookies, url }) => {
		const u = requireAdmin(locals);
		const f = await request.formData();
		const mapsTileProvider = String(f.get('mapsTileProvider') || 'openstreetmap');
		if (!(MAP_TILE_PROVIDERS as readonly string[]).includes(mapsTileProvider)) {
			return fail(400, { error: 'Invalid tile provider' });
		}
		const sessionCookieSameSite = String(f.get('sessionCookieSameSite') || 'lax');
		if (!SESSION_COOKIE_SAME_SITE_VALUES.includes(sessionCookieSameSite as SessionCookieSameSite)) {
			return fail(400, { error: 'Invalid SameSite value' });
		}
		const pass = String(f.get('smtpPass') || '');
		const clearSmtpPass = f.get('clearSmtpPass') === 'on';
		const tileApiKey = String(f.get('mapsTileApiKey') || '');
		const allowListRaw = String(f.get('oauthClientAllowList') || '')
			.split('\n')
			.map((s) => s.trim())
			.filter(Boolean);
		_saveAdminSettings(u.id, {
			instanceName: String(f.get('instanceName') || 'Roamarr'),
			allowRegistration: f.get('allowRegistration') === 'on',
			defaultTimezone: String(f.get('defaultTimezone') || 'UTC'),
			defaultCurrency: String(f.get('defaultCurrency') || ''),
			defaultDateFormat: String(f.get('defaultDateFormat') || 'yyyy-MM-dd'),
			defaultDatetimeFormat: String(f.get('defaultDatetimeFormat') || 'yyyy-MM-dd h:mm a'),
			defaultFlightCheckinLeadHours: parseLead(f.get('defaultFlightCheckinLeadHours'), 24),
			defaultDocumentExpiryLeadDays: parseLead(f.get('defaultDocumentExpiryLeadDays'), 90),
			smtpHost: String(f.get('smtpHost') || '') || undefined,
			smtpPort: f.get('smtpPort') ? Number(f.get('smtpPort')) : undefined,
			smtpSecurity: String(f.get('smtpSecurity') || '') || undefined,
			smtpUser: String(f.get('smtpUser') || '') || undefined,
			smtpPass: clearSmtpPass ? null : pass && pass !== '********' ? pass : undefined,
			smtpFrom: String(f.get('smtpFrom') || '') || undefined,
			webhookUrl: String(f.get('webhookUrl') || '') || undefined,
			mapsTileProvider: mapsTileProvider as MapTileProvider,
			mapsTileUrl: String(f.get('mapsTileUrl') || '') || null,
			mapsTileAttribution: String(f.get('mapsTileAttribution') || '') || null,
			mapsTileApiKey: tileApiKey && tileApiKey !== '********' ? tileApiKey : undefined,
			sessionCookieSameSite: sessionCookieSameSite as SessionCookieSameSite,
			oauthClientAllowList: allowListRaw.length > 0 ? allowListRaw : null
		});
		setFlash(cookies, 'Settings saved.');
		const tab = url.searchParams.get('tab') ?? 'general';
		throw redirect(303, `/general?tab=${tab}`);
		},
		// Idempotent: re-checks what's already downloaded and only fetches the missing
		// pieces, so re-enabling after a disable (or a failed asset) resumes cleanly.
		enableMaps: async ({ locals, cookies, getClientAddress }) => {
			const u = requireAdmin(locals);
			const limited = rateLimitFailure(getClientAddress(), 'maps:enable', MAP_RATE_LIMITS.enable);
			if (limited) return limited;
			try {
				const before = getMapSettings();
				let imported = 0;
				if (before.cityCount === 0) {
					({ imported } = await importCitiesFromUrl());
				}
				if (!hasMapTexture()) {
					await importMapTexture();
				}
				updateSettings({ mapsEnabled: true });
				logAudit(u.id, 'maps_enable', 'settings', 1, {
					citiesImported: imported,
					textureReady: hasMapTexture()
				});
				const parts = [
					imported
						? `${imported.toLocaleString()} cities imported`
						: `${before.cityCount.toLocaleString()} cities already present`,
					hasMapTexture() ? 'Earth texture ready' : 'texture missing'
				];
				setFlash(cookies, `Maps enabled (${parts.join(', ')}).`);
			} catch (e) {
				return fail(400, { error: userFacingError(e, 'Failed to enable maps') });
			}
			throw redirect(303, TAB_REDIRECTS.maps);
		},
		disableMaps: async ({ locals, cookies }) => {
			const u = requireAdmin(locals);
			updateSettings({ mapsEnabled: false });
			logAudit(u.id, 'maps_disable', 'settings', 1, {});
			setFlash(cookies, 'Maps disabled. Downloaded data was kept; re-enable to re-check and resume.');
			throw redirect(303, TAB_REDIRECTS.maps);
		},
		reimportCities: async ({ locals, cookies, getClientAddress }) => {
			const u = requireAdmin(locals);
			const limited = rateLimitFailure(getClientAddress(), 'maps:cities-download', MAP_RATE_LIMITS.cities);
			if (limited) return limited;
			try {
				const { imported } = await importCitiesFromUrl();
				logAudit(u.id, 'geonames_import', 'settings', 1, { source: 'download', imported });
				setFlash(cookies, `GeoNames cities re-imported (${imported.toLocaleString()} cities).`);
			} catch (e) {
				return fail(400, { error: userFacingError(e, 'Failed to import GeoNames data') });
			}
			throw redirect(303, TAB_REDIRECTS.maps);
		},
		reimportTexture: async ({ locals, cookies, getClientAddress }) => {
			const u = requireAdmin(locals);
			const limited = rateLimitFailure(getClientAddress(), 'maps:texture-download', MAP_RATE_LIMITS.texture);
			if (limited) return limited;
			try {
				await importMapTexture();
				logAudit(u.id, 'maps_texture_import', 'settings', 1, {});
				setFlash(cookies, 'Earth texture re-imported.');
			} catch (e) {
				return fail(400, { error: userFacingError(e, 'Failed to import Earth texture') });
			}
			throw redirect(303, TAB_REDIRECTS.maps);
		},
		importGeonames: async ({ request, locals, cookies, getClientAddress }) => {
			const u = requireAdmin(locals);
			const limited = rateLimitFailure(getClientAddress(), 'maps:cities-upload', MAP_RATE_LIMITS.upload);
			if (limited) return limited;
			const f = await request.formData();
			const file = f.get('cities1000');
			if (!(file instanceof File) || file.size === 0) {
				return fail(400, { error: 'cities1000.zip is required' });
			}
			try {
				const { imported } = await importCitiesFromReadable(Readable.fromWeb(file.stream() as any));
				logAudit(u.id, 'geonames_import', 'settings', 1, { source: 'upload', imported });
				setFlash(cookies, `GeoNames cities imported (${imported.toLocaleString()} cities).`);
			} catch (e) {
				return fail(400, { error: userFacingError(e, 'Failed to import GeoNames data') });
			}
			throw redirect(303, TAB_REDIRECTS.maps);
		}
};
