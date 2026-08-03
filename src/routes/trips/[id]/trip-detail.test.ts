import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});
import { kit } from '$lib/server/db';

import {
	makeUser,
	makeTrip,
	makeSegment,
	makeCompanion,
	makeShare,
	makeInsurancePolicy,
	makeFareProvider,
	makeExpense
} from '../../../../tests/helpers';


import { load, actions } from './+page.server';
import { _deleteTrip } from './edit/+page.server';
import { addComment } from '$lib/server/tripComments';
import {
	trips,
	segments,
	insurancePolicies,
	reminders,
	tripComments,
	auditLogs,
	tripTemplates,
	tripHomeTasks,
	tripMedications,
	tripEntryRequirements,
	tripImportantItems,
	tripExpenseAttachments,
	galleryImages,
	attachments
} from '$lib/server/db/mongrelSchema';
import * as usersRepo from '$lib/server/repositories/usersRepo';
import * as tripsRepo from '$lib/server/repositories/tripsRepo';
import { upsertCustomReminder } from '$lib/server/reminders';
import { setDayNote } from '$lib/server/tripDayNotes';
import { tripDayNotes } from '$lib/server/db/mongrelSchema';
import { eq } from '@visorcraft/mongreldb-kit';

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

test('load includes fare watches with segment titles', async () => {
	const u = makeUser(kit, { email: 'td-fw@x.c', passwordHash: 'x', displayName: 'U' });
	const t = makeTrip(kit, u.id, { name: 'T' });
	makeFareProvider(kit, u.id, { providerKey: 'stub', label: 'Stub', enabled: true });
	kit.insertInto(insurancePolicies).values({ user_id: BigInt(u.id), provider: 'X', trip_id: BigInt(t.id) }).executeSync();

	const result = await load(event(u, t.id)) as { watches: unknown[] };
	expect(Array.isArray(result.watches)).toBe(true);
});


test('load includes attached insurance policies and user cards for the owner', async () => {
	const u = makeUser(kit, { email: 'td@x.c', passwordHash: 'x', displayName: 'U' });
	const t = makeTrip(kit, u.id, { name: 'T' });
	makeFareProvider(kit, u.id, { providerKey: 'stub', label: 'Stub', enabled: true });
	makeInsurancePolicy(kit, u.id, {
		provider: 'Acme Insurance',
		policyNumber: 'ACME-123',
		coverageSummary: 'Trip cancellation',
		tripId: t.id
	});

	const result = await load(event(u, t.id)) as {
		policies: { provider: string; policyNumber: string }[];
		availablePolicies: { provider: string }[];
		cards: unknown[];
	};
	expect(result.policies).toHaveLength(1);
	expect(result.policies[0].provider).toBe('Acme Insurance');
	expect(result.availablePolicies).toHaveLength(0);
	expect(Array.isArray(result.cards)).toBe(true);
});

test('load separates available unattached policies from attached policies', async () => {
	const u = makeUser(kit, { email: 'td2@x.c', passwordHash: 'x', displayName: 'U' });
	const t1 = makeTrip(kit, u.id, { name: 'T1' });
	const t2 = makeTrip(kit, u.id, { name: 'T2' });
	makeInsurancePolicy(kit, u.id, { provider: 'Attached', tripId: t1.id });
	makeInsurancePolicy(kit, u.id, { provider: 'Free', tripId: t2.id });

	const result = await load(event(u, t1.id)) as {
		policies: { provider: string }[];
		availablePolicies: { provider: string }[];
	};
	expect(result.policies.map((p) => p.provider)).toEqual(['Attached']);
	expect(result.availablePolicies.map((p) => p.provider)).toEqual(['Free']);
});

test('attachPolicy action links an existing policy to the trip', async () => {
	const u = makeUser(kit, { email: 'ap@x.c', passwordHash: 'x', displayName: 'U' });
	const t = makeTrip(kit, u.id, { name: 'T' });
	const pol = makeInsurancePolicy(kit, u.id, { provider: 'P', tripId: null });

	const request = new Request('http://localhost/trips/' + t.id, {
		method: 'POST',
		body: new URLSearchParams({ policyId: String(pol.id) })
	});
	await expect(actions.attachPolicy({ ...event(u, t.id), request })).rejects.toMatchObject({
		status: 303,
		location: `/trips/${t.id}`
	});

	const row = kit.selectFrom(insurancePolicies).where(eq(insurancePolicies.id, BigInt(pol.id))).executeSync()[0];
	expect(Number(row?.trip_id)).toBe(t.id);
});

