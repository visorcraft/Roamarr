import { redirect, type Actions } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/auth';
import { getSettings, updateSettings } from '$lib/server/settings';
import { encrypt } from '$lib/server/crypto';
import type { PageServerLoad } from './$types';

export function saveAdminSettings(i: {
	instanceName: string;
	allowRegistration: boolean;
	defaultTimezone: string;
	smtpHost?: string;
	smtpPort?: number;
	smtpUser?: string;
	smtpPass?: string;
	smtpFrom?: string;
}) {
	const patch: Record<string, unknown> = {
		instanceName: i.instanceName,
		allowRegistration: i.allowRegistration,
		defaultTimezone: i.defaultTimezone,
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

export const actions: Actions = {
	default: async ({ request, locals }) => {
		requireAdmin(locals);
		const f = await request.formData();
		const pass = String(f.get('smtpPass') || '');
		saveAdminSettings({
			instanceName: String(f.get('instanceName') || 'Roamarr'),
			allowRegistration: f.get('allowRegistration') === 'on',
			defaultTimezone: String(f.get('defaultTimezone') || 'UTC'),
			smtpHost: String(f.get('smtpHost') || '') || undefined,
			smtpPort: f.get('smtpPort') ? Number(f.get('smtpPort')) : undefined,
			smtpUser: String(f.get('smtpUser') || '') || undefined,
			smtpPass: pass && pass !== '********' ? pass : undefined,
			smtpFrom: String(f.get('smtpFrom') || '') || undefined
		});
		throw redirect(303, '/settings');
	}
};
