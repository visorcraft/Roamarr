import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ kit: null as never }));
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
import { eq } from '@visorcraft/mongreldb-kit';
import { beforeEach } from 'vitest';
import { makeLocals, makeFormData } from '../../../../../tests/eventHelpers';

beforeEach(() => {
	kit.deleteFrom(auditLogs).executeSync();
	kit.deleteFrom(fareWatches).executeSync();
	kit.deleteFrom(fareProviders).executeSync();
	kit.deleteFrom(reminders).executeSync();
	kit.deleteFrom(tripShares).executeSync();
	kit.deleteFrom(segments).executeSync();
	kit.deleteFrom(trips).executeSync();
	kit.deleteFrom(users).executeSync();
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
	const a = makeUser(kit, { email: 'del-owner@x.c', passwordHash: 'x', displayName: 'A' });
	const b = makeUser(kit, { email: 'del-shared@x.c', passwordHash: 'x', displayName: 'B' });
	const t = createTrip(a.id, { name: 'Trip', defaultVisibility: 'public' });

	addSegment(a.id, t.id, {
		type: 'flight',
		title: 'UA1',
		localStart: '2026-07-01T15:00:00',
		startTz: 'America/New_York'
	});
	expect(kit.selectFrom(reminders).executeSync()).toHaveLength(1);

	makeShare(kit, { tripId: t.id, sharedWithUserId: b.id });
	const provider = kit
		.insertInto(fareProviders)
		.values({ user_id: BigInt(a.id), provider_key: 'stub' })
		.executeSync();
	kit
		.insertInto(fareWatches)
		.values({ trip_id: BigInt(t.id), provider_id: provider.id })
		.executeSync();

	_deleteTrip(a.id, t.id);

	expect(kit.selectFrom(trips).where(eq(trips.id, BigInt(t.id))).executeSync()[0]).toBeUndefined();
	expect(kit.selectFrom(segments).where(eq(segments.trip_id, BigInt(t.id))).executeSync()).toHaveLength(0);
	expect(kit.selectFrom(tripShares).where(eq(tripShares.trip_id, BigInt(t.id))).executeSync()).toHaveLength(0);
	expect(kit.selectFrom(fareWatches).where(eq(fareWatches.trip_id, BigInt(t.id))).executeSync()).toHaveLength(0);
	expect(kit.selectFrom(reminders).executeSync()).toHaveLength(0);

	const logs = kit.selectFrom(auditLogs).where(eq(auditLogs.user_id, BigInt(a.id))).executeSync();
	expect(logs).toHaveLength(1);
	expect(logs[0].action).toBe('trip_delete');
	expect(logs[0].entity_type).toBe('trip');
	expect(Number(logs[0].entity_id)).toBe(t.id);
});

test('non-owner cannot delete a trip', () => {
	const a = makeUser(kit, { email: 'del-owner2@x.c', passwordHash: 'x', displayName: 'A' });
	const b = makeUser(kit, { email: 'del-intruder@x.c', passwordHash: 'x', displayName: 'B' });
	const t = createTrip(a.id, { name: 'Trip' });

	expect(() => _deleteTrip(b.id, t.id)).toThrow();
	expect(kit.selectFrom(trips).where(eq(trips.id, BigInt(t.id))).executeSync()[0]).toBeDefined();
	expect(kit.selectFrom(auditLogs).executeSync()).toHaveLength(0);
});

test('edit action updates a trip with valid data', async () => {
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
	const updated = kit.selectFrom(trips).where(eq(trips.id, BigInt(t.id))).executeSync()[0]!;
	expect(updated.name).toBe('Updated');
	expect(updated.destination).toBeNull();
	expect(updated.destination_country_code).toBeNull();
	expect(updated.destination_city_name).toBeNull();
});

test('edit action allows shared editors but not read-only viewers', async () => {
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
	const updated = kit.selectFrom(trips).where(eq(trips.id, BigInt(t.id))).executeSync()[0]!;
	expect(updated.name).toBe('Editor Updated');

	await expect(actions.save(makeEvent(form, { id: String(t.id) }, reader.id))).rejects.toMatchObject({
		status: 404
	});
});

test('edit action updates trip status', async () => {
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
	const updated = kit.selectFrom(trips).where(eq(trips.id, BigInt(t.id))).executeSync()[0]!;
	expect(updated.status).toBe('active');

	const logs = kit.selectFrom(auditLogs).where(eq(auditLogs.user_id, BigInt(a.id))).executeSync();
	expect(logs).toHaveLength(1);
	expect(logs[0].action).toBe('trip_update');
	expect(logs[0].entity_type).toBe('trip');
	expect(Number(logs[0].entity_id)).toBe(t.id);
});

test('edit action rejects invalid status values', async () => {
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
	expect(kit.selectFrom(auditLogs).executeSync()).toHaveLength(0);
});

test('edit action rejects invalid data and enforces ownership', async () => {
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
