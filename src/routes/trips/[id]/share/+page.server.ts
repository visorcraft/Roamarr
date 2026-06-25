import { error, fail, redirect, type Actions } from '@sveltejs/kit';
import { and, eq, isNotNull } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { requireUser } from '$lib/server/auth';
import { requireOwnedTrip } from '$lib/server/ownership';
import { logAudit } from '$lib/server/audit';
import { listGroupsForUser } from '$lib/server/sharing';
import { db } from '$lib/server/db';
import { users, trips, tripShares, groups as groupsTable } from '$lib/server/db/schema';
import { normalizeEmail } from '$lib/server/users';
import { parseTripId } from '$lib/server/params';
import type { PageServerLoad } from './$types';

const SHARE_PERMISSIONS = ['read', 'edit'] as const;
type SharePermission = (typeof SHARE_PERMISSIONS)[number];

function parsePermission(raw: unknown): SharePermission | undefined {
	const v = typeof raw === 'string' ? raw : 'read';
	return SHARE_PERMISSIONS.includes(v as SharePermission) ? (v as SharePermission) : undefined;
}

export function _shareWithUserEmail(
	ownerId: number,
	tripId: number,
	email: string,
	permission: SharePermission = 'read'
) {
	requireOwnedTrip(ownerId, tripId);
	const target = db
		.select()
		.from(users)
		.where(eq(users.email, normalizeEmail(email)))
		.get();
	if (!target) throw error(404, 'No such user');
	db.insert(tripShares)
		.values({ tripId, sharedWithUserId: target.id, permission })
		.onConflictDoNothing()
		.run();
	logAudit(ownerId, 'trip_share_user', 'trip', tripId, { sharedWithUserId: target.id, permission });
}

export function _shareWithGroup(
	ownerId: number,
	tripId: number,
	groupId: number,
	permission: SharePermission = 'read'
) {
	requireOwnedTrip(ownerId, tripId);
	// The group must be one the sharer owns or belongs to.
	const allowed = listGroupsForUser(ownerId).some((g) => g.id === groupId);
	if (!allowed) throw error(404, 'No such group');
	db.insert(tripShares)
		.values({ tripId, sharedWithGroupId: groupId, permission })
		.onConflictDoNothing()
		.run();
	logAudit(ownerId, 'trip_share_group', 'trip', tripId, { sharedWithGroupId: groupId, permission });
}

export function _mintPublicToken(
	ownerId: number,
	tripId: number,
	publicShowDetails = false,
	expiresAt?: string | null
) {
	requireOwnedTrip(ownerId, tripId);
	const token = randomBytes(24).toString('base64url');
	db.update(trips)
		.set({ publicToken: token, publicTokenExpiresAt: expiresAt ?? null, publicShowDetails })
		.where(eq(trips.id, tripId))
		.run();
	logAudit(ownerId, 'trip_public_token_mint', 'trip', tripId, {
		expiresAt: expiresAt ?? null,
		publicShowDetails
	});
	return token;
}

export function _setPublicShowDetails(ownerId: number, tripId: number, publicShowDetails: boolean) {
	requireOwnedTrip(ownerId, tripId);
	db.update(trips).set({ publicShowDetails }).where(eq(trips.id, tripId)).run();
	logAudit(ownerId, 'trip_public_set_show_details', 'trip', tripId, { publicShowDetails });
}

export function _unshareUser(ownerId: number, tripId: number, shareId: number) {
	requireOwnedTrip(ownerId, tripId);
	const share = db
		.select({ sharedWithUserId: tripShares.sharedWithUserId })
		.from(tripShares)
		.where(and(eq(tripShares.id, shareId), eq(tripShares.tripId, tripId)))
		.get();
	db.delete(tripShares)
		.where(
			and(
				eq(tripShares.id, shareId),
				eq(tripShares.tripId, tripId),
				isNotNull(tripShares.sharedWithUserId)
			)
		)
		.run();
	logAudit(ownerId, 'trip_unshare_user', 'trip', tripId, { shareId, sharedWithUserId: share?.sharedWithUserId });
}

export function _unshareGroup(ownerId: number, tripId: number, shareId: number) {
	requireOwnedTrip(ownerId, tripId);
	const share = db
		.select({ sharedWithGroupId: tripShares.sharedWithGroupId })
		.from(tripShares)
		.where(and(eq(tripShares.id, shareId), eq(tripShares.tripId, tripId)))
		.get();
	db.delete(tripShares)
		.where(
			and(
				eq(tripShares.id, shareId),
				eq(tripShares.tripId, tripId),
				isNotNull(tripShares.sharedWithGroupId)
			)
		)
		.run();
	logAudit(ownerId, 'trip_unshare_group', 'trip', tripId, { shareId, sharedWithGroupId: share?.sharedWithGroupId });
}

