import nodemailer from 'nodemailer';
import { eq as kitEq } from '@visorcraft/mongreldb-kit';
import { kit } from './db';
import { userSmtpOverrides } from './db/mongrelSchema';
import { getSettings } from './repositories/settingsRepo';
import { decrypt, encrypt } from './crypto';
import { nowIso } from './tz';
import type { Transporter } from 'nodemailer';
import type { Row } from '@visorcraft/mongreldb-kit';

export type SmtpSecurity = 'none' | 'starttls' | 'ssl/tls';

export const DEFAULT_SMTP_SECURITY: SmtpSecurity = 'starttls';

export interface SmtpTransportConfig {
	host: string;
	port: number;
	security: SmtpSecurity;
	user: string | null;
	pass: string | null;
	from: string;
}

export interface ResolvedTransport {
	transport: Transporter;
	from: string;
	source: 'user' | 'admin';
}

export function parseSmtpSecurity(value: string | null | undefined): SmtpSecurity {
	if (value === 'none' || value === 'starttls' || value === 'ssl/tls') return value;
	return DEFAULT_SMTP_SECURITY;
}

/**
 * SMTP socket timeouts. Without these, a blackholed or slow SMTP server leaves
 * Nodemailer waiting on the socket indefinitely, which (because sends are
 * awaited inside scheduler ticks) can freeze all scheduled work until the
 * process is restarted. Keep the send deadline in `notify.ts` slightly above
 * `SMTP_SOCKET_TIMEOUT_MS`.
 */
export const SMTP_CONNECTION_TIMEOUT_MS = 15_000;
export const SMTP_GREETING_TIMEOUT_MS = 15_000;
export const SMTP_SOCKET_TIMEOUT_MS = 20_000;

/**
 * Build the raw Nodemailer transport options. Exported (and pure) so the
 * timeout/security mapping can be unit-tested without opening a socket.
 */
export function buildSmtpOptions(config: SmtpTransportConfig) {
	const security = parseSmtpSecurity(config.security);
	return {
		host: config.host,
		port: config.port,
		secure: security === 'ssl/tls',
		requireTLS: security === 'starttls',
		// `none` must mean plaintext: without ignoreTLS, Nodemailer still attempts
		// opportunistic STARTTLS, which fails against servers with broken certs.
		ignoreTLS: security === 'none',
		auth: config.user ? { user: config.user, pass: config.pass ?? '' } : undefined,
		connectionTimeout: SMTP_CONNECTION_TIMEOUT_MS,
		greetingTimeout: SMTP_GREETING_TIMEOUT_MS,
		socketTimeout: SMTP_SOCKET_TIMEOUT_MS
	};
}

/**
 * Map the transport-security selector to Nodemailer's `secure`/`requireTLS`
 * flags. `ssl/tls` uses implicit TLS (port 465); `starttls` upgrades via
 * STARTTLS (port 587); `none` sends plaintext (port 25 typically).
 */
export function buildTransport(config: SmtpTransportConfig): Transporter {
	return nodemailer.createTransport(buildSmtpOptions(config));
}

export interface UserSmtpOverride {
	userId: number;
	enabled: boolean;
	host: string | null;
	port: number | null;
	security: SmtpSecurity;
	username: string | null;
	passwordSet: boolean;
	fromAddress: string | null;
	updatedAt: string;
}

function toOverrideRow(row: Row<typeof userSmtpOverrides>): UserSmtpOverride {
	return {
		userId: Number(row.user_id),
		enabled: Boolean(row.enabled),
		host: row.host || null,
		port: row.port == null || row.port === 0n ? null : Number(row.port),
		security: parseSmtpSecurity(row.security as string | null),
		username: row.username || null,
		passwordSet: Boolean(row.password),
		fromAddress: row.from_address || null,
		updatedAt: row.updated_at
	};
}

export function getUserSmtpOverride(userId: number): UserSmtpOverride | null {
	const row = kit
		.selectFrom(userSmtpOverrides)
		.where(kitEq(userSmtpOverrides.user_id, BigInt(userId)))
		.executeSync()[0];
	return row ? toOverrideRow(row) : null;
}

