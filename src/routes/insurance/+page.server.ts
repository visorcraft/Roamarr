import { redirect, type Actions } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { requireUser } from '$lib/server/auth';
import { requireOwnedTrip } from '$lib/server/ownership';
import { db } from '$lib/server/db';
import { insurancePolicies, trips } from '$lib/server/db/schema';
import type { PageServerLoad } from './$types';

export function addPolicy(
	userId: number,
	i: {
		provider: string;
		policyNumber?: string;
		coverageSummary?: string;
		coverageAmount?: number;
		startDate?: string;
		endDate?: string;
		tripId?: number;
		notes?: string;
	}
) {
	if (i.tripId != null) requireOwnedTrip(userId, i.tripId);
	return db
		.insert(insurancePolicies)
		.values({
			userId,
			provider: i.provider,
			policyNumber: i.policyNumber,
			coverageSummary: i.coverageSummary,
			coverageAmount: i.coverageAmount,
			startDate: i.startDate,
			endDate: i.endDate,
			tripId: i.tripId,
			notes: i.notes
		})
		.returning()
		.get();
}

export const load: PageServerLoad = ({ locals }) => {
	const u = requireUser(locals);
	return {
		policies: db
			.select()
			.from(insurancePolicies)
			.where(eq(insurancePolicies.userId, u.id))
			.all(),
		trips: db.select().from(trips).where(eq(trips.ownerId, u.id)).all()
	};
};

export const actions: Actions = {
	add: async ({ request, locals }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		addPolicy(u.id, {
			provider: String(f.get('provider')),
			policyNumber: String(f.get('policyNumber') || '') || undefined,
			coverageSummary: String(f.get('coverageSummary') || '') || undefined,
			coverageAmount: f.get('coverageAmount') ? Number(f.get('coverageAmount')) : undefined,
			startDate: String(f.get('startDate') || '') || undefined,
			endDate: String(f.get('endDate') || '') || undefined,
			tripId: f.get('tripId') ? Number(f.get('tripId')) : undefined
		});
		throw redirect(303, '/insurance');
	},
	delete: async ({ request, locals }) => {
		const u = requireUser(locals);
		const id = Number((await request.formData()).get('id'));
		db.delete(insurancePolicies)
			.where(and(eq(insurancePolicies.id, id), eq(insurancePolicies.userId, u.id)))
			.run();
		throw redirect(303, '/insurance');
	}
};
