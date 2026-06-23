import { error, redirect, type Actions } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { requireUser } from '$lib/server/auth';
import { requireOwnedTrip } from '$lib/server/ownership';
import { db } from '$lib/server/db';
import { users, trips, tripShares, groups } from '$lib/server/db/schema';
import type { PageServerLoad } from './$types';

export function shareWithUserEmail(ownerId: number, tripId: number, email: string) {
	requireOwnedTrip(ownerId, tripId);
	const target = db
		.select()
		.from(users)
		.where(eq(users.email, email.trim().toLowerCase()))
		.get();
	if (!target) throw error(404, 'No such user');
	db.insert(tripShares)
		.values({ tripId, sharedWithUserId: target.id })
		.onConflictDoNothing()
		.run();
}

export function shareWithGroup(ownerId: number, tripId: number, groupId: number) {
	requireOwnedTrip(ownerId, tripId);
	db.insert(tripShares).values({ tripId, sharedWithGroupId: groupId }).onConflictDoNothing().run();
}

export function mintPublicToken(ownerId: number, tripId: number) {
	requireOwnedTrip(ownerId, tripId);
	const token = randomBytes(24).toString('base64url');
	db.update(trips).set({ publicToken: token }).where(eq(trips.id, tripId)).run();
	return token;
}

export const load: PageServerLoad = ({ locals, params }) => {
	const u = requireUser(locals);
	const t = requireOwnedTrip(u.id, Number(params.id));
	const shares = db
		.select({ id: tripShares.id, email: users.email })
		.from(tripShares)
		.leftJoin(users, eq(tripShares.sharedWithUserId, users.id))
		.where(eq(tripShares.tripId, t.id))
		.all();
	const myGroups = db.select().from(groups).where(eq(groups.ownerId, u.id)).all();
	return { trip: t, shares, groups: myGroups };
};

export const actions: Actions = {
	shareUser: async ({ request, locals, params }) => {
		const u = requireUser(locals);
		shareWithUserEmail(u.id, Number(params.id), String((await request.formData()).get('email')));
		throw redirect(303, `/trips/${params.id}`);
	},
	shareGroup: async ({ request, locals, params }) => {
		const u = requireUser(locals);
		shareWithGroup(u.id, Number(params.id), Number((await request.formData()).get('groupId')));
		throw redirect(303, `/trips/${params.id}`);
	},
	makePublic: async ({ locals, params }) => {
		const u = requireUser(locals);
		mintPublicToken(u.id, Number(params.id));
		throw redirect(303, `/trips/${params.id}`);
	},
	revokePublic: async ({ locals, params }) => {
		const u = requireUser(locals);
		requireOwnedTrip(u.id, Number(params.id));
		db.update(trips)
			.set({ publicToken: null })
			.where(eq(trips.id, Number(params.id)))
			.run();
		throw redirect(303, `/trips/${params.id}`);
	}
};
