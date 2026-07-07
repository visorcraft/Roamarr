import { fail, redirect, error, type Actions } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { requireOwnedGroup } from '$lib/server/ownership';
import {
	getGroupById,
	updateGroup,
	listMembersForGroup,
	addGroupMember,
	removeGroupMember
} from '$lib/server/repositories/tripsRepo';
import { getUserByEmail } from '$lib/server/repositories/usersRepo';
import { normalizeEmail } from '$lib/server/users';
import { logAudit } from '$lib/server/audit';
import type { PageServerLoad } from './$types';

function parseId(params: { id?: string }): number {
	const id = Number(params.id);
	if (!Number.isInteger(id) || id < 1) throw error(404, 'Not found');
	return id;
}

export const load: PageServerLoad = ({ params, locals }) => {
	const u = requireUser(locals);
	const id = parseId(params);
	const group = getGroupById(id);
	if (!group) throw error(404, 'Not found');
	requireOwnedGroup(u.id, group.id);
	return {
		group,
		members: listMembersForGroup(group.id)
	};
};

export const actions: Actions = {
	update: async ({ params, request, locals }) => {
		const u = requireUser(locals);
		const id = parseId(params);
		requireOwnedGroup(u.id, id);
		const f = await request.formData();
		const name = String(f.get('name') ?? '').trim();
		if (!name) {
			return fail(400, { error: 'Group name is required' });
		}
		updateGroup(id, { name });
		logAudit(u.id, 'group_update', 'group', id);
		throw redirect(303, '/groups');
	},
	addMember: async ({ params, request, locals }) => {
		const u = requireUser(locals);
		const id = parseId(params);
		requireOwnedGroup(u.id, id);
		const f = await request.formData();
		const email = normalizeEmail(String(f.get('email') ?? ''));
		const member = getUserByEmail(email);
		if (!member) {
			return fail(400, { error: 'User not found', values: { email } });
		}
		addGroupMember(id, Number(member.id));
		logAudit(u.id, 'group_member_add', 'group', id);
		throw redirect(303, `/groups/${id}/edit`);
	},
	removeMember: async ({ params, request, locals }) => {
		const u = requireUser(locals);
		const id = parseId(params);
		requireOwnedGroup(u.id, id);
		const f = await request.formData();
		const userId = Number(f.get('userId'));
		if (!Number.isInteger(userId) || userId < 1) {
			return fail(400, { error: 'Invalid member' });
		}
		removeGroupMember(id, userId);
		logAudit(u.id, 'group_member_remove', 'group', id);
		throw redirect(303, `/groups/${id}/edit`);
	}
};
