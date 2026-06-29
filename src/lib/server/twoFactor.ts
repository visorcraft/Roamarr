import * as OTPAuth from 'otpauth';
import { createHash, randomBytes, createHmac } from 'node:crypto';
import { eq as kitEq, and as kitAnd, isNull as kitIsNull } from '@mongreldb/kit';
import { kit } from './db';
import { userTwoFactor, twoFactorBackupCodes } from './db/mongrelSchema';
import { encrypt, decrypt } from './crypto';
import { logAudit } from './audit';

const ISSUER = 'Roamarr';
const BACKUP_CODE_COUNT = 10;

export interface TwoFactorState {
	enabled: boolean;
	enabledAt: string | null;
	backupCodesRemaining: number;
}

export interface TwoFactorSetup {
	secret: string;
	otpauthUri: string;
}

export function generateSecret(email: string): TwoFactorSetup {
	const secret = new OTPAuth.Secret({ size: 20 });
	const totp = new OTPAuth.TOTP({
		issuer: ISSUER,
		label: email,
		algorithm: 'SHA1',
		digits: 6,
		period: 30,
		secret
	});
	return {
		secret: secret.base32,
		otpauthUri: totp.toString()
	};
}

export function verifyTotp(secretBase32: string, token: string, window = 1): boolean {
	const totp = new OTPAuth.TOTP({
		issuer: ISSUER,
		algorithm: 'SHA1',
		digits: 6,
		period: 30,
		secret: OTPAuth.Secret.fromBase32(secretBase32)
	});
	const delta = totp.validate({ token: token.replace(/\s/g, ''), window });
	return delta !== null;
}

function hashBackupCode(code: string): string {
	return createHash('sha256').update(code).digest('hex');
}

export function generateBackupCodes(): string[] {
	const codes: string[] = [];
	for (let i = 0; i < BACKUP_CODE_COUNT; i++) {
		const bytes = randomBytes(4);
		const hex = bytes.toString('hex');
		codes.push(`${hex.slice(0, 4)}-${hex.slice(4)}`);
	}
	return codes;
}

export function isTwoFactorEnabled(userId: number): boolean {
	const row = kit
		.selectFrom(userTwoFactor)
		.where(kitEq(userTwoFactor.user_id, BigInt(userId)))
		.executeSync()[0];
	return Boolean(row?.enabled);
}

export function getTwoFactorState(userId: number): TwoFactorState {
	const row = kit
		.selectFrom(userTwoFactor)
		.where(kitEq(userTwoFactor.user_id, BigInt(userId)))
		.executeSync()[0];
	if (!row) return { enabled: false, enabledAt: null, backupCodesRemaining: 0 };
	return {
		enabled: Boolean(row.enabled),
		enabledAt: row.enabled_at as string | null,
		backupCodesRemaining: Number(row.backup_codes_count)
	};
}

export function enableTwoFactor(
	userId: number,
	secret: string,
	token: string
): { ok: true; backupCodes: string[] } | { ok: false; error: string } {
	if (!verifyTotp(secret, token)) return { ok: false, error: 'Invalid verification code.' };

	const encryptedSecret = encrypt(secret);
	const codes = generateBackupCodes();
	const now = new Date().toISOString();

	const existing = kit
		.selectFrom(userTwoFactor)
		.where(kitEq(userTwoFactor.user_id, BigInt(userId)))
		.executeSync()[0];

	kit.deleteFrom(twoFactorBackupCodes)
		.where(kitEq(twoFactorBackupCodes.user_id, BigInt(userId)))
		.executeSync();

	for (const code of codes) {
		kit.insertInto(twoFactorBackupCodes).values({
			user_id: BigInt(userId),
			code_hash: hashBackupCode(code),
			used_at: null,
			created_at: now
		} as any).executeSync();
	}

	if (existing) {
		kit
			.updateTable(userTwoFactor)
			.set({
				secret_encrypted: encryptedSecret,
				enabled: true,
				enabled_at: now,
				backup_codes_count: BigInt(codes.length)
			})
			.where(kitEq(userTwoFactor.user_id, BigInt(userId)))
			.executeSync();
	} else {
		kit.insertInto(userTwoFactor).values({
			user_id: BigInt(userId),
			secret_encrypted: encryptedSecret,
			enabled: true,
			enabled_at: now,
			backup_codes_count: BigInt(codes.length)
		} as any).executeSync();
	}

	logAudit(userId, 'two_factor_enable', 'user', userId, {});
	return { ok: true, backupCodes: codes };
}

export function disableTwoFactor(userId: number): void {
	kit.deleteFrom(userTwoFactor).where(kitEq(userTwoFactor.user_id, BigInt(userId))).executeSync();
	kit.deleteFrom(twoFactorBackupCodes)
		.where(kitEq(twoFactorBackupCodes.user_id, BigInt(userId)))
		.executeSync();
	logAudit(userId, 'two_factor_disable', 'user', userId, {});
}

