import { eq as kitEq, and, inList, asc, ne as kitNe } from '@mongreldb/kit';
import { eq as drizzleEq, and as drizzleAnd, inArray as drizzleInArray } from 'drizzle-orm';
import { db, kit } from '$lib/server/db';
import {
	users as usersTable,
	trips,
	tripComments,
	groups,
	groupMembers
} from '$lib/server/db/mongrelSchema';
import {
	trips as drizzleTrips,
	tripComments as drizzleTripComments,
	tripShares as drizzleTripShares,
	groups as drizzleGroups,
	groupMembers as drizzleGroupMembers
} from '$lib/server/db/schema';
import type { Row, Insert, Update } from '@mongreldb/kit';

export type KitTrip = Row<typeof trips>;
export type KitTripComment = Row<typeof tripComments>;
export type KitGroup = Row<typeof groups>;
export type KitGroupMember = Row<typeof groupMembers>;

export type SharePermission = 'read' | 'edit';
export type Visibility = 'private' | 'groups' | 'public';
export type TripStatus = 'planning' | 'booked' | 'active' | 'completed';

export interface Trip {
	id: number;
	ownerId: number;
	name: string;
	destination: string | null;
	destinationCountryCode: string | null;
	destinationCityName: string | null;
	destinationCityLat: number | null;
	destinationCityLng: number | null;
	startDate: string | null;
	endDate: string | null;
	notes: string | null;
	tags: string;
	archived: boolean;
	favorite: boolean;
	defaultVisibility: Visibility;
	publicToken: string | null;
	publicTokenExpiresAt: string | null;
	publicShowDetails: boolean;
	calendarToken: string | null;
	calendarTokenExpiresAt: string | null;
	baseCurrency: string;
	status: TripStatus;
	createdAt: string;
	updatedAt: string;
}

export interface TripShare {
	id: number;
	tripId: number;
	sharedWithUserId: number | null;
	sharedWithGroupId: number | null;
	permission: SharePermission;
	showDetails: boolean;
	createdAt: string;
}

export interface TripComment {
	id: number;
	tripId: number;
	userId: number;
	body: string;
	createdAt: string;
}

export interface Group {
	id: number;
	ownerId: number;
	name: string;
	createdAt: string;
}

export interface GroupMember {
	groupId: number;
	userId: number;
}

function kitId(id: number): bigint {
	return BigInt(id);
}

function num(id: bigint): number {
	return Number(id);
}

export function toTrip(row: KitTrip): Trip {
	return {
		id: num(row.id),
		ownerId: num(row.owner_id),
		name: row.name,
		destination: row.destination,
		destinationCountryCode: row.destination_country_code,
		destinationCityName: row.destination_city_name,
		destinationCityLat: row.destination_city_lat,
		destinationCityLng: row.destination_city_lng,
		startDate: row.start_date,
		endDate: row.end_date,
		notes: row.notes,
		tags: row.tags as string,
		archived: row.archived,
		favorite: row.favorite,
		defaultVisibility: row.default_visibility as Visibility,
		publicToken: row.public_token,
		publicTokenExpiresAt: row.public_token_expires_at,
		publicShowDetails: row.public_show_details,
		calendarToken: row.calendar_token,
		calendarTokenExpiresAt: row.calendar_token_expires_at,
		baseCurrency: row.base_currency,
		status: row.status as TripStatus,
		createdAt: row.created_at,
		updatedAt: row.updated_at
	};
}

type DrizzleTripShare = typeof drizzleTripShares.$inferSelect;

export function toTripShare(row: DrizzleTripShare): TripShare {
	return {
		id: row.id,
		tripId: row.tripId,
		sharedWithUserId: row.sharedWithUserId ?? null,
		sharedWithGroupId: row.sharedWithGroupId ?? null,
		permission: row.permission as SharePermission,
		showDetails: row.showDetails,
		createdAt: row.createdAt
	};
}

export function toTripComment(row: KitTripComment): TripComment {
	return {
		id: num(row.id),
		tripId: num(row.trip_id),
		userId: num(row.user_id),
		body: row.body,
		createdAt: row.created_at
	};
}