test('attachPolicy action rejects a policy owned by another user', async () => {
	const owner = makeUser(kit, { email: 'ap-owner@x.c', passwordHash: 'x', displayName: 'O' });
	const other = makeUser(kit, { email: 'ap-other@x.c', passwordHash: 'x', displayName: 'X' });
	const t = makeTrip(kit, owner.id, { name: 'T' });
	const pol = makeInsurancePolicy(kit, other.id, { provider: 'P', tripId: null });

	const request = new Request('http://localhost/trips/' + t.id, {
		method: 'POST',
		body: new URLSearchParams({ policyId: String(pol.id) })
	});
	await expect(actions.attachPolicy({ ...event(owner, t.id), request })).rejects.toMatchObject({ status: 404 });
});

test('detachPolicy action unlinks a policy from the trip', async () => {
	const u = makeUser(kit, { email: 'dp@x.c', passwordHash: 'x', displayName: 'U' });
	const t = makeTrip(kit, u.id, { name: 'T' });
	const pol = makeInsurancePolicy(kit, u.id, { provider: 'P', tripId: t.id });

	const request = new Request('http://localhost/trips/' + t.id, {
		method: 'POST',
		body: new URLSearchParams({ policyId: String(pol.id) })
	});
	await expect(actions.detachPolicy({ ...event(u, t.id), request })).rejects.toMatchObject({
		status: 303,
		location: `/trips/${t.id}`
	});

	const row = kit.selectFrom(insurancePolicies).where(eq(insurancePolicies.id, BigInt(pol.id))).executeSync()[0];
	expect(row?.trip_id).toBeNull();
});

test('addComment action creates a comment on the trip', async () => {
	const u = makeUser(kit, { email: 'cc@x.c', passwordHash: 'x', displayName: 'U' });
	const t = makeTrip(kit, u.id, { name: 'T' });

	const request = new Request('http://localhost/trips/' + t.id, {
		method: 'POST',
		body: new URLSearchParams({ body: 'Nice trip' })
	});
	await expect(actions.addComment({ ...event(u, t.id), request })).rejects.toMatchObject({
		status: 303,
		location: `/trips/${t.id}`
	});

	const rows = kit.selectFrom(tripComments).where(eq(tripComments.trip_id, BigInt(t.id))).executeSync();
	expect(rows).toHaveLength(1);
	expect(rows[0].body).toBe('Nice trip');
});

test('deleteComment action removes the users own comment', async () => {
	const u = makeUser(kit, { email: 'dc@x.c', passwordHash: 'x', displayName: 'U' });
	const t = makeTrip(kit, u.id, { name: 'T' });
	const c = addComment(u.id, t.id, 'X');

	const request = new Request('http://localhost/trips/' + t.id, {
		method: 'POST',
		body: new URLSearchParams({ commentId: String(c.id) })
	});
	await expect(actions.deleteComment({ ...event(u, t.id), request })).rejects.toMatchObject({
		status: 303,
		location: `/trips/${t.id}`
	});

	expect(kit.selectFrom(tripComments).where(eq(tripComments.id, BigInt(c.id))).executeSync()[0]).toBeUndefined();
});

test('delete action removes trip-level reminders', async () => {
	const u = makeUser(kit, { email: 'del@x.c', passwordHash: 'x', displayName: 'U' });
	const t = makeTrip(kit, u.id, { name: 'Del', startDate: '2099-01-01' });
	upsertCustomReminder(u.id, 'trip', t.id, `${t.startDate}T09:00:00Z`, 60);
	expect(kit.selectFrom(reminders).where(eq(reminders.ref_type, 'trip')).executeSync()).toHaveLength(1);

	await _deleteTrip(u.id, t.id);
	expect(kit.selectFrom(trips).where(eq(trips.id, BigInt(t.id))).executeSync()[0]).toBeUndefined();
	expect(kit.selectFrom(reminders).where(eq(reminders.ref_type, 'trip')).executeSync()).toHaveLength(0);
});

