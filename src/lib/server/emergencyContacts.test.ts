import { test, expect, vi, beforeEach } from 'vitest';

const ctx = vi.hoisted(() => ({
	kit: null as unknown as import('@visorcraft/mongreldb-kit').KitDatabase
}));
const sent = vi.hoisted(() => [] as Array<Record<string, unknown>>);
vi.mock('./db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});
vi.mock('nodemailer', () => ({
	default: {
		createTransport: () => ({ sendMail: async (m: Record<string, unknown>) => sent.push(m) })
	}
}));

import {
	listEmergencyContacts,
	addEmergencyContact,
	updateEmergencyContact,
	deleteEmergencyContact,
	shareItineraryWithContact,
	checkShareRateLimit,
	pruneExpiredShareWindow,
	shareRateLimitSize,
	resetEmergencyShareRateLimit,
	MAX_SHARE_WINDOW_ENTRIES
} from './emergencyContacts';
import { emergencyContacts, trips, users, auditLogs, tripShares } from './db/mongrelSchema';
import { eq } from '@visorcraft/mongreldb-kit';
import { updateSettings } from './settings';
import { createTrip } from './repositories/tripsRepo';
import { makeKitUser } from '../../../tests/kitHelpers';
import { makeShare } from '../../../tests/helpers';

beforeEach(() => {
	ctx.kit.deleteFrom(tripShares).executeSync();
	ctx.kit.deleteFrom(auditLogs).executeSync();
	ctx.kit.deleteFrom(emergencyContacts).executeSync();
	ctx.kit.deleteFrom(trips).executeSync();
	ctx.kit.deleteFrom(users).executeSync();
});

test('addEmergencyContact creates a contact and audits', () => {
	const kit = ctx.kit;
	const u = makeKitUser({ email: 'ec@x.c' });

	const c = addEmergencyContact(Number(u.id), {
		name: 'Jordan Doe',
		relationship: 'spouse',
		phone: '+1-555-0100',
		email: 'jordan@x.c',
		isPrimary: true
	});

	expect(c.name).toBe('Jordan Doe');
	expect(c.relationship).toBe('spouse');
	expect(c.phone).toBe('+1-555-0100');
	expect(c.email).toBe('jordan@x.c');
	expect(c.isPrimary).toBe(true);

	const logs = kit.selectFrom(auditLogs).where(eq(auditLogs.user_id, BigInt(u.id))).executeSync();
	expect(logs).toHaveLength(1);
	expect(logs[0].action).toBe('emergency_contact_create');
	expect(logs[0].entity_type).toBe('emergency_contact');
});

test('addEmergencyContact enforces single primary contact', () => {
	const kit = ctx.kit;
	const u = makeKitUser({ email: 'ec2@x.c' });

	const first = addEmergencyContact(Number(u.id), { name: 'A', isPrimary: true });
	const second = addEmergencyContact(Number(u.id), { name: 'B', isPrimary: true });

	expect(
		kit
			.selectFrom(emergencyContacts)
			.where(eq(emergencyContacts.id, BigInt(first.id)))
			.executeSync()[0]!.is_primary
	).toBe(false);
	expect(second.isPrimary).toBe(true);
});

test('addEmergencyContact rejects empty name', () => {
	const u = makeKitUser({ email: 'ec3@x.c' });

	expect(() => addEmergencyContact(Number(u.id), { name: '   ' })).toThrow(
		expect.objectContaining({ status: 400, body: { message: 'Name is required' } })
	);
});

test('listEmergencyContacts orders primary first then by name', () => {
	const u = makeKitUser({ email: 'ec4@x.c' });

	addEmergencyContact(Number(u.id), { name: 'Zoe', isPrimary: false });
	addEmergencyContact(Number(u.id), { name: 'Aaron', isPrimary: true });
	addEmergencyContact(Number(u.id), { name: 'Maya', isPrimary: false });

	const list = listEmergencyContacts(Number(u.id));
	expect(list.map((c) => c.name)).toEqual(['Aaron', 'Maya', 'Zoe']);
	expect(list[0].isPrimary).toBe(true);
});

test('updateEmergencyContact edits a contact and shifts primary status', () => {
	const kit = ctx.kit;
	const u = makeKitUser({ email: 'ec5@x.c' });

	const a = addEmergencyContact(Number(u.id), { name: 'A', isPrimary: true });
	const b = addEmergencyContact(Number(u.id), { name: 'B', isPrimary: false });

	updateEmergencyContact(Number(u.id), b.id, { name: 'B-updated', isPrimary: true });

	const updatedA = kit
		.selectFrom(emergencyContacts)
		.where(eq(emergencyContacts.id, BigInt(a.id)))
		.executeSync()[0]!;
	const updatedB = kit
		.selectFrom(emergencyContacts)
		.where(eq(emergencyContacts.id, BigInt(b.id)))
		.executeSync()[0]!;
	expect(updatedA.is_primary).toBe(false);
	expect(updatedB.is_primary).toBe(true);
	expect(updatedB.name).toBe('B-updated');

	const logs = kit.selectFrom(auditLogs).where(eq(auditLogs.user_id, BigInt(u.id))).executeSync();
	expect(logs.some((l) => l.action === 'emergency_contact_update')).toBe(true);
});

test('updateEmergencyContact is user-scoped', () => {
	const a = makeKitUser({ email: 'ec6-a@x.c' });
	const b = makeKitUser({ email: 'ec6-b@x.c' });

	const c = addEmergencyContact(Number(a.id), { name: 'A-contact', isPrimary: true });
	try {
		updateEmergencyContact(Number(b.id), c.id, { name: 'Hacked' });
		expect.unreachable('expected ownership error');
	} catch (e: any) {
		expect(e.status).toBe(404);
		expect(e.body?.message).toBe('Not found');
	}
});

test('deleteEmergencyContact removes only the owned contact', () => {
	const kit = ctx.kit;
	const a = makeKitUser({ email: 'ec7-a@x.c' });
	const b = makeKitUser({ email: 'ec7-b@x.c' });

	const c = addEmergencyContact(Number(a.id), { name: 'A-contact' });
	addEmergencyContact(Number(b.id), { name: 'B-contact' });

	deleteEmergencyContact(Number(a.id), c.id);

	const remainingA = kit
		.selectFrom(emergencyContacts)
		.where(eq(emergencyContacts.user_id, BigInt(a.id)))
		.executeSync();
	const remainingB = kit
		.selectFrom(emergencyContacts)
		.where(eq(emergencyContacts.user_id, BigInt(b.id)))
		.executeSync();
	expect(remainingA).toHaveLength(0);
	expect(remainingB).toHaveLength(1);
	expect(remainingB[0].name).toBe('B-contact');
});

test('shareItineraryWithContact sends link and audits', async () => {
	resetEmergencyShareRateLimit();
	sent.length = 0;
	const kit = ctx.kit;
	const u = makeKitUser({ email: 'ec-share@x.c' });
	updateSettings({ smtpHost: 'smtp.x', smtpPort: 587, smtpFrom: 'roamarr@x.c' });
	const contact = addEmergencyContact(Number(u.id), { name: 'Emergency', email: 'em@x.c' });
	const trip = createTrip(Number(u.id), { name: 'Tokyo Trip' });

	const result = await shareItineraryWithContact(
		Number(u.id),
		trip.id,
		contact.id,
		'https://roamarr.test'
	);

	expect(result.link).toMatch(/^https:\/\/roamarr\.test\/share\/[A-Za-z0-9_-]+$/);
	expect(result.sent).toBe(true);
	expect(sent.length).toBe(1);
	expect(sent[0].to).toBe('em@x.c');
	expect(sent[0].subject).toBe('Itinerary shared: Tokyo Trip');
	expect(String(sent[0].text)).toContain('Tokyo Trip');
	expect(String(sent[0].text)).toContain(result.link);

	const updated = kit.selectFrom(trips).where(eq(trips.id, BigInt(trip.id))).executeSync()[0]!;
	expect(updated.public_token).toBeTruthy();

	const logs = kit.selectFrom(auditLogs).where(eq(auditLogs.user_id, BigInt(u.id))).executeSync();
	expect(
		logs.some(
			(l) => l.action === 'emergency_share' && l.entity_type === 'trip' && Number(l.entity_id) === trip.id
		)
	).toBe(true);
});

test('shareItineraryWithContact reuses existing public token', async () => {
	resetEmergencyShareRateLimit();
	sent.length = 0;
	const u = makeKitUser({ email: 'ec-reuse@x.c' });
	updateSettings({ smtpHost: 'smtp.x', smtpPort: 587, smtpFrom: 'roamarr@x.c' });
	const contact = addEmergencyContact(Number(u.id), { name: 'Emergency', email: 'em@x.c' });
	const trip = createTrip(Number(u.id), { name: 'Paris Trip', publicToken: 'existing-token' });

	const result = await shareItineraryWithContact(
		Number(u.id),
		trip.id,
		contact.id,
		'https://roamarr.test'
	);

	expect(result.link).toBe('https://roamarr.test/share/existing-token');
	expect(sent.length).toBe(1);
});

test('shareItineraryWithContact enforces contact ownership', async () => {
	resetEmergencyShareRateLimit();
	const a = makeKitUser({ email: 'ec-own-a@x.c' });
	const b = makeKitUser({ email: 'ec-own-b@x.c' });
	const contact = addEmergencyContact(Number(a.id), { name: 'A-contact', email: 'a@x.c' });
	const trip = createTrip(Number(b.id), { name: 'B Trip' });

	try {
		await shareItineraryWithContact(Number(a.id), trip.id, contact.id, 'https://roamarr.test');
		expect.unreachable('expected ownership error');
	} catch (e: any) {
		expect(e.status).toBe(404);
	}
});

test('shareItineraryWithContact enforces trip ownership', async () => {
	resetEmergencyShareRateLimit();
	const owner = makeKitUser({ email: 'ec-trip-owner@x.c' });
	const other = makeKitUser({ email: 'ec-trip-other@x.c' });
	const contact = addEmergencyContact(Number(other.id), { name: 'Contact', email: 'c@x.c' });
	const trip = createTrip(Number(owner.id), { name: 'Private Trip' });

	try {
		await shareItineraryWithContact(Number(other.id), trip.id, contact.id, 'https://roamarr.test');
		expect.unreachable('expected trip permission error');
	} catch (e: any) {
		expect(e.status).toBe(404);
	}
});

test('shareItineraryWithContact rejects non-owner editors', async () => {
	resetEmergencyShareRateLimit();
	const kit = ctx.kit;
	const owner = makeKitUser({ email: 'ec-editor-owner@x.c' });
	const editor = makeKitUser({ email: 'ec-editor@x.c' });
	const contact = addEmergencyContact(Number(editor.id), { name: 'Contact', email: 'c@x.c' });
	const trip = createTrip(Number(owner.id), { name: 'Shared Trip' });
	makeShare(kit, { tripId: trip.id, sharedWithUserId: Number(editor.id), permission: 'edit' });

	try {
		await shareItineraryWithContact(Number(editor.id), trip.id, contact.id, 'https://roamarr.test');
		expect.unreachable('expected owner-only error');
	} catch (e: any) {
		expect(e.status).toBe(404);
	}
});

test('shareItineraryWithContact rejects contact without email', async () => {
	resetEmergencyShareRateLimit();
	const u = makeKitUser({ email: 'ec-noemail@x.c' });
	const contact = addEmergencyContact(Number(u.id), { name: 'No Email' });
	const trip = createTrip(Number(u.id), { name: 'Trip' });

	try {
		await shareItineraryWithContact(Number(u.id), trip.id, contact.id, 'https://roamarr.test');
		expect.unreachable('expected email required error');
	} catch (e: any) {
		expect(e.status).toBe(400);
	}
});

test('shareItineraryWithContact rate limits repeat shares', async () => {
	resetEmergencyShareRateLimit();
	sent.length = 0;
	const u = makeKitUser({ email: 'ec-rate@x.c' });
	updateSettings({ smtpHost: 'smtp.x', smtpPort: 587, smtpFrom: 'roamarr@x.c' });
	const contact = addEmergencyContact(Number(u.id), { name: 'Emergency', email: 'em@x.c' });
	const trip = createTrip(Number(u.id), { name: 'Rated Trip' });

	await shareItineraryWithContact(Number(u.id), trip.id, contact.id, 'https://roamarr.test');
	await shareItineraryWithContact(Number(u.id), trip.id, contact.id, 'https://roamarr.test');
	await shareItineraryWithContact(Number(u.id), trip.id, contact.id, 'https://roamarr.test');
	expect(sent.length).toBe(3);

	try {
		await shareItineraryWithContact(Number(u.id), trip.id, contact.id, 'https://roamarr.test');
		expect.unreachable('expected rate limit error');
	} catch (e: any) {
		expect(e.status).toBe(429);
	}
	expect(sent.length).toBe(3);
});

test('pruneExpiredShareWindow removes only expired buckets and reports the count', () => {
	resetEmergencyShareRateLimit();
	checkShareRateLimit(1, 1, 1);
	checkShareRateLimit(2, 2, 2);
	expect(shareRateLimitSize()).toBe(2);
	// Simulate the window elapsing by passing a future timestamp (no real waiting).
	expect(pruneExpiredShareWindow(Date.now() + 120_000)).toBe(2);
	expect(shareRateLimitSize()).toBe(0);
});

test('share rate-limit store is capped by evicting the nearest-expiry bucket when full', () => {
	resetEmergencyShareRateLimit();
	for (let i = 0; i < MAX_SHARE_WINDOW_ENTRIES; i++) {
		checkShareRateLimit(i, 1, 1);
	}
	expect(shareRateLimitSize()).toBe(MAX_SHARE_WINDOW_ENTRIES);
	expect(checkShareRateLimit(9_999_999, 9, 9)).toBe(true);
	expect(shareRateLimitSize()).toBeLessThanOrEqual(MAX_SHARE_WINDOW_ENTRIES);
});