export function toGroup(row: KitGroup): Group {
	return {
		id: num(row.id),
		ownerId: num(row.owner_id),
		name: row.name,
		createdAt: row.created_at
	};
}

export function toGroupMember(row: KitGroupMember): GroupMember {
	return {
		groupId: num(row.group_id),
		userId: num(row.user_id)
	};
}

// Keep the legacy Drizzle tables in sync during the migration so that
// not-yet-migrated code (segments, expenses, etc.) can still read and
// foreign-key to trip, share, comment, and group rows.

function syncTripToLegacy(row: KitTrip) {
	db.insert(drizzleTrips)
		.values({
			id: num(row.id),
			ownerId: num(row.owner_id),
			name: row.name,
			destination: row.destination,
			destinationCountryCode: row.destination_country_code,
			destinationCityName: row.destination_city_name,
			destinationCityLat: row.destination_city_lat,
			destinationCityLng: row.destination_city_lng,
			startDate: row.start_date,
			endDate: row.end_date,
			notes: row.notes,
			tags: row.tags,
			archived: row.archived,
			favorite: row.favorite,
			defaultVisibility: row.default_visibility as Visibility,
			publicToken: row.public_token,
			publicTokenExpiresAt: row.public_token_expires_at,
			publicShowDetails: row.public_show_details,
			calendarToken: row.calendar_token,
			calendarTokenExpiresAt: row.calendar_token_expires_at,
			baseCurrency: row.base_currency,
			status: row.status as TripStatus,
			createdAt: row.created_at,
			updatedAt: row.updated_at
		} as any)
		.onConflictDoNothing({ target: drizzleTrips.id })
		.run();
}

function updateTripInLegacy(trip: Trip) {
	db.update(drizzleTrips)
		.set({
			ownerId: trip.ownerId,
			name: trip.name,
			destination: trip.destination,
			destinationCountryCode: trip.destinationCountryCode,
			destinationCityName: trip.destinationCityName,
			destinationCityLat: trip.destinationCityLat,
			destinationCityLng: trip.destinationCityLng,
			startDate: trip.startDate,
			endDate: trip.endDate,
			notes: trip.notes,
			tags: trip.tags,
			archived: trip.archived,
			favorite: trip.favorite,
			defaultVisibility: trip.defaultVisibility,
			publicToken: trip.publicToken,
			publicTokenExpiresAt: trip.publicTokenExpiresAt,
			publicShowDetails: trip.publicShowDetails,
			calendarToken: trip.calendarToken,
			calendarTokenExpiresAt: trip.calendarTokenExpiresAt,
			baseCurrency: trip.baseCurrency,
			status: trip.status,
			createdAt: trip.createdAt,
			updatedAt: trip.updatedAt
		})
		.where(drizzleEq(drizzleTrips.id, trip.id))
		.run();
}

function deleteTripFromLegacy(id: number) {
	db.delete(drizzleTrips).where(drizzleEq(drizzleTrips.id, id)).run();
}

function syncTripCommentToLegacy(row: KitTripComment) {
	db.insert(drizzleTripComments)
		.values({
			id: num(row.id),
			tripId: num(row.trip_id),
			userId: num(row.user_id),
			body: row.body,
			createdAt: row.created_at
		} as any)
		.onConflictDoNothing({ target: drizzleTripComments.id })
		.run();
}

function deleteTripCommentFromLegacy(id: number) {
	db.delete(drizzleTripComments).where(drizzleEq(drizzleTripComments.id, id)).run();
}

function syncGroupToLegacy(row: KitGroup) {
	db.insert(drizzleGroups)
		.values({
			id: num(row.id),
			ownerId: num(row.owner_id),
			name: row.name,
			createdAt: row.created_at
		} as any)
		.onConflictDoNothing({ target: drizzleGroups.id })
		.run();
}

function updateGroupInLegacy(group: Group) {
	db.update(drizzleGroups)
		.set({ ownerId: group.ownerId, name: group.name })
		.where(drizzleEq(drizzleGroups.id, group.id))
		.run();
}

