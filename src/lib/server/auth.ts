import { hash, verify } from '@node-rs/argon2';
import { randomBytes, createHash } from 'node:crypto';
import { and, eq, lt, ne } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { error } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { db } from './db';
import { users, sessions } from './db/schema';

const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1 };
const th = (t: string) => createHash('sha256').update(t).digest('hex');

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
	db.insert(sessions)
		.values({ tokenHash: th(token), userId, expiresAt, lastIp: ip ?? null, userAgent: userAgent ?? null })
		.run();
	return token;
}

export async function validateSession(token?: string) {
	if (!token) return null;
	const s = db.select().from(sessions).where(eq(sessions.tokenHash, th(token))).get();
	if (!s || s.expiresAt < DateTime.utc().toISO()!) return null;
	const u = db.select().from(users).where(eq(users.id, s.userId)).get();
	if (!u || u.disabled) return null;
	return u;
}

export function updateSessionMetadata(token: string, ip?: string, userAgent?: string) {
	if (!ip && !userAgent) return;
	db.update(sessions)
		.set({ lastIp: ip ?? null, userAgent: userAgent ?? null })
		.where(eq(sessions.tokenHash, th(token)))
		.run();
}

export function invalidateSession(token: string) {
	db.delete(sessions).where(eq(sessions.tokenHash, th(token))).run();
}

export function invalidateAllSessions(userId: number) {
	db.delete(sessions).where(eq(sessions.userId, userId)).run();
}

export function invalidateOtherSessions(userId: number, token: string) {
	db.delete(sessions)
		.where(and(eq(sessions.userId, userId), ne(sessions.tokenHash, th(token))))
		.run();
}

export function purgeExpiredSessions() {
	db.delete(sessions).where(lt(sessions.expiresAt, DateTime.utc().toISO()!)).run();
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