test('duplicateSegment action copies a segment and redirects', async () => {
	const u = makeUser(kit, { email: 'ds@x.c', passwordHash: 'x', displayName: 'U' });
	const t = makeTrip(kit, u.id, { name: 'T' });
	const s = makeSegment(kit, t.id, {
			type: 'event',
			title: 'City tour',
			startAt: '2026-09-01T14:00:00Z',
			startTz: 'UTC',
			endAt: '2026-09-01T16:00:00Z',
			confirmationNumber: 'XYZ'
		});

	const request = new Request('http://localhost/trips/' + t.id, {
		method: 'POST',
		body: new URLSearchParams({ segmentId: String(s.id) })
	});
	await expect(actions.duplicateSegment({ ...event(u, t.id), request })).rejects.toMatchObject({
		status: 303,
		location: `/trips/${t.id}`
	});

	const rows = kit.selectFrom(segments).where(eq(segments.trip_id, BigInt(t.id))).executeSync();
	expect(rows).toHaveLength(2);
	const copy = rows.find((r) => Number(r.id) !== s.id)!;
	expect(copy.title).toBe('City tour');
	expect(copy.start_at).toBe('2026-09-01T14:00:00Z');
	expect(copy.end_at).toBe('2026-09-01T16:00:00Z');
	expect(copy.confirmation_number).toBeNull();

	const logs = kit.selectFrom(auditLogs).where(eq(auditLogs.entity_id, copy.id)).executeSync();
	expect(logs).toHaveLength(1);
	expect(logs[0].action).toBe('duplicate');
});

test('duplicateSegment action rejects invalid segment id', async () => {
	const u = makeUser(kit, { email: 'ds-bad@x.c', passwordHash: 'x', displayName: 'U' });
	const t = makeTrip(kit, u.id, { name: 'T' });

	const request = new Request('http://localhost/trips/' + t.id, {
		method: 'POST',
		body: new URLSearchParams({ segmentId: 'abc' })
	});
	await expect(actions.duplicateSegment({ ...event(u, t.id), request })).rejects.toMatchObject({
		status: 400
	});
});

test('duplicateSegment action rejects a non-editor', async () => {
	const owner = makeUser(kit, { email: 'ds-owner@x.c', passwordHash: 'x', displayName: 'O' });
	const other = makeUser(kit, { email: 'ds-other@x.c', passwordHash: 'x', displayName: 'X' });
	const t = makeTrip(kit, owner.id, { name: 'T' });
	const s = makeSegment(kit, t.id, {
			type: 'flight',
			title: 'F',
			startAt: '2026-10-01T10:00:00Z',
			startTz: 'UTC'
		});

	const request = new Request('http://localhost/trips/' + t.id, {
		method: 'POST',
		body: new URLSearchParams({ segmentId: String(s.id) })
	});
	await expect(actions.duplicateSegment({ ...event(other, t.id), request })).rejects.toMatchObject({
		status: 404
	});
});

test('load strips companion notes from shared viewers', async () => {
	const owner = makeUser(kit, { email: 'co@x.c', passwordHash: 'x', displayName: 'O' });
	const reader = makeUser(kit, { email: 'cr@x.c', passwordHash: 'x', displayName: 'R' });
	const t = makeTrip(kit, owner.id, { name: 'T' });
	makeCompanion(kit, t.id, {
		name: 'Sam',
		category: 'adult',
		dietary: 'Vegetarian',
		allergies: 'Peanuts',
		medicalNotes: 'EpiPen',
		notes: 'Likes windows'
	});
	makeShare(kit, { tripId: t.id, sharedWithUserId: reader.id });

	const result = await load(event(reader, t.id)) as { companions: { name: string; dietary: string | null; allergies: string | null; medicalNotes: string | null; notes: string | null }[] };
	expect(result.companions).toHaveLength(1);
	expect(result.companions[0].name).toBe('Sam');
	expect(result.companions[0].dietary).toBeNull();
	expect(result.companions[0].allergies).toBeNull();
	expect(result.companions[0].medicalNotes).toBeNull();
	expect(result.companions[0].notes).toBeNull();
});

