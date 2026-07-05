import { eq as kitEq, and, inList } from '@visorcraft/mongreldb-kit';
import type { TableSpec, Row } from '@visorcraft/mongreldb-kit';
import { error } from '@sveltejs/kit';
import { kit } from './db';
import {
	cards,
	fareProviders,
	segments,
	tripCompanions,
	users
} from './db/mongrelSchema';
import * as tripsRepo from './repositories/tripsRepo';
import { canEdit } from './sharing';

export function requireOwnedUser(userId: number) {
	const u = kit.selectFrom(users).where(kitEq(users.id, BigInt(userId))).executeSync()[0];
	if (!u) throw error(404, 'Not found');
	return u;
}

export function requireOwnedTrip(userId: number, tripId: number) {
	const t = tripsRepo.getTripById(tripId);
	if (!t || t.ownerId !== userId) throw error(404, 'Not found');
	return t;
}

export function requireEditableTrip(userId: number, tripId: number) {
	const t = tripsRepo.getTripById(tripId);
	if (!t || !canEdit(userId, t)) throw error(404, 'Not found');
	return t;
}

export function requireOwnedGroup(userId: number, groupId: number) {
	const g = tripsRepo.getGroupById(groupId);
	if (!g || g.ownerId !== userId) throw error(404, 'Not found');
	return g;
}

export function requireOwnedTripRow<TTable extends TableSpec & { id: unknown; trip_id: unknown }>(
	table: TTable,
	tripId: number,
	id: number,
	notFoundMessage = 'Not found'
): Row<TTable> {
	const row = kit
		.selectFrom(table)
		.where(and(kitEq(table.id as any, BigInt(id)), kitEq(table.trip_id as any, BigInt(tripId))))
		.executeSync()[0];
	if (!row) throw error(404, notFoundMessage);
	return row as Row<TTable>;
}

export function requireOwnedUserRow<TTable extends TableSpec & { id: unknown; user_id: unknown }>(
	table: TTable,
	userId: number,
	id: number,
	notFoundMessage = 'Not found'
): Row<TTable> {
	const row = kit
		.selectFrom(table)
		.where(and(kitEq(table.id as any, BigInt(id)), kitEq(table.user_id as any, BigInt(userId))))
		.executeSync()[0];
	if (!row) throw error(404, notFoundMessage);
	return row as Row<TTable>;
}

export function requireCompanionOnTrip(companionId: number | null | undefined, tripId: number) {
	if (companionId == null) return null;
	const c = kit
		.selectFrom(tripCompanions)
		.where(and(kitEq(tripCompanions.id, BigInt(companionId)), kitEq(tripCompanions.trip_id, BigInt(tripId))))
		.executeSync()[0];
	if (!c) throw error(400, 'Companion is not on this trip');
	return companionId;
}

export function requireCompanionsOnTrip(companionIds: number[], tripId: number) {
	if (companionIds.length === 0) return;
	const found = kit
		.selectFrom(tripCompanions)
		.where(
			and(
				kitEq(tripCompanions.trip_id, BigInt(tripId)),
				inList(tripCompanions.id, companionIds.map((id) => BigInt(id)))
			)
		)
		.executeSync();
	const foundIds = new Set(found.map((c) => Number(c.id)));
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
		const c = kit
			.selectFrom(cards)
			.where(and(kitEq(cards.id, BigInt(refs.cardId)), kitEq(cards.user_id, BigInt(userId))))
			.executeSync()[0];
		if (!c) throw error(404, 'Not found');
	}
	if (refs.providerId != null) {
		const p = kit
			.selectFrom(fareProviders)
			.where(and(kitEq(fareProviders.id, BigInt(refs.providerId)), kitEq(fareProviders.user_id, BigInt(userId))))
			.executeSync()[0];
		if (!p) throw error(404, 'Not found');
	}
	if (refs.segmentId != null) {
		const s = kit.selectFrom(segments).where(kitEq(segments.id, BigInt(refs.segmentId))).executeSync()[0];
		if (!s) throw error(404, 'Not found');
		requireOwnedTrip(userId, Number(s.trip_id));
	}
}