function deleteGroupFromLegacy(id: number) {
	db.delete(drizzleGroups).where(drizzleEq(drizzleGroups.id, id)).run();
}

function syncGroupMemberToLegacy(groupId: number, userId: number) {
	db.insert(drizzleGroupMembers)
		.values({ groupId, userId })
		.onConflictDoNothing()
		.run();
}

function deleteGroupMemberFromLegacy(groupId: number, userId: number) {
	db.delete(drizzleGroupMembers)
		.where(drizzleAnd(drizzleEq(drizzleGroupMembers.groupId, groupId), drizzleEq(drizzleGroupMembers.userId, userId)))
		.run();
}

// Fallback to the legacy Drizzle row for reads. During normal operation all
// trip rows live in the kit table (and are mirrored to legacy), but tests for
// not-yet-migrated domains still create legacy trips directly.
function tripFromLegacy(id: number): Trip | null {
	const row = db.select().from(drizzleTrips).where(drizzleEq(drizzleTrips.id, id)).get();
	if (!row) return null;
	return {
		...row,
		defaultVisibility: row.defaultVisibility as Visibility,
		status: (row.status as TripStatus) ?? 'booked',
		tags: row.tags ?? '[]'
	} as Trip;
}

export function getTripById(id: number): Trip | null {
	const rows = kit.selectFrom(trips).where(kitEq(trips.id, kitId(id))).executeSync();
	if (rows[0]) return toTrip(rows[0]);
	return tripFromLegacy(id);
}

export function listTripsForUser(userId: number): Trip[] {
	const rows = kit
		.selectFrom(trips)
		.where(kitEq(trips.owner_id, kitId(userId)))
		.orderBy(asc(trips.start_date))
		.executeSync();
	return rows.map(toTrip);
}

export interface CreateTripInput {
	name: string;
	destination?: string | null;
	destinationCountryCode?: string | null;
	destinationCityName?: string | null;
	destinationCityLat?: number | null;
	destinationCityLng?: number | null;
	startDate?: string | null;
	endDate?: string | null;
	notes?: string | null;
	tags?: string | null;
	archived?: boolean;
	favorite?: boolean;
	defaultVisibility?: Visibility;
	publicToken?: string | null;
	publicTokenExpiresAt?: string | null;
	publicShowDetails?: boolean;
	calendarToken?: string | null;
	calendarTokenExpiresAt?: string | null;
	baseCurrency?: string;
	status?: TripStatus;
}

export type UpdateTripInput = Partial<Omit<CreateTripInput, 'name'>> & { name?: string; updatedAt?: string };

export function createTrip(ownerId: number, input: CreateTripInput): Trip {
	const row = kit
		.insertInto(trips)
		.values({
			owner_id: kitId(ownerId),
			name: input.name,
			destination: input.destination ?? null,
			destination_country_code: input.destinationCountryCode ?? null,
			destination_city_name: input.destinationCityName ?? null,
			destination_city_lat: input.destinationCityLat ?? null,
			destination_city_lng: input.destinationCityLng ?? null,
			start_date: input.startDate ?? null,
			end_date: input.endDate ?? null,
			notes: input.notes ?? null,
			tags: input.tags ?? '[]',
			archived: input.archived ?? false,
			favorite: input.favorite ?? false,
			default_visibility: input.defaultVisibility ?? 'private',
			public_token: input.publicToken ?? null,
			public_token_expires_at: input.publicTokenExpiresAt ?? null,
			public_show_details: input.publicShowDetails ?? false,
			calendar_token: input.calendarToken ?? null,
			calendar_token_expires_at: input.calendarTokenExpiresAt ?? null,
			base_currency: input.baseCurrency ?? 'USD',
			status: input.status ?? 'booked'
		} as Insert<typeof trips>)
		.executeSync();
	const trip = toTrip(row);
	syncTripToLegacy(row);
	return trip;
}

