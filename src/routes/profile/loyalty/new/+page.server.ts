import { fail, redirect, type Actions } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { checkRateLimit } from '$lib/server/rateLimit';
import { Validator } from '$lib/server/validation';
import { logAudit } from '$lib/server/audit';
import { createLoyaltyProgram } from '$lib/server/repositories/profileRepo';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	requireUser(locals);
	return {};
};

export const actions: Actions = {
	create: async ({ request, locals, getClientAddress }) => {
		const u = requireUser(locals);
		const limit = checkRateLimit(getClientAddress(), 'loyalty:create');
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

		const program = createLoyaltyProgram(u.id, {
			programName: programName!,
			membershipNumber,
			balance,
			notes
		});
		logAudit(u.id, 'loyalty_program_create', 'loyalty_program', program.id);
		throw redirect(303, '/profile/loyalty');
	}
};
