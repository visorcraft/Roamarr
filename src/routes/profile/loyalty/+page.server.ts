import { redirect, type Actions } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { requireUser } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { loyaltyPrograms } from '$lib/server/db/schema';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	const u = requireUser(locals);
	return {
		programs: db.select().from(loyaltyPrograms).where(eq(loyaltyPrograms.userId, u.id)).all()
	};
};

export const actions: Actions = {
	add: async ({ request, locals }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		db.insert(loyaltyPrograms)
			.values({
				userId: u.id,
				programName: String(f.get('programName')),
				membershipNumber: String(f.get('membershipNumber') || ''),
				balance: f.get('balance') ? Number(f.get('balance')) : null,
				notes: String(f.get('notes') || '')
			})
			.run();
		throw redirect(303, '/profile/loyalty');
	},
	delete: async ({ request, locals }) => {
		const u = requireUser(locals);
		const id = Number((await request.formData()).get('id'));
		db.delete(loyaltyPrograms)
			.where(and(eq(loyaltyPrograms.id, id), eq(loyaltyPrograms.userId, u.id)))
			.run();
		throw redirect(303, '/profile/loyalty');
	}
};
