import { error, fail, redirect, type Actions } from '@sveltejs/kit';
import { and, eq, isNotNull } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { requireUser } from '$lib/server/auth';
import { requireOwnedTrip } from '$lib/server/ownership';
import { logAudit } from '$lib/server/audit';
import { db } from '$lib/server/db';
import { users, trips, tripShares, groups } from '$lib/server/db/schema';
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
		.where(eq(users.email, email.trim().toLowerCase()))
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
	// The group must belong to the sharer — otherwise an owner could expose their trip
	// to an arbitrary group they don't control.
	const g = db
		.select({ id: groups.id })
		.from(groups)
		.where(and(eq(groups.id, groupId), eq(groups.ownerId, ownerId)))
		.get();
	if (!g) throw error(404, 'No such group');
	db.insert(tripShares)
		.values({ tripId, sharedWithGroupId: groupId, permission })
		.onConflictDoNothing()
		.run();
	logAudit(ownerId, 'trip_share_group', 'trip', tripId, { sharedWithGroupId: groupId, permission });
}

export function _mintPublicToken(ownerId: number, tripId: number) {
	requireOwnedTrip(ownerId, tripId);
	const token = randomBytes(24).toString('base64url');
	db.update(trips).set({ publicToken: token }).where(eq(trips.id, tripId)).run();
	logAudit(ownerId, 'trip_public_token_mint', 'trip', tripId);
	return token;
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

export const load: PageServerLoad = ({ locals, params }) => {
	const u = requireUser(locals);
	const t = requireOwnedTrip(u.id, Number(params.id));
	const shares = db
		.select({
			id: tripShares.id,
			email: users.email,
			groupName: groups.name,
			permission: tripShares.permission
		})
		.from(tripShares)
		.leftJoin(users, eq(tripShares.sharedWithUserId, users.id))
		.leftJoin(groups, eq(tripShares.sharedWithGroupId, groups.id))
		.where(eq(tripShares.tripId, t.id))
		.all();
	const myGroups = db.select().from(groups).where(eq(groups.ownerId, u.id)).all();
	return { trip: t, shares, groups: myGroups };
};

export const actions: Actions = {
	shareUser: async ({ request, locals, params }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const permission = parsePermission(f.get('permission'));
		if (!permission) return fail(400, { error: 'Invalid permission' });
		_shareWithUserEmail(
			u.id,
			Number(params.id),
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
		_shareWithGroup(u.id, Number(params.id), Number(f.get('groupId')), permission);
		throw redirect(303, `/trips/${params.id}`);
	},
	makePublic: async ({ locals, params }) => {
		const u = requireUser(locals);
		_mintPublicToken(u.id, Number(params.id));
		throw redirect(303, `/trips/${params.id}`);
	},
	revokePublic: async ({ locals, params }) => {
		const u = requireUser(locals);
		const tripId = Number(params.id);
		requireOwnedTrip(u.id, tripId);
		db.update(trips)
			.set({ publicToken: null })
			.where(eq(trips.id, tripId))
			.run();
		logAudit(u.id, 'trip_public_token_revoke', 'trip', tripId);
		throw redirect(303, `/trips/${params.id}`);
	},
	unshareUser: async ({ request, locals, params }) => {
		const u = requireUser(locals);
		const shareId = Number((await request.formData()).get('shareId'));
		_unshareUser(u.id, Number(params.id), shareId);
		throw redirect(303, `/trips/${params.id}/share`);
	},
	unshareGroup: async ({ request, locals, params }) => {
		const u = requireUser(locals);
		const shareId = Number((await request.formData()).get('shareId'));
		_unshareGroup(u.id, Number(params.id), shareId);
		throw redirect(303, `/trips/${params.id}/share`);
	}
};