export interface UserSmtpPatch {
	enabled?: boolean;
	host?: string | null;
	port?: number | null;
	security?: SmtpSecurity;
	username?: string | null;
	password?: string | null;
	fromAddress?: string | null;
}

export function upsertUserSmtpOverride(userId: number, patch: UserSmtpPatch): UserSmtpOverride {
	const existing = kit
		.selectFrom(userSmtpOverrides)
		.where(kitEq(userSmtpOverrides.user_id, BigInt(userId)))
		.executeSync()[0];

	// undefined = leave unchanged; null/'' = clear; non-empty string = (re)encrypt.
	const encryptedPass =
		patch.password === undefined ? undefined : patch.password ? encrypt(patch.password) : null;

	if (existing) {
		const updates: Record<string, unknown> = { updated_at: nowIso() };
		if (patch.enabled !== undefined) updates.enabled = patch.enabled;
		if (patch.host !== undefined) updates.host = patch.host || null;
		if (patch.port !== undefined) updates.port = patch.port == null ? null : BigInt(patch.port);
		if (patch.security !== undefined) updates.security = patch.security;
		if (patch.username !== undefined) updates.username = patch.username || null;
		if (patch.fromAddress !== undefined) updates.from_address = patch.fromAddress || null;
		if (encryptedPass !== undefined) updates.password = encryptedPass;
		kit
			.updateTable(userSmtpOverrides)
			.set(updates)
			.where(kitEq(userSmtpOverrides.user_id, BigInt(userId)))
			.executeSync();
	} else {
		kit.insertInto(userSmtpOverrides).values({
			user_id: BigInt(userId),
			enabled: patch.enabled ?? false,
			host: patch.host || null,
			port: patch.port == null ? null : BigInt(patch.port),
			security: patch.security ?? DEFAULT_SMTP_SECURITY,
			username: patch.username || null,
			password: encryptedPass ?? null,
			from_address: patch.fromAddress || null,
			updated_at: nowIso()
		} as any).executeSync();
	}
	return getUserSmtpOverride(userId)!;
}

export function deleteUserSmtpOverride(userId: number): boolean {
	const n = kit
		.deleteFrom(userSmtpOverrides)
		.where(kitEq(userSmtpOverrides.user_id, BigInt(userId)))
		.executeSync();
	return n > 0n;
}

/**
 * A user override is "complete" (usable) when enabled, and has at minimum a
 * host and from address. Credentials are optional (some relay hosts don't
 * need auth).
 */
function overrideIsComplete(o: UserSmtpOverride): boolean {
	return o.enabled && !!o.host && !!o.fromAddress;
}

/**
 * Resolve the SMTP transport for a user. Prefers the user's enabled+complete
 * override, then falls back to the admin settings. Returns null when neither
 * is configured (caller should skip SMTP).
 */
export function resolveSmtpTransport(userId?: number): ResolvedTransport | null {
	if (userId != null) {
		const override = getUserSmtpOverride(userId);
		if (override && overrideIsComplete(override)) {
			const pass = getOverridePassword(userId);
			return {
				transport: buildTransport({
					host: override.host!,
					port: override.port ?? 587,
					security: override.security,
					user: override.username,
					pass,
					from: override.fromAddress!
				}),
				from: override.fromAddress!,
				source: 'user'
			};
		}
	}

	const s = getSettings();
	if (!s.smtpHost || !s.smtpFrom) return null;
	return {
		transport: buildTransport({
			host: s.smtpHost,
			port: s.smtpPort ?? 587,
			security: parseSmtpSecurity(s.smtpSecurity),
			user: s.smtpUser,
			pass: s.smtpPass ? decrypt(s.smtpPass) : null,
			from: s.smtpFrom
		}),
		from: s.smtpFrom,
		source: 'admin'
	};
}

function getOverridePassword(userId: number): string | null {
	const row = kit
		.selectFrom(userSmtpOverrides)
		.where(kitEq(userSmtpOverrides.user_id, BigInt(userId)))
		.executeSync()[0];
	if (!row || !row.password) return null;
	return decrypt(row.password as string);
}
