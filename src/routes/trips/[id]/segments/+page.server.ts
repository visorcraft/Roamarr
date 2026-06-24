import { error, fail, redirect, type Actions } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { requireUser } from '$lib/server/auth';
import { requireOwnedTrip, assertOwnedRefs } from '$lib/server/ownership';
import { localToUtc } from '$lib/server/tz';
import { upsertRemindersForSegment, cancelRemindersFor } from '$lib/server/reminders';
import { db } from '$lib/server/db';
import { segments, SEGMENT_TYPES, type SegmentType } from '$lib/server/db/schema';
import { Validator } from '$lib/server/validation';

export function _addSegment(
	userId: number,
	tripId: number,
	i: {
		type: SegmentType;
		title: string;
		localStart: string;
		startTz: string;
		endAt?: string;
		location?: string;
		confirmationNumber?: string;
		cardId?: number;
		details?: object;
	}
) {
	requireOwnedTrip(userId, tripId);
	if (i.cardId != null) assertOwnedRefs(userId, { cardId: i.cardId });
	const seg = db
		.insert(segments)
		.values({
			tripId,
			type: i.type,
			title: i.title,
			startAt: localToUtc(i.localStart, i.startTz),
			startTz: i.startTz,
			endAt: i.endAt ?? null,
			location: i.location ?? null,
			confirmationNumber: i.confirmationNumber ?? null,
			cardId: i.cardId ?? null,
			detailsJson: i.details ? JSON.stringify(i.details) : null
		})
		.returning()
		.get();
	upsertRemindersForSegment(seg);
	return seg;
}

export function _deleteSegment(userId: number, tripId: number, segId: number) {
	requireOwnedTrip(userId, tripId);
	db.delete(segments).where(and(eq(segments.id, segId), eq(segments.tripId, tripId))).run();
	cancelRemindersFor('segment', segId);
}

export function _updateSegment(
	userId: number,
	tripId: number,
	segId: number,
	i: {
		title: string;
		localStart: string;
		startTz: string;
		endAt?: string;
		location?: string;
		confirmationNumber?: string;
		details?: object;
	}
) {
	requireOwnedTrip(userId, tripId);
	const existing = db
		.select()
		.from(segments)
		.where(and(eq(segments.id, segId), eq(segments.tripId, tripId)))
		.get();
	if (!existing) throw error(404, 'Not found');
	const seg = db
		.update(segments)
		.set({
			title: i.title,
			startAt: localToUtc(i.localStart, i.startTz),
			startTz: i.startTz,
			endAt: i.endAt ?? null,
			location: i.location ?? null,
			confirmationNumber: i.confirmationNumber ?? null,
			detailsJson: i.details ? JSON.stringify(i.details) : null
		})
		.where(eq(segments.id, segId))
		.returning()
		.get();
	upsertRemindersForSegment(seg);
	return seg;
}

export const actions: Actions = {
	add: async ({ request, locals, params }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const v = new Validator();

		const type = v.enumValue(f.get('type'), SEGMENT_TYPES, 'type');
		const title = v.requiredString(f.get('title'), 'title', { max: 200 });
		const localStart = v.requiredDateTime(f.get('localStart'), 'localStart');
		const startTz = v.timezone(f.get('startTz') || u.timezone, 'startTz');
		const endAt = v.dateTime(f.get('endAt'), 'endAt');
		const location = v.optionalString(f.get('location'), 'location', { max: 200 });
		const confirmationNumber = v.optionalString(
			f.get('confirmationNumber'),
			'confirmationNumber',
			{ max: 100 }
		);
		const cardId = f.get('cardId') ? v.positiveId(f.get('cardId'), 'cardId') : undefined;

		if (!v.ok()) return fail(400, { error: v.failMessage(), errors: v.errors });

		_addSegment(u.id, Number(params.id), {
			type: type!,
			title: title!,
			localStart: localStart!,
			startTz: startTz!,
			endAt: endAt ?? undefined,
			location,
			confirmationNumber,
			cardId
		});
		throw redirect(303, `/trips/${params.id}`);
	},
	delete: async ({ request, locals, params }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const v = new Validator();
		const segmentId = v.positiveId(f.get('segmentId'), 'segmentId');
		if (!v.ok()) return fail(400, { error: v.failMessage(), errors: v.errors });
		_deleteSegment(u.id, Number(params.id), segmentId!);
		throw redirect(303, `/trips/${params.id}`);
	},
	update: async ({ request, locals, params }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		let details: object | undefined;
		const detailsRaw = String(f.get('detailsJson') || '');
		if (detailsRaw) {
			try {
				details = JSON.parse(detailsRaw);
			} catch {
				return fail(400, { error: 'Invalid details JSON' });
			}
		}
		const v = new Validator();
		const segmentId = v.positiveId(f.get('segmentId'), 'segmentId');
		const title = v.requiredString(f.get('title'), 'title', { max: 200 });
		const localStart = v.requiredDateTime(f.get('localStart'), 'localStart');
		const startTz = v.timezone(f.get('startTz') || u.timezone, 'startTz');
		const endAt = v.dateTime(f.get('endAt'), 'endAt');
		const location = v.optionalString(f.get('location'), 'location', { max: 200 });
		const confirmationNumber = v.optionalString(
			f.get('confirmationNumber'),
			'confirmationNumber',
			{ max: 100 }
		);

		if (!v.ok()) return fail(400, { error: v.failMessage(), errors: v.errors });

		_updateSegment(u.id, Number(params.id), segmentId!, {
			title: title!,
			localStart: localStart!,
			startTz: startTz!,
			endAt: endAt ?? undefined,
			location,
			confirmationNumber,
			details
		});
		throw redirect(303, `/trips/${params.id}`);
	}
};
