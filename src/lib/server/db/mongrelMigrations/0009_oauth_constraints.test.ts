import { describe, test, expect, beforeEach, vi } from 'vitest';
import type { KitDatabase } from '@mongreldb/kit';

const ctx = vi.hoisted(() => ({ kit: null as unknown as KitDatabase }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { eq } from '@mongreldb/kit';
import { oauthClients, oauthTokens, users } from '../mongrelSchema';
import { kit } from '$lib/server/db';
import { makeUser } from '../../../../../tests/helpers';

describe('0009_oauth_constraints', () => {
	beforeEach(() => {
		ctx.kit.deleteFrom(oauthTokens).executeSync();
		ctx.kit.deleteFrom(oauthClients).executeSync();
	});

	test('refresh_token_hash is unique across oauth_tokens', () => {
		const user = makeUser(ctx.kit);

		kit.insertInto(oauthTokens).values({
			access_token_hash: 'hash-a',
			refresh_token_hash: 'shared-refresh',
			client_id: 'client-a',
			user_id: BigInt(user.id),
			scopes: '[]',
			expires_at: new Date(Date.now() + 3600_000).toISOString(),
			refresh_expires_at: null,
			revoked_at: null,
			last_used_at: null
		} as any).executeSync();

		expect(() =>
			kit.insertInto(oauthTokens).values({
				access_token_hash: 'hash-b',
				refresh_token_hash: 'shared-refresh',
				client_id: 'client-b',
				user_id: BigInt(user.id),
				scopes: '[]',
				expires_at: new Date(Date.now() + 3600_000).toISOString(),
				refresh_expires_at: null,
				revoked_at: null,
				last_used_at: null
			} as any).executeSync()
		).toThrow();

		// Null refresh_token_hash values are allowed (e.g. single-use tokens).
		expect(() => {
			kit.insertInto(oauthTokens).values({
				access_token_hash: 'hash-c',
				refresh_token_hash: null,
				client_id: 'client-c',
				user_id: BigInt(user.id),
				scopes: '[]',
				expires_at: new Date(Date.now() + 3600_000).toISOString(),
				refresh_expires_at: null,
				revoked_at: null,
				last_used_at: null
			} as any).executeSync();
			kit.insertInto(oauthTokens).values({
				access_token_hash: 'hash-d',
				refresh_token_hash: null,
				client_id: 'client-d',
				user_id: BigInt(user.id),
				scopes: '[]',
				expires_at: new Date(Date.now() + 3600_000).toISOString(),
				refresh_expires_at: null,
				revoked_at: null,
				last_used_at: null
			} as any).executeSync();
		}).not.toThrow();
	});

	test('oauth_clients.created_by_user_id references users and cascades on delete', () => {
		const user = makeUser(ctx.kit);

		// Creating a client for a real user succeeds.
		expect(() =>
			kit.insertInto(oauthClients).values({
				client_id: 'valid-client',
				client_name: 'Valid',
				client_secret_hash: null,
				redirect_uris: '[]',
				scopes: '[]',
				created_by_user_id: BigInt(user.id)
			} as any).executeSync()
		).not.toThrow();

		// Creating a client for a non-existent user is rejected.
		expect(() =>
			kit.insertInto(oauthClients).values({
				client_id: 'orphan-client',
				client_name: 'Orphan',
				client_secret_hash: null,
				redirect_uris: '[]',
				scopes: '[]',
				created_by_user_id: 999_999n
			} as any).executeSync()
		).toThrow();

		// Deleting the user cascades to the client.
		kit.deleteFrom(users).where(eq(users.id, BigInt(user.id))).executeSync();
		const remaining = kit
			.selectFrom(oauthClients)
			.where(eq(oauthClients.client_id, 'valid-client'))
			.executeSync();
		expect(remaining).toHaveLength(0);
	});
});
