import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('./db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import {
	listEmergencyContacts,
	addEmergencyContact,
	updateEmergencyContact,
	deleteEmergencyContact
} from './emergencyContacts';
import { emergencyContacts, users, auditLogs } from './db/schema';
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