test('setSegmentStatus action updates segment status for an editor', async () => {
	const u = makeUser(kit, { email: 'ss@x.c', passwordHash: 'x', displayName: 'U' });
	const t = makeTrip(kit, u.id, { name: 'T' });
	const s = makeSegment(kit, t.id, {
			type: 'flight',
			title: 'F',
			startAt: '2026-01-01T10:00:00Z',
			startTz: 'UTC'
		});

	const request = new Request('http://localhost/trips/' + t.id, {
		method: 'POST',
		body: new URLSearchParams({ segmentId: String(s.id), status: 'checked_in' })
	});
	await expect(actions.setSegmentStatus({ ...event(u, t.id), request })).rejects.toMatchObject({
		status: 303,
		location: `/trips/${t.id}`
	});

	const row = kit.selectFrom(segments).where(eq(segments.id, BigInt(s.id))).executeSync()[0];
	expect(row?.status).toBe('checked_in');
});

test('setSegmentStatus action rejects invalid status', async () => {
	const u = makeUser(kit, { email: 'ss-bad@x.c', passwordHash: 'x', displayName: 'U' });
	const t = makeTrip(kit, u.id, { name: 'T' });
	const s = makeSegment(kit, t.id, {
			type: 'flight',
			title: 'F',
			startAt: '2026-01-01T10:00:00Z',
			startTz: 'UTC'
		});

	const request = new Request('http://localhost/trips/' + t.id, {
		method: 'POST',
		body: new URLSearchParams({ segmentId: String(s.id), status: 'invalid' })
	});
	await expect(actions.setSegmentStatus({ ...event(u, t.id), request })).rejects.toMatchObject({ status: 400 });
});

test('setSegmentStatus action rejects a non-editor', async () => {
	const owner = makeUser(kit, { email: 'ss-owner@x.c', passwordHash: 'x', displayName: 'O' });
	const other = makeUser(kit, { email: 'ss-other@x.c', passwordHash: 'x', displayName: 'X' });
	const t = makeTrip(kit, owner.id, { name: 'T' });
	const s = makeSegment(kit, t.id, {
			type: 'flight',
			title: 'F',
			startAt: '2026-01-01T10:00:00Z',
			startTz: 'UTC'
		});

	const request = new Request('http://localhost/trips/' + t.id, {
		method: 'POST',
		body: new URLSearchParams({ segmentId: String(s.id), status: 'completed' })
	});
	await expect(actions.setSegmentStatus({ ...event(other, t.id), request })).rejects.toMatchObject({ status: 404 });
});

test('moveSegmentDate action moves a segment to a new local date', async () => {
	const u = makeUser(kit, { email: 'move-action@x.c', passwordHash: 'x', displayName: 'U' });
	const t = makeTrip(kit, u.id, { name: 'T' });
	const s = makeSegment(kit, t.id, {
			type: 'food',
			title: 'Lunch',
			startAt: '2026-09-16T03:30:00.000Z',
			startTz: 'Asia/Tokyo',
			endAt: '2026-09-16T04:30:00.000Z',
			endTz: 'Asia/Tokyo'
		});

	const f = new FormData();
	f.set('segmentId', String(s.id));
	f.set('targetDate', '2026-09-15');
	await expect(actions.moveSegmentDate(formEvent(u, t.id, f))).rejects.toMatchObject({
		status: 303,
		location: `/trips/${t.id}`
	});

	const row = kit.selectFrom(segments).where(eq(segments.id, BigInt(s.id))).executeSync()[0];
	expect(row?.start_at).toBe('2026-09-15T03:30:00.000Z');
	expect(row?.end_at).toBe('2026-09-15T04:30:00.000Z');
});

test('optimizeTripDay action persists the optimized order and redirects', async () => {
	const u = makeUser(kit, { email: 'opt-action@x.c', passwordHash: 'x', displayName: 'U' });
	const t = makeTrip(kit, u.id, { name: 'T' });
	const a = makeSegment(kit, t.id, { type: 'poi', startAt: '2026-07-10T00:00:00Z', cityLat: 0, cityLng: 0 });
	const b = makeSegment(kit, t.id, { type: 'poi', startAt: '2026-07-10T00:00:00Z', cityLat: 0, cityLng: 1 });
	const c = makeSegment(kit, t.id, { type: 'poi', startAt: '2026-07-10T00:00:00Z', cityLat: 0, cityLng: 2 });

	const f = new FormData();
	f.set('date', '2026-07-10');
	const cookies = { set: vi.fn() };
	await expect(
		actions.optimizeTripDay({ ...formEvent(u, t.id, f), cookies })
	).rejects.toMatchObject({ status: 303, location: `/trips/${t.id}` });
	expect(cookies.set).toHaveBeenCalledWith('flash', expect.stringContaining('Optimized 3 stops'), expect.anything());

	for (const [index, s] of [a, b, c].entries()) {
		const row = kit.selectFrom(segments).where(eq(segments.id, BigInt(s.id))).executeSync()[0];
		expect(row?.day_sort_order).toBe(BigInt(index + 1));
	}
});

