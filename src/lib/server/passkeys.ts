import {
	generateRegistrationOptions,
	verifyRegistrationResponse,
	generateAuthenticationOptions,
	verifyAuthenticationResponse
} from '@simplewebauthn/server';
import { createHash, randomBytes } from 'node:crypto';
import { eq as kitEq, lt as kitLt } from '@mongreldb/kit';
import { kit } from './db';
import { passkeys, webauthnChallenges } from './db/mongrelSchema';
import { getSettings } from './repositories/settingsRepo';
import { logAudit } from './audit';
import type { Row } from '@mongreldb/kit';

const CHALLENGE_TTL_MIN = 5;

export interface RpConfig {
	rpID: string;
	rpName: string;
	origins: string[];
}

export function getRpConfig(): RpConfig {
	const origin = process.env.ORIGIN;
	if (!origin) throw new Error('ORIGIN must be set to use passkeys');
	const url = new URL(origin);
	return {
		rpID: url.hostname,
		rpName: getSettings().instanceName || 'Roamarr',
		origins: [origin]
	};
}

export function isPasskeyAvailable(): boolean {
	return Boolean(process.env.ORIGIN);
}

export interface PasskeyInfo {
	id: number;
	name: string | null;
	deviceType: string | null;
	createdAt: string;
	lastUsedAt: string | null;
}

function toInfo(row: Row<typeof passkeys>): PasskeyInfo {
	return {
		id: Number(row.id),
		name: row.name as string | null,
		deviceType: row.device_type as string | null,
		createdAt: row.created_at as string,
		lastUsedAt: (row.last_used_at as string) || null
	};
}

export function listPasskeys(userId: number): PasskeyInfo[] {
	return kit
		.selectFrom(passkeys)
		.where(kitEq(passkeys.user_id, BigInt(userId)))
		.executeSync()
		.map(toInfo);
}

export function passkeyCount(userId: number): number {
	return kit
		.selectFrom(passkeys)
		.where(kitEq(passkeys.user_id, BigInt(userId)))
		.executeSync().length;
}

function hashChallenge(challenge: string): string {
	return createHash('sha256').update(challenge).digest('hex');
}

function storeChallenge(challenge: string, userId: number | null, purpose: 'register' | 'auth'): void {
	const expires = new Date(Date.now() + CHALLENGE_TTL_MIN * 60 * 1000).toISOString();
	kit.insertInto(webauthnChallenges).values({
		challenge_hash: hashChallenge(challenge),
		user_id: userId != null ? BigInt(userId) : null,
		purpose,
		expires_at: expires
	} as any).executeSync();
}

function consumeChallenge(challenge: string, purpose: string): number | null {
	const hash = hashChallenge(challenge);
	const rows = kit
		.selectFrom(webauthnChallenges)
		.where(kitEq(webauthnChallenges.challenge_hash, hash))
		.executeSync();
	if (rows.length === 0) return null;
	const row = rows[0];
	kit.deleteFrom(webauthnChallenges).where(kitEq(webauthnChallenges.id, row.id)).executeSync();
	if (row.purpose !== purpose) return null;
	const expires = row.expires_at as string;
	if (Date.now() > new Date(expires).getTime()) return null;
	return row.user_id != null ? Number(row.user_id) : null;
}

export function purgeExpiredChallenges(): number {
	const now = new Date().toISOString();
	const n = kit
		.deleteFrom(webauthnChallenges)
		.where(kitLt(webauthnChallenges.expires_at, now))
		.executeSync();
	return Number(n);
}

export async function createRegistrationOptions(userId: number, email: string) {
	const rp = getRpConfig();
	const existing = kit
		.selectFrom(passkeys)
		.where(kitEq(passkeys.user_id, BigInt(userId)))
		.executeSync()
		.map((r) => r.credential_id as string);

	const options = await generateRegistrationOptions({
		rpName: rp.rpName,
		rpID: rp.rpID,
		userName: email,
		excludeCredentials: existing.map((id) => ({ id: id, type: 'public-key' as const })),
		authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' }
	});

	storeChallenge(options.challenge, userId, 'register');
	return options;
}