export function adminDisableTwoFactor(adminId: number, userId: number): void {
	kit.deleteFrom(userTwoFactor).where(kitEq(userTwoFactor.user_id, BigInt(userId))).executeSync();
	kit.deleteFrom(twoFactorBackupCodes)
		.where(kitEq(twoFactorBackupCodes.user_id, BigInt(userId)))
		.executeSync();
	logAudit(adminId, 'two_factor_admin_disable', 'user', userId, {});
}

export function regenerateBackupCodes(
	userId: number,
	token: string
): { ok: true; backupCodes: string[] } | { ok: false; error: string } {
	const row = kit
		.selectFrom(userTwoFactor)
		.where(kitEq(userTwoFactor.user_id, BigInt(userId)))
		.executeSync()[0];
	if (!row || !row.enabled) return { ok: false, error: 'Two-factor is not enabled.' };
	const secret = decrypt(row.secret_encrypted as string);
	if (!verifyTotp(secret, token)) return { ok: false, error: 'Invalid verification code.' };

	const codes = generateBackupCodes();
	kit.deleteFrom(twoFactorBackupCodes)
		.where(kitEq(twoFactorBackupCodes.user_id, BigInt(userId)))
		.executeSync();
	const now = new Date().toISOString();
	for (const code of codes) {
		kit.insertInto(twoFactorBackupCodes).values({
			user_id: BigInt(userId),
			code_hash: hashBackupCode(code),
			used_at: null,
			created_at: now
		} as any).executeSync();
	}
	kit
		.updateTable(userTwoFactor)
		.set({ backup_codes_count: BigInt(codes.length) })
		.where(kitEq(userTwoFactor.user_id, BigInt(userId)))
		.executeSync();
	logAudit(userId, 'two_factor_regenerate_codes', 'user', userId, {});
	return { ok: true, backupCodes: codes };
}

export function verifyTwoFactor(userId: number, code: string): boolean {
	const row = kit
		.selectFrom(userTwoFactor)
		.where(kitEq(userTwoFactor.user_id, BigInt(userId)))
		.executeSync()[0];
	if (!row || !row.enabled) return false;
	const secret = decrypt(row.secret_encrypted as string);

	if (/^\d{6}$/.test(code.trim())) {
		return verifyTotp(secret, code.trim());
	}

	const normalized = code.trim().toLowerCase();
	const hash = hashBackupCode(normalized);
	const unused = kit
		.selectFrom(twoFactorBackupCodes)
		.where(
			kitAnd(
				kitEq(twoFactorBackupCodes.user_id, BigInt(userId)),
				kitEq(twoFactorBackupCodes.code_hash, hash)
			)
		)
		.executeSync();
	if (unused.length === 0) return false;
	const target = unused[0];
	if (target.used_at) return false;

	kit
		.updateTable(twoFactorBackupCodes)
		.set({ used_at: new Date().toISOString() })
		.where(kitEq(twoFactorBackupCodes.id, target.id))
		.executeSync();

	const remaining = kit
		.selectFrom(twoFactorBackupCodes)
		.where(
			kitAnd(
				kitEq(twoFactorBackupCodes.user_id, BigInt(userId)),
				kitIsNull(twoFactorBackupCodes.used_at)
			)
		)
		.executeSync();
	const count = remaining.length;
	kit
		.updateTable(userTwoFactor)
		.set({ backup_codes_count: BigInt(count) })
		.where(kitEq(userTwoFactor.user_id, BigInt(userId)))
		.executeSync();

	return true;
}

export interface PendingTwoFactor {
	userId: number;
	nonce: string;
	expires: number;
}

const PENDING_MAX_AGE = 5 * 60;

function signPending(payload: string): string {
	const secret = process.env.ROAMARR_SECRET;
	if (!secret) throw new Error('ROAMARR_SECRET is not set');
	return createHmac('sha256', secret).update(payload).digest('hex');
}

export function createPendingCookie(userId: number): { value: string; maxAge: number } {
	const nonce = randomBytes(16).toString('hex');
	const expires = Date.now() + PENDING_MAX_AGE * 1000;
	const payload = `${userId}.${nonce}.${expires}`;
	const sig = signPending(payload);
	return { value: `${payload}.${sig}`, maxAge: PENDING_MAX_AGE };
}

export function verifyPendingCookie(value: string | undefined): PendingTwoFactor | null {
	if (!value) return null;
	const parts = value.split('.');
	if (parts.length !== 4) return null;
	const [userIdStr, nonce, expiresStr, sig] = parts;
	const payload = `${userIdStr}.${nonce}.${expiresStr}`;
	const expected = signPending(payload);
	if (sig !== expected) return null;
	const userId = Number(userIdStr);
	const expires = Number(expiresStr);
	if (!Number.isFinite(userId) || !Number.isFinite(expires)) return null;
	if (Date.now() > expires) return null;
	return { userId, nonce, expires };
}