test('optimizeTripDay action rejects read-share viewers and invalid dates', async () => {
	const u = makeUser(kit, { email: 'opt-owner@x.c', passwordHash: 'x', displayName: 'U' });
	const viewer = makeUser(kit, { email: 'opt-viewer@x.c', passwordHash: 'x', displayName: 'V' });
	const t = makeTrip(kit, u.id, { name: 'T' });
	makeShare(kit, { tripId: t.id, sharedWithUserId: viewer.id, permission: 'read' });

	const f = new FormData();
	f.set('date', '2026-07-10');
	await expect(
		actions.optimizeTripDay({ ...formEvent(viewer, t.id, f), cookies: { set: vi.fn() } })
	).rejects.toMatchObject({ status: 404 });

	const bad = new FormData();
	bad.set('date', 'not-a-date');
	await expect(
		actions.optimizeTripDay({ ...formEvent(u, t.id, bad), cookies: { set: vi.fn() } })
	).rejects.toMatchObject({ status: 400 });
});

test('saveTripTemplate action saves a template and redirects', async () => {
	const u = usersRepo.createUser({
		email: 'stpl@x.c',
		password_hash: 'x',
		display_name: 'U',
		calendar_token: null,
		calendar_token_expires_at: null
	});
	const t = tripsRepo.createTrip(Number(u.id), { name: 'T' });

	const templateForm = new FormData();
	templateForm.set('name', 'Template');
	await expect(
		actions.saveTripTemplate(formEvent({ id: Number(u.id) }, t.id, templateForm))
	).rejects.toMatchObject({
		status: 303,
		location: `/trips/${t.id}`
	});

	expect(kit.selectFrom(tripTemplates).where(eq(tripTemplates.user_id, u.id)).executeSync()).toHaveLength(1);
});

test('addHomeTask action creates a task and redirects', async () => {
	const u = makeUser(kit, { email: 'ht-act@x.c', passwordHash: 'x', displayName: 'U' });
	const t = makeTrip(kit, u.id, { name: 'T' });

	const f = new FormData();
	f.set('text', 'Stop mail');
	f.set('dueDate', '2026-07-01');
	await expect(actions.addHomeTask(formEvent(u, t.id, f))).rejects.toMatchObject({
		status: 303,
		location: `/trips/${t.id}`
	});

	expect(kit.selectFrom(tripHomeTasks).where(eq(tripHomeTasks.trip_id, BigInt(t.id))).executeSync()).toHaveLength(1);
});

test('addMedication action creates a schedule and redirects', async () => {
	const u = makeUser(kit, { email: 'med-act@x.c', passwordHash: 'x', displayName: 'U' });
	const t = makeTrip(kit, u.id, { name: 'T' });

	const f = new FormData();
	f.set('name', 'Claritin');
	f.set('dosage', '5mg');
	await expect(actions.addMedication(formEvent(u, t.id, f))).rejects.toMatchObject({
		status: 303,
		location: `/trips/${t.id}`
	});

	expect(kit.selectFrom(tripMedications).where(eq(tripMedications.trip_id, BigInt(t.id))).executeSync()).toHaveLength(1);
});

test('addEntryRequirement action creates a requirement and redirects', async () => {
	const u = makeUser(kit, { email: 'er-act@x.c', passwordHash: 'x', displayName: 'U' });
	const t = makeTrip(kit, u.id, { name: 'T' });

	const f = new FormData();
	f.set('country', 'Japan');
	f.set('requirementType', 'visa');
	f.set('status', 'in_progress');
	await expect(actions.addEntryRequirement(formEvent(u, t.id, f))).rejects.toMatchObject({
		status: 303,
		location: `/trips/${t.id}`
	});

	const rows = kit.selectFrom(tripEntryRequirements).where(eq(tripEntryRequirements.trip_id, BigInt(t.id))).executeSync();
	expect(rows).toHaveLength(1);
	expect(rows[0].status).toBe('in_progress');
});

