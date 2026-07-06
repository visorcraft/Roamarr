import { eq as kitEq, and as kitAnd, and, inList, asc } from '@visorcraft/mongreldb-kit';
import { kit } from '$lib/server/db';
import {
	users as usersTable,
	trips,
	tripComments,
	groups,
	groupMembers,
	tripShares
} from '$lib/server/db/mongrelSchema';
import type { Row, Insert, Update } from '@visorcraft/mongreldb-kit';

export type KitTrip = Row<typeof trips>;
export type KitTripComment = Row<typeof tripComments>;
export type KitGroup = Row<typeof groups>;
export type KitGroupMember = Row<typeof groupMembers>;
export type KitTripShare = Row<typeof tripShares>;

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

export function toTripShare(row: KitTripShare): TripShare {
	return {
		id: num(row.id),
		tripId: num(row.trip_id),
		sharedWithUserId: row.shared_with_user_id == null || row.shared_with_user_id === 0n
			? null
			: num(row.shared_with_user_id),
		sharedWithGroupId: row.shared_with_group_id == null || row.shared_with_group_id === 0n
			? null
			: num(row.shared_with_group_id),
		permission: row.permission as SharePermission,
		showDetails: row.show_details,
		createdAt: row.created_at
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

export function getTripById(id: number): Trip | null {
	const rows = kit.selectFrom(trips).where(kitEq(trips.id, kitId(id))).executeSync();
	return rows[0] ? toTrip(rows[0]) : null;
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
	return toTrip(row);
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
	if (patch.updatedAt !== undefined) set.updated_at = patch.updatedAt;

	const updated = kit.updateTable(trips).set(set).where(kitEq(trips.id, kitId(id))).executeSync();
	const row = updated[0];
	return row ? toTrip(row) : null;
}

export function deleteTrip(id: number): number {
	const deleted = kit.deleteFrom(trips).where(kitEq(trips.id, kitId(id))).executeSync();
	return Number(deleted);
}

export function listEditableTripIdsForUser(userId: number): number[] {
	return listTripIdsForUser(userId, { editOnly: true });
}

export function listViewableTripIdsForUser(userId: number): number[] {
	return listTripIdsForUser(userId, { editOnly: false });
}

function listTripIdsForUser(userId: number, options: { editOnly: boolean }): number[] {
	const owned = listTripsForUser(userId).map((t) => t.id);

	const directWhere = options.editOnly
		? kitAnd(kitEq(tripShares.shared_with_user_id, kitId(userId)), kitEq(tripShares.permission, 'edit'))
		: kitEq(tripShares.shared_with_user_id, kitId(userId));
	const directIds = kit
		.selectFrom(tripShares)
		.where(directWhere)
		.executeSync()
		.map((s) => num(s.trip_id));

	const groupIds = kit
		.selectFrom(groupMembers)
		.where(kitEq(groupMembers.user_id, kitId(userId)))
		.executeSync()
		.map((m) => num(m.group_id));

	let groupIdsResult: number[] = [];
	if (groupIds.length) {
		const groupWhere = options.editOnly
			? kitAnd(
					inList(tripShares.shared_with_group_id, groupIds.map(kitId)),
					kitEq(tripShares.permission, 'edit')
				)
			: inList(tripShares.shared_with_group_id, groupIds.map(kitId));
		groupIdsResult = kit
			.selectFrom(tripShares)
			.where(groupWhere)
			.executeSync()
			.map((s) => num(s.trip_id));
	}

	return Array.from(new Set([...owned, ...directIds, ...groupIdsResult]));
}

export function listTripsSharedWithUser(userId: number): Trip[] {
	const directShares = kit
		.selectFrom(tripShares)
		.where(kitEq(tripShares.shared_with_user_id, kitId(userId)))
		.executeSync();
	const directTripIds = directShares.map((s) => num(s.trip_id));

	const memberships = kit
		.selectFrom(groupMembers)
		.where(kitEq(groupMembers.user_id, kitId(userId)))
		.executeSync();
	const groupIds = memberships.map((m) => m.group_id);

	let groupTripIds: number[] = [];
	if (groupIds.length) {
		const groupShares = kit
			.selectFrom(tripShares)
			.where(inList(tripShares.shared_with_group_id, groupIds))
			.executeSync();
		groupTripIds = groupShares.map((s) => num(s.trip_id));
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
	return toTripComment(row);
}

export function deleteComment(userId: number, commentId: number): number {
	const deleted = kit
		.deleteFrom(tripComments)
		.where(and(kitEq(tripComments.id, kitId(commentId)), kitEq(tripComments.user_id, kitId(userId))))
		.executeSync();
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
	const rows = kit
		.selectFrom(tripShares)
		.where(kitEq(tripShares.trip_id, kitId(tripId)))
		.executeSync();
	return rows.map(toTripShare);
}

export function getShareById(id: number): TripShare | null {
	const rows = kit.selectFrom(tripShares).where(kitEq(tripShares.id, kitId(id))).executeSync();
	return rows[0] ? toTripShare(rows[0]) : null;
}

export function getDirectShareForTrip(tripId: number, userId: number): TripShare | null {
	const rows = kit
		.selectFrom(tripShares)
		.where(
			kitAnd(
				kitEq(tripShares.trip_id, kitId(tripId)),
				kitEq(tripShares.shared_with_user_id, kitId(userId))
			)
		)
		.executeSync();
	return rows[0] ? toTripShare(rows[0]) : null;
}

export function getGroupShareForTrip(tripId: number, userId: number): TripShare | null {
	const memberships = kit
		.selectFrom(groupMembers)
		.where(kitEq(groupMembers.user_id, kitId(userId)))
		.executeSync();
	const groupIds = memberships.map((m) => num(m.group_id));
	if (groupIds.length === 0) return null;
	const rows = kit
		.selectFrom(tripShares)
		.where(
			kitAnd(
				kitEq(tripShares.trip_id, kitId(tripId)),
				inList(tripShares.shared_with_group_id, groupIds.map(kitId))
			)
		)
		.executeSync();
	return rows[0] ? toTripShare(rows[0]) : null;
}

export function createShare(input: CreateTripShareInput): TripShare {
	const sharedWithUserId = input.sharedWithUserId ?? null;
	const sharedWithGroupId = input.sharedWithGroupId ?? null;

	if (sharedWithUserId != null) {
		const existing = kit
			.selectFrom(tripShares)
			.where(
				kitAnd(
					kitEq(tripShares.trip_id, kitId(input.tripId)),
					kitEq(tripShares.shared_with_user_id, kitId(sharedWithUserId))
				)
			)
			.executeSync()[0];
		if (existing) return toTripShare(existing);
	}
	if (sharedWithGroupId != null) {
		const existing = kit
			.selectFrom(tripShares)
			.where(
				kitAnd(
					kitEq(tripShares.trip_id, kitId(input.tripId)),
					kitEq(tripShares.shared_with_group_id, kitId(sharedWithGroupId))
				)
			)
			.executeSync()[0];
		if (existing) return toTripShare(existing);
	}

	const row = kit
		.insertInto(tripShares)
		.values({
			trip_id: kitId(input.tripId),
			shared_with_user_id: sharedWithUserId != null ? kitId(sharedWithUserId) : null,
			shared_with_group_id: sharedWithGroupId != null ? kitId(sharedWithGroupId) : null,
			permission: input.permission ?? 'read',
			show_details: input.showDetails ?? false
		} as Insert<typeof tripShares>)
		.executeSync();
	return toTripShare(row);
}

export function updateShare(id: number, patch: UpdateTripShareInput): TripShare | null {
	const set: Update<typeof tripShares> = {};
	if (patch.permission !== undefined) set.permission = patch.permission;
	if (patch.showDetails !== undefined) set.show_details = patch.showDetails;

	const rows = kit
		.updateTable(tripShares)
		.set(set)
		.where(kitEq(tripShares.id, kitId(id)))
		.executeSync();
	const row = rows[0];
	if (!row) return null;
	return toTripShare(row);
}

export function deleteShare(id: number): number {
	return Number(kit.deleteFrom(tripShares).where(kitEq(tripShares.id, kitId(id))).executeSync());
}

// Groups

export interface CreateGroupInput {
	ownerId: number;
	name: string;
}

export type UpdateGroupInput = Partial<Pick<Group, 'name'>>;

export function countTrips(): number {
	return Number(kit.selectFrom(trips).selectCount().executeSync());
}

export function countGroups(): number {
	return Number(kit.selectFrom(groups).selectCount().executeSync());
}

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
	return toGroup(row);
}

export function deleteGroup(id: number): number {
	return Number(kit.deleteFrom(groups).where(kitEq(groups.id, kitId(id))).executeSync());
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
		.where(
			kitAnd(
				kitEq(groupMembers.group_id, kitId(groupId)),
				kitEq(groupMembers.user_id, kitId(userId))
			)
		)
		.executeSync()[0];
	if (existing) return toGroupMember(existing);

	const row = kit
		.insertInto(groupMembers)
		.values({
			group_id: kitId(groupId),
			user_id: kitId(userId)
		} as Insert<typeof groupMembers>)
		.executeSync();
	return toGroupMember(row);
}

export function removeGroupMember(groupId: number, userId: number): number {
	return Number(
		kit
			.deleteFrom(groupMembers)
			.where(
				kitAnd(
					kitEq(groupMembers.group_id, kitId(groupId)),
					kitEq(groupMembers.user_id, kitId(userId))
				)
			)
			.executeSync()
	);
}
