import { fail, redirect, type Actions } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { requireOwnedGroup } from '$lib/server/ownership';
import { listGroupsForUser } from '$lib/server/sharing';
import * as tripsRepo from '$lib/server/repositories/tripsRepo';
import { positiveIdFromForm } from '$lib/server/validation';
import { normalizeEmail } from '$lib/server/users';
import * as usersRepo from '$lib/server/repositories/usersRepo';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	const u = requireUser(locals);
	const all = listGroupsForUser(u.id);
	return {
		groups: all.map((g) => ({
			...g,
			members: tripsRepo.listMembersForGroup(g.id)
		}))
	};
};

export function _addMember(ownerId: number, groupId: number, email: string) {
	requireOwnedGroup(ownerId, groupId);
	const m = usersRepo.getUserByEmail(normalizeEmail(email));
	if (m) tripsRepo.addGroupMember(groupId, Number(m.id));
}

export function _removeMember(ownerId: number, groupId: number, userId: number) {
	requireOwnedGroup(ownerId, groupId);
	tripsRepo.removeGroupMember(groupId, userId);
}

export function _deleteGroup(ownerId: number, groupId: number) {
	requireOwnedGroup(ownerId, groupId);
	tripsRepo.deleteGroup(groupId);
}

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const u = requireUser(locals);
		tripsRepo.createGroup({ ownerId: u.id, name: String((await request.formData()).get('name')) });
		throw redirect(303, '/groups');
	},
	addMember: async ({ request, locals }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const groupResult = positiveIdFromForm(f.get('groupId'), 'groupId');
		if (!groupResult.ok) return fail(400, { error: groupResult.error });
		_addMember(u.id, groupResult.value, String(f.get('email')));
		throw redirect(303, '/groups');
	},
	removeMember: async ({ request, locals }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const groupResult = positiveIdFromForm(f.get('groupId'), 'groupId');
		if (!groupResult.ok) return fail(400, { error: groupResult.error });
		const userResult = positiveIdFromForm(f.get('userId'), 'userId');
		if (!userResult.ok) return fail(400, { error: userResult.error });
		_removeMember(u.id, groupResult.value, userResult.value);
		throw redirect(303, '/groups');
	},
	deleteGroup: async ({ request, locals }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const groupResult = positiveIdFromForm(f.get('groupId'), 'groupId');
		if (!groupResult.ok) return fail(400, { error: groupResult.error });
		_deleteGroup(u.id, groupResult.value);
		throw redirect(303, '/groups');
	}
};
