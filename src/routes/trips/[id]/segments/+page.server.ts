import { error, fail, redirect, type Actions } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { requireUser } from '$lib/server/auth';
import { requireOwnedTrip, assertOwnedRefs } from '$lib/server/ownership';
import { localToUtc } from '$lib/server/tz';
import { upsertRemindersForSegment, cancelRemindersFor } from '$lib/server/reminders';
import { db } from '$lib/server/db';
import { segments } from '$lib/server/db/schema';

export function _addSegment(
	userId: number,
	tripId: number,
	i: {
		type: 'flight' | 'lodging';
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
		_addSegment(u.id, Number(params.id), {
			type: f.get('type') as 'flight' | 'lodging',
			title: String(f.get('title')),
			localStart: String(f.get('localStart')),
			startTz: String(f.get('startTz') || u.timezone),
			endAt: String(f.get('endAt') || '') || undefined,
			location: String(f.get('location') || '') || undefined,
			confirmationNumber: String(f.get('confirmationNumber') || '') || undefined,
			cardId: f.get('cardId') ? Number(f.get('cardId')) : undefined
		});
		throw redirect(303, `/trips/${params.id}`);
	},
	delete: async ({ request, locals, params }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		_deleteSegment(u.id, Number(params.id), Number(f.get('segmentId')));
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
		_updateSegment(u.id, Number(params.id), Number(f.get('segmentId')), {
			title: String(f.get('title')),
			localStart: String(f.get('localStart')),
			startTz: String(f.get('startTz') || u.timezone),
			endAt: String(f.get('endAt') || '') || undefined,
			location: String(f.get('location') || '') || undefined,
			confirmationNumber: String(f.get('confirmationNumber') || '') || undefined,
			details
		});
		throw redirect(303, `/trips/${params.id}`);
	}
};
