import { hash, verify } from '@node-rs/argon2';
import { randomBytes, createHash } from 'node:crypto';
import { eq as drizzleEq, and as drizzleAnd, ne as drizzleNe, lt as drizzleLt } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { error } from '@sveltejs/kit';
import { dev } from '$app/environment';
import * as usersRepo from './repositories/usersRepo';
import type { KitUser } from './repositories/usersRepo';
import { db } from './db';
import { users, sessions as drizzleSessions } from './db/schema';
import { nowIso } from './tz';

const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1 };
const th = (t: string) => createHash('sha256').update(t).digest('hex');

function toAppUser(u: KitUser): typeof users.$inferSelect {
	return {
		id: Number(u.id),
		email: u.email,
		passwordHash: u.password_hash,
		displayName: u.display_name,
		role: u.role as 'admin' | 'user',
		disabled: u.disabled,
		mustResetPassword: u.must_reset_password,
		timezone: u.timezone,
		flightCheckinLeadHours: Number(u.flight_checkin_lead_hours),
		documentExpiryLeadDays: Number(u.document_expiry_lead_days),
		emailNotifications: u.email_notifications,
		webhookNotifications: u.webhook_notifications,
		themeId: u.theme_id,
		defaultCurrency: u.default_currency,
		calendarToken: u.calendar_token,
		calendarTokenExpiresAt: u.calendar_token_expires_at,
		createdAt: u.created_at
	};
}

export async function hashPassword(pw: string) {
	if (pw.length < 8 || Buffer.byteLength(pw) > 1024)
		throw new Error('password must be 8–1024 bytes');
	return hash(pw, ARGON);
}

export async function verifyPassword(h: string, pw: string) {
	return verify(h, pw, ARGON).catch(() => false);
}

export function createSession(userId: number, ip?: string, userAgent?: string) {
	const token = randomBytes(32).toString('base64url');
	const expiresAt = DateTime.utc().plus({ days: 30 }).toISO()!;
	const tokenHash = th(token);
	usersRepo.createSession({
		token_hash: tokenHash,
		user_id: BigInt(userId),
		expires_at: expiresAt,
		last_ip: ip ?? null,
		user_agent: userAgent ?? null
	});
	// Keep legacy Drizzle sessions in sync during transition.
	db.insert(drizzleSessions)
		.values({ tokenHash, userId, expiresAt, lastIp: ip ?? null, userAgent: userAgent ?? null })
		.run();
	return token;
}

export function validateSession(token?: string) {
	if (!token) return null;
	const s = usersRepo.getSessionByTokenHash(th(token));
	if (!s || s.expires_at < nowIso()) return null;
	const u = usersRepo.getUserById(Number(s.user_id));
	if (!u || u.disabled) return null;
	return toAppUser(u);
}

export function updateSessionMetadata(token: string, ip?: string, userAgent?: string) {
	if (!ip && !userAgent) return;
	const tokenHash = th(token);
	usersRepo.updateSessionByTokenHash(tokenHash, {
		last_ip: ip ?? null,
		user_agent: userAgent ?? null
	});
	db.update(drizzleSessions)
		.set({ lastIp: ip ?? null, userAgent: userAgent ?? null })
		.where(drizzleEq(drizzleSessions.tokenHash, tokenHash))
		.run();
}

export function invalidateSession(token: string) {
	const tokenHash = th(token);
	usersRepo.deleteSessionByTokenHash(tokenHash);
	db.delete(drizzleSessions).where(drizzleEq(drizzleSessions.tokenHash, tokenHash)).run();
}

export function invalidateAllSessions(userId: number) {
	usersRepo.deleteSessionsByUserId(userId);
	db.delete(drizzleSessions).where(drizzleEq(drizzleSessions.userId, userId)).run();
}

export function invalidateOtherSessions(userId: number, token: string) {
	const tokenHash = th(token);
	usersRepo.deleteSessionsByUserIdExceptTokenHash(userId, tokenHash);
	db.delete(drizzleSessions)
		.where(
			drizzleAnd(
				drizzleEq(drizzleSessions.userId, userId),
				drizzleNe(drizzleSessions.tokenHash, tokenHash)
			)
		)
		.run();
}

export function purgeExpiredSessions() {
	const now = nowIso();
	usersRepo.deleteExpiredSessions(now);
	db.delete(drizzleSessions).where(drizzleLt(drizzleSessions.expiresAt, now)).run();
}

export function requireUser(locals: App.Locals) {
	if (!locals.user) throw error(401, 'Not signed in');
	return locals.user;
}

export function requireAdmin(locals: App.Locals) {
	const u = requireUser(locals);
	if (u.role !== 'admin') throw error(403, 'Admin only');
	return u;
}

/**
 * Session cookie attributes. `secure` follows the deployment's real transport:
 * never set in dev; in production set unless ORIGIN is explicitly `http://` (e.g. the
 * documented local-trial quickstart). A blanket `secure: true` would make the cookie
 * unsendable over HTTP, silently breaking login behind any non-TLS origin.
 */
export function sessionCookieOptions() {
	const origin = process.env.ORIGIN;
	const secure = dev ? false : !(origin && origin.startsWith('http://'));
	return {
		path: '/',
		httpOnly: true,
		secure,
		sameSite: 'lax' as const,
		maxAge: 60 * 60 * 24 * 30
	};
}
