import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});
import { kit } from '$lib/server/db';

import { makeUser, makeShare } from '../../../../../tests/helpers';


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
} from '$lib/server/db/mongrelSchema';
import { eq } from '@mongreldb/kit';
import { beforeEach } from 'vitest';
import { makeLocals, makeFormData } from '../../../../../tests/eventHelpers';

beforeEach(() => {
	(ctx as any).sqlite.exec(
		'delete from audit_logs; delete from fare_watches; delete from fare_providers; delete from reminders; delete from trip_shares; delete from segments; delete from trips; delete from users;'
	);
});

function makeEvent(form: FormData, params: Record<string, string>, userId: number) {
	return {
		request: new Request('http://localhost/trips/1/edit', { method: 'POST', body: form }),
		params,
		locals: makeLocals({ id: userId }),
		url: new URL(`http://localhost/trips/${params.id}/edit`)
	} as any;
}

test('owner can delete a trip and its segments, shares, watches, and reminders', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const a = makeUser(kit, { email: 'del-owner@x.c', passwordHash: 'x', displayName: 'A' });
	const b = makeUser(kit, { email: 'del-shared@x.c', passwordHash: 'x', displayName: 'B' });
	const t = createTrip(a.id, { name: 'Trip', defaultVisibility: 'public' });

	addSegment(a.id, t.id, {
		type: 'flight',
		title: 'UA1',
		localStart: '2026-07-01T15:00:00',
		startTz: 'America/New_York'
	});
	expect(db.select().from(reminders).all()).toHaveLength(1);

	makeShare(kit, { tripId: t.id, sharedWithUserId: b.id });
	const provider = db
		.insert(fareProviders)
		.values({ userId: a.id, providerKey: 'stub' })
		.returning()
		.get();
	db.insert(fareWatches).values({ tripId: t.id, providerId: provider.id, status: 'active' }).run();

	_deleteTrip(a.id, t.id);

	expect(db.select().from(trips).where(eq(trips.id, BigInt(t.id))).get()).toBeUndefined();
	expect(db.select().from(segments).where(eq(segments.trip_id, BigInt(t.id))).all()).toHaveLength(0);
	expect(db.select().from(tripShares).where(eq(tripShares.trip_id, BigInt(t.id))).all()).toHaveLength(0);
	expect(db.select().from(fareWatches).where(eq(fareWatches.trip_id, BigInt(t.id))).all()).toHaveLength(0);
	expect(db.select().from(reminders).all()).toHaveLength(0);

	const logs = db.select().from(auditLogs).where(eq(auditLogs.user_id, BigInt(a.id))).all();
	expect(logs).toHaveLength(1);
	expect(logs[0].action).toBe('trip_delete');
	expect(logs[0].entityType).toBe('trip');
	expect(logs[0].entityId).toBe(t.id);
});

test('non-owner cannot delete a trip', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const a = makeUser(kit, { email: 'del-owner2@x.c', passwordHash: 'x', displayName: 'A' });
	const b = makeUser(kit, { email: 'del-intruder@x.c', passwordHash: 'x', displayName: 'B' });
	const t = createTrip(a.id, { name: 'Trip' });

	expect(() => _deleteTrip(b.id, t.id)).toThrow();
	expect(db.select().from(trips).where(eq(trips.id, BigInt(t.id))).get()).toBeDefined();
	expect(db.select().from(auditLogs).all()).toHaveLength(0);
});

test('edit action updates a trip with valid data', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const a = makeUser(kit, { email: 'edit-a@x.c', passwordHash: 'x', displayName: 'A' });
	const t = createTrip(a.id, { name: 'Old' });
	const form = makeFormData({
		name: 'Updated',
		startDate: '2026-08-01',
		endDate: '2026-08-10',
		notes: 'new notes'
	});
	await expect(actions.save(makeEvent(form, { id: String(t.id) }, a.id))).rejects.toMatchObject({
		status: 303,
		location: `/trips/${t.id}`
	});
	const updated = db.select().from(trips).where(eq(trips.id, BigInt(t.id))).get()!;
	expect(updated.name).toBe('Updated');
	expect(updated.destination).toBeNull();
	expect(updated.destinationCountryCode).toBeNull();
	expect(updated.destinationCityName).toBeNull();
});

