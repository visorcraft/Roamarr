import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { _deleteTrip, actions } from './+page.server';
import { createTrip } from '../../shared';
import { addSegment } from '$lib/server/segments';
import {
	users,
	trips,
	segments,
	tripShares,
	reminders,
	fareWatches,
	fareProviders,
	auditLogs
} from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { beforeEach } from 'vitest';

beforeEach(() => {
	(ctx as any).sqlite.exec(
		'delete from audit_logs; delete from fare_watches; delete from fare_providers; delete from reminders; delete from trip_shares; delete from segments; delete from trips; delete from users;'
	);
});

function locals(user: { id: number }) {
	return { user } as App.Locals;
}

function formData(obj: Record<string, string>) {
	const f = new FormData();
	for (const [k, v] of Object.entries(obj)) f.append(k, v);
	return f;
}

function makeEvent(form: FormData, params: Record<string, string>, userId: number) {
	return {
		request: new Request('http://localhost/trips/1/edit', { method: 'POST', body: form }),
		params,
		locals: locals({ id: userId }),
		url: new URL(`http://localhost/trips/${params.id}/edit`)
	} as any;
}

test('owner can delete a trip and its segments, shares, watches, and reminders', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const a = db
		.insert(users)
		.values({ email: 'del-owner@x.c', passwordHash: 'x', displayName: 'A' })
		.returning()
		.get();
	const b = db
		.insert(users)
		.values({ email: 'del-shared@x.c', passwordHash: 'x', displayName: 'B' })
		.returning()
		.get();
	const t = createTrip(a.id, { name: 'Trip', defaultVisibility: 'public' });

	addSegment(a.id, t.id, {
		type: 'flight',
		title: 'UA1',
		localStart: '2026-07-01T15:00:00',
		startTz: 'America/New_York'
	});
	expect(db.select().from(reminders).all()).toHaveLength(1);

	db.insert(tripShares).values({ tripId: t.id, sharedWithUserId: b.id }).run();
	const provider = db
		.insert(fareProviders)
		.values({ userId: a.id, providerKey: 'stub' })
		.returning()
		.get();
	db.insert(fareWatches).values({ tripId: t.id, providerId: provider.id, status: 'active' }).run();

	_deleteTrip(a.id, t.id);

	expect(db.select().from(trips).where(eq(trips.id, t.id)).get()).toBeUndefined();
	expect(db.select().from(segments).where(eq(segments.tripId, t.id)).all()).toHaveLength(0);
	expect(db.select().from(tripShares).where(eq(tripShares.tripId, t.id)).all()).toHaveLength(0);
	expect(db.select().from(fareWatches).where(eq(fareWatches.tripId, t.id)).all()).toHaveLength(0);
	expect(db.select().from(reminders).all()).toHaveLength(0);

	const logs = db.select().from(auditLogs).where(eq(auditLogs.userId, a.id)).all();
	expect(logs).toHaveLength(1);
	expect(logs[0].action).toBe('trip_delete');
	expect(logs[0].entityType).toBe('trip');
	expect(logs[0].entityId).toBe(t.id);
});

test('non-owner cannot delete a trip', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const a = db
		.insert(users)
		.values({ email: 'del-owner2@x.c', passwordHash: 'x', displayName: 'A' })
		.returning()
		.get();
	const b = db
		.insert(users)
		.values({ email: 'del-intruder@x.c', passwordHash: 'x', displayName: 'B' })
		.returning()
		.get();
	const t = createTrip(a.id, { name: 'Trip' });

	expect(() => _deleteTrip(b.id, t.id)).toThrow();
	expect(db.select().from(trips).where(eq(trips.id, t.id)).get()).toBeDefined();
	expect(db.select().from(auditLogs).all()).toHaveLength(0);
});

test('edit action updates a trip with valid data', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const a = db.insert(users).values({ email: 'edit-a@x.c', passwordHash: 'x', displayName: 'A' }).returning().get();
	const t = createTrip(a.id, { name: 'Old' });
	const form = formData({
		name: 'Updated',
		destination: 'Tokyo',
		startDate: '2026-08-01',
		endDate: '2026-08-10',
		notes: 'new notes'
	});
	await expect(actions.save(makeEvent(form, { id: String(t.id) }, a.id))).rejects.toMatchObject({
		status: 303,
		location: `/trips/${t.id}`
	});
	const updated = db.select().from(trips).where(eq(trips.id, t.id)).get()!;
	expect(updated.name).toBe('Updated');
	expect(updated.destination).toBe('Tokyo');
});

test('edit action allows shared editors but not read-only viewers', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const owner = db.insert(users).values({ email: 'edit-owner3@x.c', passwordHash: 'x', displayName: 'A' }).returning().get();
	const editor = db.insert(users).values({ email: 'edit-editor@x.c', passwordHash: 'x', displayName: 'E' }).returning().get();
	const reader = db.insert(users).values({ email: 'edit-reader@x.c', passwordHash: 'x', displayName: 'R' }).returning().get();
	const t = createTrip(owner.id, { name: 'Trip' });
	db.insert(tripShares).values({ tripId: t.id, sharedWithUserId: editor.id, permission: 'edit' }).run();
	db.insert(tripShares).values({ tripId: t.id, sharedWithUserId: reader.id, permission: 'read' }).run();

	const form = formData({
		name: 'Editor Updated',
		destination: 'Osaka',
		startDate: '2026-08-01',
		endDate: '2026-08-10',
		notes: 'editor notes'
	});
	await expect(actions.save(makeEvent(form, { id: String(t.id) }, editor.id))).rejects.toMatchObject({
		status: 303,
		location: `/trips/${t.id}`
	});
	const updated = db.select().from(trips).where(eq(trips.id, t.id)).get()!;
	expect(updated.name).toBe('Editor Updated');

	await expect(actions.save(makeEvent(form, { id: String(t.id) }, reader.id))).rejects.toMatchObject({
		status: 404
	});
});

test('edit action rejects invalid data and enforces ownership', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const a = db.insert(users).values({ email: 'edit-b@x.c', passwordHash: 'x', displayName: 'A' }).returning().get();
	const b = db.insert(users).values({ email: 'edit-c@x.c', passwordHash: 'x', displayName: 'B' }).returning().get();
	const t = createTrip(a.id, { name: 'Trip' });

	const form = formData({
		name: '',
		startDate: '2026-08-10',
		endDate: '2026-08-01'
	});
	const result = (await actions.save(makeEvent(form, { id: String(t.id) }, a.id))) as {
		status: number;
		data: { errors: Record<string, string> };
	};
	expect(result.status).toBe(400);
	expect(result.data.errors.name).toBe('name is required');
	expect(result.data.errors.startDate).toBe('startDate must be on or before endDate');

	await expect(actions.save(makeEvent(form, { id: String(t.id) }, b.id))).rejects.toMatchObject({
		status: 404
	});
});

import { render } from 'svelte/server';
import EditTripPage from './+page.svelte';

test('edit trip form highlights invalid fields and shows per-field errors', () => {
	const trip = {
		id: 1,
		name: 'Trip',
		destination: '',
		startDate: '',
		endDate: '',
		notes: null,
		tags: '[]'
	};
	const { body } = render(EditTripPage, {
		props: { data: { trip, owner: true }, form: { errors: { name: 'name is required' } } }
	});
	expect(body).toContain('input-error');
	expect(body).toContain('name is required');
});
