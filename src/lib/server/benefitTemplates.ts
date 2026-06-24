import { eq, count } from 'drizzle-orm';
import { error } from '@sveltejs/kit';
import { db } from './db';
import { benefitTemplates } from './db/schema';
import type { DB } from './db';

const DEFAULT_BENEFIT_TEMPLATES: Array<
	Omit<typeof benefitTemplates.$inferInsert, 'id'>
> = [
	{
		benefitType: 'trip_delay',
		name: 'Trip delay reimbursement',
		coverageAmount: 50000,
		currency: 'USD',
		description: 'Reimburses meals, lodging and transport when a trip is delayed.'
	},
	{
		benefitType: 'baggage_delay',
		name: 'Baggage delay reimbursement',
		coverageAmount: 10000,
		currency: 'USD',
		description: 'Reimburses essential purchases when checked baggage is delayed.'
	},
	{
		benefitType: 'trip_cancellation',
		name: 'Trip cancellation reimbursement',
		coverageAmount: 100000,
		currency: 'USD',
		description: 'Reimburses non-refundable trip costs if you cancel for a covered reason.'
	}
];

function requireAdminRole(role: string) {
	if (role !== 'admin') throw error(403, 'Admin only');
}

export function listBenefitTemplates() {
	return db.select().from(benefitTemplates).all();
}

export function getBenefitTemplate(id: number) {
	return db.select().from(benefitTemplates).where(eq(benefitTemplates.id, id)).get();
}

export function createBenefitTemplate(
	user: { role: string },
	input: Omit<typeof benefitTemplates.$inferInsert, 'id'>
) {
	requireAdminRole(user.role);
	return db.insert(benefitTemplates).values(input).returning().get();
}

export function updateBenefitTemplate(
	user: { role: string },
	id: number,
	input: Partial<Omit<typeof benefitTemplates.$inferInsert, 'id'>>
) {
	requireAdminRole(user.role);
	return db
		.update(benefitTemplates)
		.set(input)
		.where(eq(benefitTemplates.id, id))
		.returning()
		.get();
}

export function deleteBenefitTemplate(user: { role: string }, id: number) {
	requireAdminRole(user.role);
	return db.delete(benefitTemplates).where(eq(benefitTemplates.id, id)).run();
}

export function ensureDefaultBenefitTemplates(database: DB) {
	const existing = database.select({ count: count() }).from(benefitTemplates).get();
	if (existing && existing.count > 0) return;
	database.insert(benefitTemplates).values(DEFAULT_BENEFIT_TEMPLATES).run();
}
