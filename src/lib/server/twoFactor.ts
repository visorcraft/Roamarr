import * as OTPAuth from 'otpauth';
import { randomBytes, createHmac, timingSafeEqual, createHash } from 'node:crypto';
import type { Transaction } from '@visorcraft/mongreldb/native.js';
import {
	eq as kitEq,
	and as kitAnd,
	isNull as kitIsNull,
	validateRow,
	toCells,
	enforceForeignKeys,
	stageUniqueGuards,
	stagePkGuard,
	deleteUniqueGuards,
	planDelete,
	type TableSpec,
	type ConstraintKit
} from '@visorcraft/mongreldb-kit';
import { kit } from './db';
import { userTwoFactor, twoFactorBackupCodes } from './db/mongrelSchema';
import { encrypt, decrypt } from './crypto';
import { logAudit } from './audit';

const ISSUER = 'Roamarr';
const BACKUP_CODE_COUNT = 10;
const BACKUP_CODE_BYTES = 4;

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

function verifyBackupCode(code: string, stored: string): boolean {
	const expected = Buffer.from(stored, 'hex');
	if (expected.length !== 32) return false;
	const actual = createHash('sha256').update(code).digest();
	return timingSafeEqual(actual, expected);
}

export function generateBackupCodes(): string[] {
	const codes = new Set<string>();
	while (codes.size < BACKUP_CODE_COUNT) {
		const hex = randomBytes(BACKUP_CODE_BYTES).toString('hex');
		const code = `${hex.slice(0, 4)}-${hex.slice(4, 8)}`;
		codes.add(code);
	}
	return Array.from(codes);
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

// --- Kit transaction helpers -------------------------------------------------

function constraintKit(): ConstraintKit {
	return { db: kit.nativeDb, schema: kit.schema };
}

function runKitTransaction(fn: (txn: Transaction) => void): void {
	const txn = kit.begin();
	try {
		fn(txn);
		txn.commit();
	} catch (err) {
		try {
			txn.rollback();
		} catch {
			// ignore rollback errors
		}
		throw err;
	}
}

function pkValue(table: TableSpec, row: Record<string, unknown>): string | bigint {
	const name = table.primaryKey[0];
	const value = row[name];
	if (typeof value !== 'string' && typeof value !== 'bigint') {
		throw new Error(`Primary key "${name}" must be string or bigint in "${table.name}"`);
	}
	return value;
}

function insertRow(txn: Transaction, table: TableSpec, row: Record<string, unknown>): void {
	validateRow(table, row);
	const pk = pkValue(table, row);
	const ck = constraintKit();
	enforceForeignKeys(ck, txn, table, row);
	stageUniqueGuards(ck, txn, table, row, pk);
	stagePkGuard(ck, txn, table, pk, true);
	txn.put(table.name, toCells(table, row));
}

function updateRow(txn: Transaction, table: TableSpec, row: Record<string, unknown>, rowId: bigint): void {
	validateRow(table, row);
	const pk = pkValue(table, row);
	const ck = constraintKit();
	deleteUniqueGuards(ck, txn, table, pk);
	txn.delete(table.name, rowId);
	txn.put(table.name, toCells(table, row));
	stageUniqueGuards(ck, txn, table, row, pk);
}

function deleteBackupCodes(txn: Transaction, userId: number): void {
	const ck = constraintKit();
	const codes = kit
		.selectFrom(twoFactorBackupCodes)
		.where(kitEq(twoFactorBackupCodes.user_id, BigInt(userId)))
		.executeSync();
	for (const code of codes) {
		const rowJs = kit.nativeDb.table('two_factor_backup_codes').getByPkInt64(code.id as bigint);
		if (!rowJs) continue;
		planDelete(ck, txn, twoFactorBackupCodes, code.id as bigint, { row: code as Record<string, unknown>, rowId: rowJs.rowId });
	}
}

// -----------------------------------------------------------------------------

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

	runKitTransaction((txn) => {
		deleteBackupCodes(txn, userId);

		for (const code of codes) {
			const id = kit.reserveAutoIncSync('two_factor_backup_codes')!;
			insertRow(txn, twoFactorBackupCodes, {
				id,
				user_id: BigInt(userId),
				code_hash: hashBackupCode(code),
				used_at: null,
				created_at: now
			});
		}

		if (existing) {
			const rowJs = kit.nativeDb.table('user_two_factor').getByPkInt64(BigInt(userId));
			if (!rowJs) throw new Error('Two-factor row disappeared during enable.');
			updateRow(txn, userTwoFactor, {
				user_id: BigInt(userId),
				secret_encrypted: encryptedSecret,
				enabled: true,
				enabled_at: now,
				backup_codes_count: BigInt(codes.length)
			}, rowJs.rowId);
		} else {
			insertRow(txn, userTwoFactor, {
				user_id: BigInt(userId),
				secret_encrypted: encryptedSecret,
				enabled: true,
				enabled_at: now,
				backup_codes_count: BigInt(codes.length)
			});
		}
	});

	logAudit(userId, 'two_factor_enable', 'user', userId, {});
	return { ok: true, backupCodes: codes };
}

function deleteTwoFactorForUser(userId: number): void {
	runKitTransaction((txn) => {
		const existing = kit
			.selectFrom(userTwoFactor)
			.where(kitEq(userTwoFactor.user_id, BigInt(userId)))
			.executeSync()[0];
		if (existing) {
			const rowJs = kit.nativeDb.table('user_two_factor').getByPkInt64(BigInt(userId));
			if (rowJs) {
				planDelete(constraintKit(), txn, userTwoFactor, BigInt(userId), {
					row: existing as Record<string, unknown>,
					rowId: rowJs.rowId
				});
			}
		}
		deleteBackupCodes(txn, userId);
	});
}

