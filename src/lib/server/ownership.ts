import { and, eq, inArray } from 'drizzle-orm';
import { error } from '@sveltejs/kit';
import { db } from './db';
import { trips, cards, fareProviders, segments, groups, travelDocuments, users, tripCompanions } from './db/schema';
import { canEdit } from './sharing';
import type { SQLiteTable, AnySQLiteColumn } from 'drizzle-orm/sqlite-core';

export function requireOwnedUser(userId: number) {
	const u = db.select().from(users).where(eq(users.id, userId)).get();
	if (!u) throw error(404, 'Not found');
	return u;
}

export function requireOwnedTrip(userId: number, tripId: number) {
	const t = db
		.select()
		.from(trips)
		.where(and(eq(trips.id, tripId), eq(trips.ownerId, userId)))
		.get();
	if (!t) throw error(404, 'Not found');
	return t;
}

export function requireEditableTrip(userId: number, tripId: number) {
	const t = db.select().from(trips).where(eq(trips.id, tripId)).get();
	if (!t || !canEdit(userId, t)) throw error(404, 'Not found');
	return t;
}

export function requireOwnedGroup(userId: number, groupId: number) {
	const g = db
		.select()
		.from(groups)
		.where(and(eq(groups.id, groupId), eq(groups.ownerId, userId)))
		.get();
	if (!g) throw error(404, 'Not found');
	return g;
}

export function requireOwnedDocument(userId: number, documentId: number) {
	const d = db
		.select()
		.from(travelDocuments)
		.where(and(eq(travelDocuments.id, documentId), eq(travelDocuments.userId, userId)))
		.get();
	if (!d) throw error(404, 'Not found');
	return d;
}

export function requireOwnedTripRow<TTable extends SQLiteTable>(
	table: TTable & { id: AnySQLiteColumn; tripId: AnySQLiteColumn },
	tripId: number,
	id: number,
	notFoundMessage = 'Not found'
): TTable['$inferSelect'] {
	const row = db.select().from(table).where(and(eq(table.id, id), eq(table.tripId, tripId))).get();
	if (!row) throw error(404, notFoundMessage);
	return row;
}

export function requireOwnedUserRow<TTable extends SQLiteTable>(
	table: TTable & { id: AnySQLiteColumn; userId: AnySQLiteColumn },
	userId: number,
	id: number,
	notFoundMessage = 'Not found'
): TTable['$inferSelect'] {
	const row = db.select().from(table).where(and(eq(table.id, id), eq(table.userId, userId))).get();
	if (!row) throw error(404, notFoundMessage);
	return row;
}

export function requireCompanionOnTrip(companionId: number | null | undefined, tripId: number) {
	if (companionId == null) return null;
	const c = db
		.select({ id: tripCompanions.id })
		.from(tripCompanions)
		.where(and(eq(tripCompanions.id, companionId), eq(tripCompanions.tripId, tripId)))
		.get();
	if (!c) throw error(400, 'Companion is not on this trip');
	return companionId;
}

export function requireCompanionsOnTrip(companionIds: number[], tripId: number) {
	if (companionIds.length === 0) return;
	const found = db
		.select({ id: tripCompanions.id })
		.from(tripCompanions)
		.where(and(eq(tripCompanions.tripId, tripId), inArray(tripCompanions.id, companionIds)))
		.all();
	const foundIds = new Set(found.map((c) => c.id));
	if (foundIds.size !== companionIds.length) throw error(400, 'Companion is not on this trip');
}

export function assertOwnedRefs(
	userId: number,
	refs: {
		cardId?: number | null;
		tripId?: number | null;
		providerId?: number | null;
		segmentId?: number | null;
	}
) {
	if (refs.tripId != null) requireOwnedTrip(userId, refs.tripId);
	if (refs.cardId != null) {
		const c = db
			.select()
			.from(cards)
			.where(and(eq(cards.id, refs.cardId), eq(cards.userId, userId)))
			.get();
		if (!c) throw error(404, 'Not found');
	}
	if (refs.providerId != null) {
		const p = db
			.select()
			.from(fareProviders)
			.where(and(eq(fareProviders.id, refs.providerId), eq(fareProviders.userId, userId)))
			.get();
		if (!p) throw error(404, 'Not found');
	}
	if (refs.segmentId != null) {
		const s = db
			.select({ tripId: segments.tripId })
			.from(segments)
			.where(eq(segments.id, refs.segmentId))
			.get();
		if (!s) throw error(404, 'Not found');
		requireOwnedTrip(userId, s.tripId);
	}
}
