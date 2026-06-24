import { redirect, type Actions } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { requireUser } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { loyaltyPrograms } from '$lib/server/db/schema';
import type { PageServerLoad } from './$types';

export function _updateProgram(
	userId: number,
	id: number,
	i: {
		programName: string;
		membershipNumber?: string;
		balance?: number;
		notes?: string;
	}
) {
	db.update(loyaltyPrograms)
		.set({
			programName: i.programName,
			membershipNumber: i.membershipNumber || null,
			balance: i.balance ?? null,
			notes: i.notes || null
		})
		.where(and(eq(loyaltyPrograms.id, id), eq(loyaltyPrograms.userId, userId)))
		.run();
}

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
	update: async ({ request, locals }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		_updateProgram(u.id, Number(f.get('id')), {
			programName: String(f.get('programName')),
			membershipNumber: String(f.get('membershipNumber') || '') || undefined,
			balance: f.get('balance') ? Number(f.get('balance')) : undefined,
			notes: String(f.get('notes') || '') || undefined
		});
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
