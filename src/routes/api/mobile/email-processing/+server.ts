import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/auth';
import { getSettings } from '$lib/server/settings';
import { getEmailProcessingConfig, pollUserInbox, saveEmailProcessingConfig, type EmailProcessingPatch, type MailSecurity } from '$lib/server/emailProcessing';
import { sendMail } from '$lib/server/notify';
import { checkRateLimit } from '$lib/server/rateLimit';
import { logAudit } from '$lib/server/audit';

const security = (value: unknown, fallback: MailSecurity): MailSecurity => value === 'none' || value === 'starttls' || value === 'ssl/tls' ? value : fallback;
const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null;
const port = (value: unknown) => { if (value == null || value === '') return null; const n = Number(value); if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error('Port must be between 1 and 65535'); return n; };

export const GET: RequestHandler = ({ locals }) => {
	const user = requireUser(locals), settings = getSettings();
	return json({ config: getEmailProcessingConfig(user.id), allowUserImap: settings.allowUserImap, allowUserSmtp: settings.allowUserSmtp, allowUserParsingProviders: settings.allowUserParsingProviders });
};

export const PATCH: RequestHandler = async ({ locals, request }) => {
	const user = requireUser(locals), values = await request.json() as Record<string, unknown>, section = String(values.section ?? ''), settings = getSettings();
	if (!['inbound', 'parsing', 'sender'].includes(section)) return json({ error: 'Invalid email settings section' }, { status: 400 });
	if ((section === 'inbound' && !settings.allowUserImap) || (section === 'sender' && !settings.allowUserSmtp) || (section === 'parsing' && !settings.allowUserParsingProviders)) return json({ error: 'This setting is disabled by the administrator' }, { status: 403 });
	const old = getEmailProcessingConfig(user.id);
	try {
		const patch: EmailProcessingPatch = {
			enabled: section === 'inbound' ? values.enabled === true : old?.enabled ?? false,
			imapHost: section === 'inbound' ? text(values.imapHost) : old?.imapHost ?? null,
			imapPort: section === 'inbound' ? port(values.imapPort) : old?.imapPort ?? null,
			imapSecurity: section === 'inbound' ? security(values.imapSecurity, 'ssl/tls') : old?.imapSecurity ?? 'ssl/tls',
			imapUsername: section === 'inbound' ? text(values.imapUsername) : old?.imapUsername ?? null,
			imapPassword: section === 'inbound' && typeof values.imapPassword === 'string' ? values.imapPassword || null : undefined,
			imapMailbox: section === 'inbound' ? text(values.imapMailbox) ?? 'INBOX' : old?.imapMailbox ?? 'INBOX',
			useImapForSmtp: section === 'sender' ? values.useImapForSmtp === true : old?.useImapForSmtp ?? true,
			smtpHost: section === 'sender' ? text(values.smtpHost) : old?.smtpHost ?? null,
			smtpPort: section === 'sender' ? port(values.smtpPort) : old?.smtpPort ?? null,
			smtpSecurity: section === 'sender' ? security(values.smtpSecurity, 'starttls') : old?.smtpSecurity ?? 'starttls',
			smtpUsername: section === 'sender' ? text(values.smtpUsername) : old?.smtpUsername ?? null,
			smtpPassword: section === 'sender' && typeof values.smtpPassword === 'string' ? values.smtpPassword || null : undefined,
			smtpFrom: section === 'sender' ? text(values.smtpFrom) : old?.smtpFrom ?? null,
			aiEnabled: section === 'parsing' ? values.aiEnabled === true : old?.aiEnabled ?? false,
			aiBaseUrl: section === 'parsing' ? text(values.aiBaseUrl) : old?.aiBaseUrl ?? null,
			aiModel: section === 'parsing' ? text(values.aiModel) : old?.aiModel ?? null,
			aiToken: section === 'parsing' && typeof values.aiToken === 'string' ? values.aiToken || null : undefined,
			aiTokenUrl: section === 'parsing' ? text(values.aiTokenUrl) : old?.aiTokenUrl ?? null,
			aiClientId: section === 'parsing' ? text(values.aiClientId) : old?.aiClientId ?? null,
			aiClientSecret: section === 'parsing' && typeof values.aiClientSecret === 'string' ? values.aiClientSecret || null : undefined,
			aiScope: section === 'parsing' ? text(values.aiScope) : old?.aiScope ?? null
		};
		if (patch.enabled && (!patch.imapHost || !patch.imapUsername || (!old?.imapPasswordSet && patch.imapPassword === undefined))) throw new Error('IMAP host, username, and password are required');
		if (patch.aiEnabled && (!patch.aiBaseUrl || !patch.aiModel)) throw new Error('AI base URL and model are required');
		const mode = String(values.aiAuthMode ?? (patch.aiTokenUrl ? 'oauth' : 'token'));
		if (section === 'parsing' && mode !== 'token' && mode !== 'oauth') throw new Error('Invalid parsing authentication method');
		if (section === 'parsing' && patch.aiEnabled && mode === 'token' && !old?.aiTokenSet && !patch.aiToken) throw new Error('API/subscription key is required');
		if (section === 'parsing' && patch.aiEnabled && mode === 'oauth' && (!patch.aiTokenUrl || !patch.aiClientId || (!old?.aiClientSecretSet && !patch.aiClientSecret))) throw new Error('OAuth requires token URL, client ID, and client secret');
		const config = saveEmailProcessingConfig(user.id, patch);
		logAudit(user.id, 'email_processing_update', 'user', user.id, { section });
		return json({ config });
	} catch (error) { return json({ error: error instanceof Error ? error.message : 'Invalid settings' }, { status: 400 }); }
};

export const POST: RequestHandler = async ({ locals, request, getClientAddress }) => {
	const user = requireUser(locals), { action } = await request.json() as { action?: string };
	const limit = checkRateLimit(getClientAddress(), `mobile_email_${action}`);
	if (!limit.allowed) return json({ error: 'Too many attempts. Try again later.' }, { status: 429 });
	if (action === 'poll') {
		if (!getSettings().allowUserImap) return json({ error: 'Per-user IMAP is disabled by the administrator.' }, { status: 403 });
		return json(await pollUserInbox(user.id));
	}
	if (action === 'test') return json({ sent: await sendMail(user.email, { title: 'Roamarr email test', body: 'Your notification email settings work.' }, user.id) });
	return json({ error: 'Unknown action' }, { status: 400 });
};