test('edit action allows shared editors but not read-only viewers', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const owner = makeUser(kit, { email: 'edit-owner3@x.c', passwordHash: 'x', displayName: 'A' });
	const editor = makeUser(kit, { email: 'edit-editor@x.c', passwordHash: 'x', displayName: 'E' });
	const reader = makeUser(kit, { email: 'edit-reader@x.c', passwordHash: 'x', displayName: 'R' });
	const t = createTrip(owner.id, { name: 'Trip' });
	makeShare(kit, { tripId: t.id, sharedWithUserId: editor.id, permission: 'edit' });
	makeShare(kit, { tripId: t.id, sharedWithUserId: reader.id, permission: 'read' });

	const form = makeFormData({
		name: 'Editor Updated',
		startDate: '2026-08-01',
		endDate: '2026-08-10',
		notes: 'editor notes'
	});
	await expect(actions.save(makeEvent(form, { id: String(t.id) }, editor.id))).rejects.toMatchObject({
		status: 303,
		location: `/trips/${t.id}`
	});
	const updated = db.select().from(trips).where(eq(trips.id, BigInt(t.id))).get()!;
	expect(updated.name).toBe('Editor Updated');

	await expect(actions.save(makeEvent(form, { id: String(t.id) }, reader.id))).rejects.toMatchObject({
		status: 404
	});
});

test('edit action updates trip status', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const a = makeUser(kit, { email: 'edit-status@x.c', passwordHash: 'x', displayName: 'A' });
	const t = createTrip(a.id, { name: 'Trip' });

	const form = makeFormData({
		name: 'Trip',
		status: 'active'
	});
	await expect(actions.save(makeEvent(form, { id: String(t.id) }, a.id))).rejects.toMatchObject({
		status: 303,
		location: `/trips/${t.id}`
	});
	const updated = db.select().from(trips).where(eq(trips.id, BigInt(t.id))).get()!;
	expect(updated.status).toBe('active');

	const logs = db.select().from(auditLogs).where(eq(auditLogs.user_id, BigInt(a.id))).all();
	expect(logs).toHaveLength(1);
	expect(logs[0].action).toBe('trip_update');
	expect(logs[0].entityType).toBe('trip');
	expect(logs[0].entityId).toBe(t.id);
});

test('edit action rejects invalid status values', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const a = makeUser(kit, { email: 'edit-status-bad@x.c', passwordHash: 'x', displayName: 'A' });
	const t = createTrip(a.id, { name: 'Trip' });

	const form = makeFormData({
		name: 'Trip',
		status: 'foo'
	});
	const result = (await actions.save(makeEvent(form, { id: String(t.id) }, a.id))) as {
		status: number;
		data: { errors: Record<string, string> };
	};
	expect(result.status).toBe(400);
	expect(result.data.errors.status).toBe('status must be one of: planning, booked, active, completed');
	expect(db.select().from(auditLogs).all()).toHaveLength(0);
});

test('edit action rejects invalid data and enforces ownership', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const a = makeUser(kit, { email: 'edit-b@x.c', passwordHash: 'x', displayName: 'A' });
	const b = makeUser(kit, { email: 'edit-c@x.c', passwordHash: 'x', displayName: 'B' });
	const t = createTrip(a.id, { name: 'Trip' });

	const form = makeFormData({
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
		destinationCountryCode: '',
		destinationCityName: '',
		destinationCityLat: null,
		destinationCityLng: null,
		startDate: '',
		endDate: '',
		notes: null,
		tags: '[]',
		status: 'booked' as const,
		baseCurrency: 'USD'
		};
	const { body } = render(EditTripPage, {
		props: { data: { trip, owner: true }, form: { errors: { name: 'name is required' } } }
	});
	expect(body).toContain('input-error');
	expect(body).toContain('name is required');
	expect(body).toContain('destinationCountryCode');
	expect(body).toContain('destinationCityName');
});
