import {
	generateRegistrationOptions,
	verifyRegistrationResponse,
	generateAuthenticationOptions,
	verifyAuthenticationResponse
} from '@simplewebauthn/server';
import { createHash, randomBytes } from 'node:crypto';
import { eq as kitEq, lt as kitLt, and as kitAnd } from '@mongreldb/kit';
import { kit } from './db';
import { passkeys, webauthnChallenges } from './db/mongrelSchema';
import { getSettings } from './repositories/settingsRepo';
import { getUserById } from './repositories/usersRepo';
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

// Single-use: deletes the row when found, regardless of validity. Returns `ok`
// to distinguish a valid challenge from an invalid/expired one — `userId` is
// null for auth challenges (discoverable login), so it must not double as the
// validity signal.
function consumeChallenge(
	challenge: string,
	purpose: string
): { ok: boolean; userId: number | null } {
	const hash = hashChallenge(challenge);
	const rows = kit
		.selectFrom(webauthnChallenges)
		.where(kitEq(webauthnChallenges.challenge_hash, hash))
		.executeSync();
	if (rows.length === 0) return { ok: false, userId: null };
	const row = rows[0];
	kit.deleteFrom(webauthnChallenges).where(kitEq(webauthnChallenges.id, row.id)).executeSync();
	if (row.purpose !== purpose) return { ok: false, userId: null };
	if (Date.now() > new Date(row.expires_at as string).getTime()) return { ok: false, userId: null };
	return { ok: true, userId: row.user_id != null ? Number(row.user_id) : null };
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
				const r = consumeChallenge(challenge, 'register');
				return r.ok && r.userId === userId;
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
			expectedChallenge: (challenge) => consumeChallenge(challenge, 'auth').ok,
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
	// Passkey login is a primary credential; a disabled user must not slip past the
	// "disabled users cannot authenticate" invariant via this path.
	const user = getUserById(userId);
	if (!user || user.disabled) return { ok: false, error: 'Account is disabled' };
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
	const rows = kit
		.updateTable(passkeys)
		.set({ name })
		.where(kitAnd(kitEq(passkeys.id, BigInt(id)), kitEq(passkeys.user_id, BigInt(userId))))
		.executeSync();
	return rows.length > 0;
}

export function deletePasskey(userId: number, id: number): boolean {
	const where = kitAnd(kitEq(passkeys.id, BigInt(id)), kitEq(passkeys.user_id, BigInt(userId)));
	const rows = kit.selectFrom(passkeys).where(where).executeSync();
	if (rows.length === 0) return false;
	const n = kit.deleteFrom(passkeys).where(where).executeSync();
	if (n > 0n) logAudit(userId, 'passkey_delete', 'user', userId, {});
	return n > 0n;
}
