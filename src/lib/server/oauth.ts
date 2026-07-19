import { createHash, randomBytes } from 'node:crypto';
import { eq as kitEq, and as kitAnd, isNull as kitIsNull, lt as kitLt } from '@visorcraft/mongreldb-kit';
import { kit } from './db';
import { oauthClients, oauthCodes, oauthTokens } from './db/mongrelSchema';
import { logAudit } from './audit';
import { getUserById } from './repositories/usersRepo';
import { getSettings } from './settings';
import { nowIso, utcIsoAfter } from './tz';
import type { Row } from '@visorcraft/mongreldb-kit';

export type Scope =
	| 'trips:read'
	| 'trips:write'
	| 'segments:read'
	| 'segments:write'
	| 'packing:read'
	| 'packing:write'
	| 'budgets:read'
	| 'budgets:write'
	| 'expenses:read'
	| 'expenses:write'
	| 'places:read'
	| 'places:write'
	| 'reminders:read'
	| 'reminders:write'
	| 'profile:read'
	| 'companions:read'
	| 'companions:write'
	| 'sharing:read'
	| 'sharing:write'
	| 'calendar:read'
	| 'calendar:write'
	| 'templates:read'
	| 'templates:write'
	| 'travel-docs:read'
	| 'travel-docs:write'
	| 'doc-links:read'
	| 'doc-links:write'
	| 'fares:read'
	| 'fares:write'
	| 'polls:read'
	| 'polls:write'
	| 'journal:read'
	| 'journal:write'
	| 'items:read'
	| 'items:write'
	| 'requirements:read'
	| 'requirements:write'
	| 'home-tasks:read'
	| 'home-tasks:write'
	| 'medications:read'
	| 'medications:write'
	| 'cards:read'
	| 'cards:write'
	| 'loyalty:read'
	| 'loyalty:write'
	| 'insurance:read'
	| 'insurance:write'
	| 'contacts:read'
	| 'contacts:write'
	| 'profile-prefs:read'
	| 'profile-prefs:write'
	| 'notifications:read'
	| 'notifications:write'
	| 'user-smtp:read'
	| 'user-smtp:write'
	| 'comments:read'
	| 'comments:write'
	| 'search:read'
	| 'admin:read'
	| 'admin:write'
	| 'security:read'
	| 'security:write';

export const ALL_SCOPES: Scope[] = [
	'trips:read',
	'trips:write',
	'segments:read',
	'segments:write',
	'packing:read',
	'packing:write',
	'budgets:read',
	'budgets:write',
	'expenses:read',
	'expenses:write',
	'places:read',
	'places:write',
	'reminders:read',
	'reminders:write',
	'profile:read',
	'companions:read',
	'companions:write',
	'sharing:read',
	'sharing:write',
	'calendar:read',
	'calendar:write',
	'templates:read',
	'templates:write',
	'travel-docs:read',
	'travel-docs:write',
	'doc-links:read',
	'doc-links:write',
	'fares:read',
	'fares:write',
	'polls:read',
	'polls:write',
	'journal:read',
	'journal:write',
	'items:read',
	'items:write',
	'requirements:read',
	'requirements:write',
	'home-tasks:read',
	'home-tasks:write',
	'medications:read',
	'medications:write',
	'cards:read',
	'cards:write',
	'loyalty:read',
	'loyalty:write',
	'insurance:read',
	'insurance:write',
	'contacts:read',
	'contacts:write',
	'profile-prefs:read',
	'profile-prefs:write',
	'notifications:read',
	'notifications:write',
	'user-smtp:read',
	'user-smtp:write',
	'comments:read',
	'comments:write',
	'search:read',
	'admin:read',
	'admin:write',
	'security:read',
	'security:write'
];

export { SCOPE_DESCRIPTIONS } from '$lib/oauthScopes';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
const CODE_TTL_SEC = 5 * 60;
// OAuth grants remain valid until the user revokes them. Keep expires_in for
// client compatibility, but authorization is controlled by revoked_at.
const ACCESS_TTL_SEC = 2_147_483_647;

export interface OAuthClient {
	clientId: string;
	clientName: string;
	redirectUris: string[];
	scopes: Scope[];
	isConfidential: boolean;
	createdAt: string;
	requiresReauth: boolean;
}

function toClient(row: Row<typeof oauthClients>): OAuthClient {
	return {
		clientId: row.client_id as string,
		clientName: row.client_name as string,
		redirectUris: JSON.parse(row.redirect_uris as string) as string[],
		scopes: JSON.parse(row.scopes as string) as Scope[],
		isConfidential: Boolean(row.client_secret_hash),
		createdAt: row.created_at as string,
		requiresReauth: Boolean(row.requires_reauth)
	};
}

