import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import type { KitDatabase } from '@mongreldb/kit';

const ctx = vi.hoisted(() => ({ kit: null as unknown as KitDatabase }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { webauthnChallenges, passkeys } from './db/mongrelSchema';
import {
	isPasskeyAvailable,
	getRpConfig,
	listPasskeys,
	passkeyCount,
	purgeExpiredChallenges,
	renamePasskey,
	deletePasskey
} from './passkeys';
import { makeUser } from '../../../tests/helpers';

const ORIGINAL_ORIGIN = process.env.ORIGIN;

describe('passkeys', () => {
	let userId: number;

	beforeEach(() => {
		ctx.kit.deleteFrom(webauthnChallenges).executeSync();
		ctx.kit.deleteFrom(passkeys).executeSync();
		const u = makeUser(ctx.kit);
		userId = u.id;
		process.env.ORIGIN = 'https://roamarr.example.com';
	});

	test('isPasskeyAvailable reflects ORIGIN env', () => {
		expect(isPasskeyAvailable()).toBe(true);
		delete process.env.ORIGIN;
		expect(isPasskeyAvailable()).toBe(false);
		process.env.ORIGIN = 'https://roamarr.example.com';
	});

	test('getRpConfig derives rpID and origins from ORIGIN', () => {
		const rp = getRpConfig();
		expect(rp.rpID).toBe('roamarr.example.com');
		expect(rp.origins).toEqual(['https://roamarr.example.com']);
	});

	test('getRpConfig throws when ORIGIN is missing', () => {
		delete process.env.ORIGIN;
		expect(() => getRpConfig()).toThrow('ORIGIN');
	});

	test('purgeExpiredChallenges removes only expired rows', () => {
		const expired = new Date(Date.now() - 60000).toISOString();
		const future = new Date(Date.now() + 5 * 60 * 1000).toISOString();
		ctx.kit.insertInto(webauthnChallenges).values({
			challenge_hash: 'old-hash',
			user_id: BigInt(userId),
			purpose: 'register',
			expires_at: expired
		} as any).executeSync();
		ctx.kit.insertInto(webauthnChallenges).values({
			challenge_hash: 'new-hash',
			user_id: BigInt(userId),
			purpose: 'auth',
			expires_at: future
		} as any).executeSync();

		const removed = purgeExpiredChallenges();
		expect(removed).toBe(1);
		const remaining = ctx.kit.selectFrom(webauthnChallenges).executeSync();
		expect(remaining).toHaveLength(1);
		expect(remaining[0].challenge_hash as string).toBe('new-hash');
	});

	test('listPasskeys and passkeyCount return empty for new user', () => {
		expect(listPasskeys(userId)).toEqual([]);
		expect(passkeyCount(userId)).toBe(0);
	});

	test('renamePasskey and deletePasskey on nonexistent passkey', () => {
		expect(renamePasskey(userId, 99999, 'New Name')).toBe(false);
		expect(deletePasskey(userId, 99999)).toBe(false);
	});

	test('deletePasskey removes the credential', () => {
		ctx.kit.insertInto(passkeys).values({
			user_id: BigInt(userId),
			credential_id: 'test-cred-id',
			public_key: 'dGVzdA==',
			counter: 0n,
			transports: '[]',
			device_type: 'singleDevice',
			name: 'Test Key',
			created_at: new Date().toISOString(),
			last_used_at: null
		} as any).executeSync();

		expect(passkeyCount(userId)).toBe(1);
		expect(listPasskeys(userId)[0].name).toBe('Test Key');

		renamePasskey(userId, 1, 'Renamed');
		expect(listPasskeys(userId)[0].name).toBe('Renamed');

		expect(deletePasskey(userId, 1)).toBe(true);
		expect(passkeyCount(userId)).toBe(0);
	});

	afterEach(() => {
		process.env.ORIGIN = ORIGINAL_ORIGIN;
	});
});
