import { describe, test, expect, beforeEach, vi } from 'vitest';
import type { KitDatabase } from '@visorcraft/mongreldb-kit';

const ctx = vi.hoisted(() => ({ kit: null as unknown as KitDatabase }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { apiKeys } from '$lib/server/db/mongrelSchema';
import { makeUser } from '../../../../tests/helpers';
import { createApiKey, listApiKeys, verifyApiKey } from '$lib/server/apiKeys';
import { actions } from './+page.server';

let userId: number;

beforeEach(() => {
	ctx.kit.deleteFrom(apiKeys).executeSync();
	userId = makeUser(ctx.kit).id;
});

function buildEvent(uid: number | null, body: Record<string, string | string[]>) {
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(body)) {
		if (Array.isArray(value)) {
			for (const item of value) params.append(key, item);
		} else {
			params.set(key, value);
		}
	}
	const request = new Request('http://localhost/profile/api-keys', { method: 'POST', body: params });
	const cookies = { set: vi.fn() };
	const locals = uid == null ? {} : { user: { id: uid, role: 'user' } };
	return { event: { request, locals, cookies } as never, cookies };
}

describe('profile api-keys actions', () => {
	test('create returns the plaintext token once and stores an end-of-day UTC expiry', async () => {
		const { event } = buildEvent(userId, { name: 'CI script', scopes: ['trips:read'], expiresAt: '2030-01-02' });
		const result = (await actions.create(event)) as { createdToken: string; createdName: string; status?: number };

		expect(result.status).not.toBe(400);
		expect(result.createdToken).toMatch(/^rk_[0-9a-f]{64}$/);
		expect(result.createdName).toBe('CI script');

		const keys = listApiKeys(userId);
		expect(keys).toHaveLength(1);
		expect(keys[0].scopes).toEqual(['trips:read']);
		expect(keys[0].expiresAt).toBe('2030-01-02T23:59:59.000Z');
		expect(verifyApiKey(result.createdToken)).toEqual({
			keyId: keys[0].id,
			userId,
			scopes: ['trips:read']
		});
	});

	test('create without an expiry stores a non-expiring key', async () => {
		const { event } = buildEvent(userId, { name: 'CI script', scopes: ['trips:read'], expiresAt: '' });
		const result = (await actions.create(event)) as { createdToken: string; status?: number };

		expect(result.status).not.toBe(400);
		expect(result.createdToken).toMatch(/^rk_[0-9a-f]{64}$/);
		expect(listApiKeys(userId)[0].expiresAt).toBeNull();
	});

	test('create rejects invalid input with 400 and writes nothing', async () => {
		const cases: Array<[Record<string, string | string[]>, string | RegExp]> = [
			[{ scopes: ['trips:read'] }, 'Key name is required.'],
			[{ name: 'x'.repeat(81), scopes: ['trips:read'] }, 'Key name is too long.'],
			[{ name: 'ok' }, 'Select at least one scope.'],
			[{ name: 'ok', scopes: ['trips:read'], expiresAt: '2030-13-01' }, 'Invalid expiry date.'],
			[{ name: 'ok', scopes: ['trips:read'], expiresAt: '2030-02-30' }, 'Invalid expiry date.'],
			[{ name: 'ok', scopes: ['trips:read'], expiresAt: '01/02/2030' }, 'Invalid expiry date.'],
			[{ name: 'ok', scopes: ['admin:read'] }, /not allowed/],
			[{ name: 'ok', scopes: ['trips:read'], expiresAt: '2020-01-01' }, 'Expiry must be in the future']
		];

		for (const [body, error] of cases) {
			ctx.kit.deleteFrom(apiKeys).executeSync();
			const { event } = buildEvent(userId, body);
			const result = (await actions.create(event)) as {
				status: number;
				data: { error: string; createdToken?: string };
			};

			expect(result.status).toBe(400);
			if (error instanceof RegExp) expect(result.data.error).toMatch(error);
			else expect(result.data.error).toContain(error);
			expect(result.data.createdToken).toBeUndefined();
			expect(listApiKeys(userId)).toHaveLength(0);
		}
	});

	test('rename updates only an owned key and validates id and name', async () => {
		const { key } = createApiKey(userId, { name: 'original', scopes: ['trips:read'] });

		// Successful rename calls cookies.set and renames the owned key.
		const { event, cookies } = buildEvent(userId, { id: String(key.id), name: 'Renamed' });
		await actions.rename(event);
		expect(cookies.set).toHaveBeenCalled();
		expect(listApiKeys(userId)[0].name).toBe('Renamed');

		// Another user cannot rename the key; the name is left unchanged.
		const otherId = makeUser(ctx.kit).id;
		const { event: otherEvent } = buildEvent(otherId, { id: String(key.id), name: 'Nope' });
		const otherResult = (await actions.rename(otherEvent)) as { status: number; data: { error: string } };
		expect(otherResult.status).toBe(400);
		expect(otherResult.data.error).toBe('API key not found.');
		expect(listApiKeys(userId)[0].name).toBe('Renamed');

		// Invalid ids are rejected.
		for (const id of ['abc', '0', '1.5']) {
			const { event: e } = buildEvent(userId, { id, name: 'X' });
			const r = (await actions.rename(e)) as { status: number; data: { error: string } };
			expect(r.status).toBe(400);
			expect(r.data.error).toBe('Invalid API key.');
		}

		// A missing id is rejected.
		const { event: missingIdEvent } = buildEvent(userId, { name: 'X' });
		const missingIdResult = (await actions.rename(missingIdEvent)) as { status: number; data: { error: string } };
		expect(missingIdResult.status).toBe(400);
		expect(missingIdResult.data.error).toBe('Invalid API key.');

		// Blank and overlong names are rejected.
		for (const name of ['', 'x'.repeat(81)]) {
			const { event: e } = buildEvent(userId, { id: String(key.id), name });
			const r = (await actions.rename(e)) as { status: number; data: { error: string } };
			expect(r.status).toBe(400);
			expect(r.data.error).toBe('Invalid name.');
		}
	});

	test('revoke stops the key and only works for its owner', async () => {
		const { key, token } = createApiKey(userId, { name: 'revoke me', scopes: ['trips:read'] });

		const { event, cookies } = buildEvent(userId, { id: String(key.id) });
		await actions.revoke(event);
		expect(listApiKeys(userId).find((k) => k.id === key.id)?.revoked).toBe(true);
		expect(cookies.set).toHaveBeenCalled();
		expect(verifyApiKey(token)).toBeNull();

		// Another user cannot revoke the key; the key stays valid.
		const otherKey = createApiKey(userId, { name: 'second', scopes: ['trips:read'] });
		const otherId = makeUser(ctx.kit).id;
		const { event: otherEvent } = buildEvent(otherId, { id: String(otherKey.key.id) });
		const otherResult = (await actions.revoke(otherEvent)) as { status: number; data: { error: string } };
		expect(otherResult.status).toBe(400);
		expect(otherResult.data.error).toBe('API key not found or already revoked.');
		expect(verifyApiKey(otherKey.token)).not.toBeNull();

		// A second revoke of the already-revoked key is rejected.
		const { event: secondEvent } = buildEvent(userId, { id: String(key.id) });
		const secondResult = (await actions.revoke(secondEvent)) as { status: number; data: { error: string } };
		expect(secondResult.status).toBe(400);
		expect(secondResult.data.error).toBe('API key not found or already revoked.');

		// An unparseable id is rejected.
		const { event: abcEvent } = buildEvent(userId, { id: 'abc' });
		const abcResult = (await actions.revoke(abcEvent)) as { status: number; data: { error: string } };
		expect(abcResult.status).toBe(400);
		expect(abcResult.data.error).toBe('Invalid API key.');
	});

	test('actions require a signed-in user', async () => {
		const { event: createEvent } = buildEvent(null, { name: 'x', scopes: ['trips:read'] });
		await expect(actions.create(createEvent)).rejects.toMatchObject({ status: 401 });

		const { event: renameEvent } = buildEvent(null, { id: '1', name: 'x' });
		await expect(actions.rename(renameEvent)).rejects.toMatchObject({ status: 401 });

		const { event: revokeEvent } = buildEvent(null, { id: '1' });
		await expect(actions.revoke(revokeEvent)).rejects.toMatchObject({ status: 401 });
	});
});
