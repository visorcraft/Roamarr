import { createHash, randomBytes } from 'node:crypto';
import { eq as kitEq, and as kitAnd } from '@visorcraft/mongreldb-kit';
import { kit } from './db';
import { apiKeys } from './db/mongrelSchema';
import { logAudit } from './audit';
import { getUserById } from './repositories/usersRepo';
import { getAvailableScopes, type Scope } from './oauth';
import { nowIso } from './tz';
import type { Row } from '@visorcraft/mongreldb-kit';

// Token format: `rk_` followed by 64 lowercase hex characters (32 random
// bytes from crypto.randomBytes). The plaintext is shown exactly once at
// creation; only its SHA-256 hex digest is persisted.
export const API_KEY_PREFIX = 'rk_';
// Synthetic clientId used when an API key stands in for an OAuth token, so the
// auth context shape stays identical. Keys belong to the user directly, so no
// client registry or consent checks apply to them.
export const API_KEY_CLIENT_ID = 'api-key';
const TOKEN_BYTES = 32;
// last_used_at writes are throttled so a busy script does not turn every
// request into a row update.
const LAST_USED_THROTTLE_MS = 60_000;
export const MAX_API_KEY_NAME_LENGTH = 80;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

// Admin scopes stay exclusive to OAuth grants; personal API keys can never
// carry them, no matter who creates the key.
const ADMIN_SCOPES: Scope[] = ['admin:read', 'admin:write'];

/** Scopes a personal API key may be created with. */
export function getApiKeyScopes(): Scope[] {
	return getAvailableScopes().filter((s) => !ADMIN_SCOPES.includes(s));
}

export interface ApiKeyInfo {
	id: number;
	name: string;
	scopes: Scope[];
	createdAt: string;
	expiresAt: string | null;
	lastUsedAt: string | null;
	revoked: boolean;
}

function toInfo(row: Row<typeof apiKeys>): ApiKeyInfo {
	return {
		id: Number(row.id),
		name: row.name as string,
		scopes: (row.scopes as string).split(',').filter(Boolean) as Scope[],
		createdAt: row.created_at as string,
		expiresAt: (row.expires_at as string) || null,
		lastUsedAt: (row.last_used_at as string) || null,
		revoked: Boolean(row.revoked_at)
	};
}

export interface CreateApiKeyInput {
	name: string;
	scopes: Scope[];
	/** Optional ISO timestamp after which the key stops authenticating. */
	expiresAt?: string | null;
}

export function createApiKey(userId: number, input: CreateApiKeyInput): { key: ApiKeyInfo; token: string } {
	const name = input.name.trim();
	if (!name) throw new Error('Key name is required');
	if (name.length > MAX_API_KEY_NAME_LENGTH) throw new Error('Key name is too long');
	if (!Array.isArray(input.scopes) || input.scopes.length === 0) {
		throw new Error('At least one scope is required');
	}
	// Fail loudly on unknown or admin-only scopes instead of silently filtering,
	// mirroring createClient in oauth.ts.
	const allowed = getApiKeyScopes();
	const invalid = input.scopes.filter((s) => !allowed.includes(s));
	if (invalid.length > 0) {
		throw new Error(`Scope(s) not allowed for API keys: ${invalid.join(', ')}`);
	}
	if (input.expiresAt != null) {
		const ms = new Date(input.expiresAt).getTime();
		if (!Number.isFinite(ms)) throw new Error('Invalid expiry date');
		if (ms <= Date.now()) throw new Error('Expiry must be in the future');
	}

	const token = API_KEY_PREFIX + randomBytes(TOKEN_BYTES).toString('hex');
	kit.insertInto(apiKeys).values({
		user_id: BigInt(userId),
		name,
		key_hash: sha256(token),
		scopes: input.scopes.join(','),
		expires_at: input.expiresAt ?? null,
		last_used_at: null,
		created_at: nowIso(),
		revoked_at: null
	} as any).executeSync();

	const row = kit
		.selectFrom(apiKeys)
		.where(kitEq(apiKeys.key_hash, sha256(token)))
		.executeSync()[0];
	const key = toInfo(row);
	logAudit(userId, 'api_key_create', 'api_key', key.id, { name, scopes: input.scopes });
	return { key, token };
}

export function listApiKeys(userId: number): ApiKeyInfo[] {
	return kit
		.selectFrom(apiKeys)
		.where(kitEq(apiKeys.user_id, BigInt(userId)))
		.executeSync()
		.map(toInfo);
}

/** Revocation keeps the row for audit; the key simply stops verifying. */
export function revokeApiKey(userId: number, id: number): boolean {
	const row = kit
		.selectFrom(apiKeys)
		.where(kitAnd(kitEq(apiKeys.id, BigInt(id)), kitEq(apiKeys.user_id, BigInt(userId))))
		.executeSync()[0];
	if (!row || row.revoked_at) return false;
	kit
		.updateTable(apiKeys)
		.set({ revoked_at: nowIso() })
		.where(kitEq(apiKeys.id, row.id))
		.executeSync();
	logAudit(userId, 'api_key_revoke', 'api_key', Number(row.id), { name: row.name as string });
	return true;
}

export function renameApiKey(userId: number, id: number, name: string): boolean {
	const trimmed = name.trim();
	if (!trimmed || trimmed.length > MAX_API_KEY_NAME_LENGTH) return false;
	const updated = kit
		.updateTable(apiKeys)
		.set({ name: trimmed })
		.where(kitAnd(kitEq(apiKeys.id, BigInt(id)), kitEq(apiKeys.user_id, BigInt(userId))))
		.executeSync();
	return updated.length > 0;
}

export interface VerifiedApiKey {
	keyId: number;
	userId: number;
	scopes: Scope[];
}

export function verifyApiKey(token: string): VerifiedApiKey | null {
	if (!token.startsWith(API_KEY_PREFIX)) return null;
	const row = kit
		.selectFrom(apiKeys)
		.where(kitEq(apiKeys.key_hash, sha256(token)))
		.executeSync()[0];
	if (!row) return null;
	if (row.revoked_at) return null;
	const expiresAt = row.expires_at as string | null;
	if (expiresAt && Date.now() > new Date(expiresAt).getTime()) return null;
	// Mirror the OAuth invariant: a disabled (or deleted) user's credentials
	// must stop authenticating immediately.
	const user = getUserById(Number(row.user_id));
	if (!user || user.disabled) return null;

	const lastUsedAt = row.last_used_at as string | null;
	if (!lastUsedAt || Date.now() - new Date(lastUsedAt).getTime() > LAST_USED_THROTTLE_MS) {
		kit
			.updateTable(apiKeys)
			.set({ last_used_at: nowIso() })
			.where(kitEq(apiKeys.id, row.id))
			.executeSync();
	}

	return {
		keyId: Number(row.id),
		userId: Number(row.user_id),
		scopes: (row.scopes as string).split(',').filter(Boolean) as Scope[]
	};
}

/**
 * Extract a personal API key credential from a request: either the
 * `X-Api-Token` header or an `Authorization: Bearer rk_…` header. Real OAuth
 * access tokens never carry the rk_ prefix, so Bearer extraction can never
 * shadow them.
 */
export function extractApiKeyToken(request: Request): string | null {
	const header = request.headers.get('x-api-token')?.trim();
	if (header) return header;
	const bearer = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
	if (bearer && bearer.startsWith(API_KEY_PREFIX)) return bearer;
	return null;
}
