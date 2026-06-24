import { fail, redirect, type RequestEvent } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { combineDateTime, parseSegmentDetails } from '$lib/server/segmentForm';
import { Validator } from '$lib/server/validation';
import type { SegmentType } from '$lib/server/db/schema';
import { addSegment, hasOverlappingSegment } from '$lib/server/segments';
import { localToUtc } from '$lib/server/tz';
import { setFlash } from '$lib/server/flash';

function readLocalStart(v: Validator, f: FormData, optional = false): string | undefined {
	const direct = f.get('localStart');
	if (typeof direct === 'string' && direct.trim()) {
		return optional ? v.dateTime(direct, 'localStart') : v.requiredDateTime(direct, 'localStart');
	}

	const startDateRaw = f.get('startDate');
	const startDate = optional ? v.date(startDateRaw, 'startDate') : v.requiredDate(startDateRaw, 'startDate');
	const startTimeRaw = f.get('startTime');
	const startTime = typeof startTimeRaw === 'string' ? startTimeRaw.trim() : '';
	if (!startDate) return undefined;

	const combined = combineDateTime(startDate, startTime);
	return optional ? v.dateTime(combined, 'localStart') : v.requiredDateTime(combined!, 'localStart');
}

function readEndAt(v: Validator, f: FormData): string | undefined {
	const direct = f.get('endAt');
	if (typeof direct === 'string' && direct.trim()) return v.dateTime(direct, 'endAt');

	const endDateRaw = f.get('endDate');
	const endDate = v.date(endDateRaw, 'endDate');
	const endTimeRaw = f.get('endTime');
	const endTime = typeof endTimeRaw === 'string' ? endTimeRaw.trim() : '';
	if (!endDate) return undefined;
	return v.dateTime(combineDateTime(endDate, endTime), 'endAt');
}

export async function submitAddSegment(event: RequestEvent, type: SegmentType) {
	const u = requireUser(event.locals);
	const tripId = Number(event.params.id);
	const f = await event.request.formData();
	const v = new Validator();

	const title = v.requiredString(f.get('title'), 'title', { max: 200 });
	const localStart = readLocalStart(v, f);
	const startTz = v.timezone(f.get('startTz') || u.timezone, 'startTz');
	const endAt = readEndAt(v, f);
	const location = v.optionalString(f.get('location'), 'location', { max: 200 });
	const confirmationNumber = v.optionalString(f.get('confirmationNumber'), 'confirmationNumber', {
		max: 100
	});
	const cardId = f.get('cardId') ? v.positiveId(f.get('cardId'), 'cardId') : undefined;
	const details = parseSegmentDetails(f);

	if (!v.ok()) {
		return fail(400, { error: v.failMessage(), errors: v.errors, type });
	}

	const overlap = hasOverlappingSegment(
		tripId,
		undefined,
		localToUtc(localStart!, startTz!),
		endAt ?? null
	);
	addSegment(u.id, tripId, {
		type,
		title: title!,
		localStart: localStart!,
		startTz: startTz!,
		endAt: endAt ?? undefined,
		location,
		confirmationNumber,
		cardId,
		details
	});
	if (overlap) {
		setFlash(event.cookies, 'Warning: this segment overlaps an existing one.');
	}
	throw redirect(303, `/trips/${tripId}`);
}
