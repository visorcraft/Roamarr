import { fail, redirect, type Actions } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { setFlash } from '$lib/server/flash';
import { logAudit } from '$lib/server/audit';
import { sendMail } from '$lib/server/notify';
import { checkRateLimit } from '$lib/server/rateLimit';
import {
	getEmailProcessingConfig,
	pollUserInbox,
	saveEmailProcessingConfig,
	type MailSecurity
} from '$lib/server/emailProcessing';
import type { PageServerLoad } from './$types';
import { getSettings } from '$lib/server/settings';

const SECURITY_VALUES: MailSecurity[] = ['none', 'starttls', 'ssl/tls'];
const text = (form: FormData, name: string) => String(form.get(name) || '').trim() || null;
const secret = (form: FormData, name: string, clearName: string) =>
	form.get(clearName) === 'on' ? null : text(form, name) === '********' ? undefined : text(form, name) ?? undefined;

function port(form: FormData, name: string): number | null {
	const raw = text(form, name);
	if (!raw) return null;
	const value = Number(raw);
	if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error(`${name} must be between 1 and 65535`);
	return value;
}

function security(form: FormData, name: string, fallback: MailSecurity): MailSecurity {
	const value = String(form.get(name) || fallback) as MailSecurity;
	if (!SECURITY_VALUES.includes(value)) throw new Error('Invalid transport security');
	return value;
}

export const load: PageServerLoad = ({ locals }) => {
	const user = requireUser(locals);
	const settings = getSettings();
	return { config: getEmailProcessingConfig(user.id), allowUserImap: settings.allowUserImap, allowUserSmtp: settings.allowUserSmtp, allowUserParsingProviders: settings.allowUserParsingProviders };
};

export const actions: Actions = {
	save: async ({ request, locals, cookies }) => {
		const user = requireUser(locals);
		const form = await request.formData();
		try {
			const settings = getSettings();
			const existing = getEmailProcessingConfig(user.id);
			const enabled = settings.allowUserImap && form.get('enabled') === 'on';
			const useImapForSmtp = form.get('useImapForSmtp') === 'on';
			const aiEnabled = settings.allowUserParsingProviders && form.get('aiEnabled') === 'on';
			const imapHost = settings.allowUserImap ? text(form, 'imapHost') : existing?.imapHost ?? null;
			const imapUsername = settings.allowUserImap ? text(form, 'imapUsername') : existing?.imapUsername ?? null;
			if (enabled && (!imapHost || !imapUsername)) throw new Error('IMAP host and username are required');
			if (aiEnabled && (!text(form, 'aiBaseUrl') || !text(form, 'aiModel'))) throw new Error('AI base URL and model are required');
			saveEmailProcessingConfig(user.id, {
				enabled, imapHost, imapPort: settings.allowUserImap ? port(form, 'imapPort') : existing?.imapPort ?? null, imapSecurity: settings.allowUserImap ? security(form, 'imapSecurity', 'ssl/tls') : existing?.imapSecurity ?? 'ssl/tls',
				imapUsername, imapPassword: settings.allowUserImap ? secret(form, 'imapPassword', 'clearImapPassword') : undefined, imapMailbox: settings.allowUserImap ? text(form, 'imapMailbox') || 'INBOX' : existing?.imapMailbox ?? 'INBOX',
				useImapForSmtp: settings.allowUserSmtp && useImapForSmtp, smtpHost: settings.allowUserSmtp ? text(form, 'smtpHost') : existing?.smtpHost ?? null, smtpPort: settings.allowUserSmtp ? port(form, 'smtpPort') : existing?.smtpPort ?? null,
				smtpSecurity: settings.allowUserSmtp ? security(form, 'smtpSecurity', 'starttls') : existing?.smtpSecurity ?? 'starttls', smtpUsername: settings.allowUserSmtp ? text(form, 'smtpUsername') : existing?.smtpUsername ?? null,
				smtpPassword: settings.allowUserSmtp ? secret(form, 'smtpPassword', 'clearSmtpPassword') : undefined, smtpFrom: settings.allowUserSmtp ? text(form, 'smtpFrom') || imapUsername : existing?.smtpFrom ?? null,
				aiEnabled, aiBaseUrl: settings.allowUserParsingProviders ? text(form, 'aiBaseUrl') : existing?.aiBaseUrl ?? null, aiModel: settings.allowUserParsingProviders ? text(form, 'aiModel') : existing?.aiModel ?? null, aiToken: settings.allowUserParsingProviders ? secret(form, 'aiToken', 'clearAiToken') : undefined,
				aiTokenUrl: settings.allowUserParsingProviders ? text(form, 'aiTokenUrl') : existing?.aiTokenUrl ?? null, aiClientId: settings.allowUserParsingProviders ? text(form, 'aiClientId') : existing?.aiClientId ?? null,
				aiClientSecret: settings.allowUserParsingProviders ? secret(form, 'aiClientSecret', 'clearAiClientSecret') : undefined, aiScope: settings.allowUserParsingProviders ? text(form, 'aiScope') : existing?.aiScope ?? null
			});
			logAudit(user.id, 'email_processing_update', 'user', user.id, { enabled, useImapForSmtp, aiEnabled });
			setFlash(cookies, 'Email processing settings saved.');
		} catch (error) { return fail(400, { error: error instanceof Error ? error.message : 'Invalid settings' }); }
		throw redirect(303, '/profile/email_processing');
	},
	pollNow: async ({ locals, cookies, getClientAddress }) => {
		const user = requireUser(locals);
		if (!getSettings().allowUserImap) return fail(403, { error: 'Per-user IMAP is disabled by the administrator.' });
		const limit = checkRateLimit(getClientAddress(), 'profile_email_processing_poll');
		if (!limit.allowed) return fail(429, { error: 'Too many attempts. Try again later.' });
		try {
			const result = await pollUserInbox(user.id);
			setFlash(cookies, `Inbox checked. ${result.imported} itinerary item${result.imported === 1 ? '' : 's'} imported.`);
		} catch (error) { return fail(400, { error: error instanceof Error ? error.message : 'Inbox check failed' }); }
		throw redirect(303, '/profile/email_processing');
	},
	testEmail: async ({ locals, cookies, getClientAddress }) => {
		const user = requireUser(locals);
		const limit = checkRateLimit(getClientAddress(), 'profile_email_processing_test_email');
		if (!limit.allowed) return fail(429, { error: 'Too many attempts. Try again later.' });
		try {
			const sent = await sendMail(user.email, { title: 'Roamarr email test', body: 'Your notification email settings work.' }, user.id);
			setFlash(cookies, sent ? 'Test email sent.' : 'Notification email is not configured.');
		} catch (error) { return fail(400, { error: error instanceof Error ? error.message : 'Test email failed' }); }
		throw redirect(303, '/profile/email_processing');
	}
};