export function getClient(clientId: string): OAuthClient | null {
	const row = kit
		.selectFrom(oauthClients)
		.where(kitEq(oauthClients.client_id, clientId))
		.executeSync()[0];
	return row ? toClient(row) : null;
}

export function listClients(userId: number): OAuthClient[] {
	return kit
		.selectFrom(oauthClients)
		.where(kitEq(oauthClients.created_by_user_id, BigInt(userId)))
		.executeSync()
		.map(toClient);
}

export interface CreateClientInput {
	clientName: string;
	redirectUris: string[];
	scopes: Scope[];
	/** Public clients (e.g. desktop apps that can't keep a secret) use PKCE only. */
	isPublic?: boolean;
	/** Optional pre-approved client ID. Required when an admin allow-list is in effect. */
	clientId?: string;
}

export function getOAuthClientAllowList(): string[] | null {
	return getSettings().oauthClientAllowList;
}

export function isClientAllowed(clientId: string): boolean {
	const list = getOAuthClientAllowList();
	if (!list || list.length === 0) return true;
	return list.includes(clientId);
}

export function assertClientAllowed(clientId: string): void {
	if (!isClientAllowed(clientId)) {
		throw new Error('Client ID is not on the admin allow-list');
	}
}

export function createClient(userId: number | null, input: CreateClientInput): { client: OAuthClient; plaintextSecret: string | null } {
	const clientId = input.clientId ?? randomToken(16);
	assertClientAllowed(clientId);
	// Reject empty scope arrays. The previous behavior of "empty = ALL_SCOPES"
	// was a privilege-inflation hazard once ALL_SCOPES grew. A client with
	// no scopes gets no permission; the consent UI surfaces this.
	if (!Array.isArray(input.scopes) || input.scopes.length === 0) {
		throw new Error('At least one scope is required');
	}
	// Reject any scope not in the canonical ALL_SCOPES list. validateScopes
	// filters silently; here we want the create call to fail loudly so a
	// tampered form (e.g. future scope name smuggled in) cannot persist.
	const invalid = input.scopes.filter((s) => !ALL_SCOPES.includes(s));
	if (invalid.length > 0) {
		throw new Error(`Unknown scope(s): ${invalid.join(', ')}`);
	}
	const isConfidential = !input.isPublic;
	const plaintextSecret = isConfidential ? randomToken(32) : null;

	kit.insertInto(oauthClients).values({
		client_id: clientId,
		client_name: input.clientName,
		client_secret_hash: plaintextSecret ? sha256(plaintextSecret) : null,
		redirect_uris: JSON.stringify(input.redirectUris),
		scopes: JSON.stringify(input.scopes),
		created_at: nowIso(),
		created_by_user_id: userId == null ? null : BigInt(userId)
	} as any).executeSync();

	if (userId != null) logAudit(userId, 'oauth_client_create', 'oauth_client', 0, { clientId, name: input.clientName });
	return { client: getClient(clientId)!, plaintextSecret };
}

export function claimDynamicClient(clientId: string, userId: number): void {
	const updated = kit.updateTable(oauthClients)
		.set({ created_by_user_id: BigInt(userId) })
		.where(kitAnd(kitEq(oauthClients.client_id, clientId), kitIsNull(oauthClients.created_by_user_id)))
		.executeSync();
	if (updated.length > 0) logAudit(userId, 'oauth_client_claim', 'oauth_client', 0, { clientId });
}

export function deleteClient(userId: number, clientId: string): boolean {
	const n = kit
		.deleteFrom(oauthClients)
		.where(
			kitAnd(
				kitEq(oauthClients.client_id, clientId),
				kitEq(oauthClients.created_by_user_id, BigInt(userId))
			)
		)
		.executeSync();
	if (n > 0n) {
		kit.deleteFrom(oauthTokens).where(kitEq(oauthTokens.client_id, clientId)).executeSync();
		logAudit(userId, 'oauth_client_delete', 'oauth_client', 0, { clientId });
	}
	return n > 0n;
}

export function validateScopes(requested: string[], allowed: Scope[]): Scope[] {
	const set = new Set(allowed as string[]);
	return requested.filter((s) => set.has(s)) as Scope[];
}

