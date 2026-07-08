import { error, fail, redirect, type Actions } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { checkRateLimit } from '$lib/server/rateLimit';
import { Validator } from '$lib/server/validation';
import { logAudit } from '$lib/server/audit';
import { getLoyaltyProgramById, updateLoyaltyProgram } from '$lib/server/repositories/profileRepo';
import type { PageServerLoad } from './$types';

function parseId(params: { id?: string }): number {
	const id = Number(params.id);
	if (!Number.isInteger(id) || id < 1) throw error(404, 'Not found');
	return id;
}

export const load: PageServerLoad = ({ params, locals }) => {
	const u = requireUser(locals);
	const id = parseId(params);
	const program = getLoyaltyProgramById(id, u.id);
	if (!program) throw error(404, 'Not found');
	return { program };
};

export const actions: Actions = {
	update: async ({ params, request, locals, getClientAddress }) => {
		const u = requireUser(locals);
		const id = parseId(params);
		const limit = checkRateLimit(getClientAddress(), 'loyalty:update');
		if (!limit.allowed) {
			return fail(429, { error: 'Too many attempts. Try again later.', retryAfter: limit.retryAfter });
		}

		const f = await request.formData();
		const v = new Validator();
		const programName = v.requiredString(f.get('programName'), 'programName', { max: 200 });
		const membershipNumber = v.optionalString(f.get('membershipNumber'), 'membershipNumber', { max: 200 });
		const notes = v.optionalString(f.get('notes'), 'notes', { max: 2000 });

		const balanceRaw = f.get('balance');
		let balance: number | undefined;
		if (balanceRaw !== '' && balanceRaw != null) {
			const n = Number(balanceRaw);
			if (!Number.isFinite(n)) {
				v.addError('balance', 'balance must be a number');
			} else if (n < 0) {
				v.addError('balance', 'Balance cannot be negative');
			} else {
				balance = n;
			}
		}

		if (!v.ok()) {
			return fail(400, {
				error: v.failMessage(),
				errors: v.errors,
				values: {
					programName: String(f.get('programName') || '').trim(),
					membershipNumber: String(f.get('membershipNumber') || '').trim(),
					balance: String(f.get('balance') || ''),
					notes: String(f.get('notes') || '').trim()
				}
			});
		}

		updateLoyaltyProgram(id, u.id, {
			programName: programName!,
			membershipNumber,
			balance,
			notes
		});
		logAudit(u.id, 'loyalty_program_update', 'loyalty_program', id);
		throw redirect(303, '/profile/loyalty');
	}
};
