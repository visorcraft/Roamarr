import { describe, test, expect, beforeEach, vi } from 'vitest';
import * as OTPAuth from 'otpauth';
import { eq } from '@visorcraft/mongreldb-kit';
import type { KitDatabase } from '@visorcraft/mongreldb-kit';

const ctx = vi.hoisted(() => ({ kit: null as unknown as KitDatabase }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { userTwoFactor, twoFactorBackupCodes } from './db/mongrelSchema';
import {
	generateSecret,
	verifyTotp,
	generateBackupCodes,
	isTwoFactorEnabled,
	areTwoFactorEnabledForUserIds,
	getTwoFactorState,
	enableTwoFactor,
	disableTwoFactor,
	regenerateBackupCodes,
	verifyTwoFactor,
	createPendingCookie,
	verifyPendingCookie
} from './twoFactor';
import { makeUser } from '../../../tests/helpers';

function validToken(secret: string): string {
	const totp = new OTPAuth.TOTP({
		issuer: 'Roamarr',
		label: 'test@example.com',
		algorithm: 'SHA1',
		digits: 6,
		period: 30,
		secret: OTPAuth.Secret.fromBase32(secret)
	});
	return totp.generate();
}

describe('twoFactor', () => {
	let userId: number;

	beforeEach(() => {
		ctx.kit.deleteFrom(userTwoFactor).executeSync();
		ctx.kit.deleteFrom(twoFactorBackupCodes).executeSync();
		const u = makeUser(ctx.kit);
		userId = u.id;
	});

	test('generateSecret returns base32 secret and otpauth URI', () => {
		const setup = generateSecret('user@example.com');
		expect(setup.secret).toMatch(/^[A-Z2-7]+$/);
		expect(setup.otpauthUri).toContain('otpauth://totp/');
		expect(setup.otpauthUri).toContain('user%40example.com');
	});

	test('verifyTotp accepts a current token', () => {
		const setup = generateSecret('u@e.com');
		expect(verifyTotp(setup.secret, validToken(setup.secret))).toBe(true);
		expect(verifyTotp(setup.secret, '000000')).toBe(false);
	});

	test('generateBackupCodes produces 10 formatted codes', () => {
		const codes = generateBackupCodes();
		expect(codes).toHaveLength(10);
		expect(codes.every((c) => /^[0-9a-f]{4}-[0-9a-f]{4}$/.test(c))).toBe(true);
		expect(new Set(codes).size).toBe(10);
	});

	test('backup codes are stored as sha256 hashes', () => {
		const setup = generateSecret('u@e.com');
		const result = enableTwoFactor(userId, setup.secret, validToken(setup.secret));
		expect(result.ok).toBe(true);

		const hashes = ctx.kit
			.selectFrom(twoFactorBackupCodes)
			.where(eq(twoFactorBackupCodes.user_id, BigInt(userId)))
			.executeSync();
		expect(hashes.length).toBe(10);
		expect(hashes.every((h) => /^[0-9a-f]{64}$/.test(String(h.code_hash)))).toBe(true);
	});

	test('enableTwoFactor requires a valid token and stores encrypted secret', () => {
		const setup = generateSecret('u@e.com');
		const bad = enableTwoFactor(userId, setup.secret, '000000');
		expect(bad.ok).toBe(false);

		const good = enableTwoFactor(userId, setup.secret, validToken(setup.secret));
		expect(good.ok).toBe(true);
		if (good.ok) expect(good.backupCodes).toHaveLength(10);

		expect(isTwoFactorEnabled(userId)).toBe(true);
		const state = getTwoFactorState(userId);
		expect(state.enabled).toBe(true);
		expect(state.backupCodesRemaining).toBe(10);
	});

	test('disableTwoFactor removes all 2FA data', () => {
		const setup = generateSecret('u@e.com');
		enableTwoFactor(userId, setup.secret, validToken(setup.secret));
		disableTwoFactor(userId);
		expect(isTwoFactorEnabled(userId)).toBe(false);
		const remaining = ctx.kit.selectFrom(twoFactorBackupCodes).executeSync();
		expect(remaining).toHaveLength(0);
	});

	test('regenerateBackupCodes invalidates old codes', () => {
		const setup = generateSecret('u@e.com');
		const result = enableTwoFactor(userId, setup.secret, validToken(setup.secret));
		if (!result.ok) throw new Error('enable failed');
		const oldCodes = result.backupCodes;

		// old backup code works before regen
		expect(verifyTwoFactor(userId, oldCodes[0])).toBe(true);

		const regen = regenerateBackupCodes(userId, validToken(setup.secret));
		expect(regen.ok).toBe(true);
		if (!regen.ok) return;
		// old code no longer works (deleted)
		expect(verifyTwoFactor(userId, oldCodes[1])).toBe(false);
		// new code works
		expect(verifyTwoFactor(userId, regen.backupCodes[0])).toBe(true);
	});

	test('verifyTwoFactor accepts TOTP and marks backup codes single-use', () => {
		const setup = generateSecret('u@e.com');
		const result = enableTwoFactor(userId, setup.secret, validToken(setup.secret));
		if (!result.ok) throw new Error('enable failed');

		// TOTP works
		expect(verifyTwoFactor(userId, validToken(setup.secret))).toBe(true);

		// backup code works once
		const code = result.backupCodes[0];
		expect(verifyTwoFactor(userId, code)).toBe(true);
		// same code fails on reuse
		expect(verifyTwoFactor(userId, code)).toBe(false);
	});

	test('verifyTwoFactor rejects for disabled accounts', () => {
		expect(verifyTwoFactor(userId, '123456')).toBe(false);
	});

	test('areTwoFactorEnabledForUserIds returns only enabled users', () => {
		const otherUser = makeUser(ctx.kit);

		expect(areTwoFactorEnabledForUserIds([])).toEqual(new Set());
		expect(areTwoFactorEnabledForUserIds([userId])).toEqual(new Set());

		const setup = generateSecret('u@e.com');
		enableTwoFactor(userId, setup.secret, validToken(setup.secret));

		ctx.kit.insertInto(userTwoFactor).values({
			user_id: BigInt(otherUser.id),
			secret_encrypted: 'x',
			enabled: false,
			enabled_at: null,
			backup_codes_count: 0n
		}).executeSync();

		const enabled = areTwoFactorEnabledForUserIds([userId, otherUser.id, 999999]);
		expect(enabled).toEqual(new Set([userId]));
		expect(enabled.has(otherUser.id)).toBe(false);
		expect(enabled.has(999999)).toBe(false);
	});

	test('consuming a backup code decrements the remaining count', () => {
		const setup = generateSecret('u@e.com');
		const result = enableTwoFactor(userId, setup.secret, validToken(setup.secret));
		if (!result.ok) throw new Error('enable failed');
		expect(getTwoFactorState(userId).backupCodesRemaining).toBe(10);

		expect(verifyTwoFactor(userId, result.backupCodes[0])).toBe(true);
		// Regression: the remaining count must reflect the 9 unused codes, not 0.
		expect(getTwoFactorState(userId).backupCodesRemaining).toBe(9);
	});

	test('createPendingCookie / verifyPendingCookie round-trip', () => {
		const cookie = createPendingCookie(userId, '1.1.1.1', 'Mozilla/5.0');
		const pending = verifyPendingCookie(cookie.value, '1.1.1.1', 'Mozilla/5.0');
		expect(pending).not.toBeNull();
		expect(pending!.userId).toBe(userId);
	});

	test('verifyPendingCookie rejects fingerprint mismatch', () => {
		const cookie = createPendingCookie(userId, '1.1.1.1', 'Mozilla/5.0');
		expect(verifyPendingCookie(cookie.value, '9.9.9.9', 'Mozilla/5.0')).toBeNull();
		expect(verifyPendingCookie(cookie.value, '1.1.1.1', 'Evil/1.0')).toBeNull();
		expect(verifyPendingCookie(cookie.value, '1.1.1.1', undefined)).toBeNull();
	});

	test('verifyPendingCookie rejects tampered values', () => {
		expect(verifyPendingCookie(undefined, '1.1.1.1', 'Mozilla/5.0')).toBeNull();
		expect(verifyPendingCookie('garbage', '1.1.1.1', 'Mozilla/5.0')).toBeNull();
		const cookie = createPendingCookie(userId, '1.1.1.1', 'Mozilla/5.0');
		const tampered = cookie.value.slice(0, -1) + (cookie.value.endsWith('a') ? 'b' : 'a');
		expect(verifyPendingCookie(tampered, '1.1.1.1', 'Mozilla/5.0')).toBeNull();
	});

	test('verifyPendingCookie rejects legacy four-part cookies', () => {
		const cookie = createPendingCookie(userId, '1.1.1.1', 'Mozilla/5.0');
		const legacy = cookie.value.split('.').slice(0, 4).join('.');
		expect(verifyPendingCookie(legacy, '1.1.1.1', 'Mozilla/5.0')).toBeNull();
	});
});
