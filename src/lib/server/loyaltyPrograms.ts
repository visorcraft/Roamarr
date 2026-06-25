import { error } from '@sveltejs/kit';
import { asc } from 'drizzle-orm';
import { db } from './db';
import { loyaltyPrograms } from './db/schema';
import { userCrudFactory } from './crud';
import { Validator } from './validation';

interface LoyaltyProgramInput {
	programName: string;
	membershipNumber?: string | null;
	balance?: number | null;
	notes?: string | null;
}

const loyaltyCrud = userCrudFactory({
	table: loyaltyPrograms,
	auditEntity: 'loyalty_program',
	orderBy: asc(loyaltyPrograms.programName),
	validate(input: LoyaltyProgramInput) {
		const v = new Validator();
		v.requiredString(input.programName, 'programName', { max: 200 });
		v.optionalString(input.membershipNumber, 'membershipNumber', { max: 200 });
		v.optionalString(input.notes, 'notes', { max: 2000 });
		if (input.balance != null && (!Number.isFinite(input.balance) || input.balance < 0)) {
			v.addError('balance', 'Balance must be a non-negative number');
		}
		if (!v.ok()) throw error(400, v.failMessage());
	},
	buildInsert(input, userId) {
		return {
			userId,
			programName: input.programName.trim(),
			membershipNumber: input.membershipNumber?.trim() || null,
			balance: input.balance ?? null,
			notes: input.notes?.trim() || null
		};
	},
	update: {
		validate(input: LoyaltyProgramInput) {
			const v = new Validator();
			v.requiredString(input.programName, 'programName', { max: 200 });
			v.optionalString(input.membershipNumber, 'membershipNumber', { max: 200 });
			v.optionalString(input.notes, 'notes', { max: 2000 });
			if (input.balance != null && (!Number.isFinite(input.balance) || input.balance < 0)) {
				v.addError('balance', 'Balance must be a non-negative number');
			}
			if (!v.ok()) throw error(400, v.failMessage());
		},
		buildSet(input) {
			return {
				programName: input.programName.trim(),
				membershipNumber: input.membershipNumber?.trim() || null,
				balance: input.balance ?? null,
				notes: input.notes?.trim() || null
			};
		}
	}
});

export const listLoyaltyPrograms = loyaltyCrud.list;
export const addLoyaltyProgram = loyaltyCrud.add;
export const updateLoyaltyProgram = loyaltyCrud.modify;
export const deleteLoyaltyProgram = loyaltyCrud.remove;