export function createAuthorizationCode(params: {
	userId: number;
	clientId: string;
	scopes: Scope[];
	codeChallenge: string;
	redirectUri: string;
}): { code: string; redirectUri: string } {
	// NOTE: requires_reauth is cleared only on a successful token exchange
	// (exchangeAuthorizationCode), not here. A user who opens the consent
	// page but never completes the flow would otherwise bypass the re-auth
	// gate by simply visiting /oauth/authorize.
	const code = randomToken(32);
	const expiresAt = utcIsoAfter({ seconds: CODE_TTL_SEC });
	kit.insertInto(oauthCodes).values({
		code_hash: sha256(code),
		client_id: params.clientId,
		user_id: BigInt(params.userId),
		scopes: JSON.stringify(params.scopes),
		code_challenge: params.codeChallenge,
		code_challenge_method: 'S256',
		redirect_uri: params.redirectUri,
		expires_at: expiresAt,
		used_at: null
	} as any).executeSync();
	return { code, redirectUri: params.redirectUri };
}

export function verifyPkce(verifier: string, challenge: string): boolean {
	const hash = createHash('sha256').update(verifier).digest('base64url');
	return hash === challenge;
}

// Confidential clients must present their secret at the token endpoint; public
// (PKCE-only) clients authenticate via the code_verifier alone.
function authenticateClient(clientId: string, clientSecret: string | null): { ok: true } | { error: string } {
	const client = getClient(clientId);
	if (!client) return { error: 'invalid_client' };
	if (client.requiresReauth) return { error: 'invalid_client' };
	if (client.isConfidential) {
		if (!clientSecret) return { error: 'invalid_client' };
		const stored = kit
			.selectFrom(oauthClients)
			.where(kitEq(oauthClients.client_id, clientId))
			.executeSync()[0];
		if (stored?.client_secret_hash !== sha256(clientSecret)) return { error: 'invalid_client' };
	}
	return { ok: true };
}

export interface TokenResult {
	accessToken: string;
	refreshToken: string;
	tokenType: 'Bearer';
	expiresIn: number;
	scope: string;
}

export function exchangeAuthorizationCode(params: {
	code: string;
	clientId: string;
	clientSecret: string | null;
	codeVerifier: string;
	redirectUri?: string;
}): TokenResult | { error: string } {
	const row = kit
		.selectFrom(oauthCodes)
		.where(kitEq(oauthCodes.code_hash, sha256(params.code)))
		.executeSync()[0];
	if (!row) return { error: 'invalid_grant' };
	if (row.used_at) return { error: 'invalid_grant' };
	if (Date.now() > new Date(row.expires_at as string).getTime()) return { error: 'invalid_grant' };
	if (row.client_id !== params.clientId) return { error: 'invalid_grant' };
	// RFC 6749 §4.1.3: redirect_uri must match the one bound to the code.
	if (params.redirectUri != null && row.redirect_uri !== params.redirectUri) return { error: 'invalid_grant' };

	const clientAuth = authenticateClient(params.clientId, params.clientSecret);
	if ('error' in clientAuth) return clientAuth;

	if (!verifyPkce(params.codeVerifier, row.code_challenge as string)) return { error: 'invalid_grant' };

	kit
		.updateTable(oauthCodes)
		.set({ used_at: nowIso() })
		.where(kitEq(oauthCodes.id, row.id))
		.executeSync();

	// Successful exchange clears the reauth gate.
	kit
		.updateTable(oauthClients)
		.set({ requires_reauth: false })
		.where(kitEq(oauthClients.client_id, params.clientId))
		.executeSync();

	const scopes = JSON.parse(row.scopes as string) as Scope[];
	return issueTokens({
		clientId: params.clientId,
		userId: Number(row.user_id),
		scopes
	});
}

export function refreshAccessToken(params: {
	refreshToken: string;
	clientId: string;
	clientSecret?: string | null;
}): TokenResult | { error: string } {
	const row = kit
		.selectFrom(oauthTokens)
		.where(kitEq(oauthTokens.refresh_token_hash, sha256(params.refreshToken)))
		.executeSync()[0];
	if (!row) return { error: 'invalid_grant' };
	if (row.revoked_at) return { error: 'invalid_grant' };
	if (row.client_id !== params.clientId) return { error: 'invalid_grant' };
	const clientAuth = authenticateClient(params.clientId, params.clientSecret ?? null);
	if ('error' in clientAuth) return clientAuth;

	kit
		.updateTable(oauthTokens)
		.set({ revoked_at: nowIso() })
		.where(kitEq(oauthTokens.id, row.id))
		.executeSync();

	const scopes = JSON.parse(row.scopes as string) as Scope[];
	return issueTokens({
		clientId: params.clientId,
		userId: Number(row.user_id),
		scopes
	});
}

