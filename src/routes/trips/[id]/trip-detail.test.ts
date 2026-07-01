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
	makeFareWatch,
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
	tripExpenseAttachments
} from '$lib/server/db/mongrelSchema';
import * as usersRepo from '$lib/server/repositories/usersRepo';
import * as tripsRepo from '$lib/server/repositories/tripsRepo';
import { upsertCustomReminder } from '$lib/server/reminders';
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

test('delete action removes trip-level reminders', () => {
	const u = makeUser(kit, { email: 'del@x.c', passwordHash: 'x', displayName: 'U' });
	const t = makeTrip(kit, u.id, { name: 'Del', startDate: '2099-01-01' });
	upsertCustomReminder(u.id, 'trip', t.id, `${t.startDate}T09:00:00Z`, 60);
	expect(kit.selectFrom(reminders).where(eq(reminders.ref_type, 'trip')).executeSync()).toHaveLength(1);

	_deleteTrip(u.id, t.id);
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
	expect(copy.start_at).toBe('2026-09-02T14:00:00.000Z');
	expect(copy.end_at).toBe('2026-09-02T16:00:00.000Z');
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
	f.set('file', new File(['hello'], 'receipt.png', { type: 'image/png' }));
	await expect(actions.addAttachment(formEvent(u, t.id, f))).rejects.toMatchObject({
		status: 303,
		location: `/trips/${t.id}`
	});

	expect(kit.selectFrom(tripExpenseAttachments).where(eq(tripExpenseAttachments.expense_id, BigInt(e.id))).executeSync()).toHaveLength(1);
});