export function _setShowDetails(
	ownerId: number,
	tripId: number,
	shareId: number,
	showDetails: boolean
) {
	requireOwnedTrip(ownerId, tripId);
	db.update(tripShares)
		.set({ showDetails })
		.where(and(eq(tripShares.id, shareId), eq(tripShares.tripId, tripId)))
		.run();
	logAudit(ownerId, 'trip_share_set_show_details', 'trip', tripId, { shareId, showDetails });
}

export const load: PageServerLoad = ({ locals, params, url }) => {
	const u = requireUser(locals);
	const t = requireOwnedTrip(u.id, parseTripId(params));
	const shares = db
		.select({
			id: tripShares.id,
			email: users.email,
			groupName: groupsTable.name,
			permission: tripShares.permission,
			showDetails: tripShares.showDetails
		})
		.from(tripShares)
		.leftJoin(users, eq(tripShares.sharedWithUserId, users.id))
		.leftJoin(groupsTable, eq(tripShares.sharedWithGroupId, groupsTable.id))
		.where(eq(tripShares.tripId, t.id))
		.all();
	const myGroups = listGroupsForUser(u.id);
	const publicShareUrl = t.publicToken
		? `${url.origin}/share/${encodeURIComponent(t.publicToken)}`
		: null;
	return { trip: t, shares, groups: myGroups, publicShareUrl };
};

export const actions: Actions = {
	shareUser: async ({ request, locals, params }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const permission = parsePermission(f.get('permission'));
		if (!permission) return fail(400, { error: 'Invalid permission' });
		_shareWithUserEmail(
			u.id,
			parseTripId(params),
			String(f.get('email')),
			permission
		);
		throw redirect(303, `/trips/${params.id}`);
	},
	shareGroup: async ({ request, locals, params }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const permission = parsePermission(f.get('permission'));
		if (!permission) return fail(400, { error: 'Invalid permission' });
		_shareWithGroup(u.id, parseTripId(params), Number(f.get('groupId')), permission);
		throw redirect(303, `/trips/${params.id}`);
	},
	makePublic: async ({ request, locals, params }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const expiresAt = String(f.get('publicExpiresAt') || '');
		const publicShowDetails = String(f.get('publicShowDetails')) === '1';
		_mintPublicToken(u.id, parseTripId(params), publicShowDetails, expiresAt || null);
		throw redirect(303, `/trips/${params.id}/share`);
	},
	setPublicShowDetails: async ({ request, locals, params }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const publicShowDetails = String(f.get('publicShowDetails')) === '1';
		_setPublicShowDetails(u.id, parseTripId(params), publicShowDetails);
		throw redirect(303, `/trips/${params.id}/share`);
	},
	revokePublic: async ({ locals, params }) => {
		const u = requireUser(locals);
		const tripId = parseTripId(params);
		requireOwnedTrip(u.id, tripId);
		db.update(trips)
			.set({ publicToken: null, publicTokenExpiresAt: null, publicShowDetails: false })
			.where(eq(trips.id, tripId))
			.run();
		logAudit(u.id, 'trip_public_token_revoke', 'trip', tripId);
		throw redirect(303, `/trips/${params.id}`);
	},
	unshareUser: async ({ request, locals, params }) => {
		const u = requireUser(locals);
		const shareId = Number((await request.formData()).get('shareId'));
		_unshareUser(u.id, parseTripId(params), shareId);
		throw redirect(303, `/trips/${params.id}/share`);
	},
	unshareGroup: async ({ request, locals, params }) => {
		const u = requireUser(locals);
		const shareId = Number((await request.formData()).get('shareId'));
		_unshareGroup(u.id, parseTripId(params), shareId);
		throw redirect(303, `/trips/${params.id}/share`);
	},
	setShowDetails: async ({ request, locals, params }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const shareId = Number(f.get('shareId'));
		const showDetails = String(f.get('showDetails')) === '1';
		if (!Number.isFinite(shareId)) return fail(400, { error: 'Invalid share' });
		_setShowDetails(u.id, parseTripId(params), shareId, showDetails);
		throw redirect(303, `/trips/${params.id}/share`);
	}
};