export function updateTrip(id: number, patch: UpdateTripInput): Trip | null {
	const set: Update<typeof trips> = {};
	if (patch.name !== undefined) set.name = patch.name;
	if (patch.destination !== undefined) set.destination = patch.destination;
	if (patch.destinationCountryCode !== undefined) set.destination_country_code = patch.destinationCountryCode;
	if (patch.destinationCityName !== undefined) set.destination_city_name = patch.destinationCityName;
	if (patch.destinationCityLat !== undefined) set.destination_city_lat = patch.destinationCityLat;
	if (patch.destinationCityLng !== undefined) set.destination_city_lng = patch.destinationCityLng;
	if (patch.startDate !== undefined) set.start_date = patch.startDate;
	if (patch.endDate !== undefined) set.end_date = patch.endDate;
	if (patch.notes !== undefined) set.notes = patch.notes;
	if (patch.tags !== undefined) set.tags = patch.tags;
	if (patch.archived !== undefined) set.archived = patch.archived;
	if (patch.favorite !== undefined) set.favorite = patch.favorite;
	if (patch.defaultVisibility !== undefined) set.default_visibility = patch.defaultVisibility;
	if (patch.publicToken !== undefined) set.public_token = patch.publicToken;
	if (patch.publicTokenExpiresAt !== undefined) set.public_token_expires_at = patch.publicTokenExpiresAt;
	if (patch.publicShowDetails !== undefined) set.public_show_details = patch.publicShowDetails;
	if (patch.calendarToken !== undefined) set.calendar_token = patch.calendarToken;
	if (patch.calendarTokenExpiresAt !== undefined) set.calendar_token_expires_at = patch.calendarTokenExpiresAt;
	if (patch.baseCurrency !== undefined) set.base_currency = patch.baseCurrency;
	if (patch.status !== undefined) set.status = patch.status;

	const updated = kit.updateTable(trips).set(set).where(kitEq(trips.id, kitId(id))).executeSync();
	const row = updated[0];
	if (!row) {
		// If the row only exists in legacy, try to update it there.
		const legacy = tripFromLegacy(id);
		if (!legacy) return null;
		const merged = {
			...legacy,
			...patch,
			defaultVisibility: (patch.defaultVisibility ?? legacy.defaultVisibility) as Visibility,
			status: (patch.status ?? legacy.status) as TripStatus,
			tags: patch.tags ?? legacy.tags ?? '[]'
		} as Trip;
		updateTripInLegacy(merged);
		return merged;
	}
	const trip = toTrip(row);
	updateTripInLegacy(trip);
	return trip;
}

export function deleteTrip(id: number): number {
	const deleted = kit.deleteFrom(trips).where(kitEq(trips.id, kitId(id))).executeSync();
	deleteTripFromLegacy(id);
	return Number(deleted);
}

export function listEditableTripIdsForUser(userId: number): number[] {
	const owned = listTripsForUser(userId).map((t) => t.id);

	const directShares = db
		.select({ tripId: drizzleTripShares.tripId })
		.from(drizzleTripShares)
		.where(
			drizzleAnd(
				drizzleEq(drizzleTripShares.sharedWithUserId, userId),
				drizzleEq(drizzleTripShares.permission, 'edit')
			)
		)
		.all();
	const directIds = directShares.map((s) => s.tripId);

	const memberships = kit
		.selectFrom(groupMembers)
		.where(kitEq(groupMembers.user_id, kitId(userId)))
		.executeSync();
	const groupIds = memberships.map((m) => num(m.group_id));

	let groupIdsResult: number[] = [];
	if (groupIds.length) {
		const groupShares = db
			.select({ tripId: drizzleTripShares.tripId })
			.from(drizzleTripShares)
			.where(
				drizzleAnd(
					drizzleInArray(drizzleTripShares.sharedWithGroupId, groupIds),
					drizzleEq(drizzleTripShares.permission, 'edit')
				)
			)
			.all();
		groupIdsResult = groupShares.map((s) => s.tripId);
	}

	return Array.from(new Set([...owned, ...directIds, ...groupIdsResult]));
}

