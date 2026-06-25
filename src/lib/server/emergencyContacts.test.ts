import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
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
	resetEmergencyShareRateLimit
} from './emergencyContacts';
import { emergencyContacts, users, auditLogs, trips, settings, tripShares } from './db/schema';
import { eq } from 'drizzle-orm';

test('addEmergencyContact creates a contact and audits', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = db
		.insert(users)
		.values({ email: 'ec@x.c', passwordHash: 'x', displayName: 'U' })
		.returning()
		.get();

	const c = addEmergencyContact(u.id, {
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

	const logs = db.select().from(auditLogs).where(eq(auditLogs.userId, u.id)).all();
	expect(logs).toHaveLength(1);
	expect(logs[0].action).toBe('emergency_contact_create');
	expect(logs[0].entityType).toBe('emergency_contact');
});

test('addEmergencyContact enforces single primary contact', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = db
		.insert(users)
		.values({ email: 'ec2@x.c', passwordHash: 'x', displayName: 'U' })
		.returning()
		.get();

	const first = addEmergencyContact(u.id, { name: 'A', isPrimary: true });
	const second = addEmergencyContact(u.id, { name: 'B', isPrimary: true });

	expect(db.select().from(emergencyContacts).where(eq(emergencyContacts.id, first.id)).get()!.isPrimary).toBe(false);
	expect(second.isPrimary).toBe(true);
});

test('addEmergencyContact rejects empty name', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = db
		.insert(users)
		.values({ email: 'ec3@x.c', passwordHash: 'x', displayName: 'U' })
		.returning()
		.get();

	expect(() => addEmergencyContact(u.id, { name: '   ' })).toThrow('Name is required');
});

test('listEmergencyContacts orders primary first then by name', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = db
		.insert(users)
		.values({ email: 'ec4@x.c', passwordHash: 'x', displayName: 'U' })
		.returning()
		.get();

	addEmergencyContact(u.id, { name: 'Zoe', isPrimary: false });
	addEmergencyContact(u.id, { name: 'Aaron', isPrimary: true });
	addEmergencyContact(u.id, { name: 'Maya', isPrimary: false });

	const list = listEmergencyContacts(u.id);
	expect(list.map((c) => c.name)).toEqual(['Aaron', 'Maya', 'Zoe']);
	expect(list[0].isPrimary).toBe(true);
});

test('updateEmergencyContact edits a contact and shifts primary status', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = db
		.insert(users)
		.values({ email: 'ec5@x.c', passwordHash: 'x', displayName: 'U' })
		.returning()
		.get();

	const a = addEmergencyContact(u.id, { name: 'A', isPrimary: true });
	const b = addEmergencyContact(u.id, { name: 'B', isPrimary: false });

	updateEmergencyContact(u.id, b.id, { name: 'B-updated', isPrimary: true });

	const updatedA = db.select().from(emergencyContacts).where(eq(emergencyContacts.id, a.id)).get()!;
	const updatedB = db.select().from(emergencyContacts).where(eq(emergencyContacts.id, b.id)).get()!;
	expect(updatedA.isPrimary).toBe(false);
	expect(updatedB.isPrimary).toBe(true);
	expect(updatedB.name).toBe('B-updated');

	const logs = db.select().from(auditLogs).where(eq(auditLogs.userId, u.id)).all();
	expect(logs.some((l) => l.action === 'emergency_contact_update')).toBe(true);
});

test('updateEmergencyContact is user-scoped', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const a = db
		.insert(users)
		.values({ email: 'ec6-a@x.c', passwordHash: 'x', displayName: 'A' })
		.returning()
		.get();
	const b = db
		.insert(users)
		.values({ email: 'ec6-b@x.c', passwordHash: 'x', displayName: 'B' })
		.returning()
		.get();

	const c = addEmergencyContact(a.id, { name: 'A-contact', isPrimary: true });
	try {
		updateEmergencyContact(b.id, c.id, { name: 'Hacked' });
		expect.unreachable('expected ownership error');
	} catch (e: any) {
		expect(e.status).toBe(404);
		expect(e.body?.message).toBe('Not found');
	}
});

