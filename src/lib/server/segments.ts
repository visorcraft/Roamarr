import { error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { requireEditableTrip, assertOwnedRefs } from '$lib/server/ownership';
import { localToUtc } from '$lib/server/tz';
import { upsertRemindersForSegment, cancelRemindersFor } from '$lib/server/reminders';
import { db } from '$lib/server/db';
import { segments, type SegmentType } from '$lib/server/db/schema';

export function addSegment(
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

export function deleteSegment(userId: number, tripId: number, segId: number) {
	requireEditableTrip(userId, tripId);
	db.delete(segments).where(and(eq(segments.id, segId), eq(segments.tripId, tripId))).run();
	cancelRemindersFor('segment', segId);
}

export function updateSegment(
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
		cardId?: number;
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
	if (i.cardId != null) assertOwnedRefs(userId, { cardId: i.cardId });
	const seg = db
		.update(segments)
		.set({
			title: i.title,
			startAt: localToUtc(i.localStart, i.startTz),
			startTz: i.startTz,
			endAt: i.endAt ?? null,
			location: i.location ?? null,
			confirmationNumber: i.confirmationNumber ?? null,
			cardId: i.cardId ?? null,
			detailsJson: i.details ? JSON.stringify(i.details) : null
		})
		.where(eq(segments.id, segId))
		.returning()
		.get();
	upsertRemindersForSegment(seg);
	return seg;
}
