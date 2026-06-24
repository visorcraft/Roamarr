import { redirect, type Actions } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { requireUser } from '$lib/server/auth';
import { requireOwnedGroup } from '$lib/server/ownership';
import { listGroupsForUser } from '$lib/server/sharing';
import { db } from '$lib/server/db';
import { users, groups, groupMembers } from '$lib/server/db/schema';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	const u = requireUser(locals);
	const all = listGroupsForUser(u.id);
	return {
		groups: all.map((g) => ({
			...g,
			members: db
				.select({ id: users.id, email: users.email })
				.from(groupMembers)
				.innerJoin(users, eq(groupMembers.userId, users.id))
				.where(eq(groupMembers.groupId, g.id))
				.all()
		}))
	};
};

export function _addMember(ownerId: number, groupId: number, email: string) {
	requireOwnedGroup(ownerId, groupId);
	const m = db.select().from(users).where(eq(users.email, email.trim().toLowerCase())).get();
	if (m) db.insert(groupMembers).values({ groupId, userId: m.id }).onConflictDoNothing().run();
}

export function _removeMember(ownerId: number, groupId: number, userId: number) {
	requireOwnedGroup(ownerId, groupId);
	db.delete(groupMembers)
		.where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
		.run();
}

export function _deleteGroup(ownerId: number, groupId: number) {
	requireOwnedGroup(ownerId, groupId);
	db.delete(groups).where(eq(groups.id, groupId)).run();
}

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const u = requireUser(locals);
		db.insert(groups)
			.values({ ownerId: u.id, name: String((await request.formData()).get('name')) })
			.run();
		throw redirect(303, '/groups');
	},
	addMember: async ({ request, locals }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		_addMember(u.id, Number(f.get('groupId')), String(f.get('email')));
		throw redirect(303, '/groups');
	},
	removeMember: async ({ request, locals }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		_removeMember(u.id, Number(f.get('groupId')), Number(f.get('userId')));
		throw redirect(303, '/groups');
	},
	deleteGroup: async ({ request, locals }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		_deleteGroup(u.id, Number(f.get('groupId')));
		throw redirect(303, '/groups');
	}
};