test('deleteEmergencyContact removes only the owned contact', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const a = db
		.insert(users)
		.values({ email: 'ec7-a@x.c', passwordHash: 'x', displayName: 'A' })
		.returning()
		.get();
	const b = db
		.insert(users)
		.values({ email: 'ec7-b@x.c', passwordHash: 'x', displayName: 'B' })
		.returning()
		.get();

	const c = addEmergencyContact(a.id, { name: 'A-contact' });
	addEmergencyContact(b.id, { name: 'B-contact' });

	deleteEmergencyContact(a.id, c.id);

	const remainingA = db.select().from(emergencyContacts).where(eq(emergencyContacts.userId, a.id)).all();
	const remainingB = db.select().from(emergencyContacts).where(eq(emergencyContacts.userId, b.id)).all();
	expect(remainingA).toHaveLength(0);
	expect(remainingB).toHaveLength(1);
	expect(remainingB[0].name).toBe('B-contact');
});

test('shareItineraryWithContact sends link and audits', async () => {
	resetEmergencyShareRateLimit();
	sent.length = 0;
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = db
		.insert(users)
		.values({ email: 'ec-share@x.c', passwordHash: 'x', displayName: 'U' })
		.returning()
		.get();
	db.update(settings)
		.set({ smtpHost: 'smtp.x', smtpPort: 587, smtpFrom: 'roamarr@x.c' })
		.where(eq(settings.id, 1))
		.run();
	const contact = addEmergencyContact(u.id, { name: 'Emergency', email: 'em@x.c' });
	const trip = db
		.insert(trips)
		.values({ ownerId: u.id, name: 'Tokyo Trip', defaultVisibility: 'private' })
		.returning()
		.get();

	const result = await shareItineraryWithContact(u.id, trip.id, contact.id, 'https://roamarr.test');

	expect(result.link).toMatch(/^https:\/\/roamarr\.test\/share\/[A-Za-z0-9_-]+$/);
	expect(result.sent).toBe(true);
	expect(sent.length).toBe(1);
	expect(sent[0].to).toBe('em@x.c');
	expect(sent[0].subject).toBe('Itinerary shared: Tokyo Trip');
	expect(String(sent[0].text)).toContain('Tokyo Trip');
	expect(String(sent[0].text)).toContain(result.link);

	const updated = db.select().from(trips).where(eq(trips.id, trip.id)).get()!;
	expect(updated.publicToken).toBeTruthy();

	const logs = db.select().from(auditLogs).where(eq(auditLogs.userId, u.id)).all();
	expect(logs.some((l) => l.action === 'emergency_share' && l.entityType === 'trip' && l.entityId === trip.id)).toBe(true);
});

test('shareItineraryWithContact reuses existing public token', async () => {
	resetEmergencyShareRateLimit();
	sent.length = 0;
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = db
		.insert(users)
		.values({ email: 'ec-reuse@x.c', passwordHash: 'x', displayName: 'U' })
		.returning()
		.get();
	db.update(settings)
		.set({ smtpHost: 'smtp.x', smtpPort: 587, smtpFrom: 'roamarr@x.c' })
		.where(eq(settings.id, 1))
		.run();
	const contact = addEmergencyContact(u.id, { name: 'Emergency', email: 'em@x.c' });
	const trip = db
		.insert(trips)
		.values({ ownerId: u.id, name: 'Paris Trip', defaultVisibility: 'private', publicToken: 'existing-token' })
		.returning()
		.get();

	const result = await shareItineraryWithContact(u.id, trip.id, contact.id, 'https://roamarr.test');

	expect(result.link).toBe('https://roamarr.test/share/existing-token');
	expect(sent.length).toBe(1);
});

test('shareItineraryWithContact enforces contact ownership', async () => {
	resetEmergencyShareRateLimit();
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const a = db
		.insert(users)
		.values({ email: 'ec-own-a@x.c', passwordHash: 'x', displayName: 'A' })
		.returning()
		.get();
	const b = db
		.insert(users)
		.values({ email: 'ec-own-b@x.c', passwordHash: 'x', displayName: 'B' })
		.returning()
		.get();
	const contact = addEmergencyContact(a.id, { name: 'A-contact', email: 'a@x.c' });
	const trip = db.insert(trips).values({ ownerId: b.id, name: 'B Trip', defaultVisibility: 'private' }).returning().get();

	try {
		await shareItineraryWithContact(a.id, trip.id, contact.id, 'https://roamarr.test');
		expect.unreachable('expected ownership error');
	} catch (e: any) {
		expect(e.status).toBe(404);
	}
});

