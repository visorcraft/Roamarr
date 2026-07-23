import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAdmin } from '$lib/server/auth';
import { listUsers } from '$lib/server/repositories/usersRepo';
import { getAdminStats, listAuditLogs } from '$lib/server/repositories/auditRepo';
import { adminCreateUser, adminDeleteUser, adminSendPasswordReset, adminUpdateUser } from '$lib/server/users';
import { runTick } from '$lib/server/scheduler';
import { kit } from '$lib/server/db';
import { checkRateLimit } from '$lib/server/rateLimit';
import { logAudit } from '$lib/server/audit';
import { getSettings } from '$lib/server/settings';
import { _saveAdminSettings } from '../../general/+page.server';
import { MAP_TILE_PROVIDERS, type MapTileProvider } from '$lib/server/mapTiles';

const publicUser = (user: ReturnType<typeof listUsers>[number]) => ({
	id: Number(user.id), email: user.email, displayName: user.display_name ?? '', role: user.role,
	disabled: user.disabled, mustResetPassword: user.must_reset_password, createdAt: user.created_at
});
const safe = (value: unknown) => JSON.parse(JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? String(item) : item));

export const GET: RequestHandler = ({ locals }) => {
	requireAdmin(locals);
	const audit = listAuditLogs({ limit: 50 }), settings = getSettings();
	return json({ users: listUsers().map(publicUser), stats: getAdminStats(), audit: audit.logs, auditTotal: audit.total, settings: {
		instanceName: settings.instanceName, allowRegistration: settings.allowRegistration, defaultTimezone: settings.defaultTimezone,
		defaultCurrency: settings.defaultCurrency, defaultDateFormat: settings.defaultDateFormat, defaultDatetimeFormat: settings.defaultDatetimeFormat,
		defaultFlightCheckinLeadHours: settings.defaultFlightCheckinLeadHours, defaultDocumentExpiryLeadDays: settings.defaultDocumentExpiryLeadDays,
		emailPollIntervalMinutes: settings.emailPollIntervalMinutes, sessionCookieSameSite: settings.sessionCookieSameSite,
		webhookUrl: settings.webhookUrl, mapsTileProvider: settings.mapsTileProvider, mapsTileUrl: settings.mapsTileUrl,
		mapsTileAttribution: settings.mapsTileAttribution, mapsTileApiKeySet: !!settings.mapsTileApiKey,
		allowUserImap: settings.allowUserImap, allowUserSmtp: settings.allowUserSmtp,
		allowUserParsingProviders: settings.allowUserParsingProviders, allowUserMcpClients: settings.allowUserMcpClients,
		oauthClientAllowList: settings.oauthClientAllowList,
		smtpHost: settings.smtpHost, smtpPort: settings.smtpPort, smtpSecurity: settings.smtpSecurity, smtpUser: settings.smtpUser,
		smtpPassSet: !!settings.smtpPass, smtpFrom: settings.smtpFrom,
		globalImapEnabled: settings.globalImapEnabled, globalImapHost: settings.globalImapHost, globalImapPort: settings.globalImapPort,
		globalImapSecurity: settings.globalImapSecurity, globalImapUsername: settings.globalImapUsername,
		globalImapPasswordSet: !!settings.globalImapPassword, globalImapMailbox: settings.globalImapMailbox,
		globalAiEnabled: settings.globalAiEnabled, globalAiAuthMode: settings.globalAiAuthMode, globalAiBaseUrl: settings.globalAiBaseUrl,
		globalAiModel: settings.globalAiModel, globalAiTokenSet: !!settings.globalAiToken, globalAiTokenUrl: settings.globalAiTokenUrl,
		globalAiClientId: settings.globalAiClientId, globalAiClientSecretSet: !!settings.globalAiClientSecret, globalAiScope: settings.globalAiScope
	} });
};

