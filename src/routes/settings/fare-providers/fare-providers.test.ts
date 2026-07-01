import { test, expect, vi, beforeEach, afterAll } from 'vitest';

const ctx = vi.hoisted(() => ({
	kit: null as unknown as import('@visorcraft/mongreldb-kit').KitDatabase,
	close: null as unknown as () => void
}));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	const { kit, close } = freshDb();
	Object.assign(ctx, { kit, close });
	return { kit, getDb: () => kit };
});

beforeEach(() => {
	ctx.kit.deleteFrom(fareProviders).executeSync();
	ctx.kit.deleteFrom(users).executeSync();
});

afterAll(() => {
	ctx.close();
});

import { load, actions } from './+page.server';
import { makeKitUser } from '../../../../tests/kitHelpers';
import {
	createFareProvider,
	listFareProvidersForUser,
	type FareProviderAccount
} from '$lib/server/repositories/travelDataRepo';
import { fareProviders, users } from '$lib/server/db/mongrelSchema';
import { decrypt } from '$lib/server/crypto';
import { eq as kitEq } from '@visorcraft/mongreldb-kit';

function event(user: { id: number }, body?: FormData) {
	return {
		locals: { user } as App.Locals,
		request: body ? ({ formData: async () => body } as Request) : undefined
	} as any;
}

test('load lists saved accounts without leaking ciphertext', () => {
	const u = makeKitUser({ email: 'fp@x.c' });
	createFareProvider({
		userId: Number(u.id),
		providerKey: 'stub',
		label: 'Work',
		apiKey: 'encrypted-blob',
		enabled: true
	});

	const result = load(event({ id: Number(u.id) })) as any;
	expect(result.saved.length).toBe(1);
	expect(result.saved[0].label).toBe('Work');
	expect(result.saved[0].hasKey).toBe(true);
	expect(result.saved[0].apiKey).toBeUndefined();
});

test('add action creates a new provider account', async () => {
	const u = makeKitUser({ email: 'fp-add@x.c' });

	const body = new FormData();
	body.set('providerKey', 'stub');
	body.set('label', 'Personal');
	body.set('apiKey', 'SECRET');
	body.set('enabled', 'on');
	await expect(actions.add(event({ id: Number(u.id) }, body))).rejects.toEqual(
		expect.objectContaining({ status: 303 })
	);

	const rows = listFareProvidersForUser(Number(u.id));
	expect(rows).toHaveLength(1);
	expect(rows[0].label).toBe('Personal');
	expect(rows[0].apiKey).toBe('SECRET');
});

test('update action edits an owned account', async () => {
	const u = makeKitUser({ email: 'fp-up@x.c' });
	const other = makeKitUser({ email: 'fp-other@x.c' });
	const p = createFareProvider({
		userId: Number(u.id),
		providerKey: 'stub',
		label: 'Old',
		apiKey: 'enc',
		enabled: true
	});

	const body = new FormData();
	body.set('id', String(p.id));
	body.set('label', 'New');
	body.set('apiKey', 'NEW-SECRET');
	body.set('enabled', 'on');
	await expect(actions.update(event({ id: Number(u.id) }, body))).rejects.toEqual(
		expect.objectContaining({ status: 303 })
	);

	const row = ctx.kit
		.selectFrom(fareProviders)
		.where(kitEq(fareProviders.id, BigInt(p.id)))
		.executeSync()[0];
	expect(row!.label).toBe('New');
	expect(decrypt(row!.api_key!)).toBe('NEW-SECRET');

	const hijack = new FormData();
	hijack.set('id', String(p.id));
	hijack.set('label', 'Hijacked');
	hijack.set('apiKey', 'X');
	await expect(actions.update(event({ id: Number(other.id) }, hijack))).rejects.toThrow();
});

test('delete action removes an owned account', async () => {
	const u = makeKitUser({ email: 'fp-del@x.c' });
	const other = makeKitUser({ email: 'fp-del-other@x.c' });
	const p = createFareProvider({
		userId: Number(u.id),
		providerKey: 'stub',
		label: 'X',
		apiKey: null,
		enabled: true
	});

	const hijack = new FormData();
	hijack.set('id', String(p.id));
	await expect(actions.delete(event({ id: Number(other.id) }, hijack))).rejects.toThrow();

	const body = new FormData();
	body.set('id', String(p.id));
	await expect(actions.delete(event({ id: Number(u.id) }, body))).rejects.toEqual(
		expect.objectContaining({ status: 303 })
	);
	expect(listFareProvidersForUser(Number(u.id))).toHaveLength(0);
});

test('test action returns the stub result without redirecting', async () => {
	const u = makeKitUser({ email: 'fp-test@x.c' });
	const p = createFareProvider({
		userId: Number(u.id),
		providerKey: 'stub',
		label: 'Test',
		apiKey: null,
		enabled: true
	});

	const body = new FormData();
	body.set('id', String(p.id));
	const result = (await actions.test(event({ id: Number(u.id) }, body))) as {
		testResult: string;
	};
	expect(result.testResult).toContain('OK');
	expect(result.testResult).toContain('stub provider');
});
