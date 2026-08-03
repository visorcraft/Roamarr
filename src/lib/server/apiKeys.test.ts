import { describe, test, expect, beforeEach, vi } from 'vitest';
import type { KitDatabase } from '@visorcraft/mongreldb-kit';

const ctx = vi.hoisted(() => ({ kit: null as unknown as KitDatabase }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { apiKeys } from './db/mongrelSchema';
import {
	API_KEY_PREFIX,
	createApiKey,
	listApiKeys,
	revokeApiKey,
	renameApiKey,
	verifyApiKey,
	extractApiKeyToken,
	getApiKeyScopes
} from './apiKeys';
import { ALL_SCOPES, getAvailableScopes } from './oauth';
import { updateSettings } from './settings';
import * as usersRepo from './repositories/usersRepo';
import { makeUser } from '../../../tests/helpers';
import { utcIsoAfter } from './tz';

describe('apiKeys', () => {
	let userId: number;

	beforeEach(() => {
		ctx.kit.deleteFrom(apiKeys).executeSync();
		userId = makeUser(ctx.kit).id;
	});

	function newKey(scopes: Parameters<typeof createApiKey>[1]['scopes'] = ['trips:read'], expiresAt?: string) {
		return createApiKey(userId, { name: 'CI script', scopes, expiresAt });
	}

	test('create returns an rk_ token once and persists only its hash', () => {
		const { key, token } = newKey();
		expect(token).toMatch(/^rk_[0-9a-f]{64}$/);
		expect(key.name).toBe('CI script');
		expect(key.scopes).toEqual(['trips:read']);
		expect(key.revoked).toBe(false);

		const rows = ctx.kit.selectFrom(apiKeys).executeSync();
		expect(rows).toHaveLength(1);
		const stored = rows[0];
		expect(JSON.stringify(stored, (_, v) => (typeof v === 'bigint' ? String(v) : v))).not.toContain(token);
		expect(stored.key_hash).toMatch(/^[0-9a-f]{64}$/);
		expect(stored.key_hash).not.toBe(token);
	});

	test('list returns keys without hashes, revoke marks the row but keeps it', () => {
		const { key } = newKey(['trips:read', 'trips:write']);
		const other = makeUser(ctx.kit).id;
		createApiKey(other, { name: 'other user', scopes: ['trips:read'] });

		const mine = listApiKeys(userId);
		expect(mine).toHaveLength(1);
		expect(mine[0].scopes).toEqual(['trips:read', 'trips:write']);
		expect(JSON.stringify(mine)).not.toContain('key_hash');

		expect(revokeApiKey(other, key.id)).toBe(false); // not owned
		expect(revokeApiKey(userId, key.id)).toBe(true);
		expect(revokeApiKey(userId, key.id)).toBe(false); // already revoked
		expect(listApiKeys(userId)[0].revoked).toBe(true);
		// Row kept for audit.
		expect(ctx.kit.selectFrom(apiKeys).executeSync()).toHaveLength(2);
	});

	test('rename updates only owned keys and validates the name', () => {
		const { key } = newKey();
		expect(renameApiKey(userId, key.id, 'Renamed')).toBe(true);
		expect(listApiKeys(userId)[0].name).toBe('Renamed');
		expect(renameApiKey(userId, key.id, '')).toBe(false);
		expect(renameApiKey(userId, 999999, 'x')).toBe(false);
	});

	test('verify resolves a valid key and throttles last_used_at writes', () => {
		const { key, token } = newKey(['trips:read']);
		const verified = verifyApiKey(token);
		expect(verified).toEqual({ keyId: key.id, userId, scopes: ['trips:read'] });

		const firstUsed = listApiKeys(userId)[0].lastUsedAt;
		expect(firstUsed).toBeTruthy();

		// Immediate second verify must not rewrite last_used_at (60s throttle).
		verifyApiKey(token);
		expect(listApiKeys(userId)[0].lastUsedAt).toBe(firstUsed);
	});

	test('verify rejects wrong, revoked, expired, and disabled-user tokens', () => {
		const { token } = newKey();
		expect(verifyApiKey('rk_' + '0'.repeat(64))).toBeNull();
		expect(verifyApiKey('not-a-key')).toBeNull();

		const expired = createApiKey(userId, { name: 'exp', scopes: ['trips:read'] });
		ctx.kit
			.updateTable(apiKeys)
			.set({ expires_at: '2020-01-01T00:00:00Z' })
			.executeSync();
		expect(verifyApiKey(expired.token)).toBeNull();

		const { key, token: revokedToken } = createApiKey(userId, { name: 'rev', scopes: ['trips:read'] });
		revokeApiKey(userId, key.id);
		expect(verifyApiKey(revokedToken)).toBeNull();

		usersRepo.updateUser(userId, { disabled: true });
		expect(verifyApiKey(token)).toBeNull();
	});

	test('creation validates scopes against the registry and rejects admin scopes', () => {
		expect(() => newKey([])).toThrow('At least one scope');
		expect(() => newKey(['trips:read', 'bogus:read'] as never)).toThrow('not allowed');
		expect(() => newKey(['admin:read'])).toThrow('not allowed');
		expect(() => newKey(['admin:write'])).toThrow('not allowed');
		expect(() => createApiKey(userId, { name: '', scopes: ['trips:read'] })).toThrow('name');
		expect(() => createApiKey(userId, { name: 'x', scopes: ['trips:read'], expiresAt: 'not-a-date' })).toThrow('expiry');
		expect(() =>
			createApiKey(userId, { name: 'x', scopes: ['trips:read'], expiresAt: '2020-01-01T00:00:00Z' })
		).toThrow('future');
		// A future expiry is accepted.
		expect(newKey(['trips:read'], utcIsoAfter({ days: 30 })).key.expiresAt).toBeTruthy();
	});

	test('grantable scopes are the available OAuth scopes minus admin', () => {
		const grantable = getApiKeyScopes();
		expect(grantable).not.toContain('admin:read');
		expect(grantable).not.toContain('admin:write');
		expect(grantable).toContain('trips:read');
		// private-details:read follows the same admin PII gate as OAuth clients.
		updateSettings({ allowMcpPii: true });
		expect(getApiKeyScopes()).toContain('private-details:read');
		updateSettings({ allowMcpPii: false });
		expect(getApiKeyScopes()).not.toContain('private-details:read');
		expect(getAvailableScopes().length).toBeLessThanOrEqual(ALL_SCOPES.length);
	});

	test('extractApiKeyToken reads X-Api-Token and rk_-prefixed Bearer only', () => {
		const withHeader = new Request('http://x/api/cards', { headers: { 'x-api-token': 'rk_abc' } });
		expect(extractApiKeyToken(withHeader)).toBe('rk_abc');

		const withBearer = new Request('http://x/api/cards', { headers: { authorization: 'Bearer rk_def' } });
		expect(extractApiKeyToken(withBearer)).toBe('rk_def');

		// OAuth bearer tokens must never be treated as API keys.
		const oauthBearer = new Request('http://x/api/cards', { headers: { authorization: 'Bearer abcdef' } });
		expect(extractApiKeyToken(oauthBearer)).toBeNull();

		const none = new Request('http://x/api/cards');
		expect(extractApiKeyToken(none)).toBeNull();
	});
});
