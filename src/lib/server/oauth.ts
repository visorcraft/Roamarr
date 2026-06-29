import { createHash, randomBytes } from 'node:crypto';
import { eq as kitEq } from '@mongreldb/kit';
import { kit } from './db';
import { oauthClients, oauthCodes, oauthTokens } from './db/mongrelSchema';
import { logAudit } from './audit';
import type { Row } from '@mongreldb/kit';

export type Scope =
	| 'trips:read'
	| 'trips:write'
	| 'packing:write'
	| 'budgets:write'
	| 'places:write'
	| 'reminders:write'
	| 'profile:read';

export const ALL_SCOPES: Scope[] = [
	'trips:read',
	'trips:write',
	'packing:write',
	'budgets:write',
	'places:write',
	'reminders:write',
	'profile:read'
];

export const DEFAULT_SCOPES: Scope[] = ['trips:read', 'profile:read'];

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
const CODE_TTL_SEC = 5 * 60;
const ACCESS_TTL_SEC = 60 * 60;
const REFRESH_TTL_SEC = 30 * 24 * 60 * 60;

export interface OAuthClient {
	clientId: string;
	clientName: string;
	redirectUris: string[];
	scopes: Scope[];
	isConfidential: boolean;
	createdAt: string;
}

function toClient(row: Row<typeof oauthClients>): OAuthClient {
	return {
		clientId: row.client_id as string,
		clientName: row.client_name as string,
		redirectUris: JSON.parse(row.redirect_uris as string) as string[],
		scopes: JSON.parse(row.scopes as string) as Scope[],
		isConfidential: Boolean(row.client_secret_hash),
		createdAt: row.created_at as string
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
}

export function createClient(userId: number, input: CreateClientInput): { client: OAuthClient; plaintextSecret: string | null } {
	const clientId = randomToken(16);
	const isConfidential = true;
	const plaintextSecret = isConfidential ? randomToken(32) : null;

	kit.insertInto(oauthClients).values({
		client_id: clientId,
		client_name: input.clientName,
		client_secret_hash: plaintextSecret ? sha256(plaintextSecret) : null,
		redirect_uris: JSON.stringify(input.redirectUris),
		scopes: JSON.stringify(input.scopes),
		created_at: new Date().toISOString(),
		created_by_user_id: BigInt(userId)
	} as any).executeSync();

	logAudit(userId, 'oauth_client_create', 'oauth_client', 0, { clientId, name: input.clientName });
	return { client: getClient(clientId)!, plaintextSecret };
}

export function deleteClient(userId: number, clientId: string): boolean {
	const n = kit.deleteFrom(oauthClients).where(kitEq(oauthClients.client_id, clientId)).executeSync();
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

export interface AuthorizationCode {
	clientId: string;
	userId: number;
	scopes: Scope[];
	codeChallenge: string;
	codeChallengeMethod: string;
	redirectUri: string;
}

export function createAuthorizationCode(params: {
	userId: number;
	clientId: string;
	scopes: Scope[];
	codeChallenge: string;
	redirectUri: string;
}): { code: string; redirectUri: string } {
	const code = randomToken(32);
	const expiresAt = new Date(Date.now() + CODE_TTL_SEC * 1000).toISOString();
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
}): TokenResult | { error: string } {
	const row = kit
		.selectFrom(oauthCodes)
		.where(kitEq(oauthCodes.code_hash, sha256(params.code)))
		.executeSync()[0];
	if (!row) return { error: 'invalid_grant' };
	if (row.used_at) return { error: 'invalid_grant' };
	if (Date.now() > new Date(row.expires_at as string).getTime()) return { error: 'invalid_grant' };
	if (row.client_id !== params.clientId) return { error: 'invalid_grant' };

	const client = getClient(params.clientId);
	if (!client) return { error: 'invalid_client' };
	if (client.isConfidential) {
		if (!params.clientSecret) return { error: 'invalid_client' };
		const stored = kit
			.selectFrom(oauthClients)
			.where(kitEq(oauthClients.client_id, params.clientId))
			.executeSync()[0];
		if (stored?.client_secret_hash !== sha256(params.clientSecret)) return { error: 'invalid_client' };
	}

	if (!verifyPkce(params.codeVerifier, row.code_challenge as string)) return { error: 'invalid_grant' };

	kit
		.updateTable(oauthCodes)
		.set({ used_at: new Date().toISOString() })
		.where(kitEq(oauthCodes.id, row.id))
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
}): TokenResult | { error: string } {
	const row = kit
		.selectFrom(oauthTokens)
		.where(kitEq(oauthTokens.refresh_token_hash, sha256(params.refreshToken)))
		.executeSync()[0];
	if (!row) return { error: 'invalid_grant' };
	if (row.revoked_at) return { error: 'invalid_grant' };
	if (row.client_id !== params.clientId) return { error: 'invalid_grant' };
	if (row.refresh_expires_at && Date.now() > new Date(row.refresh_expires_at as string).getTime())
		return { error: 'invalid_grant' };

	kit
		.updateTable(oauthTokens)
		.set({ revoked_at: new Date().toISOString() })
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
	const now = Date.now();
	kit.insertInto(oauthTokens).values({
		access_token_hash: sha256(accessToken),
		refresh_token_hash: sha256(refreshToken),
		client_id: params.clientId,
		user_id: BigInt(params.userId),
		scopes: JSON.stringify(params.scopes),
		expires_at: new Date(now + ACCESS_TTL_SEC * 1000).toISOString(),
		refresh_expires_at: new Date(now + REFRESH_TTL_SEC * 1000).toISOString(),
		revoked_at: null,
		created_at: new Date().toISOString(),
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
	if (Date.now() > new Date(row.expires_at as string).getTime()) return null;

	kit
		.updateTable(oauthTokens)
		.set({ last_used_at: new Date().toISOString() })
		.where(kitEq(oauthTokens.id, row.id))
		.executeSync();

	return {
		userId: Number(row.user_id),
		scopes: JSON.parse(row.scopes as string) as Scope[],
		clientId: row.client_id as string
	};
}

export function revokeTokensForUser(userId: number): number {
	const n = kit
		.updateTable(oauthTokens)
		.set({ revoked_at: new Date().toISOString() })
		.where(kitEq(oauthTokens.user_id, BigInt(userId)))
		.executeSync();
	return Number(n);
}

export function revokeToken(token: string): boolean {
	const row = kit
		.selectFrom(oauthTokens)
		.where(kitEq(oauthTokens.access_token_hash, sha256(token)))
		.executeSync()[0];
	if (!row) return false;
	kit
		.updateTable(oauthTokens)
		.set({ revoked_at: new Date().toISOString() })
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
