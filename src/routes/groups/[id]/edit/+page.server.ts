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
import { checkRateLimit } from '$lib/server/rateLimit';
import { Validator, formFail } from '$lib/server/validation';
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
	update: async ({ params, request, locals, getClientAddress }) => {
		const u = requireUser(locals);
		const id = parseId(params);
		requireOwnedGroup(u.id, id);

		const limit = checkRateLimit(getClientAddress(), 'groups:update');
		if (!limit.allowed) {
			return fail(429, { error: 'Too many attempts. Try again later.', retryAfter: limit.retryAfter });
		}

		const f = await request.formData();
		const rawName = String(f.get('name') ?? '').trim();
		if (!rawName) {
			return fail(400, { error: 'Group name is required' });
		}
		const v = new Validator();
		const name = v.requiredString(rawName, 'name', { max: 200 });
		if (!v.ok()) {
			return formFail(v);
		}
		updateGroup(id, { name: name! });
		logAudit(u.id, 'group_update', 'group', id);
		throw redirect(303, '/groups');
	},
	addMember: async ({ params, request, locals, getClientAddress }) => {
		const u = requireUser(locals);
		const id = parseId(params);
		requireOwnedGroup(u.id, id);

		const limit = checkRateLimit(getClientAddress(), 'groups:addMember');
		if (!limit.allowed) {
			return fail(429, { error: 'Too many attempts. Try again later.', retryAfter: limit.retryAfter });
		}

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
	removeMember: async ({ params, request, locals, getClientAddress }) => {
		const u = requireUser(locals);
		const id = parseId(params);
		requireOwnedGroup(u.id, id);

		const limit = checkRateLimit(getClientAddress(), 'groups:removeMember');
		if (!limit.allowed) {
			return fail(429, { error: 'Too many attempts. Try again later.', retryAfter: limit.retryAfter });
		}

		const f = await request.formData();
		const userId = Number(f.get('userId'));
		if (!Number.isInteger(userId) || userId < 1) {
			return fail(400, { error: 'Invalid member' });
		}
		const deleted = removeGroupMember(id, userId);
		if (deleted === 0) {
			return fail(400, { error: 'Member not found' });
		}
		logAudit(u.id, 'group_member_remove', 'group', id);
		throw redirect(303, `/groups/${id}/edit`);
	}
};