export function disableTwoFactor(userId: number): void {
	deleteTwoFactorForUser(userId);
	logAudit(userId, 'two_factor_disable', 'user', userId, {});
}

export function adminDisableTwoFactor(adminId: number, userId: number): void {
	deleteTwoFactorForUser(userId);
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
	const now = new Date().toISOString();

	runKitTransaction((txn) => {
		deleteBackupCodes(txn, userId);

		for (const code of codes) {
			const id = kit.reserveAutoIncSync('two_factor_backup_codes')!;
			insertRow(txn, twoFactorBackupCodes, {
				id,
				user_id: BigInt(userId),
				code_hash: hashBackupCode(code),
				used_at: null,
				created_at: now
			});
		}

		const rowJs = kit.nativeDb.table('user_two_factor').getByPkInt64(BigInt(userId));
		if (!rowJs) throw new Error('Two-factor row disappeared during regeneration.');
		updateRow(txn, userTwoFactor, {
			user_id: BigInt(userId),
			secret_encrypted: row.secret_encrypted as string,
			enabled: true,
			enabled_at: row.enabled_at as string | null,
			backup_codes_count: BigInt(codes.length)
		}, rowJs.rowId);
	});

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

	const trimmed = code.trim();
	if (/^\d{6}$/.test(trimmed)) {
		return verifyTotp(secret, trimmed);
	}

	const normalized = trimmed.toLowerCase();
	const unused = kit
		.selectFrom(twoFactorBackupCodes)
		.where(
			kitAnd(
				kitEq(twoFactorBackupCodes.user_id, BigInt(userId)),
				kitIsNull(twoFactorBackupCodes.used_at)
			)
		)
		.executeSync();

	const target = unused.find((r) => verifyBackupCode(normalized, r.code_hash as string));
	if (!target) return false;

	const now = new Date().toISOString();
	let consumed = false;

	runKitTransaction((txn) => {
		const rowJs = kit.nativeDb.table('two_factor_backup_codes').getByPkInt64(target.id as bigint);
		if (!rowJs) return;
		const usedAtCell = rowJs.cells.find(
			(c) => c.columnId === twoFactorBackupCodes.columns.find((col) => col.name === 'used_at')!.id
		);
		// `bytes` columns store strings as `text` in RowJs; null columns have no typed value.
		if (usedAtCell?.text != null) return;

		updateRow(
			txn,
			twoFactorBackupCodes,
			{
				id: target.id,
				user_id: BigInt(userId),
				code_hash: target.code_hash,
				used_at: now,
				created_at: target.created_at
			},
			rowJs.rowId
		);

		const tfRowJs = kit.nativeDb.table('user_two_factor').getByPkInt64(BigInt(userId));
		if (!tfRowJs) return;
		updateRow(
			txn,
			userTwoFactor,
			{
				user_id: BigInt(userId),
				secret_encrypted: row.secret_encrypted as string,
				enabled: true,
				enabled_at: row.enabled_at as string | null,
				backup_codes_count: BigInt(unused.length - 1)
			},
			tfRowJs.rowId
		);
		consumed = true;
	});

	return consumed;
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

function fingerprintFor(ip: string, userAgent: string | undefined): string {
	const secret = process.env.ROAMARR_SECRET;
	if (!secret) throw new Error('ROAMARR_SECRET is not set');
	return createHmac('sha256', secret).update(`${ip}\n${userAgent ?? ''}`).digest('hex');
}

export function createPendingCookie(
	userId: number,
	ip: string,
	userAgent: string | undefined
): { value: string; maxAge: number } {
	const nonce = randomBytes(16).toString('hex');
	const expires = Date.now() + PENDING_MAX_AGE * 1000;
	const fp = fingerprintFor(ip, userAgent);
	const payload = `${userId}.${nonce}.${expires}.${fp}`;
	const sig = signPending(payload);
	return { value: `${payload}.${sig}`, maxAge: PENDING_MAX_AGE };
}

export function verifyPendingCookie(
	value: string | undefined,
	ip: string,
	userAgent: string | undefined
): PendingTwoFactor | null {
	if (!value) return null;
	const parts = value.split('.');
	if (parts.length !== 5) return null;
	const [userIdStr, nonce, expiresStr, fp, sig] = parts;

	const expectedFp = fingerprintFor(ip, userAgent);
	if (fp.length !== expectedFp.length) return null;
	const expectedFpBuf = Buffer.from(expectedFp, 'hex');
	const actualFpBuf = Buffer.from(fp, 'hex');
	if (actualFpBuf.length !== expectedFpBuf.length) return null;
	if (!timingSafeEqual(actualFpBuf, expectedFpBuf)) return null;

	const payload = `${userIdStr}.${nonce}.${expiresStr}.${fp}`;
	const expected = Buffer.from(signPending(payload), 'hex');
	const actual = Buffer.from(sig, 'hex');
	if (actual.length !== expected.length) return null;
	if (!timingSafeEqual(actual, expected)) return null;
	const userId = Number(userIdStr);
	const expires = Number(expiresStr);
	if (!Number.isFinite(userId) || !Number.isFinite(expires)) return null;
	if (Date.now() > expires) return null;
	return { userId, nonce, expires };
}
