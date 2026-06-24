import { error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db } from './db';
import { insurancePolicies } from './db/schema';

export function listPoliciesForUser(userId: number) {
	return db.select().from(insurancePolicies).where(eq(insurancePolicies.userId, userId)).all();
}

export function attachPolicyToTrip(userId: number, policyId: number, tripId: number) {
	const p = db
		.select()
		.from(insurancePolicies)
		.where(and(eq(insurancePolicies.id, policyId), eq(insurancePolicies.userId, userId)))
		.get();
	if (!p) throw error(404, 'Not found');
	db.update(insurancePolicies).set({ tripId }).where(eq(insurancePolicies.id, policyId)).run();
}

export function detachPolicyFromTrip(userId: number, policyId: number) {
	const p = db
		.select()
		.from(insurancePolicies)
		.where(and(eq(insurancePolicies.id, policyId), eq(insurancePolicies.userId, userId)))
		.get();
	if (!p) throw error(404, 'Not found');
	db.update(insurancePolicies).set({ tripId: null }).where(eq(insurancePolicies.id, policyId)).run();
}
