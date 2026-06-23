import { redirect, type Actions } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { requireUser } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { users, groups, groupMembers } from '$lib/server/db/schema';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	const u = requireUser(locals);
	const mine = db.select().from(groups).where(eq(groups.ownerId, u.id)).all();
	return {
		groups: mine.map((g) => ({
			...g,
			members: db
				.select({ email: users.email })
				.from(groupMembers)
				.innerJoin(users, eq(groupMembers.userId, users.id))
				.where(eq(groupMembers.groupId, g.id))
				.all()
		}))
	};
};

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
		const g = db
			.select()
			.from(groups)
			.where(and(eq(groups.id, Number(f.get('groupId'))), eq(groups.ownerId, u.id)))
			.get();
		if (!g) throw redirect(303, '/groups');
		const m = db
			.select()
			.from(users)
			.where(eq(users.email, String(f.get('email')).trim().toLowerCase()))
			.get();
		if (m) db.insert(groupMembers).values({ groupId: g.id, userId: m.id }).onConflictDoNothing().run();
		throw redirect(303, '/groups');
	}
};
