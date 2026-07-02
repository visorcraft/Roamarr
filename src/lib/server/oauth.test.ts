import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import type { KitDatabase } from '@visorcraft/mongreldb-kit';

const ctx = vi.hoisted(() => ({ kit: null as unknown as KitDatabase }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { oauthClients, oauthTokens } from './db/mongrelSchema';
import {
	createClient,
	getClient,
	deleteClient,
	createAuthorizationCode,
	exchangeAuthorizationCode,
	refreshAccessToken,
	verifyAccessToken,
	revokeTokensForUser,
	isClientAllowed,
	assertClientAllowed
} from './oauth';
import { updateSettings, getSettings } from './settings';
import * as usersRepo from './repositories/usersRepo';
import { makeUser } from '../../../tests/helpers';

function pkcePair() {
	const verifier = randomBytes(32).toString('base64url');
	const challenge = createHash('sha256').update(verifier).digest('base64url');
	return { verifier, challenge };
}

describe('oauth', () => {
	let userId: number;

	beforeEach(() => {
		ctx.kit.deleteFrom(oauthTokens).executeSync();
		ctx.kit.deleteFrom(oauthClients).executeSync();
		userId = makeUser(ctx.kit).id;
	});

	function newClient() {
		return createClient(userId, {
			clientName: 'Test',
			redirectUris: ['https://app.example/cb'],
			scopes: ['trips:read', 'trips:write']
		});
	}

	// Drive a full authorize → token exchange and return the issued tokens.
	function issueTokens(scopes: ('trips:read' | 'trips:write')[] = ['trips:read']) {
		const { client, plaintextSecret } = newClient();
		const { verifier, challenge } = pkcePair();
		const { code } = createAuthorizationCode({
			userId,
			clientId: client.clientId,
			scopes,
			codeChallenge: challenge,
			redirectUri: client.redirectUris[0]
		});
		const result = exchangeAuthorizationCode({
			code,
			clientId: client.clientId,
			clientSecret: plaintextSecret,
			codeVerifier: verifier
		});
		return { client, plaintextSecret, verifier, challenge, code, result };
	}

	test('authorization-code + PKCE flow issues a usable access token', () => {
		const { result } = issueTokens(['trips:read']);
		expect('error' in result).toBe(false);
		if ('error' in result) return;

		const auth = verifyAccessToken(result.accessToken);
		expect(auth?.userId).toBe(userId);
		expect(auth?.scopes).toEqual(['trips:read']);
	});

	test('wrong PKCE verifier is rejected and the code is single-use', () => {
		const { client, plaintextSecret } = newClient();
		const { challenge } = pkcePair();
		const { code } = createAuthorizationCode({
			userId,
			clientId: client.clientId,
			scopes: ['trips:read'],
			codeChallenge: challenge,
			redirectUri: client.redirectUris[0]
		});

		const bad = exchangeAuthorizationCode({
			code,
			clientId: client.clientId,
			clientSecret: plaintextSecret,
			codeVerifier: 'not-the-verifier'
		});
		expect('error' in bad).toBe(true);

		// a code that already failed cannot be reused
		const replay = exchangeAuthorizationCode({
			code,
			clientId: client.clientId,
			clientSecret: plaintextSecret,
			codeVerifier: 'whatever'
		});
		expect('error' in replay).toBe(true);
	});

	test('confidential client requires its secret', () => {
		const { client } = newClient();
		const { verifier, challenge } = pkcePair();
		const { code } = createAuthorizationCode({
			userId,
			clientId: client.clientId,
			scopes: ['trips:read'],
			codeChallenge: challenge,
			redirectUri: client.redirectUris[0]
		});
		const noSecret = exchangeAuthorizationCode({
			code,
			clientId: client.clientId,
			clientSecret: null,
			codeVerifier: verifier
		});
		expect('error' in noSecret).toBe(true);
	});

	test('a mismatched redirect_uri is rejected at the token endpoint', () => {
		const { client, plaintextSecret } = newClient();
		const { verifier, challenge } = pkcePair();
		const { code } = createAuthorizationCode({
			userId,
			clientId: client.clientId,
			scopes: ['trips:read'],
			codeChallenge: challenge,
			redirectUri: client.redirectUris[0]
		});
		const res = exchangeAuthorizationCode({
			code,
			clientId: client.clientId,
			clientSecret: plaintextSecret,
			codeVerifier: verifier,
			redirectUri: 'https://evil.example/cb'
		});
		expect('error' in res).toBe(true);
	});

	test('a public (PKCE-only) client needs no secret', () => {
		const { client, plaintextSecret } = createClient(userId, {
			clientName: 'Public',
			redirectUris: ['https://app.example/cb'],
			scopes: ['trips:read'],
			isPublic: true
		});
		expect(plaintextSecret).toBeNull();
		expect(client.isConfidential).toBe(false);

		const { verifier, challenge } = pkcePair();
		const { code } = createAuthorizationCode({
			userId,
			clientId: client.clientId,
			scopes: ['trips:read'],
			codeChallenge: challenge,
			redirectUri: client.redirectUris[0]
		});
		const res = exchangeAuthorizationCode({ code, clientId: client.clientId, clientSecret: null, codeVerifier: verifier });
		expect('error' in res).toBe(false);
	});

	test('refresh_token rotates and revokes the old token', () => {
		const { client, plaintextSecret, result } = issueTokens();
		if ('error' in result) throw new Error('exchange failed');

		const refreshed = refreshAccessToken({ refreshToken: result.refreshToken, clientId: client.clientId, clientSecret: plaintextSecret });
		expect('error' in refreshed).toBe(false);
		if ('error' in refreshed) return;

		// old refresh token is revoked
		const reuse = refreshAccessToken({ refreshToken: result.refreshToken, clientId: client.clientId, clientSecret: plaintextSecret });
		expect('error' in reuse).toBe(true);
		// new access token works
		expect(verifyAccessToken(refreshed.accessToken)?.userId).toBe(userId);
		expect(plaintextSecret).toBeTruthy();
	});

	test('verifyAccessToken rejects tokens of a disabled user', () => {
		const { result } = issueTokens();
		if ('error' in result) throw new Error('exchange failed');
		expect(verifyAccessToken(result.accessToken)).not.toBeNull();

		usersRepo.updateUser(userId, { disabled: true });
		expect(verifyAccessToken(result.accessToken)).toBeNull();
	});

	test('deleteClient cannot delete another user’s client (IDOR)', () => {
		const { client } = newClient();
		const otherUser = makeUser(ctx.kit).id;

		expect(deleteClient(otherUser, client.clientId)).toBe(false);
		expect(getClient(client.clientId)).not.toBeNull();

		// the owner can delete it
		expect(deleteClient(userId, client.clientId)).toBe(true);
		expect(getClient(client.clientId)).toBeNull();
	});

	test('revokeTokensForUser invalidates all of a user’s tokens', () => {
		const { result } = issueTokens();
		if ('error' in result) throw new Error('exchange failed');

		expect(revokeTokensForUser(userId)).toBeGreaterThan(0);
		expect(verifyAccessToken(result.accessToken)).toBeNull();
	});

	describe('client allow-list', () => {
		afterEach(() => {
			updateSettings({ oauthClientAllowList: null });
		});

		test('client creation succeeds when no allow-list is configured', () => {
			expect(getSettings().oauthClientAllowList).toBeNull();
			const { client } = createClient(userId, {
				clientName: 'Unrestricted',
				redirectUris: ['https://app.example/cb'],
				scopes: ['trips:read']
			});
			expect(client.clientId).toBeTruthy();
			expect(isClientAllowed(client.clientId)).toBe(true);
		});

		test('client creation with a pre-approved ID succeeds when allow-list is set', () => {
			const approvedId = 'pre-approved-client-id';
			updateSettings({ oauthClientAllowList: [approvedId] });
			const { client } = createClient(userId, {
				clientId: approvedId,
				clientName: 'Approved',
				redirectUris: ['https://app.example/cb'],
				scopes: ['trips:read']
			});
			expect(client.clientId).toBe(approvedId);
			expect(isClientAllowed(approvedId)).toBe(true);
		});

		test('client creation fails when generated ID is not on the allow-list', () => {
			updateSettings({ oauthClientAllowList: ['only-this-one'] });
			expect(() =>
				createClient(userId, {
					clientName: 'Not Approved',
					redirectUris: ['https://app.example/cb'],
					scopes: ['trips:read']
				})
			).toThrow('Client ID is not on the admin allow-list');
		});

		test('assertClientAllowed throws for unlisted clients when allow-list is non-empty', () => {
			updateSettings({ oauthClientAllowList: ['listed'] });
			expect(() => assertClientAllowed('not-listed')).toThrow('Client ID is not on the admin allow-list');
			expect(() => assertClientAllowed('listed')).not.toThrow();
		});
	});
});