export const POST: RequestHandler = async ({ request, locals, url, getClientAddress }) => {
	const admin = requireAdmin(locals);
	const body = await request.json().catch(() => { throw error(400, 'Invalid JSON'); }) as Record<string, unknown>;
	const action = String(body.action ?? '');
	if (action === 'settings') {
		const provider = String(body.mapsTileProvider ?? 'openstreetmap');
		if (!(MAP_TILE_PROVIDERS as readonly string[]).includes(provider)) throw error(400, 'Invalid tile provider');
		const aiEnabled = body.globalAiEnabled === true, aiMode = String(body.globalAiAuthMode ?? 'token');
		if (aiMode !== 'token' && aiMode !== 'oauth') throw error(400, 'Invalid global parsing authentication method');
		const current = getSettings(), aiToken = typeof body.globalAiToken === 'string' && body.globalAiToken ? body.globalAiToken : body.clearGlobalAiToken === true ? null : undefined;
		const aiSecret = typeof body.globalAiClientSecret === 'string' && body.globalAiClientSecret ? body.globalAiClientSecret : body.clearGlobalAiClientSecret === true ? null : undefined;
		if (aiEnabled && (!body.globalAiBaseUrl || !body.globalAiModel)) throw error(400, 'Global parsing requires API base URL and model');
		if (aiEnabled && aiMode === 'token' && !(aiToken === undefined ? current.globalAiToken : aiToken)) throw error(400, 'API/subscription key is required');
		if (aiEnabled && aiMode === 'oauth' && (!body.globalAiTokenUrl || !body.globalAiClientId || !(aiSecret === undefined ? current.globalAiClientSecret : aiSecret))) throw error(400, 'OAuth requires token URL, client ID, and client secret');
		_saveAdminSettings(admin.id, {
			instanceName: String(body.instanceName ?? 'Roamarr'), allowRegistration: body.allowRegistration === true,
			defaultTimezone: String(body.defaultTimezone ?? 'UTC'), defaultCurrency: String(body.defaultCurrency ?? 'USD'),
			defaultDateFormat: String(body.defaultDateFormat ?? 'yyyy-MM-dd'), defaultDatetimeFormat: String(body.defaultDatetimeFormat ?? 'yyyy-MM-dd h:mm a'),
			defaultFlightCheckinLeadHours: Number(body.defaultFlightCheckinLeadHours), defaultDocumentExpiryLeadDays: Number(body.defaultDocumentExpiryLeadDays),
			emailPollIntervalMinutes: Number(body.emailPollIntervalMinutes), sessionCookieSameSite: body.sessionCookieSameSite === 'strict' ? 'strict' : 'lax',
			webhookUrl: String(body.webhookUrl ?? ''), mapsTileProvider: provider as MapTileProvider, mapsTileUrl: String(body.mapsTileUrl ?? '') || null,
			mapsTileAttribution: String(body.mapsTileAttribution ?? '') || null,
			mapsTileApiKey: typeof body.mapsTileApiKey === 'string' && body.mapsTileApiKey ? body.mapsTileApiKey : undefined,
			allowUserImap: body.allowUserImap === true, allowUserSmtp: body.allowUserSmtp === true,
			allowUserParsingProviders: body.allowUserParsingProviders === true, allowUserMcpClients: body.allowUserMcpClients === true,
			oauthClientAllowList: Array.isArray(body.oauthClientAllowList) ? body.oauthClientAllowList.map(String).filter(Boolean) : null,
			smtpHost: String(body.smtpHost ?? ''), smtpPort: Number(body.smtpPort) || undefined, smtpSecurity: String(body.smtpSecurity ?? ''),
			smtpUser: String(body.smtpUser ?? ''), smtpPass: typeof body.smtpPass === 'string' && body.smtpPass ? body.smtpPass : body.clearSmtpPass === true ? null : undefined, smtpFrom: String(body.smtpFrom ?? ''),
			globalImapEnabled: body.globalImapEnabled === true, globalImapHost: String(body.globalImapHost ?? '') || null,
			globalImapPort: Number(body.globalImapPort) || null, globalImapSecurity: String(body.globalImapSecurity ?? 'ssl/tls'),
			globalImapUsername: String(body.globalImapUsername ?? '') || null,
			globalImapPassword: typeof body.globalImapPassword === 'string' && body.globalImapPassword ? body.globalImapPassword : body.clearGlobalImapPassword === true ? null : undefined,
			globalImapMailbox: String(body.globalImapMailbox ?? 'INBOX'), globalAiEnabled: aiEnabled, globalAiAuthMode: aiMode,
			globalAiBaseUrl: String(body.globalAiBaseUrl ?? '') || null, globalAiModel: String(body.globalAiModel ?? '') || null,
			globalAiToken: aiMode === 'token' ? aiToken : null, globalAiTokenUrl: aiMode === 'oauth' ? String(body.globalAiTokenUrl ?? '') || null : null,
			globalAiClientId: aiMode === 'oauth' ? String(body.globalAiClientId ?? '') || null : null,
			globalAiClientSecret: aiMode === 'oauth' ? aiSecret : null, globalAiScope: aiMode === 'oauth' ? String(body.globalAiScope ?? '') || null : null
		});
		return json({ ok: true });
	}
	if (['run-jobs', 'db-check', 'db-gc', 'db-flush', 'db-doctor'].includes(action)) {
		const limit = checkRateLimit(getClientAddress(), `mobile-admin:${action}`);
		if (!limit.allowed) throw error(429, 'Too many attempts. Try again later.');
		if (action !== 'db-check' && body.confirm !== true) throw error(400, 'Confirmation required');
		let result: unknown;
		if (action === 'run-jobs') result = await runTick(new Date());
		else if (action === 'db-check') result = kit.check();
		else if (action === 'db-gc') result = kit.compactAll();
		else if (action === 'db-flush') {
			const tableCount = kit.tableNames().length;
			await kit.flushAsync();
			result = { tableCount };
		}
		else result = kit.doctor();
		logAudit(admin.id, action, 'settings', 1);
		return json({ ok: true, result: safe(result) }, { headers: { 'cache-control': 'no-store' } });
	}
	if (action === 'create') {
		const created = await adminCreateUser(admin.id, {
			displayName: String(body.displayName ?? ''), email: String(body.email ?? ''), role: body.role === 'admin' ? 'admin' : 'user'
		});
		return json({ user: publicUser(created.user), temporaryPassword: created.temporaryPassword }, { status: 201 });
	}
	const userId = Number(body.userId);
	if (!Number.isSafeInteger(userId) || userId < 1) throw error(400, 'userId must be a positive integer');
	if (action === 'update') {
		await adminUpdateUser(admin.id, userId, {
			displayName: String(body.displayName ?? ''), email: String(body.email ?? ''), role: body.role === 'admin' ? 'admin' : 'user',
			disabled: body.disabled === true, mustResetPassword: body.mustResetPassword === true
		});
		return json({ ok: true });
	}
	if (action === 'delete') { await adminDeleteUser(admin.id, userId); return new Response(null, { status: 204 }); }
	if (action === 'reset') { await adminSendPasswordReset(userId, url.origin); return json({ ok: true }); }
	throw error(400, 'Unknown action');
};
