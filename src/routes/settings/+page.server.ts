import { count } from 'drizzle-orm';
import { fail, redirect, type Actions } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/auth';
import { getSettings, updateSettings } from '$lib/server/settings';
import { encrypt } from '$lib/server/crypto';
import { listAuditLogs, logAudit } from '$lib/server/audit';
import { setFlash } from '$lib/server/flash';
import { deliver } from '$lib/server/notify';
import { currency as parseCurrency, nonNegativeInteger } from '$lib/server/validation';
import { db } from '$lib/server/db';
import { users, trips, segments, groups, notifications } from '$lib/server/db/schema';
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
		smtpUser?: string;
		smtpPass?: string;
		smtpFrom?: string;
		webhookUrl?: string;
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
		smtpUser: i.smtpUser || null,
		smtpFrom: i.smtpFrom || null,
		webhookUrl: i.webhookUrl || null
	};
	if (i.smtpPass !== undefined) patch.smtpPass = i.smtpPass ? encrypt(i.smtpPass) : null;
	updateSettings(patch);
	logAudit(userId, 'settings_update', 'settings', 1, {
		changed: Object.keys(patch).filter((k) => k !== 'smtpPass'),
		smtpPassSet: patch.smtpPass !== undefined
	});
}

export const load: PageServerLoad = ({ locals }) => {
	requireAdmin(locals);
	const s = getSettings();
	const stats = {
		users: db.select({ count: count() }).from(users).get()?.count ?? 0,
		trips: db.select({ count: count() }).from(trips).get()?.count ?? 0,
		segments: db.select({ count: count() }).from(segments).get()?.count ?? 0,
		groups: db.select({ count: count() }).from(groups).get()?.count ?? 0,
		notifications: db.select({ count: count() }).from(notifications).get()?.count ?? 0
	};
	const recentLogs = listAuditLogs({ limit: 5 }).logs;
	return { settings: { ...s, smtpPass: s.smtpPass ? '********' : '' }, stats, recentLogs };
};

function parseLead(value: FormDataEntryValue | null, fallback: number): number {
	const n = Number(value);
	return Number.isNaN(n) ? fallback : n;
}

export const actions: Actions = {
	testNotification: async ({ locals, cookies }) => {
		const u = requireAdmin(locals);
		try {
			await deliver(u.id, { title: 'Test notification', body: 'This is a test notification from Roamarr.', link: '/' });
			setFlash(cookies, 'Test notification sent.');
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Failed to send test notification' });
		}
		throw redirect(303, '/settings');
	},
	default: async ({ request, locals, cookies }) => {
		const u = requireAdmin(locals);
		const f = await request.formData();
		const pass = String(f.get('smtpPass') || '');
		_saveAdminSettings(u.id, {
			instanceName: String(f.get('instanceName') || 'Roamarr'),
			allowRegistration: f.get('allowRegistration') === 'on',
			defaultTimezone: String(f.get('defaultTimezone') || 'UTC'),
			defaultCurrency: String(f.get('defaultCurrency') || ''),
			defaultFlightCheckinLeadHours: parseLead(f.get('defaultFlightCheckinLeadHours'), 24),
			defaultDocumentExpiryLeadDays: parseLead(f.get('defaultDocumentExpiryLeadDays'), 90),
			smtpHost: String(f.get('smtpHost') || '') || undefined,
			smtpPort: f.get('smtpPort') ? Number(f.get('smtpPort')) : undefined,
			smtpUser: String(f.get('smtpUser') || '') || undefined,
			smtpPass: pass && pass !== '********' ? pass : undefined,
			smtpFrom: String(f.get('smtpFrom') || '') || undefined,
			webhookUrl: String(f.get('webhookUrl') || '') || undefined
		});
		setFlash(cookies, 'Settings saved.');
		throw redirect(303, '/settings');
	}
};
