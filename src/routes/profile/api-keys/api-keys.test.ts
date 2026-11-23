import { test, expect, vi, beforeEach } from 'vitest';
import type { KitDatabase } from '@visorcraft/mongreldb-kit';

const ctx = vi.hoisted(() => ({ kit: null as unknown as KitDatabase }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { load, actions } from './+page.server';
import {
	API_KEY_PREFIX,
	getApiKeyScopes,
	listApiKeys,
	MAX_API_KEY_NAME_LENGTH
} from '$lib/server/apiKeys';
import { apiKeys, users } from '$lib/server/db/mongrelSchema';
import { makeUser } from '../../../../tests/helpers';

function kitDb(): KitDatabase {
	return ctx.kit;
}

function cookiesMock() {
	return { get: () => undefined, set: vi.fn(), delete: vi.fn(), getAll: () => [], serialize: () => '' };
}

function postBody(entries: Array<[string, string]>): URLSearchParams {
	const body = new URLSearchParams();
	for (const [key, value] of entries) body.append(key, value);
	return body;
}

function postRequest(body: URLSearchParams): Request {
	return new Request('http://localhost/profile/api-keys', { method: 'POST', body });
}

async function callCreate(body: URLSearchParams, user: unknown) {
	return (await actions.create({
		request: postRequest(body),
		locals: { user },
		cookies: cookiesMock()
	} as any)) as any;
}

async function callRename(body: URLSearchParams, user: unknown) {
	return (await actions.rename({
		request: postRequest(body),
		locals: { user },
		cookies: cookiesMock()
	} as any)) as any;
}

async function callRevoke(body: URLSearchParams, user: unknown) {
	return (await actions.revoke({
		request: postRequest(body),
		locals: { user },
		cookies: cookiesMock()
	} as any)) as any;
}

beforeEach(() => {
	const kit = kitDb();
	kit.deleteFrom(apiKeys).executeSync();
	kit.deleteFrom(users).executeSync();
});

test('load rejects when signed out', async () => {
	await expect(load({ locals: {} } as any)).rejects.toMatchObject({ status: 401 });
});

test('load returns only the caller keys and excludes admin scopes', async () => {
	const kit = kitDb();
	const u = makeUser(kit, { email: 'a@x.c' });
	const other = makeUser(kit, { email: 'b@x.c' });
	const [scope] = getApiKeyScopes();

	await callCreate(postBody([['name', 'A key'], ['scopes', scope]]), u);
	await callCreate(postBody([['name', 'B key'], ['scopes', scope]]), other);

	const data = (await load({ locals: { user: u } } as any)) as {
		keys: Array<{ name: string }>;
		grantableScopes: string[];
	};
	const names = data.keys.map((k) => k.name);
	expect(names).toContain('A key');
	expect(names).not.toContain('B key');
	expect(data.grantableScopes).not.toContain('admin:read');
	expect(data.grantableScopes).not.toContain('admin:write');
});

test('create persists a key with end-of-day expiry and stores only the hash', async () => {
	const kit = kitDb();
	const u = makeUser(kit, { email: 'c@x.c' });
	const scopes = getApiKeyScopes();
	const [s1, s2] = scopes;
	const day = '2099-12-31';
	const result = await callCreate(
		postBody([
			['name', 'CI key'],
			['scopes', s1],
			['scopes', s2],
			['expiresAt', day]
		]),
		u
	);
	expect(result.createdToken).toMatch(/^rk_[0-9a-f]{64}$/);
	expect(result.createdName).toBe('CI key');

	const rows = kit.selectFrom(apiKeys).executeSync();
	expect(rows).toHaveLength(1);
	expect(rows[0].scopes).toBe([s1, s2].join(','));
	expect(rows[0].expires_at).toBe(`${day}T23:59:59.000Z`);
	expect(rows[0].key_hash).not.toBe(result.createdToken);
});

test('create with a blank expiry stores a null expires_at', async () => {
	const kit = kitDb();
	const u = makeUser(kit, { email: 'c2@x.c' });
	const [scope] = getApiKeyScopes();
	const result = await callCreate(
		postBody([
			['name', 'No expiry'],
			['scopes', scope],
			['expiresAt', '']
		]),
		u
	);
	expect(result.createdToken).toMatch(/^rk_[0-9a-f]{64}$/);
	const rows = kit.selectFrom(apiKeys).executeSync();
	expect(rows).toHaveLength(1);
	expect(rows[0].expires_at).toBeNull();
});

test.each(['garbage', '2026-13-45', '2027-01-01T00:00:00Z', '2026-02-30'])(
	'create rejects malformed expiry %s without inserting a row',
	async (bad) => {
		const kit = kitDb();
		const u = makeUser(kit, { email: 'bad-exp@x.c' });
		const [scope] = getApiKeyScopes();
		const result = await callCreate(
			postBody([
				['name', 'Bad expiry'],
				['scopes', scope],
				['expiresAt', bad]
			]),
			u
		);
		expect(result).toMatchObject({ status: 400, data: { error: 'Invalid expiry date.' } });
		expect(listApiKeys(u.id)).toHaveLength(0);
	}
);

test('create validates the name and scopes without inserting a row', async () => {
	const kit = kitDb();
	const u = makeUser(kit, { email: 'validate@x.c' });
	const [scope] = getApiKeyScopes();

	let result = await callCreate(postBody([['scopes', scope]]), u);
	expect(result).toMatchObject({ status: 400, data: { error: 'Key name is required.' } });

	result = await callCreate(
		postBody([
			['name', 'x'.repeat(MAX_API_KEY_NAME_LENGTH + 1)],
			['scopes', scope]
		]),
		u
	);
	expect(result).toMatchObject({ status: 400, data: { error: 'Key name is too long.' } });

	result = await callCreate(postBody([['name', 'ok']]), u);
	expect(result).toMatchObject({ status: 400, data: { error: 'Select at least one scope.' } });

	expect(listApiKeys(u.id)).toHaveLength(0);
});

test('create rejects admin and unknown scopes via the service message', async () => {
	const kit = kitDb();
	const u = makeUser(kit, { email: 'scopes@x.c' });

	let result = await callCreate(
		postBody([
			['name', 'n'],
			['scopes', 'admin:read']
		]),
		u
	);
	expect(result).toMatchObject({
		status: 400,
		data: { error: 'Scope(s) not allowed for API keys: admin:read' }
	});

	result = await callCreate(
		postBody([
			['name', 'n'],
			['scopes', 'bogus:read']
		]),
		u
	);
	expect(result).toMatchObject({
		status: 400,
		data: { error: 'Scope(s) not allowed for API keys: bogus:read' }
	});

	expect(listApiKeys(u.id)).toHaveLength(0);
});

test('create rejects a past expiry', async () => {
	const kit = kitDb();
	const u = makeUser(kit, { email: 'past@x.c' });
	const [scope] = getApiKeyScopes();
	const result = await callCreate(
		postBody([
			['name', 'n'],
			['scopes', scope],
			['expiresAt', '2000-01-01']
		]),
		u
	);
	expect(result).toMatchObject({ status: 400, data: { error: 'Expiry must be in the future' } });
	expect(listApiKeys(u.id)).toHaveLength(0);
});

test('rename persists a new name for the owner', async () => {
	const kit = kitDb();
	const u = makeUser(kit, { email: 'rename@x.c' });
	const [scope] = getApiKeyScopes();
	await callCreate(
		postBody([
			['name', 'Old name'],
			['scopes', scope]
		]),
		u
	);
	const key = listApiKeys(u.id)[0];

	const result = await callRename(
		postBody([
			['id', String(key.id)],
			['name', 'New name']
		]),
		u
	);
	expect(result?.status).toBeUndefined();
	expect(listApiKeys(u.id)[0].name).toBe('New name');
});

test('rename rejects another user key without changing it', async () => {
	const kit = kitDb();
	const u = makeUser(kit, { email: 'owner@x.c' });
	const other = makeUser(kit, { email: 'other@x.c' });
	const [scope] = getApiKeyScopes();
	await callCreate(
		postBody([
			['name', 'Other key'],
			['scopes', scope]
		]),
		other
	);
	const key = listApiKeys(other.id)[0];

	const result = await callRename(
		postBody([
			['id', String(key.id)],
			['name', 'Hijacked']
		]),
		u
	);
	expect(result).toMatchObject({ status: 400, data: { error: 'API key not found.' } });
	expect(listApiKeys(other.id)[0].name).toBe('Other key');
});

test('rename rejects blank and over-long names', async () => {
	const kit = kitDb();
	const u = makeUser(kit, { email: 'names@x.c' });
	const [scope] = getApiKeyScopes();
	await callCreate(
		postBody([
			['name', 'Keep'],
			['scopes', scope]
		]),
		u
	);
	const key = listApiKeys(u.id)[0];

	let result = await callRename(
		postBody([
			['id', String(key.id)],
			['name', '   ']
		]),
		u
	);
	expect(result).toMatchObject({ status: 400, data: { error: 'Invalid name.' } });

	result = await callRename(
		postBody([
			['id', String(key.id)],
			['name', 'x'.repeat(MAX_API_KEY_NAME_LENGTH + 1)]
		]),
		u
	);
	expect(result).toMatchObject({ status: 400, data: { error: 'Invalid name.' } });
	expect(listApiKeys(u.id)[0].name).toBe('Keep');
});

test.each([undefined, '', 'abc', '0', '1.5', '2.5'])(
	'rename rejects invalid id %s without throwing',
	async (bad) => {
		const kit = kitDb();
		const u = makeUser(kit, { email: 'ids@x.c' });
		const [scope] = getApiKeyScopes();
		await callCreate(
			postBody([
				['name', 'Keep'],
				['scopes', scope]
			]),
			u
		);
		const key = listApiKeys(u.id)[0];

		const entries: Array<[string, string]> = [];
		if (bad !== undefined) entries.push(['id', bad]);
		entries.push(['name', 'Renamed']);
		const body = postBody(entries);

		const result = await callRename(body, u);
		expect(result).toMatchObject({ status: 400, data: { error: 'Invalid API key.' } });
		expect(listApiKeys(u.id)[0].name).toBe('Keep');
	}
);

test('revoke revokes the owner key and a second revoke fails', async () => {
	const kit = kitDb();
	const u = makeUser(kit, { email: 'revoke@x.c' });
	const [scope] = getApiKeyScopes();
	await callCreate(
		postBody([
			['name', 'Revokable'],
			['scopes', scope]
		]),
		u
	);
	const key = listApiKeys(u.id)[0];

	const result = await callRevoke(postBody([['id', String(key.id)]]), u);
	expect(result?.status).toBeUndefined();
	expect(listApiKeys(u.id)[0].revoked).toBe(true);

	const again = await callRevoke(postBody([['id', String(key.id)]]), u);
	expect(again).toMatchObject({ status: 400, data: { error: 'API key not found or already revoked.' } });
});

test('revoke rejects another user key without revoking it', async () => {
	const kit = kitDb();
	const u = makeUser(kit, { email: 'rev-owner@x.c' });
	const other = makeUser(kit, { email: 'rev-other@x.c' });
	const [scope] = getApiKeyScopes();
	await callCreate(
		postBody([
			['name', 'Other key'],
			['scopes', scope]
		]),
		other
	);
	const key = listApiKeys(other.id)[0];

	const result = await callRevoke(postBody([['id', String(key.id)]]), u);
	expect(result).toMatchObject({ status: 400, data: { error: 'API key not found or already revoked.' } });
	expect(listApiKeys(other.id)[0].revoked).toBe(false);
});

test.each([undefined, '', 'abc', '0', '1.5', '2.5'])(
	'revoke rejects invalid id %s without throwing',
	async (bad) => {
		const kit = kitDb();
		const u = makeUser(kit, { email: 'rev-ids@x.c' });
		const [scope] = getApiKeyScopes();
		await callCreate(
			postBody([
				['name', 'Keep'],
				['scopes', scope]
			]),
			u
		);
		const key = listApiKeys(u.id)[0];

		const entries: Array<[string, string]> = [];
		if (bad !== undefined) entries.push(['id', bad]);
		const body = postBody(entries);

		const result = await callRevoke(body, u);
		expect(result).toMatchObject({ status: 400, data: { error: 'Invalid API key.' } });
		expect(listApiKeys(u.id)[0].revoked).toBe(false);
	}
);

test('all actions reject when signed out', async () => {
	const cookies = cookiesMock();
	const requestFor = () =>
		postRequest(
			postBody([
				['name', 'n'],
				['scopes', 'trips:read'],
				['id', '1']
			])
		);

	await expect(load({ locals: {} } as any)).rejects.toMatchObject({ status: 401 });
	await expect(actions.create({ request: requestFor(), locals: {}, cookies } as any)).rejects.toMatchObject({
		status: 401
	});
	await expect(actions.rename({ request: requestFor(), locals: {}, cookies } as any)).rejects.toMatchObject({
		status: 401
	});
	await expect(actions.revoke({ request: requestFor(), locals: {}, cookies } as any)).rejects.toMatchObject({
		status: 401
	});
});

test('API_KEY_PREFIX and MAX_API_KEY_NAME_LENGTH are exported', () => {
	expect(API_KEY_PREFIX).toBe('rk_');
	expect(MAX_API_KEY_NAME_LENGTH).toBe(80);
});