export function listViewableTripIdsForUser(userId: number): number[] {
	const owned = listTripsForUser(userId).map((t) => t.id);

	const directShares = db
		.select({ tripId: drizzleTripShares.tripId })
		.from(drizzleTripShares)
		.where(drizzleEq(drizzleTripShares.sharedWithUserId, userId))
		.all();
	const directIds = directShares.map((s) => s.tripId);

	const memberships = kit
		.selectFrom(groupMembers)
		.where(kitEq(groupMembers.user_id, kitId(userId)))
		.executeSync();
	const groupIds = memberships.map((m) => num(m.group_id));

	let groupIdsResult: number[] = [];
	if (groupIds.length) {
		const groupShares = db
			.select({ tripId: drizzleTripShares.tripId })
			.from(drizzleTripShares)
			.where(drizzleInArray(drizzleTripShares.sharedWithGroupId, groupIds))
			.all();
		groupIdsResult = groupShares.map((s) => s.tripId);
	}

	return Array.from(new Set([...owned, ...directIds, ...groupIdsResult]));
}

export function listTripsSharedWithUser(userId: number): Trip[] {
	const directShares = db
		.select({ tripId: drizzleTripShares.tripId })
		.from(drizzleTripShares)
		.where(drizzleEq(drizzleTripShares.sharedWithUserId, userId))
		.all();
	const directTripIds = directShares.map((s) => s.tripId);

	const memberships = kit
		.selectFrom(groupMembers)
		.where(kitEq(groupMembers.user_id, kitId(userId)))
		.executeSync();
	const groupIds = memberships.map((m) => m.group_id);

	let groupTripIds: number[] = [];
	if (groupIds.length) {
		const groupShares = db
			.select({ tripId: drizzleTripShares.tripId })
			.from(drizzleTripShares)
			.where(drizzleInArray(drizzleTripShares.sharedWithGroupId, groupIds.map(Number)))
			.all();
		groupTripIds = groupShares.map((s) => s.tripId);
	}

	const ids = Array.from(new Set([...directTripIds, ...groupTripIds]));
	if (ids.length === 0) return [];
	const rows = kit
		.selectFrom(trips)
		.where(inList(trips.id, ids.map(kitId)))
		.executeSync();
	return rows.map(toTrip);
}

export function getTripByPublicToken(token: string): Trip | null {
	const rows = kit.selectFrom(trips).where(kitEq(trips.public_token, token)).executeSync();
	const row = rows[0];
	if (!row) return null;
	return toTrip(row);
}

export function getTripByCalendarToken(token: string): Trip | null {
	const rows = kit.selectFrom(trips).where(kitEq(trips.calendar_token, token)).executeSync();
	const row = rows[0];
	if (!row) return null;
	return toTrip(row);
}

// Comments

export interface TripCommentWithAuthor extends TripComment {
	displayName: string;
}

export function listCommentsForTrip(tripId: number): TripCommentWithAuthor[] {
	const rows = kit
		.selectFrom(tripComments)
		.where(kitEq(tripComments.trip_id, kitId(tripId)))
		.orderBy(asc(tripComments.created_at))
		.executeSync();
	if (rows.length === 0) return [];

	const userIds = Array.from(new Set(rows.map((r) => r.user_id)));
	const users = userIds.length
		? kit.selectFrom(usersTable).where(inList(usersTable.id, userIds)).executeSync()
		: [];
	const userMap = new Map(users.map((u) => [u.id, u.display_name]));

	return rows.map((r) => ({
		...toTripComment(r),
		displayName: userMap.get(r.user_id) ?? ''
	}));
}

export function createComment(userId: number, tripId: number, body: string): TripComment {
	const text = body.trim();
	const row = kit
		.insertInto(tripComments)
		.values({
			trip_id: kitId(tripId),
			user_id: kitId(userId),
			body: text
		} as Insert<typeof tripComments>)
		.executeSync();
	syncTripCommentToLegacy(row);
	return toTripComment(row);
}

export function deleteComment(userId: number, commentId: number): number {
	const deleted = kit
		.deleteFrom(tripComments)
		.where(and(kitEq(tripComments.id, kitId(commentId)), kitEq(tripComments.user_id, kitId(userId))))
		.executeSync();
	deleteTripCommentFromLegacy(commentId);
	return Number(deleted);
}

