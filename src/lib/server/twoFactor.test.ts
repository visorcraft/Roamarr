import { describe, test, expect, beforeEach, vi } from 'vitest';
import * as OTPAuth from 'otpauth';
import type { KitDatabase } from '@mongreldb/kit';

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
		expect(codes.every((c) => /^\w{4}-\w{4}$/.test(c))).toBe(true);
		expect(new Set(codes).size).toBe(10);
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

	test('createPendingCookie / verifyPendingCookie round-trip', () => {
		const cookie = createPendingCookie(userId);
		const pending = verifyPendingCookie(cookie.value);
		expect(pending).not.toBeNull();
		expect(pending!.userId).toBe(userId);
	});

	test('verifyPendingCookie rejects tampered values', () => {
		expect(verifyPendingCookie(undefined)).toBeNull();
		expect(verifyPendingCookie('garbage')).toBeNull();
		const cookie = createPendingCookie(userId);
		const tampered = cookie.value.slice(0, -1) + (cookie.value.endsWith('a') ? 'b' : 'a');
		expect(verifyPendingCookie(tampered)).toBeNull();
	});
});
