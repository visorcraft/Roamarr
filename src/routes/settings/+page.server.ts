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
import type { PageServerLoad } from './$types';

export function _saveAdminSettings(
	userId: number,
	i: {
		instanceName: string;
		allowRegistration: boolean;
		defaultTimezone: string;
		defaultCurrency: string;
		defaultFlightCheckinLeadHours: number;
		defaultDocumentExpiryLeadDays: number;
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
	}
) {
	if (!nonNegativeInteger(i.defaultFlightCheckinLeadHours))
		throw new Error('Default flight check-in lead must be a non-negative integer');
	if (!nonNegativeInteger(i.defaultDocumentExpiryLeadDays))
		throw new Error('Default document expiry lead must be a non-negative integer');
	const defaultCurrency = parseCurrency(i.defaultCurrency, 'Default currency');
	if (!defaultCurrency.ok) throw new Error(defaultCurrency.error);
	const patch: Record<string, unknown> = {
		instanceName: i.instanceName,
		allowRegistration: i.allowRegistration,
		defaultTimezone: i.defaultTimezone,
		defaultCurrency: defaultCurrency.value,
		defaultFlightCheckinLeadHours: i.defaultFlightCheckinLeadHours,
		defaultDocumentExpiryLeadDays: i.defaultDocumentExpiryLeadDays,
		smtpHost: i.smtpHost || null,
		smtpPort: i.smtpPort ?? null,
		smtpSecurity: i.smtpSecurity || null,
		smtpUser: i.smtpUser || null,
		smtpFrom: i.smtpFrom || null,
		webhookUrl: i.webhookUrl || null,
		mapsTileProvider: i.mapsTileProvider ?? 'openstreetmap',
		mapsTileUrl: i.mapsTileUrl ?? null,
		mapsTileAttribution: i.mapsTileAttribution ?? null,
		mapsTileApiKey: i.mapsTileApiKey ?? null
	};
	if (i.smtpPass !== undefined) patch.smtpPass = i.smtpPass ? encrypt(i.smtpPass) : null;
	if (i.mapsTileApiKey !== undefined) patch.mapsTileApiKey = i.mapsTileApiKey ? encrypt(i.mapsTileApiKey) : null;
	updateSettings(patch);
	logAudit(userId, 'settings_update', 'settings', 1, {
		changed: Object.keys(patch).filter((k) => k !== 'smtpPass'),
		smtpPassSet: patch.smtpPass !== undefined
	});
}

export const load: PageServerLoad = ({ locals }) => {
	requireAdmin(locals);
	const s = getSettings();
	const stats = getAdminStats();
	const recentLogs = listAuditLogs({ limit: 5 }).logs;
	const mapSettings = getMapSettings();
	return { settings: { ...s, smtpPass: s.smtpPass ? '********' : '' }, stats, recentLogs, mapSettings };
};

function parseLead(value: FormDataEntryValue | null, fallback: number): number {
	const n = Number(value);
	return Number.isNaN(n) ? fallback : n;
}

export const actions: Actions = {
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
			return fail(400, { error: e instanceof Error ? e.message : 'Failed to send test notification' });
		}
		throw redirect(303, '/settings');
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
			return fail(400, { error: e instanceof Error ? e.message : 'Failed to send test email' });
		}
		throw redirect(303, '/settings');
	},
	save: async ({ request, locals, cookies }) => {
		const u = requireAdmin(locals);
		const f = await request.formData();
		const mapsTileProvider = String(f.get('mapsTileProvider') || 'openstreetmap');
		if (!(MAP_TILE_PROVIDERS as readonly string[]).includes(mapsTileProvider)) {
			return fail(400, { error: 'Invalid tile provider' });
		}
		const pass = String(f.get('smtpPass') || '');
		const clearSmtpPass = f.get('clearSmtpPass') === 'on';
		const tileApiKey = String(f.get('mapsTileApiKey') || '');
		_saveAdminSettings(u.id, {
			instanceName: String(f.get('instanceName') || 'Roamarr'),
			allowRegistration: f.get('allowRegistration') === 'on',
			defaultTimezone: String(f.get('defaultTimezone') || 'UTC'),
			defaultCurrency: String(f.get('defaultCurrency') || ''),
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
			mapsTileApiKey: tileApiKey && tileApiKey !== '********' ? tileApiKey : undefined
		});
		setFlash(cookies, 'Settings saved.');
		throw redirect(303, '/settings');
	},
	// Idempotent: re-checks what's already downloaded and only fetches the missing
	// pieces, so re-enabling after a disable (or a failed asset) resumes cleanly.
	enableMaps: async ({ locals, cookies }) => {
		const u = requireAdmin(locals);
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
			return fail(400, { error: e instanceof Error ? e.message : 'Failed to enable maps' });
		}
		throw redirect(303, '/settings');
	},
	disableMaps: async ({ locals, cookies }) => {
		const u = requireAdmin(locals);
		updateSettings({ mapsEnabled: false });
		logAudit(u.id, 'maps_disable', 'settings', 1, {});
		setFlash(cookies, 'Maps disabled. Downloaded data was kept; re-enable to re-check and resume.');
		throw redirect(303, '/settings');
	},
	reimportCities: async ({ locals, cookies }) => {
		const u = requireAdmin(locals);
		try {
			const { imported } = await importCitiesFromUrl();
			logAudit(u.id, 'geonames_import', 'settings', 1, { source: 'download', imported });
			setFlash(cookies, `GeoNames cities re-imported (${imported.toLocaleString()} cities).`);
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Failed to import GeoNames data' });
		}
		throw redirect(303, '/settings');
	},
	reimportTexture: async ({ locals, cookies }) => {
		const u = requireAdmin(locals);
		try {
			await importMapTexture();
			logAudit(u.id, 'maps_texture_import', 'settings', 1, {});
			setFlash(cookies, 'Earth texture re-imported.');
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Failed to import Earth texture' });
		}
		throw redirect(303, '/settings');
	},
	importGeonames: async ({ request, locals, cookies }) => {
		const u = requireAdmin(locals);
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
			return fail(400, { error: e instanceof Error ? e.message : 'Failed to import GeoNames data' });
		}
		throw redirect(303, '/settings');
	}
};
