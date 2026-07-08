import { error, fail, redirect, type Actions } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { checkRateLimit } from '$lib/server/rateLimit';
import { logAudit } from '$lib/server/audit';
import { Validator, currency as parseCurrency } from '$lib/server/validation';
import * as tripsRepo from '$lib/server/repositories/tripsRepo';
import { getInsurancePolicyById } from '$lib/server/repositories/profileRepo';
import { updatePolicy } from '$lib/server/insurancePolicies';
import type { PageServerLoad } from './$types';

function parseId(params: { id?: string }): number {
	const id = Number(params.id);
	if (!Number.isInteger(id) || id < 1) throw error(404, 'Not found');
	return id;
}

export const load: PageServerLoad = ({ params, locals }) => {
	const u = requireUser(locals);
	const id = parseId(params);
	const policy = getInsurancePolicyById(id, u.id);
	if (!policy) throw error(404, 'Not found');
	return {
		policy,
		trips: tripsRepo.listTripsForUser(u.id).map((t) => ({ id: t.id, name: t.name }))
	};
};

export const actions: Actions = {
	update: async ({ params, request, locals, getClientAddress }) => {
		const u = requireUser(locals);
		const id = parseId(params);
		const limit = checkRateLimit(getClientAddress(), 'insurance:update');
		if (!limit.allowed) {
			return fail(429, { error: 'Too many attempts. Try again later.', retryAfter: limit.retryAfter });
		}

		const f = await request.formData();
		const v = new Validator();
		const provider = v.requiredString(f.get('provider'), 'provider', { max: 200 });
		const policyNumber = v.optionalString(f.get('policyNumber'), 'policyNumber', { max: 200 });
		const coverageSummary = v.optionalString(f.get('coverageSummary'), 'coverageSummary', { max: 2000 });
		const startDate = v.date(f.get('startDate'), 'startDate');
		const endDate = v.date(f.get('endDate'), 'endDate');
		v.dateRange(startDate, endDate);
		const notes = v.optionalString(f.get('notes'), 'notes', { max: 2000 });

		const coverageRaw = f.get('coverageAmount');
		let coverageAmount: number | undefined;
		if (coverageRaw !== '' && coverageRaw != null) {
			const n = Number(coverageRaw);
			if (!Number.isFinite(n)) {
				v.addError('coverageAmount', 'coverageAmount must be a number');
			} else if (n < 0) {
				v.addError('coverageAmount', 'Coverage amount cannot be negative');
			} else {
				coverageAmount = n;
			}
		}

		const currencyResult = parseCurrency(f.get('currency'), 'currency');
		let currencyValue: string | undefined;
		if (!currencyResult.ok) {
			v.addError('currency', currencyResult.error);
		} else {
			currencyValue = currencyResult.value;
		}

		let tripId: number | null | undefined;
		const tripIdRaw = f.get('tripId');
		if (tripIdRaw == null || tripIdRaw === '') {
			tripId = null;
		} else {
			const parsed = v.positiveId(tripIdRaw, 'tripId');
			tripId = parsed ?? undefined;
		}

		if (!v.ok()) {
			return fail(400, {
				error: v.failMessage(),
				errors: v.errors,
				values: {
					provider: String(f.get('provider') || '').trim(),
					policyNumber: String(f.get('policyNumber') || '').trim(),
					coverageSummary: String(f.get('coverageSummary') || '').trim(),
					coverageAmount: String(f.get('coverageAmount') || ''),
					currency: String(f.get('currency') || ''),
					startDate: String(f.get('startDate') || ''),
					endDate: String(f.get('endDate') || ''),
					tripId: String(f.get('tripId') || ''),
					notes: String(f.get('notes') || '').trim()
				}
			});
		}

		updatePolicy(u.id, id, {
			provider: provider!,
			policyNumber,
			coverageSummary,
			coverageAmount,
			currency: currencyValue,
			startDate,
			endDate,
			tripId,
			notes
		});
		logAudit(u.id, 'insurance_policy_update', 'insurance_policy', id);
		throw redirect(303, '/insurance');
	}
};
