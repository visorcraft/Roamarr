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
		const section = String(form.get('section') || '');
		try {
			const settings = getSettings();
			const existing = getEmailProcessingConfig(user.id);
			if (!['inbound', 'parsing', 'sender'].includes(section)) throw new Error('Invalid email settings section');
			const editImap = section === 'inbound' && settings.allowUserImap;
			const editSmtp = section === 'sender' && settings.allowUserSmtp;
			const editAi = section === 'parsing' && settings.allowUserParsingProviders;
			const enabled = editImap ? form.get('enabled') === 'on' : existing?.enabled ?? false;
			const useImapForSmtp = editSmtp ? form.get('useImapForSmtp') === 'on' : existing?.useImapForSmtp ?? true;
			const aiEnabled = editAi ? form.get('aiEnabled') === 'on' : existing?.aiEnabled ?? false;
			const aiAuthMode = String(form.get('aiAuthMode') || (existing?.aiTokenUrl || existing?.aiClientId ? 'oauth' : 'token'));
			if (aiAuthMode !== 'token' && aiAuthMode !== 'oauth') throw new Error('Invalid parsing authentication method');
			const imapHost = editImap ? text(form, 'imapHost') : existing?.imapHost ?? null;
			const imapUsername = editImap ? text(form, 'imapUsername') : existing?.imapUsername ?? null;
			if (editImap && enabled && (!imapHost || !imapUsername)) throw new Error('IMAP host and username are required');
			if (editAi && aiEnabled && (!text(form, 'aiBaseUrl') || !text(form, 'aiModel'))) throw new Error('AI base URL and model are required');
			const aiToken = editAi ? secret(form, 'aiToken', 'clearAiToken') : undefined;
			const aiClientSecret = editAi ? secret(form, 'aiClientSecret', 'clearAiClientSecret') : undefined;
			const tokenPresent = aiToken === undefined ? !!existing?.aiTokenSet : !!aiToken;
			const oauthSecretPresent = aiClientSecret === undefined ? !!existing?.aiClientSecretSet : !!aiClientSecret;
			if (editAi && aiEnabled && aiAuthMode === 'token' && !tokenPresent) throw new Error('API/subscription key is required');
			if (editAi && aiEnabled && aiAuthMode === 'oauth' && (!text(form, 'aiTokenUrl') || !text(form, 'aiClientId') || !oauthSecretPresent)) throw new Error('OAuth requires token URL, client ID, and client secret');
			saveEmailProcessingConfig(user.id, {
				enabled, imapHost, imapPort: editImap ? port(form, 'imapPort') : existing?.imapPort ?? null, imapSecurity: editImap ? security(form, 'imapSecurity', 'ssl/tls') : existing?.imapSecurity ?? 'ssl/tls',
				imapUsername, imapPassword: editImap ? secret(form, 'imapPassword', 'clearImapPassword') : undefined, imapMailbox: editImap ? text(form, 'imapMailbox') || 'INBOX' : existing?.imapMailbox ?? 'INBOX',
				useImapForSmtp, smtpHost: editSmtp ? text(form, 'smtpHost') : existing?.smtpHost ?? null, smtpPort: editSmtp ? port(form, 'smtpPort') : existing?.smtpPort ?? null,
				smtpSecurity: editSmtp ? security(form, 'smtpSecurity', 'starttls') : existing?.smtpSecurity ?? 'starttls', smtpUsername: editSmtp ? text(form, 'smtpUsername') : existing?.smtpUsername ?? null,
				smtpPassword: editSmtp ? secret(form, 'smtpPassword', 'clearSmtpPassword') : undefined, smtpFrom: editSmtp ? text(form, 'smtpFrom') || existing?.imapUsername || null : existing?.smtpFrom ?? null,
				aiEnabled, aiBaseUrl: editAi && aiEnabled ? text(form, 'aiBaseUrl') : existing?.aiBaseUrl ?? null, aiModel: editAi && aiEnabled ? text(form, 'aiModel') : existing?.aiModel ?? null, aiToken: editAi && aiEnabled ? aiAuthMode === 'token' ? aiToken : null : undefined,
				aiTokenUrl: editAi && aiEnabled ? aiAuthMode === 'oauth' ? text(form, 'aiTokenUrl') : null : existing?.aiTokenUrl ?? null, aiClientId: editAi && aiEnabled ? aiAuthMode === 'oauth' ? text(form, 'aiClientId') : null : existing?.aiClientId ?? null,
				aiClientSecret: editAi && aiEnabled ? aiAuthMode === 'oauth' ? aiClientSecret : null : undefined, aiScope: editAi && aiEnabled ? aiAuthMode === 'oauth' ? text(form, 'aiScope') : null : existing?.aiScope ?? null
			});
			logAudit(user.id, 'email_processing_update', 'user', user.id, { enabled, useImapForSmtp, aiEnabled });
			setFlash(cookies, 'Email settings saved.');
		} catch (error) { return fail(400, { error: error instanceof Error ? error.message : 'Invalid settings' }); }
		throw redirect(303, section === 'parsing' ? '/profile/email_parsing' : section === 'sender' ? '/profile/email_sender' : '/profile/email_processing');
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
		throw redirect(303, '/profile/email_sender');
	}
};