// Shares

export interface CreateTripShareInput {
	tripId: number;
	sharedWithUserId?: number | null;
	sharedWithGroupId?: number | null;
	permission?: SharePermission;
	showDetails?: boolean;
}

export type UpdateTripShareInput = Partial<
	Omit<CreateTripShareInput, 'tripId' | 'sharedWithUserId' | 'sharedWithGroupId'>
>;

export function listSharesForTrip(tripId: number): TripShare[] {
	const rows = db
		.select()
		.from(drizzleTripShares)
		.where(drizzleEq(drizzleTripShares.tripId, tripId))
		.all();
	return rows.map(toTripShare);
}

export function getShareById(id: number): TripShare | null {
	const rows = db
		.select()
		.from(drizzleTripShares)
		.where(drizzleEq(drizzleTripShares.id, id))
		.all();
	return rows[0] ? toTripShare(rows[0]) : null;
}

export function getDirectShareForTrip(tripId: number, userId: number): TripShare | null {
	const rows = db
		.select()
		.from(drizzleTripShares)
		.where(
			drizzleAnd(
				drizzleEq(drizzleTripShares.tripId, tripId),
				drizzleEq(drizzleTripShares.sharedWithUserId, userId)
			)
		)
		.all();
	return rows[0] ? toTripShare(rows[0]) : null;
}

export function getGroupShareForTrip(tripId: number, userId: number): TripShare | null {
	const memberships = kit
		.selectFrom(groupMembers)
		.where(kitEq(groupMembers.user_id, kitId(userId)))
		.executeSync();
	const groupIds = memberships.map((m) => num(m.group_id));
	if (groupIds.length === 0) return null;
	const rows = db
		.select()
		.from(drizzleTripShares)
		.where(
			drizzleAnd(
				drizzleEq(drizzleTripShares.tripId, tripId),
				drizzleInArray(drizzleTripShares.sharedWithGroupId, groupIds)
			)
		)
		.all();
	return rows[0] ? toTripShare(rows[0]) : null;
}

export function createShare(input: CreateTripShareInput): TripShare {
	const sharedWithUserId = input.sharedWithUserId ?? null;
	const sharedWithGroupId = input.sharedWithGroupId ?? null;

	if (sharedWithUserId != null) {
		const existing = db
			.select()
			.from(drizzleTripShares)
			.where(
				drizzleAnd(
					drizzleEq(drizzleTripShares.tripId, input.tripId),
					drizzleEq(drizzleTripShares.sharedWithUserId, sharedWithUserId)
				)
			)
			.all()[0];
		if (existing) return toTripShare(existing);
	}
	if (sharedWithGroupId != null) {
		const existing = db
			.select()
			.from(drizzleTripShares)
			.where(
				drizzleAnd(
					drizzleEq(drizzleTripShares.tripId, input.tripId),
					drizzleEq(drizzleTripShares.sharedWithGroupId, sharedWithGroupId)
				)
			)
			.all()[0];
		if (existing) return toTripShare(existing);
	}

	const row = db
		.insert(drizzleTripShares)
		.values({
			tripId: input.tripId,
			sharedWithUserId,
			sharedWithGroupId,
			permission: input.permission ?? 'read',
			showDetails: input.showDetails ?? false
		})
		.returning()
		.get();
	return toTripShare(row);
}

export function updateShare(id: number, patch: UpdateTripShareInput): TripShare | null {
	const set: Partial<typeof drizzleTripShares.$inferInsert> = {};
	if (patch.permission !== undefined) set.permission = patch.permission;
	if (patch.showDetails !== undefined) set.showDetails = patch.showDetails;

	const rows = db
		.update(drizzleTripShares)
		.set(set)
		.where(drizzleEq(drizzleTripShares.id, id))
		.returning()
		.all();
	const row = rows[0];
	if (!row) return null;
	return toTripShare(row);
}

export function deleteShare(id: number): number {
	return db.delete(drizzleTripShares).where(drizzleEq(drizzleTripShares.id, id)).run().changes;
}

