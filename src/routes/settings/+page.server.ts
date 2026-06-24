import { redirect, type Actions } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/auth';
import { getSettings, updateSettings } from '$lib/server/settings';
import { encrypt } from '$lib/server/crypto';
import type { PageServerLoad } from './$types';

function validDefaultLead(n: number) {
	return Number.isInteger(n) && n >= 0;
}

export function _saveAdminSettings(i: {
	instanceName: string;
	allowRegistration: boolean;
	defaultTimezone: string;
	defaultFlightCheckinLeadHours: number;
	defaultDocumentExpiryLeadDays: number;
	smtpHost?: string;
	smtpPort?: number;
	smtpUser?: string;
	smtpPass?: string;
	smtpFrom?: string;
}) {
	if (!validDefaultLead(i.defaultFlightCheckinLeadHours))
		throw new Error('Default flight check-in lead must be a non-negative integer');
	if (!validDefaultLead(i.defaultDocumentExpiryLeadDays))
		throw new Error('Default document expiry lead must be a non-negative integer');
	const patch: Record<string, unknown> = {
		instanceName: i.instanceName,
		allowRegistration: i.allowRegistration,
		defaultTimezone: i.defaultTimezone,
		defaultFlightCheckinLeadHours: i.defaultFlightCheckinLeadHours,
		defaultDocumentExpiryLeadDays: i.defaultDocumentExpiryLeadDays,
		smtpHost: i.smtpHost || null,
		smtpPort: i.smtpPort ?? null,
		smtpUser: i.smtpUser || null,
		smtpFrom: i.smtpFrom || null
	};
	if (i.smtpPass !== undefined) patch.smtpPass = i.smtpPass ? encrypt(i.smtpPass) : null;
	updateSettings(patch);
}

export const load: PageServerLoad = ({ locals }) => {
	requireAdmin(locals);
	const s = getSettings();
	return { settings: { ...s, smtpPass: s.smtpPass ? '********' : '' } };
};

function parseLead(value: FormDataEntryValue | null, fallback: number): number {
	const n = Number(value);
	return Number.isNaN(n) ? fallback : n;
}

export const actions: Actions = {
	default: async ({ request, locals }) => {
		requireAdmin(locals);
		const f = await request.formData();
		const pass = String(f.get('smtpPass') || '');
		_saveAdminSettings({
			instanceName: String(f.get('instanceName') || 'Roamarr'),
			allowRegistration: f.get('allowRegistration') === 'on',
			defaultTimezone: String(f.get('defaultTimezone') || 'UTC'),
			defaultFlightCheckinLeadHours: parseLead(f.get('defaultFlightCheckinLeadHours'), 24),
			defaultDocumentExpiryLeadDays: parseLead(f.get('defaultDocumentExpiryLeadDays'), 90),
			smtpHost: String(f.get('smtpHost') || '') || undefined,
			smtpPort: f.get('smtpPort') ? Number(f.get('smtpPort')) : undefined,
			smtpUser: String(f.get('smtpUser') || '') || undefined,
			smtpPass: pass && pass !== '********' ? pass : undefined,
			smtpFrom: String(f.get('smtpFrom') || '') || undefined
		});
		throw redirect(303, '/settings');
	}
};