export async function verifyRegistration(
	userId: number,
	response: unknown,
	name: string
): Promise<{ ok: true } | { ok: false; error: string }> {
	const rp = getRpConfig();
	let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
	try {
		verification = await verifyRegistrationResponse({
			response: response as any,
			expectedChallenge: (challenge) => {
				return consumeChallenge(challenge, 'register') === userId;
			},
			expectedOrigin: rp.origins,
			expectedRPID: rp.rpID
		});
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : 'Registration verification failed' };
	}

	if (!verification.verified || !verification.registrationInfo) {
		return { ok: false, error: 'Registration verification failed' };
	}

	const info = verification.registrationInfo;
	const cred = info.credential;
	kit.insertInto(passkeys).values({
		user_id: BigInt(userId),
		credential_id: cred.id,
		public_key: Buffer.from(cred.publicKey).toString('base64'),
		counter: BigInt(cred.counter),
		transports: JSON.stringify(cred.transports ?? []),
		device_type: info.credentialDeviceType,
		name: name || null,
		created_at: new Date().toISOString(),
		last_used_at: null
	} as any).executeSync();

	logAudit(userId, 'passkey_register', 'user', userId, { name: name || null });
	return { ok: true };
}

export async function createAuthOptions() {
	const rp = getRpConfig();
	const options = await generateAuthenticationOptions({
		rpID: rp.rpID,
		userVerification: 'preferred',
		allowCredentials: []
	});
	storeChallenge(options.challenge, null, 'auth');
	return options;
}

export async function verifyAuth(
	response: unknown
): Promise<{ ok: true; userId: number } | { ok: false; error: string }> {
	const rp = getRpConfig();
	const parsed = response as { id?: string; response?: { authenticatorData?: string } };
	if (!parsed?.id) return { ok: false, error: 'Missing credential ID' };

	const rows = kit
		.selectFrom(passkeys)
		.where(kitEq(passkeys.credential_id, parsed.id))
		.executeSync();
	if (rows.length === 0) return { ok: false, error: 'Unknown credential' };
	const passkey = rows[0];

	let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
	try {
		verification = await verifyAuthenticationResponse({
			response: response as any,
			expectedChallenge: (challenge) => consumeChallenge(challenge, 'auth') !== null,
			expectedOrigin: rp.origins,
			expectedRPID: rp.rpID,
			credential: {
				id: passkey.credential_id as string,
				publicKey: new Uint8Array(Buffer.from(passkey.public_key as string, 'base64')),
				counter: Number(passkey.counter)
			}
		});
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : 'Authentication failed' };
	}

	if (!verification.verified) return { ok: false, error: 'Authentication failed' };

	const userId = Number(passkey.user_id);
	kit
		.updateTable(passkeys)
		.set({
			counter: BigInt(verification.authenticationInfo.newCounter),
			last_used_at: new Date().toISOString()
		})
		.where(kitEq(passkeys.id, passkey.id))
		.executeSync();

	return { ok: true, userId };
}

export function renamePasskey(userId: number, id: number, name: string): boolean {
	const result = kit
		.updateTable(passkeys)
		.set({ name })
		.where(kitEq(passkeys.id, BigInt(id)))
		.executeSync();
	return result.length > 0;
}

export function deletePasskey(userId: number, id: number): boolean {
	const rows = kit
		.selectFrom(passkeys)
		.where(kitEq(passkeys.id, BigInt(id)))
		.executeSync();
	if (rows.length === 0) return false;
	const n = kit.deleteFrom(passkeys).where(kitEq(passkeys.id, BigInt(id))).executeSync();
	if (n > 0n) logAudit(userId, 'passkey_delete', 'user', userId, {});
	return n > 0n;
}