// Groups

export interface CreateGroupInput {
	ownerId: number;
	name: string;
}

export type UpdateGroupInput = Partial<Pick<Group, 'name'>>;

export function listGroupsForUser(userId: number): Group[] {
	const owned = kit.selectFrom(groups).where(kitEq(groups.owner_id, kitId(userId))).executeSync();
	const ownedIds = new Set(owned.map((g) => g.id));

	const memberships = kit
		.selectFrom(groupMembers)
		.where(kitEq(groupMembers.user_id, kitId(userId)))
		.executeSync();
	const memberIds = memberships.map((m) => m.group_id).filter((id) => !ownedIds.has(id));

	let memberGroups: KitGroup[] = [];
	if (memberIds.length) {
		memberGroups = kit.selectFrom(groups).where(inList(groups.id, memberIds)).executeSync();
	}

	return [...owned, ...memberGroups].map(toGroup);
}

export function createGroup(input: CreateGroupInput): Group {
	const row = kit
		.insertInto(groups)
		.values({
			owner_id: kitId(input.ownerId),
			name: input.name.trim()
		} as Insert<typeof groups>)
		.executeSync();
	syncGroupToLegacy(row);
	return toGroup(row);
}

export function getGroupById(id: number): Group | null {
	const rows = kit.selectFrom(groups).where(kitEq(groups.id, kitId(id))).executeSync();
	return rows[0] ? toGroup(rows[0]) : null;
}

export function updateGroup(id: number, patch: UpdateGroupInput): Group | null {
	const set: Update<typeof groups> = {};
	if (patch.name !== undefined) set.name = patch.name.trim();
	const updated = kit.updateTable(groups).set(set).where(kitEq(groups.id, kitId(id))).executeSync();
	const row = updated[0];
	if (!row) return null;
	const group = toGroup(row);
	updateGroupInLegacy(group);
	return group;
}

export function deleteGroup(id: number): number {
	const deleted = kit.deleteFrom(groups).where(kitEq(groups.id, kitId(id))).executeSync();
	deleteGroupFromLegacy(id);
	return Number(deleted);
}

// Group members

export interface GroupMemberWithEmail extends GroupMember {
	id: number;
	email: string;
	displayName: string;
}

export function listMembersForGroup(groupId: number): GroupMemberWithEmail[] {
	const rows = kit
		.selectFrom(groupMembers)
		.where(kitEq(groupMembers.group_id, kitId(groupId)))
		.executeSync();
	if (rows.length === 0) return [];

	const userIds = Array.from(new Set(rows.map((r) => r.user_id)));
	const users = userIds.length
		? kit.selectFrom(usersTable).where(inList(usersTable.id, userIds)).executeSync()
		: [];
	const userMap = new Map(
		users.map((u) => [u.id, { email: u.email, displayName: u.display_name }])
	);

	return rows.map((r) => ({
		...toGroupMember(r),
		id: num(r.user_id),
		email: userMap.get(r.user_id)?.email ?? '',
		displayName: userMap.get(r.user_id)?.displayName ?? ''
	}));
}

export function addGroupMember(groupId: number, userId: number): GroupMember {
	const existing = kit
		.selectFrom(groupMembers)
		.where(and(kitEq(groupMembers.group_id, kitId(groupId)), kitEq(groupMembers.user_id, kitId(userId))))
		.executeSync()[0];
	if (existing) return toGroupMember(existing);

	const row = kit
		.insertInto(groupMembers)
		.values({
			group_id: kitId(groupId),
			user_id: kitId(userId)
		} as Insert<typeof groupMembers>)
		.executeSync();
	syncGroupMemberToLegacy(groupId, userId);
	return toGroupMember(row);
}

export function removeGroupMember(groupId: number, userId: number): number {
	const deleted = kit
		.deleteFrom(groupMembers)
		.where(and(kitEq(groupMembers.group_id, kitId(groupId)), kitEq(groupMembers.user_id, kitId(userId))))
		.executeSync();
	deleteGroupMemberFromLegacy(groupId, userId);
	return Number(deleted);
}