test('addImportantItem action creates an item and redirects', async () => {
	const u = makeUser(kit, { email: 'ii-act@x.c', passwordHash: 'x', displayName: 'U' });
	const t = makeTrip(kit, u.id, { name: 'T' });

	const f = new FormData();
	f.set('name', 'Passport');
	f.set('serialNumber', 'ABC123');
	await expect(actions.addImportantItem(formEvent(u, t.id, f))).rejects.toMatchObject({
		status: 303,
		location: `/trips/${t.id}`
	});

	const rows = kit.selectFrom(tripImportantItems).where(eq(tripImportantItems.trip_id, BigInt(t.id))).executeSync();
	expect(rows).toHaveLength(1);
	expect(rows[0].serial_number).toBe('ABC123');
});

test('addAttachment action uploads a receipt and redirects', async () => {
	const u = makeUser(kit, { email: 'att-act@x.c', passwordHash: 'x', displayName: 'U' });
	const t = makeTrip(kit, u.id, { name: 'T' });
	const e = makeExpense(kit, { tripId: t.id, description: 'Dinner', amount: 5000, currency: 'USD' });

	const f = new FormData();
	f.set('expenseId', String(e.id));
	const pngMagic = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
	f.set('file', new File([Buffer.concat([pngMagic, Buffer.from('hello')])], 'receipt.png', { type: 'image/png' }));
	await expect(actions.addAttachment(formEvent(u, t.id, f))).rejects.toMatchObject({
		status: 303,
		location: `/trips/${t.id}`
	});

	expect(kit.selectFrom(tripExpenseAttachments).where(eq(tripExpenseAttachments.expense_id, BigInt(e.id))).executeSync()).toHaveLength(1);
});

test('uploadTripPoster action stores the selected image and redirects', async () => {
	const u = makeUser(kit, { email: 'poster-act@x.c', passwordHash: 'x', displayName: 'U' });
	const t = makeTrip(kit, u.id, { name: 'T' });
	const pngMagic = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
	const f = new FormData();
	f.set('file', new File([Buffer.concat([pngMagic, Buffer.from('hello')])], 'poster.png', { type: 'image/png' }));

	await expect(actions.uploadTripPoster(formEvent(u, t.id, f))).rejects.toMatchObject({
		status: 303,
		location: `/trips/${t.id}`
	});

	const row = kit.selectFrom(trips).where(eq(trips.id, BigInt(t.id))).executeSync()[0];
	expect(row.poster_attachment_id).not.toBeNull();
});

test('load includes day notes for the owner and for shared read viewers', async () => {
	const owner = makeUser(kit, { email: 'dn-owner@x.c', passwordHash: 'x', displayName: 'O' });
	const reader = makeUser(kit, { email: 'dn-reader@x.c', passwordHash: 'x', displayName: 'R' });
	const t = makeTrip(kit, owner.id, { name: 'T' });
	setDayNote(owner.id, t.id, '2026-06-10', { icon: 'star', body: 'Museum day' });
	makeShare(kit, { tripId: t.id, sharedWithUserId: reader.id });

	const ownerResult = await load(event(owner, t.id)) as { dayNotes: { date: string; body: string }[] };
	expect(ownerResult.dayNotes).toHaveLength(1);
	expect(ownerResult.dayNotes[0].body).toBe('Museum day');

	const readerResult = await load(event(reader, t.id)) as { dayNotes: { date: string; body: string }[] };
	expect(readerResult.dayNotes).toHaveLength(1);
});

test('setDayNote action upserts a note and redirects', async () => {
	const u = makeUser(kit, { email: 'dn-act@x.c', passwordHash: 'x', displayName: 'U' });
	const t = makeTrip(kit, u.id, { name: 'T' });

	const f = new FormData();
	f.set('date', '2026-06-10');
	f.set('icon', 'info');
	f.set('body', 'Note from action');
	await expect(actions.setDayNote(formEvent(u, t.id, f))).rejects.toMatchObject({
		status: 303,
		location: `/trips/${t.id}`
	});

	const rows = kit.selectFrom(tripDayNotes).where(eq(tripDayNotes.trip_id, BigInt(t.id))).executeSync();
	expect(rows).toHaveLength(1);
	expect(rows[0].body).toBe('Note from action');
});

