import { fail, redirect, type Actions } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { setFlash } from '$lib/server/flash';
import { logAudit } from '$lib/server/audit';
import {
	getUserSmtpOverride,
	upsertUserSmtpOverride,
	deleteUserSmtpOverride,
	parseSmtpSecurity,
	type SmtpSecurity
} from '$lib/server/smtpConfig';
import { sendMail } from '$lib/server/notify';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	const u = requireUser(locals);
	const override = getUserSmtpOverride(u.id);
	return { override };
};

const SECURITY_VALUES: SmtpSecurity[] = ['none', 'starttls', 'ssl/tls'];

export const actions: Actions = {
	save: async ({ request, locals, cookies }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const security = String(f.get('security') || 'starttls');
		if (!SECURITY_VALUES.includes(security as SmtpSecurity)) {
			return fail(400, { error: 'Invalid transport security' });
		}
		const portRaw = f.get('port');
		const port = portRaw ? Number(portRaw) : null;
		if (port != null && (!Number.isFinite(port) || port < 1 || port > 65535)) {
			return fail(400, { error: 'Port must be between 1 and 65535' });
		}
		const pass = String(f.get('password') || '');
		const password = pass && pass !== '********' ? pass : undefined;
		const override = upsertUserSmtpOverride(u.id, {
			enabled: f.get('enabled') === 'on',
			host: String(f.get('host') || '') || null,
			port,
			security: security as SmtpSecurity,
			username: String(f.get('username') || '') || null,
			password,
			fromAddress: String(f.get('fromAddress') || '') || null
		});
		logAudit(u.id, 'user_smtp_update', 'user', u.id, { passwordSet: password != null });
		setFlash(cookies, override.enabled ? 'SMTP override saved and enabled.' : 'SMTP override saved (disabled).');
		throw redirect(303, '/profile/notifications');
	},
	testEmail: async ({ locals, cookies }) => {
		const u = requireUser(locals);
		try {
			const ok = await sendMail(
				u.email,
				{ title: 'Roamarr SMTP test (per-user)', body: 'This confirms your personal SMTP override is working.' },
				u.id
			);
			setFlash(cookies, ok ? 'Test email sent.' : 'SMTP is not configured.');
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Failed to send test email' });
		}
		throw redirect(303, '/profile/notifications');
	},
	disable: async ({ locals, cookies }) => {
		const u = requireUser(locals);
		const existed = deleteUserSmtpOverride(u.id);
		if (existed) {
			logAudit(u.id, 'user_smtp_disable', 'user', u.id, {});
			setFlash(cookies, 'SMTP override removed. Notifications will use the admin server.');
		}
		throw redirect(303, '/profile/notifications');
	}
};

export { parseSmtpSecurity };