test('shareItineraryWithContact enforces trip ownership', async () => {
	resetEmergencyShareRateLimit();
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const owner = db
		.insert(users)
		.values({ email: 'ec-trip-owner@x.c', passwordHash: 'x', displayName: 'Owner' })
		.returning()
		.get();
	const other = db
		.insert(users)
		.values({ email: 'ec-trip-other@x.c', passwordHash: 'x', displayName: 'Other' })
		.returning()
		.get();
	const contact = addEmergencyContact(other.id, { name: 'Contact', email: 'c@x.c' });
	const trip = db.insert(trips).values({ ownerId: owner.id, name: 'Private Trip', defaultVisibility: 'private' }).returning().get();

	try {
		await shareItineraryWithContact(other.id, trip.id, contact.id, 'https://roamarr.test');
		expect.unreachable('expected trip permission error');
	} catch (e: any) {
		expect(e.status).toBe(404);
	}
});

test('shareItineraryWithContact rejects non-owner editors', async () => {
	resetEmergencyShareRateLimit();
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const owner = db
		.insert(users)
		.values({ email: 'ec-editor-owner@x.c', passwordHash: 'x', displayName: 'Owner' })
		.returning()
		.get();
	const editor = db
		.insert(users)
		.values({ email: 'ec-editor@x.c', passwordHash: 'x', displayName: 'Editor' })
		.returning()
		.get();
	const contact = addEmergencyContact(editor.id, { name: 'Contact', email: 'c@x.c' });
	const trip = db.insert(trips).values({ ownerId: owner.id, name: 'Shared Trip', defaultVisibility: 'private' }).returning().get();
	db.insert(tripShares).values({ tripId: trip.id, sharedWithUserId: editor.id, permission: 'edit' }).run();

	try {
		await shareItineraryWithContact(editor.id, trip.id, contact.id, 'https://roamarr.test');
		expect.unreachable('expected owner-only error');
	} catch (e: any) {
		expect(e.status).toBe(404);
	}
});

test('shareItineraryWithContact rejects contact without email', async () => {
	resetEmergencyShareRateLimit();
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = db
		.insert(users)
		.values({ email: 'ec-noemail@x.c', passwordHash: 'x', displayName: 'U' })
		.returning()
		.get();
	const contact = addEmergencyContact(u.id, { name: 'No Email' });
	const trip = db.insert(trips).values({ ownerId: u.id, name: 'Trip', defaultVisibility: 'private' }).returning().get();

	try {
		await shareItineraryWithContact(u.id, trip.id, contact.id, 'https://roamarr.test');
		expect.unreachable('expected email required error');
	} catch (e: any) {
		expect(e.status).toBe(400);
	}
});

test('shareItineraryWithContact rate limits repeat shares', async () => {
	resetEmergencyShareRateLimit();
	sent.length = 0;
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = db
		.insert(users)
		.values({ email: 'ec-rate@x.c', passwordHash: 'x', displayName: 'U' })
		.returning()
		.get();
	db.update(settings)
		.set({ smtpHost: 'smtp.x', smtpPort: 587, smtpFrom: 'roamarr@x.c' })
		.where(eq(settings.id, 1))
		.run();
	const contact = addEmergencyContact(u.id, { name: 'Emergency', email: 'em@x.c' });
	const trip = db.insert(trips).values({ ownerId: u.id, name: 'Rated Trip', defaultVisibility: 'private' }).returning().get();

	await shareItineraryWithContact(u.id, trip.id, contact.id, 'https://roamarr.test');
	await shareItineraryWithContact(u.id, trip.id, contact.id, 'https://roamarr.test');
	await shareItineraryWithContact(u.id, trip.id, contact.id, 'https://roamarr.test');
	expect(sent.length).toBe(3);

	try {
		await shareItineraryWithContact(u.id, trip.id, contact.id, 'https://roamarr.test');
		expect.unreachable('expected rate limit error');
	} catch (e: any) {
		expect(e.status).toBe(429);
	}
	expect(sent.length).toBe(3);
});
