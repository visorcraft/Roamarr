import { describe, test, expect, beforeEach, vi } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import type { KitDatabase } from '@mongreldb/kit';

const ctx = vi.hoisted(() => ({ kit: null as unknown as KitDatabase }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { load, actions } from './authorize/+page.server';
import { POST as tokenPost } from './token/+server';
import { POST as revokePost } from './revoke/+server';
import {
	createClient,
	createAuthorizationCode,
	verifyAccessToken
} from '$lib/server/oauth';
import { oauthTokens, oauthClients } from '$lib/server/db/mongrelSchema';
import { makeUser } from '../../../tests/helpers';
import { resetRateLimit } from '$lib/server/rateLimit';

function pkcePair() {
	const verifier = randomBytes(32).toString('base64url');
	const challenge = createHash('sha256').update(verifier).digest('base64url');
	return { verifier, challenge };
}

function makeLocals(user: { id: number; email: string }) {
	return { user } as App.Locals;
}

describe('oauth routes', () => {
	let user: { id: number; email: string };

	beforeEach(() => {
		resetRateLimit();
		ctx.kit.deleteFrom(oauthTokens).executeSync();
		ctx.kit.deleteFrom(oauthClients).executeSync();
		user = makeUser(ctx.kit);
	});

	describe('authorize', () => {
		function makeClient() {
			return createClient(user.id, {
				clientName: 'Test',
				redirectUris: ['https://app.example/cb'],
				scopes: ['trips:read', 'places:read']
			});
		}

		test('load renders consent screen for a valid request', async () => {
			const { client } = makeClient();
			const { challenge } = pkcePair();
			const url = new URL('http://localhost/oauth/authorize');
			url.searchParams.set('response_type', 'code');
			url.searchParams.set('client_id', client.clientId);
			url.searchParams.set('redirect_uri', client.redirectUris[0]);
			url.searchParams.set('scope', 'trips:read places:read');
			url.searchParams.set('code_challenge', challenge);
			url.searchParams.set('code_challenge_method', 'S256');
			url.searchParams.set('state', 'xyz');

			const result = (await load({
				locals: makeLocals(user),
				url,
				getClientAddress: () => '127.0.0.1'
			} as any)) as {
				client: { clientId: string };
				scopes: string[];
				state: string;
			};
			expect(result.client.clientId).toBe(client.clientId);
			expect(result.scopes).toEqual(['trips:read', 'places:read']);
			expect(result.state).toBe('xyz');
		});

		test('approve action issues a code and redirects', async () => {
			const { client } = makeClient();
			const { challenge } = pkcePair();
			const form = new FormData();
			form.set('client_id', client.clientId);
			form.set('redirect_uri', client.redirectUris[0]);
			form.set('code_challenge', challenge);
			form.set('state', 'xyz');
			form.set('scopes', 'trips:read');

			const event: any = {
				locals: makeLocals(user),
				request: { formData: async () => form },
				getClientAddress: () => '127.0.0.1'
			};

			await expect(actions.approve(event)).rejects.toSatisfy((e: any) => {
				expect(e.status).toBe(302);
				expect(e.location).toMatch(/^https:\/\/app\.example\/cb\?code=/);
				expect(e.location).toContain('state=xyz');
				return true;
			});
		});

		test('deny action redirects with access_denied', async () => {
			const { client } = makeClient();
			const form = new FormData();
			form.set('client_id', client.clientId);
			form.set('redirect_uri', client.redirectUris[0]);
			form.set('state', 'xyz');

			const event: any = {
				locals: makeLocals(user),
				request: { formData: async () => form },
				getClientAddress: () => '127.0.0.1'
			};

			await expect(actions.deny(event)).rejects.toSatisfy((e: any) => {
				expect(e.status).toBe(302);
				expect(e.location).toBe('https://app.example/cb?error=access_denied&state=xyz');
				return true;
			});
		});

		test('load is rate limited after repeated requests', async () => {
			const { client } = makeClient();
			const { challenge } = pkcePair();
			const ip = '9.9.9.9';

			for (let i = 0; i < 12; i++) {
				const url = new URL('http://localhost/oauth/authorize');
				url.searchParams.set('response_type', 'code');
				url.searchParams.set('client_id', client.clientId);
				url.searchParams.set('redirect_uri', client.redirectUris[0]);
				url.searchParams.set('scope', 'trips:read');
				url.searchParams.set('code_challenge', challenge);
				url.searchParams.set('code_challenge_method', 'S256');
				try {
					await load({ locals: makeLocals(user), url, getClientAddress: () => ip } as any);
				} catch {
					/* expected once limit kicks in */
				}
			}

			try {
				await load({ locals: makeLocals(user), url: new URL('http://localhost/oauth/authorize'), getClientAddress: () => ip } as any);
				expect.fail('expected load to be rate limited');
			} catch (e: any) {
				expect(e.status).toBe(429);
			}
		});

		test('deny action is rate limited after repeated requests', async () => {
			const { client } = makeClient();
			const ip = '9.9.9.8';

			for (let i = 0; i < 12; i++) {
				const form = new FormData();
				form.set('client_id', client.clientId);
				form.set('redirect_uri', client.redirectUris[0]);
				form.set('state', 'xyz');
				try {
					await actions.deny({
						locals: makeLocals(user),
						request: { formData: async () => form },
						getClientAddress: () => ip
					} as any);
				} catch {
					/* expected once limit kicks in */
				}
			}

			const form = new FormData();
			form.set('client_id', client.clientId);
			form.set('redirect_uri', client.redirectUris[0]);
			form.set('state', 'xyz');
			const result = await actions.deny({
				locals: makeLocals(user),
				request: { formData: async () => form },
				getClientAddress: () => ip
			} as any);
			expect(result?.status).toBe(429);
		});
	});

	describe('token', () => {
		function issueCode(scopes: string[] = ['trips:read']) {
			const { client, plaintextSecret } = createClient(user.id, {
				clientName: 'Token Test',
				redirectUris: ['https://app.example/cb'],
				scopes: scopes as any
			});
			const { verifier, challenge } = pkcePair();
			const { code } = createAuthorizationCode({
				userId: user.id,
				clientId: client.clientId,
				scopes: scopes as any,
				codeChallenge: challenge,
				redirectUri: client.redirectUris[0]
			});
			return { client, plaintextSecret, verifier, code };
		}

		test('authorization_code exchange issues tokens', async () => {
			const { client, plaintextSecret, verifier, code } = issueCode();
			const form = new URLSearchParams();
			form.set('grant_type', 'authorization_code');
			form.set('code', code);
			form.set('client_id', client.clientId);
			form.set('client_secret', plaintextSecret!);
			form.set('code_verifier', verifier);

			const res = await tokenPost({
				request: new Request('http://localhost/oauth/token', {
					method: 'POST',
					body: form,
					headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
				}),
				getClientAddress: () => '127.0.0.1'
			} as any);

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.accessToken).toBeDefined();
			expect(body.refreshToken).toBeDefined();
			expect(verifyAccessToken(body.accessToken)?.userId).toBe(user.id);
		});

		test('refresh_token rotates the token', async () => {
			const { client, plaintextSecret, verifier, code } = issueCode();
			const first = await tokenPost({
				request: new Request('http://localhost/oauth/token', {
					method: 'POST',
					body: new URLSearchParams({
						grant_type: 'authorization_code',
						code,
						client_id: client.clientId,
						client_secret: plaintextSecret!,
						code_verifier: verifier
					})
				}),
				getClientAddress: () => '127.0.0.1'
			} as any);
			const { refreshToken } = await first.json();

			const second = await tokenPost({
				request: new Request('http://localhost/oauth/token', {
					method: 'POST',
					body: new URLSearchParams({
						grant_type: 'refresh_token',
						refresh_token: refreshToken,
						client_id: client.clientId,
						client_secret: plaintextSecret!
					})
				}),
				getClientAddress: () => '127.0.0.1'
			} as any);

			expect(second.status).toBe(200);
			const body = await second.json();
			expect(verifyAccessToken(body.accessToken)?.userId).toBe(user.id);
		});

		test('rate limiting blocks repeated requests', async () => {
			const ip = '9.9.9.9';
			for (let i = 0; i < 12; i++) {
				try {
					await tokenPost({
						request: new Request('http://localhost/oauth/token', { method: 'POST', body: new URLSearchParams() }),
						getClientAddress: () => ip
					} as any);
				} catch {
					/* earlier failures are expected for malformed requests */
				}
			}
			await expect(
				tokenPost({
					request: new Request('http://localhost/oauth/token', { method: 'POST', body: new URLSearchParams() }),
					getClientAddress: () => ip
				} as any)
			).rejects.toMatchObject({ status: 429 });
		});
	});

	describe('revoke', () => {
		test('authenticated session can revoke an owned token', async () => {
			const { client, plaintextSecret, verifier, code } = (() => {
				const { client: c, plaintextSecret: s } = createClient(user.id, {
					clientName: 'Revoke Test',
					redirectUris: ['https://app.example/cb'],
					scopes: ['trips:read']
				});
				const ver = randomBytes(32).toString('base64url');
				const chal = createHash('sha256').update(ver).digest('base64url');
				const { code: cd } = createAuthorizationCode({
					userId: user.id,
					clientId: c.clientId,
					scopes: ['trips:read'],
					codeChallenge: chal,
					redirectUri: c.redirectUris[0]
				});
				return { client: c, plaintextSecret: s, verifier: ver, code: cd };
			})();

			const tokenRes = await tokenPost({
				request: new Request('http://localhost/oauth/token', {
					method: 'POST',
					body: new URLSearchParams({
						grant_type: 'authorization_code',
						code,
						client_id: client.clientId,
						client_secret: plaintextSecret!,
						code_verifier: verifier
					})
				}),
				getClientAddress: () => '127.0.0.1'
			} as any);
			const { accessToken } = await tokenRes.json();
			expect(verifyAccessToken(accessToken)).not.toBeNull();

			const form = new FormData();
			form.set('token', accessToken);
			const res = await revokePost({
				request: new Request('http://localhost/oauth/revoke', { method: 'POST', body: form }),
				locals: makeLocals(user),
				getClientAddress: () => '127.0.0.1'
			} as any);

			expect(res.status).toBe(200);
			expect(verifyAccessToken(accessToken)).toBeNull();
		});

		test('bearer-authenticated revoke only revokes own token', async () => {
			const other = makeUser(ctx.kit);
			const { client, plaintextSecret, verifier, code } = (() => {
				const { client: c, plaintextSecret: s } = createClient(user.id, {
					clientName: 'Revoke Bearer Test',
					redirectUris: ['https://app.example/cb'],
					scopes: ['trips:read']
				});
				const ver = randomBytes(32).toString('base64url');
				const chal = createHash('sha256').update(ver).digest('base64url');
				const { code: cd } = createAuthorizationCode({
					userId: user.id,
					clientId: c.clientId,
					scopes: ['trips:read'],
					codeChallenge: chal,
					redirectUri: c.redirectUris[0]
				});
				return { client: c, plaintextSecret: s, verifier: ver, code: cd };
			})();

			const tokenRes = await tokenPost({
				request: new Request('http://localhost/oauth/token', {
					method: 'POST',
					body: new URLSearchParams({
						grant_type: 'authorization_code',
						code,
						client_id: client.clientId,
						client_secret: plaintextSecret!,
						code_verifier: verifier
					})
				}),
				getClientAddress: () => '127.0.0.1'
			} as any);
			const { accessToken } = await tokenRes.json();

			const form = new FormData();
			form.set('token', accessToken);
			const res = await revokePost({
				request: new Request('http://localhost/oauth/revoke', { method: 'POST', body: form }),
				locals: makeLocals(other),
				getClientAddress: () => '127.0.0.1'
			} as any);

			expect(res.status).toBe(400);
			expect(verifyAccessToken(accessToken)).not.toBeNull();
		});

		test('unauthenticated revoke returns 401', async () => {
			const res = await revokePost({
				request: new Request('http://localhost/oauth/revoke', {
					method: 'POST',
					body: new FormData()
				}),
				locals: {},
				getClientAddress: () => '127.0.0.1'
			} as any);
			expect(res.status).toBe(401);
		});
	});
});
