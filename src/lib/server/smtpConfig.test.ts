import { describe, test, expect, beforeEach, vi } from 'vitest';
import type { KitDatabase } from '@visorcraft/mongreldb-kit';

const ctx = vi.hoisted(() => ({ kit: null as unknown as KitDatabase }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { userSmtpOverrides, settings } from './db/mongrelSchema';
import { kit } from './db';
import {
	parseSmtpSecurity,
	buildTransport,
	buildSmtpOptions,
	SMTP_CONNECTION_TIMEOUT_MS,
	SMTP_GREETING_TIMEOUT_MS,
	SMTP_SOCKET_TIMEOUT_MS,
	getUserSmtpOverride,
	upsertUserSmtpOverride,
	deleteUserSmtpOverride,
	resolveSmtpTransport
} from './smtpConfig';
import { makeUser } from '../../../tests/helpers';

function seedSettings(patch: Record<string, unknown> = {}) {
	ctx.kit.deleteFrom(settings).executeSync();
	ctx.kit
		.insertInto(settings)
		.values({
			id: 1n,
			smtp_host: patch.smtp_host ?? null,
			smtp_port: patch.smtp_port ?? null,
			smtp_security: patch.smtp_security ?? null,
			smtp_user: patch.smtp_user ?? null,
			smtp_pass: patch.smtp_pass ?? null,
			smtp_from: patch.smtp_from ?? null,
			webhook_url: null,
			maps_geonames_imported_at: null,
			maps_tile_url: null,
			maps_tile_attribution: null,
			maps_tile_api_key: null
		} as any)
		.executeSync();
}

describe('smtpConfig', () => {
	let userId: number;

	beforeEach(() => {
		ctx.kit.deleteFrom(userSmtpOverrides).executeSync();
		seedSettings();
		const u = makeUser(ctx.kit);
		userId = u.id;
	});

	describe('parseSmtpSecurity', () => {
		test('accepts known values', () => {
			expect(parseSmtpSecurity('none')).toBe('none');
			expect(parseSmtpSecurity('starttls')).toBe('starttls');
			expect(parseSmtpSecurity('ssl/tls')).toBe('ssl/tls');
		});
		test('defaults to starttls for unknown/null', () => {
			expect(parseSmtpSecurity(null)).toBe('starttls');
			expect(parseSmtpSecurity('garbage')).toBe('starttls');
			expect(parseSmtpSecurity(undefined)).toBe('starttls');
		});
	});

	describe('buildTransport', () => {
		test('ssl/tls sets secure=true', () => {
			const t = buildTransport({
				host: 'smtp.example.com',
				port: 465,
				security: 'ssl/tls',
				user: null,
				pass: null,
				from: 'a@b.com'
			});
			const opts = t.options as Record<string, unknown>;
			expect(opts.secure).toBe(true);
			expect(opts.requireTLS).toBe(false);
		});
		test('starttls sets requireTLS=true', () => {
			const t = buildTransport({
				host: 'smtp.example.com',
				port: 587,
				security: 'starttls',
				user: null,
				pass: null,
				from: 'a@b.com'
			});
			const opts = t.options as Record<string, unknown>;
			expect(opts.secure).toBe(false);
			expect(opts.requireTLS).toBe(true);
		});
		test('none leaves both false', () => {
			const t = buildTransport({
				host: 'smtp.example.com',
				port: 25,
				security: 'none',
				user: null,
				pass: null,
				from: 'a@b.com'
			});
			const opts = t.options as Record<string, unknown>;
			expect(opts.secure).toBe(false);
			expect(opts.requireTLS).toBe(false);
		});
	});

	test('mocked kit is the same as ctx.kit', () => {
		expect(kit).toBe(ctx.kit);
	});

	describe('user override CRUD', () => {
		test('upsert creates and updates; password is masked', () => {
			expect(getUserSmtpOverride(userId)).toBeNull();
			const created = upsertUserSmtpOverride(userId, {
				enabled: true,
				host: 'smtp.user.com',
				port: 587,
				security: 'starttls',
				username: 'user@example.com',
				password: 'secret123',
				fromAddress: 'me@example.com'
			});
			expect(created.enabled).toBe(true);
			expect(created.host).toBe('smtp.user.com');
			expect(created.passwordSet).toBe(true);
			const fetched = getUserSmtpOverride(userId);
			expect(fetched).not.toBeNull();
			expect(fetched!.security).toBe('starttls');

			const updated = upsertUserSmtpOverride(userId, { host: 'smtp.new.com' });
			expect(updated.host).toBe('smtp.new.com');
			expect(updated.passwordSet).toBe(true); // password retained across non-password patches
		});
		test('delete removes the override', () => {
			upsertUserSmtpOverride(userId, { enabled: false });
			expect(deleteUserSmtpOverride(userId)).toBe(true);
			expect(deleteUserSmtpOverride(userId)).toBe(false);
			expect(getUserSmtpOverride(userId)).toBeNull();
		});
	});

	describe('resolveSmtpTransport', () => {
		test('returns null when neither admin nor override configured', () => {
			expect(resolveSmtpTransport(userId)).toBeNull();
			expect(resolveSmtpTransport()).toBeNull();
		});
		test('falls back to admin when no override', () => {
			seedSettings({
				smtp_host: 'smtp.admin.com',
				smtp_port: 587n,
				smtp_security: 'starttls',
				smtp_from: 'admin@roamarr.app'
			});
			const r = resolveSmtpTransport(userId);
			expect(r).not.toBeNull();
			expect(r!.source).toBe('admin');
			expect(r!.from).toBe('admin@roamarr.app');
		});
		test('user override wins over admin when enabled+complete', () => {
			seedSettings({
				smtp_host: 'smtp.admin.com',
				smtp_port: 587n,
				smtp_from: 'admin@roamarr.app'
			});
			upsertUserSmtpOverride(userId, {
				enabled: true,
				host: 'smtp.user.com',
				port: 465,
				security: 'ssl/tls',
				username: 'u',
				password: 'p',
				fromAddress: 'me@user.com'
			});
			const r = resolveSmtpTransport(userId);
			expect(r!.source).toBe('user');
			expect(r!.from).toBe('me@user.com');
		});
		test('disabled override falls back to admin', () => {
			seedSettings({
				smtp_host: 'smtp.admin.com',
				smtp_from: 'admin@roamarr.app'
			});
			upsertUserSmtpOverride(userId, {
				enabled: false,
				host: 'smtp.user.com',
				fromAddress: 'me@user.com'
			});
			const r = resolveSmtpTransport(userId);
			expect(r!.source).toBe('admin');
		});
		test('incomplete override (missing from) falls back to admin', () => {
			seedSettings({
				smtp_host: 'smtp.admin.com',
				smtp_from: 'admin@roamarr.app'
			});
			upsertUserSmtpOverride(userId, {
				enabled: true,
				host: 'smtp.user.com',
				fromAddress: null
			});
			expect(resolveSmtpTransport(userId)!.source).toBe('admin');
		});
	});
});

describe('buildSmtpOptions timeouts', () => {
	const base = {
		host: 'smtp.example.com',
		port: 587,
		security: 'starttls' as const,
		user: null,
		pass: null,
		from: 'a@b.com'
	};
	test('sets connection, greeting and socket timeouts', () => {
		const opts = buildSmtpOptions(base) as Record<string, unknown>;
		expect(opts.connectionTimeout).toBe(SMTP_CONNECTION_TIMEOUT_MS);
		expect(opts.greetingTimeout).toBe(SMTP_GREETING_TIMEOUT_MS);
		expect(opts.socketTimeout).toBe(SMTP_SOCKET_TIMEOUT_MS);
	});
	test('timeouts reach the nodemailer transport options', () => {
		const opts = buildTransport(base).options as Record<string, unknown>;
		expect(opts.connectionTimeout).toBe(SMTP_CONNECTION_TIMEOUT_MS);
		expect(opts.greetingTimeout).toBe(SMTP_GREETING_TIMEOUT_MS);
		expect(opts.socketTimeout).toBe(SMTP_SOCKET_TIMEOUT_MS);
	});
});