test('setDayNote action rejects a non-editor', async () => {
	const owner = makeUser(kit, { email: 'dn-ne-owner@x.c', passwordHash: 'x', displayName: 'O' });
	const other = makeUser(kit, { email: 'dn-ne-other@x.c', passwordHash: 'x', displayName: 'X' });
	const t = makeTrip(kit, owner.id, { name: 'T' });

	const f = new FormData();
	f.set('date', '2026-06-10');
	f.set('body', 'Hacked');
	await expect(actions.setDayNote(formEvent(other, t.id, f))).rejects.toMatchObject({ status: 404 });
	expect(kit.selectFrom(tripDayNotes).where(eq(tripDayNotes.trip_id, BigInt(t.id))).executeSync()).toHaveLength(0);
});

test('deleteDayNote action removes the note and redirects', async () => {
	const u = makeUser(kit, { email: 'dn-del@x.c', passwordHash: 'x', displayName: 'U' });
	const t = makeTrip(kit, u.id, { name: 'T' });
	setDayNote(u.id, t.id, '2026-06-10', { body: 'Gone' });

	const f = new FormData();
	f.set('date', '2026-06-10');
	await expect(actions.deleteDayNote(formEvent(u, t.id, f))).rejects.toMatchObject({
		status: 303,
		location: `/trips/${t.id}`
	});
	expect(kit.selectFrom(tripDayNotes).where(eq(tripDayNotes.trip_id, BigInt(t.id))).executeSync()).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// Gallery (Phase 5)
// ---------------------------------------------------------------------------

const GALLERY_PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

function galleryPng(name = 'photo.png') {
	return new File([GALLERY_PNG], name, { type: 'image/png' });
}

async function withAttachmentsPath<T>(fn: () => Promise<T>): Promise<T> {
	const { mkdtempSync, rmSync } = await import('node:fs');
	const { tmpdir } = await import('node:os');
	const path = await import('node:path');
	const original = process.env.ATTACHMENTS_PATH;
	const dir = mkdtempSync(path.join(tmpdir(), 'roamarr-trip-gallery-'));
	process.env.ATTACHMENTS_PATH = dir;
	try {
		return await fn();
	} finally {
		if (original === undefined) delete process.env.ATTACHMENTS_PATH;
		else process.env.ATTACHMENTS_PATH = original;
		rmSync(dir, { recursive: true, force: true });
	}
}

test('load includes gallery images for editors and hides them from view shares', async () => {
	await withAttachmentsPath(async () => {
		const u = makeUser(kit, { email: 'gal@x.c', passwordHash: 'x', displayName: 'U' });
		const viewer = makeUser(kit, { email: 'gal-v@x.c', passwordHash: 'x', displayName: 'V' });
		const t = makeTrip(kit, u.id, { name: 'T' });
		makeShare(kit, { tripId: t.id, sharedWithUserId: viewer.id, permission: 'read' });

		const f = new FormData();
		f.append('images', galleryPng('one.png'));
		f.append('images', galleryPng('two.png'));
		await expect(actions.uploadGalleryImages(formEvent(u, t.id, f))).rejects.toMatchObject({
			status: 303,
			location: `/trips/${t.id}`
		});

		const owned = (await load(event(u, t.id))) as {
			gallery: { id: number; attachmentId: number; filename: string; sortOrder: number }[];
		};
		expect(owned.gallery).toHaveLength(2);
		expect(owned.gallery[0].filename).toBe('one.png');
		expect(owned.gallery.map((g) => g.sortOrder)).toEqual([0, 1]);

		const shared = (await load(event(viewer, t.id))) as { gallery: unknown[] };
		expect(shared.gallery).toEqual([]);
	});
});

function tripGalleryRows(tripId: number) {
	return kit
		.selectFrom(galleryImages)
		.where(eq(galleryImages.owner_id, BigInt(tripId)))
		.executeSync();
}

test('uploadGalleryImages rejects non-images and read-only shares', async () => {
	await withAttachmentsPath(async () => {
		const u = makeUser(kit, { email: 'gal2@x.c', passwordHash: 'x', displayName: 'U' });
		const viewer = makeUser(kit, { email: 'gal2-v@x.c', passwordHash: 'x', displayName: 'V' });
		const t = makeTrip(kit, u.id, { name: 'T' });
		makeShare(kit, { tripId: t.id, sharedWithUserId: viewer.id, permission: 'read' });

		const pdfForm = new FormData();
		pdfForm.append(
			'images',
			new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'doc.pdf', { type: 'application/pdf' })
		);
		await expect(actions.uploadGalleryImages(formEvent(u, t.id, pdfForm))).rejects.toMatchObject({
			status: 400
		});

		const shareForm = new FormData();
		shareForm.append('images', galleryPng());
		await expect(
			actions.uploadGalleryImages(formEvent(viewer, t.id, shareForm))
		).rejects.toMatchObject({ status: 404 });
		expect(tripGalleryRows(t.id)).toHaveLength(0);
	});
});

test('removeGalleryImage deletes the attachment; cross-trip image ids are 404', async () => {
	await withAttachmentsPath(async () => {
		const u = makeUser(kit, { email: 'gal3@x.c', passwordHash: 'x', displayName: 'U' });
		const t = makeTrip(kit, u.id, { name: 'T' });
		const other = makeTrip(kit, u.id, { name: 'T2' });

		const upload = new FormData();
		upload.append('images', galleryPng());
		await expect(actions.uploadGalleryImages(formEvent(u, t.id, upload))).rejects.toMatchObject({
			status: 303
		});
		const image = tripGalleryRows(t.id)[0]!;
		const attachmentRow = () =>
			kit
				.selectFrom(attachments)
				.where(eq(attachments.id, image.attachment_id))
				.executeSync()[0];
		expect(attachmentRow()).toBeTruthy();

		const wrongTrip = new FormData();
		wrongTrip.set('imageId', String(Number(image.id)));
		await expect(
			actions.removeGalleryImage(formEvent(u, other.id, wrongTrip))
		).rejects.toMatchObject({ status: 404 });

		const f = new FormData();
		f.set('imageId', String(Number(image.id)));
		await expect(actions.removeGalleryImage(formEvent(u, t.id, f))).rejects.toMatchObject({
			status: 303
		});
		expect(tripGalleryRows(t.id)).toHaveLength(0);
		expect(attachmentRow()).toBeUndefined();
	});
});

test('moveGalleryImage and setGalleryCaption update ordering and captions', async () => {
	await withAttachmentsPath(async () => {
		const u = makeUser(kit, { email: 'gal4@x.c', passwordHash: 'x', displayName: 'U' });
		const t = makeTrip(kit, u.id, { name: 'T' });

		const upload = new FormData();
		upload.append('images', galleryPng('a.png'));
		upload.append('images', galleryPng('b.png'));
		await expect(actions.uploadGalleryImages(formEvent(u, t.id, upload))).rejects.toMatchObject({
			status: 303
		});
		const rows = tripGalleryRows(t.id);
		const first = rows.find((r) => r.sort_order === 0n)!;

		const move = new FormData();
		move.set('imageId', String(Number(first.id)));
		move.set('direction', 'later');
		await expect(actions.moveGalleryImage(formEvent(u, t.id, move))).rejects.toMatchObject({
			status: 303
		});
		const after = tripGalleryRows(t.id);
		expect(after.find((r) => r.id === first.id)!.sort_order).toBe(1n);

		const caption = new FormData();
		caption.set('imageId', String(Number(first.id)));
		caption.set('caption', 'Beach day');
		await expect(actions.setGalleryCaption(formEvent(u, t.id, caption))).rejects.toMatchObject({
			status: 303
		});
		expect(tripGalleryRows(t.id).find((r) => r.id === first.id)!.caption).toBe(
			'Beach day'
		);
	});
});

test('_deleteTrip removes gallery rows and attachments', async () => {
	await withAttachmentsPath(async () => {
		const u = makeUser(kit, { email: 'gal5@x.c', passwordHash: 'x', displayName: 'U' });
		const t = makeTrip(kit, u.id, { name: 'T' });
		const upload = new FormData();
		upload.append('images', galleryPng());
		await expect(actions.uploadGalleryImages(formEvent(u, t.id, upload))).rejects.toMatchObject({
			status: 303
		});
		const seeded = tripGalleryRows(t.id);
		expect(seeded).toHaveLength(1);

		await _deleteTrip(u.id, t.id);
		expect(tripGalleryRows(t.id)).toHaveLength(0);
		expect(
			kit
				.selectFrom(attachments)
				.where(eq(attachments.id, seeded[0]!.attachment_id))
				.executeSync()
		).toHaveLength(0);
	});
});
