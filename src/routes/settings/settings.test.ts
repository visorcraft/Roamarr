import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { _saveAdminSettings as saveAdminSettings } from './+page.server';
import { settings } from '$lib/server/db/schema';
import { decrypt } from '$lib/server/crypto';
import { eq } from 'drizzle-orm';

test('saves settings, default leads and encrypts smtp pass', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	saveAdminSettings({
		instanceName: 'R',
		allowRegistration: true,
		defaultTimezone: 'UTC',
		defaultFlightCheckinLeadHours: 48,
		defaultDocumentExpiryLeadDays: 60,
		smtpHost: 'smtp.x',
		smtpPort: 587,
		smtpUser: 'u',
		smtpPass: 'pw',
		smtpFrom: 'r@x.c'
	});
	const s = db.select().from(settings).where(eq(settings.id, 1)).get()!;
	expect(s.allowRegistration).toBe(true);
	expect(s.defaultFlightCheckinLeadHours).toBe(48);
	expect(s.defaultDocumentExpiryLeadDays).toBe(60);
	expect(decrypt(s.smtpPass!)).toBe('pw');
});

test('rejects invalid default reminder leads', () => {
	expect(() =>
		saveAdminSettings({
			instanceName: 'R',
			allowRegistration: true,
			defaultTimezone: 'UTC',
			defaultFlightCheckinLeadHours: -1,
			defaultDocumentExpiryLeadDays: 90
		})
	).toThrow('Default flight check-in lead must be a non-negative integer');
	expect(() =>
		saveAdminSettings({
			instanceName: 'R',
			allowRegistration: true,
			defaultTimezone: 'UTC',
			defaultFlightCheckinLeadHours: 24,
			defaultDocumentExpiryLeadDays: 1.5
		})
	).toThrow('Default document expiry lead must be a non-negative integer');
});

test('omitting smtpPass preserves the existing encrypted value', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const before = db.select().from(settings).where(eq(settings.id, 1)).get()!.smtpPass;
	saveAdminSettings({
		instanceName: 'R2',
		allowRegistration: false,
		defaultTimezone: 'UTC',
		defaultFlightCheckinLeadHours: 24,
		defaultDocumentExpiryLeadDays: 90
	});
	const after = db.select().from(settings).where(eq(settings.id, 1)).get()!.smtpPass;
	expect(after).toBe(before);
});