function issueTokens(params: {
	clientId: string;
	userId: number;
	scopes: Scope[];
}): TokenResult {
	const accessToken = randomToken(32);
	const refreshToken = randomToken(32);
	kit.insertInto(oauthTokens).values({
		access_token_hash: sha256(accessToken),
		refresh_token_hash: sha256(refreshToken),
		client_id: params.clientId,
		user_id: BigInt(params.userId),
		scopes: JSON.stringify(params.scopes),
		expires_at: utcIsoAfter({ seconds: ACCESS_TTL_SEC }),
		refresh_expires_at: null,
		revoked_at: null,
		created_at: nowIso(),
		last_used_at: null
	} as any).executeSync();

	return {
		accessToken,
		refreshToken,
		tokenType: 'Bearer',
		expiresIn: ACCESS_TTL_SEC,
		scope: params.scopes.join(' ')
	};
}

export interface AuthenticatedToken {
	userId: number;
	scopes: Scope[];
	clientId: string;
}

export function verifyAccessToken(token: string): AuthenticatedToken | null {
	const row = kit
		.selectFrom(oauthTokens)
		.where(kitEq(oauthTokens.access_token_hash, sha256(token)))
		.executeSync()[0];
	if (!row) return null;
	if (row.revoked_at) return null;
	// Enforce the "disabled users cannot authenticate" invariant: oauth_tokens has
	// no FK to users, so a disabled/deleted user's token would otherwise live until
	// natural expiry.
	const user = getUserById(Number(row.user_id));
	if (!user || user.disabled) return null;

	// Enforce the re-auth gate set by the scope-hardening migration. Existing
	// tokens issued before re-authorization must not be honored after the
	// client is flagged. This catches the case where a client was rotated to
	// requires_reauth=1 but old tokens still exist in oauth_tokens.
	const clientRow = kit
		.selectFrom(oauthClients)
		.where(kitEq(oauthClients.client_id, row.client_id as string))
		.executeSync()[0];
	if (clientRow?.requires_reauth) return null;

	kit
		.updateTable(oauthTokens)
		.set({ last_used_at: nowIso() })
		.where(kitEq(oauthTokens.id, row.id))
		.executeSync();

	return {
		userId: Number(row.user_id),
		scopes: JSON.parse(row.scopes as string) as Scope[],
		clientId: row.client_id as string
	};
}

export function revokeTokensForUser(userId: number): number {
	// updateTable returns the affected rows (Row[]), not a count.
	const rows = kit
		.updateTable(oauthTokens)
		.set({ revoked_at: nowIso() })
		.where(kitEq(oauthTokens.user_id, BigInt(userId)))
		.executeSync();
	return rows.length;
}

/**
 * Delete expired one-time authorization codes. Bearer grants remain until
 * explicit revocation.
 */
export function purgeExpiredOauth(): { codes: number; tokens: number } {
	const now = nowIso();
	const codes = kit.deleteFrom(oauthCodes).where(kitLt(oauthCodes.expires_at, now)).executeSync();
	return { codes: Number(codes), tokens: 0 };
}

export function revokeTokenForUser(userId: number, token: string): boolean {
	const row = kit
		.selectFrom(oauthTokens)
		.where(kitEq(oauthTokens.access_token_hash, sha256(token)))
		.executeSync()[0];
	if (!row) return false;
	if (Number(row.user_id) !== userId) return false;
	kit
		.updateTable(oauthTokens)
		.set({ revoked_at: nowIso() })
		.where(kitEq(oauthTokens.id, row.id))
		.executeSync();
	return true;
}

export function revokeTokenByIdForUser(userId: number, tokenId: number): boolean {
	const row = kit
		.selectFrom(oauthTokens)
		.where(kitEq(oauthTokens.id, BigInt(tokenId)))
		.executeSync()[0];
	if (!row) return false;
	if (Number(row.user_id) !== userId) return false;
	kit
		.updateTable(oauthTokens)
		.set({ revoked_at: nowIso() })
		.where(kitEq(oauthTokens.id, row.id))
		.executeSync();
	return true;
}

export function listUserTokens(userId: number): Array<{
	id: number;
	clientId: string;
	scopes: Scope[];
	createdAt: string;
	lastUsedAt: string | null;
	revoked: boolean;
}> {
	return kit
		.selectFrom(oauthTokens)
		.where(kitEq(oauthTokens.user_id, BigInt(userId)))
		.executeSync()
		.map((r) => ({
			id: Number(r.id),
			clientId: r.client_id as string,
			scopes: JSON.parse(r.scopes as string) as Scope[],
			createdAt: r.created_at as string,
			lastUsedAt: (r.last_used_at as string) || null,
			revoked: Boolean(r.revoked_at)
		}));
}
