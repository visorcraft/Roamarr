import { error, fail, redirect, type Actions } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { requireUser } from '$lib/server/auth';
import { requireEditableTrip, assertOwnedRefs } from '$lib/server/ownership';
import { localToUtc } from '$lib/server/tz';
import { upsertRemindersForSegment, cancelRemindersFor } from '$lib/server/reminders';
import { db } from '$lib/server/db';
import { segments, SEGMENT_TYPES, type SegmentType } from '$lib/server/db/schema';
import { combineDateTime, parseSegmentDetails } from '$lib/server/segmentForm';
import { Validator } from '$lib/server/validation';

function readLocalStart(v: Validator, f: FormData, optional = false): string | undefined {
	const direct = f.get('localStart');
	if (typeof direct === 'string' && direct.trim()) {
		return optional ? v.dateTime(direct, 'localStart') : v.requiredDateTime(direct, 'localStart');
	}

	const startDate = optional ? v.date(f.get('startDate'), 'startDate') : v.requiredDate(f.get('startDate'), 'startDate');
	const startTime = typeof f.get('startTime') === 'string' ? f.get('startTime').trim() : '';
	if (!startDate) return undefined;

	const combined = combineDateTime(startDate, startTime);
	return optional ? v.dateTime(combined, 'localStart') : v.requiredDateTime(combined!, 'localStart');
}

function readEndAt(v: Validator, f: FormData): string | undefined {
	const direct = f.get('endAt');
	if (typeof direct === 'string' && direct.trim()) return v.dateTime(direct, 'endAt');

	const endDate = v.date(f.get('endDate'), 'endDate');
	const endTime = typeof f.get('endTime') === 'string' ? f.get('endTime').trim() : '';
	if (!endDate) return undefined;
	return v.dateTime(combineDateTime(endDate, endTime), 'endAt');
}

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
	requireEditableTrip(userId, tripId);
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
	requireEditableTrip(userId, tripId);
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
	requireEditableTrip(userId, tripId);
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
		const localStart = readLocalStart(v, f);
		const startTz = v.timezone(f.get('startTz') || u.timezone, 'startTz');
		const endAt = readEndAt(v, f);
		const location = v.optionalString(f.get('location'), 'location', { max: 200 });
		const confirmationNumber = v.optionalString(
			f.get('confirmationNumber'),
			'confirmationNumber',
			{ max: 100 }
		);
		const cardId = f.get('cardId') ? v.positiveId(f.get('cardId'), 'cardId') : undefined;
		const details = parseSegmentDetails(f);

		if (!v.ok()) {
			return fail(400, {
				error: v.failMessage(),
				errors: v.errors,
				type: typeof f.get('type') === 'string' ? f.get('type') : undefined
			});
		}

		_addSegment(u.id, Number(params.id), {
			type: type!,
			title: title!,
			localStart: localStart!,
			startTz: startTz!,
			endAt: endAt ?? undefined,
			location,
			confirmationNumber,
			cardId,
			details
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
		const v = new Validator();
		if (detailsRaw) {
			try {
				details = JSON.parse(detailsRaw);
			} catch {
				v.addError('detailsJson', 'Invalid details JSON');
			}
		}
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
