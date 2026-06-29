import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import type { KitDatabase } from '@mongreldb/kit';

const ctx = vi.hoisted(() => ({ kit: null as unknown as KitDatabase }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

const swa = vi.hoisted(() => ({
	generateRegistrationOptions: vi.fn(),
	verifyRegistrationResponse: vi.fn(),
	generateAuthenticationOptions: vi.fn(),
	verifyAuthenticationResponse: vi.fn()
}));
vi.mock('@simplewebauthn/server', () => swa);

import { webauthnChallenges, passkeys, users, auditLogs } from './db/mongrelSchema';
import {
	isPasskeyAvailable,
	getRpConfig,
	listPasskeys,
	passkeyCount,
	purgeExpiredChallenges,
	renamePasskey,
	deletePasskey,
	createRegistrationOptions,
	verifyRegistration,
	createAuthOptions,
	verifyAuth,
	MAX_PASSKEY_NAME_LENGTH
} from './passkeys';
import { makeUser } from '../../../tests/helpers';
import { eq as kitEq, asc as kitAsc } from '@mongreldb/kit';
import { createHash } from 'node:crypto';

function hashChallenge(challenge: string): string {
	return createHash('sha256').update(challenge).digest('hex');
}

const ORIGINAL_ORIGIN = process.env.ORIGIN;

function makeRegOptions(challenge = 'reg-challenge') {
	return {
		challenge,
		rp: { name: 'Roamarr', id: 'roamarr.example.com' },
		user: { id: 'user-id', name: 'user@example.com', displayName: 'User' },
		pubKeyCredParams: [],
		timeout: 60000,
		attestation: 'none' as const,
		excludeCredentials: [],
		authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
		extensions: {}
	};
}

function makeAuthOptions(challenge = 'auth-challenge') {
	return {
		challenge,
		rpId: 'roamarr.example.com',
		allowCredentials: [],
		timeout: 60000,
		userVerification: 'preferred',
		extensions: {}
	};
}

function makeRegResponse(challenge = 'reg-challenge') {
	return {
		id: 'test-credential-id',
		rawId: 'test-credential-id',
		response: {
			clientDataJSON: JSON.stringify({ challenge, type: 'webauthn.create', origin: 'https://roamarr.example.com' }),
			attestationObject: 'test-attestation'
		},
		type: 'public-key' as const,
		clientExtensionResults: {}
	};
}

function makeRegVerificationInfo() {
	return {
		verified: true,
		registrationInfo: {
			fmt: 'none' as const,
			counter: 0,
			credential: {
				id: 'test-credential-id',
				publicKey: new Uint8Array([1, 2, 3]),
				counter: 0,
				transports: ['internal' as const]
			},
			credentialDeviceType: 'singleDevice' as const,
			credentialBackedUp: false,
			aaguid: '00000000-0000-0000-0000-000000000000',
			attestationObject: new Uint8Array(),
			attestationInfo: { fmt: 'none' as const, verified: true }
		}
	};
}

function makeAuthResponse(credentialId = 'test-credential-id') {
	return {
		id: credentialId,
		rawId: credentialId,
		response: {
			authenticatorData: 'auth-data',
			clientDataJSON: JSON.stringify({ challenge: 'auth-challenge', type: 'webauthn.get', origin: 'https://roamarr.example.com' }),
			signature: 'sig',
			userHandle: null
		},
		type: 'public-key' as const,
		clientExtensionResults: {}
	};
}

function makeAuthVerificationInfo(newCounter: number) {
	return {
		verified: true,
		authenticationInfo: {
			credentialID: 'test-credential-id',
			newCounter,
			userVerified: true
		}
	};
}

describe('passkeys', () => {
	let userId: number;

	beforeEach(() => {
		ctx.kit.deleteFrom(webauthnChallenges).executeSync();
		ctx.kit.deleteFrom(passkeys).executeSync();
		ctx.kit.deleteFrom(users).executeSync();
		const u = makeUser(ctx.kit);
		userId = u.id;
		process.env.ORIGIN = 'https://roamarr.example.com';
		vi.resetAllMocks();
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

	test('rename/delete cannot touch another user’s passkey (IDOR)', () => {
		const inserted = ctx.kit.insertInto(passkeys).values({
			user_id: BigInt(userId),
			credential_id: 'owned-cred',
			public_key: 'dGVzdA==',
			counter: 0n,
			transports: '[]',
			device_type: 'singleDevice',
			name: 'Owned',
			created_at: new Date().toISOString(),
			last_used_at: null
		} as any).executeSync();
		const pkId = Number(inserted.id);
		const attacker = makeUser(ctx.kit).id;

		expect(deletePasskey(attacker, pkId)).toBe(false);
		expect(renamePasskey(attacker, pkId, 'Hacked')).toBe(false);
		expect(passkeyCount(userId)).toBe(1);
		expect(listPasskeys(userId)[0].name).toBe('Owned');

		// the real owner still can
		expect(deletePasskey(userId, pkId)).toBe(true);
		expect(passkeyCount(userId)).toBe(0);
	});

	test('createRegistrationOptions requires discoverable credentials', async () => {
		swa.generateRegistrationOptions.mockResolvedValue(makeRegOptions());
		const options = await createRegistrationOptions(userId, 'user@example.com');
		expect(swa.generateRegistrationOptions).toHaveBeenCalledWith(
			expect.objectContaining({
				authenticatorSelection: expect.objectContaining({ residentKey: 'required' })
			})
		);
		expect(options.challenge).toBe('reg-challenge');
		const stored = ctx.kit.selectFrom(webauthnChallenges).executeSync();
		expect(stored).toHaveLength(1);
		expect(stored[0].purpose as string).toBe('register');
		expect(Number(stored[0].user_id)).toBe(userId);
	});

	test('verifyRegistration stores passkey and consumes challenge', async () => {
		ctx.kit.insertInto(webauthnChallenges).values({
			challenge_hash: hashChallenge('reg-challenge'),
			user_id: BigInt(userId),
			purpose: 'register',
			expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString()
		} as any).executeSync();
		swa.verifyRegistrationResponse.mockImplementation(async (opts: any) => {
			await opts.expectedChallenge('reg-challenge');
			return makeRegVerificationInfo();
		});

		const result = await verifyRegistration(userId, makeRegResponse(), 'YubiKey');
		expect(result.ok).toBe(true);

		const rows = ctx.kit.selectFrom(passkeys).executeSync();
		expect(rows).toHaveLength(1);
		expect(rows[0].credential_id as string).toBe('test-credential-id');
		expect(rows[0].name as string).toBe('YubiKey');
		expect(ctx.kit.selectFrom(webauthnChallenges).executeSync()).toHaveLength(0);
	});

	test('verifyRegistration rejects invalid challenge', async () => {
		swa.verifyRegistrationResponse.mockRejectedValue(new Error('Invalid challenge'));
		const result = await verifyRegistration(userId, makeRegResponse(), 'YubiKey');
		expect(result.ok).toBe(false);
		expect(ctx.kit.selectFrom(passkeys).executeSync()).toHaveLength(0);
	});

	test('verifyRegistration caps and trims name', async () => {
		ctx.kit.insertInto(webauthnChallenges).values({
			challenge_hash: hashChallenge('reg-challenge'),
			user_id: BigInt(userId),
			purpose: 'register',
			expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString()
		} as any).executeSync();
		swa.verifyRegistrationResponse.mockImplementation(async (opts: any) => {
			await opts.expectedChallenge('reg-challenge');
			return makeRegVerificationInfo();
		});

		const longName = 'a'.repeat(MAX_PASSKEY_NAME_LENGTH + 50);
		await verifyRegistration(userId, makeRegResponse(), `  ${longName}  `);
		const row = ctx.kit.selectFrom(passkeys).executeSync()[0];
		expect((row.name as string).length).toBe(MAX_PASSKEY_NAME_LENGTH);
	});

	test('renamePasskey rejects empty name and caps length', () => {
		const inserted = ctx.kit.insertInto(passkeys).values({
			user_id: BigInt(userId),
			credential_id: 'owned-cred',
			public_key: 'dGVzdA==',
			counter: 0n,
			transports: '[]',
			device_type: 'singleDevice',
			name: 'Owned',
			created_at: new Date().toISOString(),
			last_used_at: null
		} as any).executeSync();
		const pkId = Number(inserted.id);

		expect(renamePasskey(userId, pkId, '   ')).toBe(false);
		expect(listPasskeys(userId)[0].name).toBe('Owned');

		const longName = 'b'.repeat(MAX_PASSKEY_NAME_LENGTH + 10);
		expect(renamePasskey(userId, pkId, longName)).toBe(true);
		expect((listPasskeys(userId)[0].name as string).length).toBe(MAX_PASSKEY_NAME_LENGTH);
	});

	test('createAuthOptions stores a discoverable challenge', async () => {
		swa.generateAuthenticationOptions.mockResolvedValue(makeAuthOptions());
		const options = await createAuthOptions();
		expect(options.challenge).toBe('auth-challenge');
		const stored = ctx.kit.selectFrom(webauthnChallenges).executeSync();
		expect(stored).toHaveLength(1);
		expect(stored[0].purpose as string).toBe('auth');
		expect(stored[0].user_id).toBeNull();
	});

	test('verifyAuth succeeds and updates counter/last_used_at', async () => {
		ctx.kit.insertInto(webauthnChallenges).values({
			challenge_hash: hashChallenge('auth-challenge'),
			user_id: null,
			purpose: 'auth',
			expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString()
		} as any).executeSync();
		ctx.kit.insertInto(passkeys).values({
			user_id: BigInt(userId),
			credential_id: 'test-credential-id',
			public_key: Buffer.from(new Uint8Array([1, 2, 3])).toString('base64'),
			counter: 0n,
			transports: '[]',
			device_type: 'singleDevice',
			name: 'Key',
			created_at: new Date().toISOString(),
			last_used_at: null
		} as any).executeSync();
		swa.verifyAuthenticationResponse.mockImplementation(async (opts: any) => {
			await opts.expectedChallenge('auth-challenge');
			return makeAuthVerificationInfo(5);
		});

		const result = await verifyAuth(makeAuthResponse());
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.userId).toBe(userId);

		const row = ctx.kit.selectFrom(passkeys).executeSync()[0];
		expect(Number(row.counter)).toBe(5);
		expect(row.last_used_at as string).toBeTruthy();
	});

	test('verifyAuth rejects unknown credential', async () => {
		const result = await verifyAuth(makeAuthResponse('unknown-credential'));
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error).toMatch(/unknown credential/i);
	});

	test('verifyAuth rejects disabled user', async () => {
		ctx.kit.insertInto(webauthnChallenges).values({
			challenge_hash: hashChallenge('auth-challenge'),
			user_id: null,
			purpose: 'auth',
			expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString()
		} as any).executeSync();
		ctx.kit.insertInto(passkeys).values({
			user_id: BigInt(userId),
			credential_id: 'test-credential-id',
			public_key: Buffer.from(new Uint8Array([1, 2, 3])).toString('base64'),
			counter: 0n,
			transports: '[]',
			device_type: 'singleDevice',
			name: 'Key',
			created_at: new Date().toISOString(),
			last_used_at: null
		} as any).executeSync();
		ctx.kit.updateTable(users).set({ disabled: true }).where(kitEq(users.id, BigInt(userId))).executeSync();
		swa.verifyAuthenticationResponse.mockImplementation(async (opts: any) => {
			await opts.expectedChallenge('auth-challenge');
			return makeAuthVerificationInfo(5);
		});

		const result = await verifyAuth(makeAuthResponse());
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error).toMatch(/disabled/i);
	});

	test('verifyAuth fails on counter replay / verification failure', async () => {
		ctx.kit.insertInto(webauthnChallenges).values({
			challenge_hash: hashChallenge('auth-challenge'),
			user_id: null,
			purpose: 'auth',
			expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString()
		} as any).executeSync();
		ctx.kit.insertInto(passkeys).values({
			user_id: BigInt(userId),
			credential_id: 'test-credential-id',
			public_key: Buffer.from(new Uint8Array([1, 2, 3])).toString('base64'),
			counter: 10n,
			transports: '[]',
			device_type: 'singleDevice',
			name: 'Key',
			created_at: new Date().toISOString(),
			last_used_at: null
		} as any).executeSync();
		swa.verifyAuthenticationResponse.mockRejectedValue(new Error('Counter replay detected'));

		const result = await verifyAuth(makeAuthResponse());
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error).toMatch(/replay|authentication failed/i);
		const row = ctx.kit.selectFrom(passkeys).executeSync()[0];
		expect(Number(row.counter)).toBe(10);
		expect(row.last_used_at).toBeNull();
	});

	test('failed registration verification leaves challenge reusable', async () => {
		ctx.kit.insertInto(webauthnChallenges).values({
			challenge_hash: hashChallenge('reg-challenge'),
			user_id: BigInt(userId),
			purpose: 'register',
			expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString()
		} as any).executeSync();
		swa.verifyRegistrationResponse.mockRejectedValue(new Error('Invalid attestation'));

		const first = await verifyRegistration(userId, makeRegResponse(), 'YubiKey');
		expect(first.ok).toBe(false);
		expect(ctx.kit.selectFrom(webauthnChallenges).executeSync()).toHaveLength(1);

		swa.verifyRegistrationResponse.mockImplementation(async (opts: any) => {
			await opts.expectedChallenge('reg-challenge');
			return makeRegVerificationInfo();
		});
		const second = await verifyRegistration(userId, makeRegResponse(), 'YubiKey');
		expect(second.ok).toBe(true);
		expect(ctx.kit.selectFrom(passkeys).executeSync()).toHaveLength(1);
		expect(ctx.kit.selectFrom(webauthnChallenges).executeSync()).toHaveLength(0);
	});

	test('registration challenge replay is rejected after successful verify', async () => {
		ctx.kit.insertInto(webauthnChallenges).values({
			challenge_hash: hashChallenge('reg-challenge'),
			user_id: BigInt(userId),
			purpose: 'register',
			expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString()
		} as any).executeSync();
		swa.verifyRegistrationResponse.mockImplementation(async (opts: any) => {
			const ok = await opts.expectedChallenge('reg-challenge');
			if (!ok) throw new Error('Invalid challenge');
			return makeRegVerificationInfo();
		});

		const first = await verifyRegistration(userId, makeRegResponse(), 'YubiKey');
		expect(first.ok).toBe(true);

		// Replaying the same response must fail because the challenge was consumed.
		const replay = await verifyRegistration(userId, makeRegResponse(), 'YubiKey');
		expect(replay.ok).toBe(false);
		expect(ctx.kit.selectFrom(passkeys).executeSync()).toHaveLength(1);
	});

	test('authentication challenge replay is rejected after successful verify', async () => {
		ctx.kit.insertInto(webauthnChallenges).values({
			challenge_hash: hashChallenge('auth-challenge'),
			user_id: null,
			purpose: 'auth',
			expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString()
		} as any).executeSync();
		ctx.kit.insertInto(passkeys).values({
			user_id: BigInt(userId),
			credential_id: 'test-credential-id',
			public_key: Buffer.from(new Uint8Array([1, 2, 3])).toString('base64'),
			counter: 0n,
			transports: '[]',
			device_type: 'singleDevice',
			name: 'Key',
			created_at: new Date().toISOString(),
			last_used_at: null
		} as any).executeSync();
		swa.verifyAuthenticationResponse.mockImplementation(async (opts: any) => {
			const ok = await opts.expectedChallenge('auth-challenge');
			if (!ok) throw new Error('Invalid challenge');
			return makeAuthVerificationInfo(5);
		});

		const first = await verifyAuth(makeAuthResponse());
		expect(first.ok).toBe(true);

		const replay = await verifyAuth(makeAuthResponse());
		expect(replay.ok).toBe(false);
	});

	test('passkey operations write audit log entries', async () => {
		// Register
		ctx.kit.insertInto(webauthnChallenges).values({
			challenge_hash: hashChallenge('reg-challenge'),
			user_id: BigInt(userId),
			purpose: 'register',
			expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString()
		} as any).executeSync();
		swa.verifyRegistrationResponse.mockImplementation(async (opts: any) => {
			await opts.expectedChallenge('reg-challenge');
			return makeRegVerificationInfo();
		});
		await verifyRegistration(userId, makeRegResponse(), 'Work YubiKey');

		const inserted = ctx.kit.selectFrom(passkeys).executeSync()[0];
		const passkeyId = Number(inserted.id);

		// Rename
		renamePasskey(userId, passkeyId, 'Renamed Key');

		// Authenticate
		ctx.kit.insertInto(webauthnChallenges).values({
			challenge_hash: hashChallenge('auth-challenge'),
			user_id: null,
			purpose: 'auth',
			expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString()
		} as any).executeSync();
		swa.verifyAuthenticationResponse.mockImplementation(async (opts: any) => {
			await opts.expectedChallenge('auth-challenge');
			return makeAuthVerificationInfo(5);
		});
		await verifyAuth(makeAuthResponse());

		// Delete
		deletePasskey(userId, passkeyId);

		const logs = ctx.kit
			.selectFrom(auditLogs)
			.where(kitEq(auditLogs.user_id, BigInt(userId)))
			.orderBy(kitAsc(auditLogs.id))
			.executeSync()
			.map((r) => ({ action: r.action, meta: JSON.parse(r.meta_json as string) }));

		expect(logs.map((l) => l.action)).toEqual([
			'passkey_register',
			'passkey_rename',
			'passkey_auth',
			'passkey_delete'
		]);
		expect(logs[0].meta.name).toBe('Work YubiKey');
		expect(logs[1].meta.name).toBe('Renamed Key');
		expect(logs[2].meta.credentialId).toBe('test-credential-id');
		expect(logs[3].meta.credentialId).toBe('test-credential-id');
		expect(logs[3].meta.name).toBe('Renamed Key');
	});

	afterEach(() => {
		process.env.ORIGIN = ORIGINAL_ORIGIN;
	});
});
