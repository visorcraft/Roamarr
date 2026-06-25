import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { load, actions } from './+page.server';
import { _deleteTrip } from './edit/+page.server';
import {
	users,
	trips,
	segments,
	insurancePolicies,
	fareProviders,
	reminders,
	tripComments,
	auditLogs,
	tripCompanions,
	tripShares,
	tripTemplates,
	tripHomeTasks,
	tripMedications,
	tripEntryRequirements,
	tripImportantItems,
	tripExpenseAttachments,
	tripExpenses
} from '$lib/server/db/schema';
import { upsertCustomReminder } from '$lib/server/reminders';
import { eq } from 'drizzle-orm';

function event(user: { id: number }, tripId: number) {
	return {
		locals: { user } as App.Locals,
		params: { id: String(tripId) },
		url: new URL(`http://localhost/trips/${tripId}`)
	} as any;
}

function formEvent(user: { id: number }, tripId: number, body: FormData) {
	return {
		locals: { user } as App.Locals,
		params: { id: String(tripId) },
		request: new Request(`http://localhost/trips/${tripId}`, { method: 'POST', body })
	} as any;
}

test('load includes fare watches with segment titles', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = db.insert(users).values({ email: 'td-fw@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();
	db.insert(fareProviders).values({ userId: u.id, providerKey: 'stub', label: 'Stub', enabled: true }).run();
	db.insert(insurancePolicies).values({ userId: u.id, provider: 'X', tripId: t.id }).run();

	const result = load(event(u, t.id)) as { watches: unknown[] };
	expect(Array.isArray(result.watches)).toBe(true);
});


test('load includes attached insurance policies and user cards for the owner', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = db.insert(users).values({ email: 'td@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();
	db.insert(fareProviders).values({ userId: u.id, providerKey: 'stub', label: 'Stub', enabled: true }).run();
	db.insert(insurancePolicies).values({
		userId: u.id,
		provider: 'Acme Insurance',
		policyNumber: 'ACME-123',
		coverageSummary: 'Trip cancellation',
		tripId: t.id
	}).run();

	const result = load(event(u, t.id)) as {
		policies: { provider: string; policyNumber: string }[];
		availablePolicies: { provider: string }[];
		cards: unknown[];
	};
	expect(result.policies).toHaveLength(1);
	expect(result.policies[0].provider).toBe('Acme Insurance');
	expect(result.availablePolicies).toHaveLength(0);
	expect(Array.isArray(result.cards)).toBe(true);
});

test('load separates available unattached policies from attached policies', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = db.insert(users).values({ email: 'td2@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();
	const t1 = db.insert(trips).values({ ownerId: u.id, name: 'T1' }).returning().get();
	const t2 = db.insert(trips).values({ ownerId: u.id, name: 'T2' }).returning().get();
	db.insert(insurancePolicies).values({ userId: u.id, provider: 'Attached', tripId: t1.id }).run();
	db.insert(insurancePolicies).values({ userId: u.id, provider: 'Free', tripId: t2.id }).run();

	const result = load(event(u, t1.id)) as {
		policies: { provider: string }[];
		availablePolicies: { provider: string }[];
	};
	expect(result.policies.map((p) => p.provider)).toEqual(['Attached']);
	expect(result.availablePolicies.map((p) => p.provider)).toEqual(['Free']);
});

test('attachPolicy action links an existing policy to the trip', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = db.insert(users).values({ email: 'ap@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();
	const pol = db.insert(insurancePolicies).values({ userId: u.id, provider: 'P', tripId: null }).returning().get();

	const request = new Request('http://localhost/trips/' + t.id, {
		method: 'POST',
		body: new URLSearchParams({ policyId: String(pol.id) })
	});
	await expect(actions.attachPolicy({ ...event(u, t.id), request })).rejects.toMatchObject({
		status: 303,
		location: `/trips/${t.id}`
	});

	const row = db.select().from(insurancePolicies).where(eq(insurancePolicies.id, pol.id)).get();
	expect(row?.tripId).toBe(t.id);
});

test('attachPolicy action rejects a policy owned by another user', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const owner = db.insert(users).values({ email: 'ap-owner@x.c', passwordHash: 'x', displayName: 'O' }).returning().get();
	const other = db.insert(users).values({ email: 'ap-other@x.c', passwordHash: 'x', displayName: 'X' }).returning().get();
	const t = db.insert(trips).values({ ownerId: owner.id, name: 'T' }).returning().get();
	const pol = db.insert(insurancePolicies).values({ userId: other.id, provider: 'P', tripId: null }).returning().get();

	const request = new Request('http://localhost/trips/' + t.id, {
		method: 'POST',
		body: new URLSearchParams({ policyId: String(pol.id) })
	});
	await expect(actions.attachPolicy({ ...event(owner, t.id), request })).rejects.toMatchObject({ status: 404 });
});

test('detachPolicy action unlinks a policy from the trip', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = db.insert(users).values({ email: 'dp@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();
	const pol = db.insert(insurancePolicies).values({ userId: u.id, provider: 'P', tripId: t.id }).returning().get();

	const request = new Request('http://localhost/trips/' + t.id, {
		method: 'POST',
		body: new URLSearchParams({ policyId: String(pol.id) })
	});
	await expect(actions.detachPolicy({ ...event(u, t.id), request })).rejects.toMatchObject({
		status: 303,
		location: `/trips/${t.id}`
	});

	const row = db.select().from(insurancePolicies).where(eq(insurancePolicies.id, pol.id)).get();
	expect(row?.tripId).toBeNull();
});

test('addComment action creates a comment on the trip', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = db.insert(users).values({ email: 'cc@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();

	const request = new Request('http://localhost/trips/' + t.id, {
		method: 'POST',
		body: new URLSearchParams({ body: 'Nice trip' })
	});
	await expect(actions.addComment({ ...event(u, t.id), request })).rejects.toMatchObject({
		status: 303,
		location: `/trips/${t.id}`
	});

	const rows = db.select().from(tripComments).where(eq(tripComments.tripId, t.id)).all();
	expect(rows).toHaveLength(1);
	expect(rows[0].body).toBe('Nice trip');
});

test('deleteComment action removes the users own comment', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = db.insert(users).values({ email: 'dc@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();
	db.insert(tripComments).values({ userId: u.id, tripId: t.id, body: 'X' }).run();
	const c = db.select().from(tripComments).where(eq(tripComments.tripId, t.id)).get()!;

	const request = new Request('http://localhost/trips/' + t.id, {
		method: 'POST',
		body: new URLSearchParams({ commentId: String(c.id) })
	});
	await expect(actions.deleteComment({ ...event(u, t.id), request })).rejects.toMatchObject({
		status: 303,
		location: `/trips/${t.id}`
	});

	expect(db.select().from(tripComments).where(eq(tripComments.id, c.id)).get()).toBeUndefined();
});

test('delete action removes trip-level reminders', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = db.insert(users).values({ email: 'del@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'Del', startDate: '2099-01-01' }).returning().get();
	upsertCustomReminder(u.id, 'trip', t.id, `${t.startDate}T09:00:00Z`, 60);
	expect(db.select().from(reminders).where(eq(reminders.refType, 'trip')).all()).toHaveLength(1);

	_deleteTrip(u.id, t.id);
	expect(db.select().from(trips).where(eq(trips.id, t.id)).get()).toBeUndefined();
	expect(db.select().from(reminders).where(eq(reminders.refType, 'trip')).all()).toHaveLength(0);
});

test('duplicateSegment action copies a segment and redirects', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = db.insert(users).values({ email: 'ds@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();
	const s = db
		.insert(segments)
		.values({
			tripId: t.id,
			type: 'event',
			title: 'City tour',
			startAt: '2026-09-01T14:00:00Z',
			startTz: 'UTC',
			endAt: '2026-09-01T16:00:00Z',
			confirmationNumber: 'XYZ'
		})
		.returning()
		.get();

	const request = new Request('http://localhost/trips/' + t.id, {
		method: 'POST',
		body: new URLSearchParams({ segmentId: String(s.id) })
	});
	await expect(actions.duplicateSegment({ ...event(u, t.id), request })).rejects.toMatchObject({
		status: 303,
		location: `/trips/${t.id}`
	});

	const rows = db.select().from(segments).where(eq(segments.tripId, t.id)).all();
	expect(rows).toHaveLength(2);
	const copy = rows.find((r) => r.id !== s.id)!;
	expect(copy.title).toBe('City tour');
	expect(copy.startAt).toBe('2026-09-02T14:00:00.000Z');
	expect(copy.endAt).toBe('2026-09-02T16:00:00.000Z');
	expect(copy.confirmationNumber).toBeNull();

	const logs = db.select().from(auditLogs).where(eq(auditLogs.entityId, copy.id)).all();
	expect(logs).toHaveLength(1);
	expect(logs[0].action).toBe('duplicate');
});

test('duplicateSegment action rejects invalid segment id', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = db.insert(users).values({ email: 'ds-bad@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();

	const request = new Request('http://localhost/trips/' + t.id, {
		method: 'POST',
		body: new URLSearchParams({ segmentId: 'abc' })
	});
	await expect(actions.duplicateSegment({ ...event(u, t.id), request })).rejects.toMatchObject({
		status: 400
	});
});

test('duplicateSegment action rejects a non-editor', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const owner = db.insert(users).values({ email: 'ds-owner@x.c', passwordHash: 'x', displayName: 'O' }).returning().get();
	const other = db.insert(users).values({ email: 'ds-other@x.c', passwordHash: 'x', displayName: 'X' }).returning().get();
	const t = db.insert(trips).values({ ownerId: owner.id, name: 'T' }).returning().get();
	const s = db
		.insert(segments)
		.values({
			tripId: t.id,
			type: 'flight',
			title: 'F',
			startAt: '2026-10-01T10:00:00Z',
			startTz: 'UTC'
		})
		.returning()
		.get();

	const request = new Request('http://localhost/trips/' + t.id, {
		method: 'POST',
		body: new URLSearchParams({ segmentId: String(s.id) })
	});
	await expect(actions.duplicateSegment({ ...event(other, t.id), request })).rejects.toMatchObject({
		status: 404
	});
});

test('load strips companion notes from shared viewers', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const owner = db.insert(users).values({ email: 'co@x.c', passwordHash: 'x', displayName: 'O' }).returning().get();
	const reader = db.insert(users).values({ email: 'cr@x.c', passwordHash: 'x', displayName: 'R' }).returning().get();
	const t = db.insert(trips).values({ ownerId: owner.id, name: 'T' }).returning().get();
	db.insert(tripCompanions).values({
		tripId: t.id,
		name: 'Sam',
		category: 'adult',
		dietary: 'Vegetarian',
		allergies: 'Peanuts',
		medicalNotes: 'EpiPen',
		notes: 'Likes windows'
	}).run();
	db.insert(tripShares).values({ tripId: t.id, sharedWithUserId: reader.id }).run();

	const result = load(event(reader, t.id)) as { companions: { name: string; dietary: string | null; allergies: string | null; medicalNotes: string | null; notes: string | null }[] };
	expect(result.companions).toHaveLength(1);
	expect(result.companions[0].name).toBe('Sam');
	expect(result.companions[0].dietary).toBeNull();
	expect(result.companions[0].allergies).toBeNull();
	expect(result.companions[0].medicalNotes).toBeNull();
	expect(result.companions[0].notes).toBeNull();
});

test('setSegmentStatus action updates segment status for an editor', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = db.insert(users).values({ email: 'ss@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();
	const s = db
		.insert(segments)
		.values({
			tripId: t.id,
			type: 'flight',
			title: 'F',
			startAt: '2026-01-01T10:00:00Z',
			startTz: 'UTC'
		})
		.returning()
		.get();

	const request = new Request('http://localhost/trips/' + t.id, {
		method: 'POST',
		body: new URLSearchParams({ segmentId: String(s.id), status: 'checked_in' })
	});
	await expect(actions.setSegmentStatus({ ...event(u, t.id), request })).rejects.toMatchObject({
		status: 303,
		location: `/trips/${t.id}`
	});

	const row = db.select().from(segments).where(eq(segments.id, s.id)).get();
	expect(row?.status).toBe('checked_in');
});

test('setSegmentStatus action rejects invalid status', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = db.insert(users).values({ email: 'ss-bad@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();
	const s = db
		.insert(segments)
		.values({
			tripId: t.id,
			type: 'flight',
			title: 'F',
			startAt: '2026-01-01T10:00:00Z',
			startTz: 'UTC'
		})
		.returning()
		.get();

	const request = new Request('http://localhost/trips/' + t.id, {
		method: 'POST',
		body: new URLSearchParams({ segmentId: String(s.id), status: 'invalid' })
	});
	await expect(actions.setSegmentStatus({ ...event(u, t.id), request })).rejects.toMatchObject({ status: 400 });
});

test('setSegmentStatus action rejects a non-editor', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const owner = db.insert(users).values({ email: 'ss-owner@x.c', passwordHash: 'x', displayName: 'O' }).returning().get();
	const other = db.insert(users).values({ email: 'ss-other@x.c', passwordHash: 'x', displayName: 'X' }).returning().get();
	const t = db.insert(trips).values({ ownerId: owner.id, name: 'T' }).returning().get();
	const s = db
		.insert(segments)
		.values({
			tripId: t.id,
			type: 'flight',
			title: 'F',
			startAt: '2026-01-01T10:00:00Z',
			startTz: 'UTC'
		})
		.returning()
		.get();

	const request = new Request('http://localhost/trips/' + t.id, {
		method: 'POST',
		body: new URLSearchParams({ segmentId: String(s.id), status: 'completed' })
	});
	await expect(actions.setSegmentStatus({ ...event(other, t.id), request })).rejects.toMatchObject({ status: 404 });
});

test('saveTripTemplate action saves a template and redirects', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = db.insert(users).values({ email: 'stpl@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();

	const templateForm = new FormData();
	templateForm.set('name', 'Template');
	await expect(actions.saveTripTemplate(formEvent(u, t.id, templateForm))).rejects.toMatchObject({
		status: 303,
		location: `/trips/${t.id}`
	});

	expect(db.select().from(tripTemplates).where(eq(tripTemplates.userId, u.id)).all()).toHaveLength(1);
});

test('addHomeTask action creates a task and redirects', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = db.insert(users).values({ email: 'ht-act@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();

	const f = new FormData();
	f.set('text', 'Stop mail');
	f.set('dueDate', '2026-07-01');
	await expect(actions.addHomeTask(formEvent(u, t.id, f))).rejects.toMatchObject({
		status: 303,
		location: `/trips/${t.id}`
	});

	expect(db.select().from(tripHomeTasks).where(eq(tripHomeTasks.tripId, t.id)).all()).toHaveLength(1);
});

test('addMedication action creates a schedule and redirects', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = db.insert(users).values({ email: 'med-act@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();

	const f = new FormData();
	f.set('name', 'Claritin');
	f.set('dosage', '5mg');
	await expect(actions.addMedication(formEvent(u, t.id, f))).rejects.toMatchObject({
		status: 303,
		location: `/trips/${t.id}`
	});

	expect(db.select().from(tripMedications).where(eq(tripMedications.tripId, t.id)).all()).toHaveLength(1);
});

test('addEntryRequirement action creates a requirement and redirects', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = db.insert(users).values({ email: 'er-act@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();

	const f = new FormData();
	f.set('country', 'Japan');
	f.set('requirementType', 'visa');
	f.set('status', 'in_progress');
	await expect(actions.addEntryRequirement(formEvent(u, t.id, f))).rejects.toMatchObject({
		status: 303,
		location: `/trips/${t.id}`
	});

	const rows = db.select().from(tripEntryRequirements).where(eq(tripEntryRequirements.tripId, t.id)).all();
	expect(rows).toHaveLength(1);
	expect(rows[0].status).toBe('in_progress');
});

test('addImportantItem action creates an item and redirects', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = db.insert(users).values({ email: 'ii-act@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();

	const f = new FormData();
	f.set('name', 'Passport');
	f.set('serialNumber', 'ABC123');
	await expect(actions.addImportantItem(formEvent(u, t.id, f))).rejects.toMatchObject({
		status: 303,
		location: `/trips/${t.id}`
	});

	const rows = db.select().from(tripImportantItems).where(eq(tripImportantItems.tripId, t.id)).all();
	expect(rows).toHaveLength(1);
	expect(rows[0].serialNumber).toBe('ABC123');
});

test('addAttachment action uploads a receipt and redirects', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = db.insert(users).values({ email: 'att-act@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();
	const e = db
		.insert(tripExpenses)
		.values({ tripId: t.id, description: 'Dinner', amount: 5000, currency: 'USD' })
		.returning()
		.get();

	const f = new FormData();
	f.set('expenseId', String(e.id));
	f.set('file', new File(['hello'], 'receipt.png', { type: 'image/png' }));
	await expect(actions.addAttachment(formEvent(u, t.id, f))).rejects.toMatchObject({
		status: 303,
		location: `/trips/${t.id}`
	});

	expect(db.select().from(tripExpenseAttachments).where(eq(tripExpenseAttachments.expenseId, e.id)).all()).toHaveLength(1);
});
