import { fail, redirect, type Actions } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { requireOwnedTrip } from '$lib/server/ownership';
import * as tripsRepo from '$lib/server/repositories/tripsRepo';
import {
	listInsurancePolicies,
	createInsurancePolicy,
	updateInsurancePolicy,
	deleteInsurancePolicy
} from '$lib/server/repositories/profileRepo';
import { positiveIdFromForm } from '$lib/server/validation';
import type { PageServerLoad } from './$types';

export function _addPolicy(
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
	return createInsurancePolicy(userId, {
		provider: i.provider,
		policyNumber: i.policyNumber,
		coverageSummary: i.coverageSummary,
		coverageAmount: i.coverageAmount,
		startDate: i.startDate,
		endDate: i.endDate,
		tripId: i.tripId,
		notes: i.notes
	});
}

export function _updatePolicy(
	userId: number,
	id: number,
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
	return updateInsurancePolicy(id, userId, {
		provider: i.provider,
		policyNumber: i.policyNumber,
		coverageSummary: i.coverageSummary,
		coverageAmount: i.coverageAmount,
		startDate: i.startDate,
		endDate: i.endDate,
		tripId: i.tripId,
		notes: i.notes
	});
}

export const load: PageServerLoad = ({ locals }) => {
	const u = requireUser(locals);
	return {
		policies: listInsurancePolicies(u.id),
		trips: tripsRepo.listTripsForUser(u.id)
	};
};

export const actions: Actions = {
	add: async ({ request, locals }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		let tripId: number | undefined;
		const tripIdRaw = f.get('tripId');
		if (tripIdRaw) {
			const tripResult = positiveIdFromForm(tripIdRaw, 'tripId');
			if (!tripResult.ok) return fail(400, { error: tripResult.error });
			tripId = tripResult.value;
		}
		_addPolicy(u.id, {
			provider: String(f.get('provider')),
			policyNumber: String(f.get('policyNumber') || '') || undefined,
			coverageSummary: String(f.get('coverageSummary') || '') || undefined,
			coverageAmount: f.get('coverageAmount') ? Number(f.get('coverageAmount')) : undefined,
			startDate: String(f.get('startDate') || '') || undefined,
			endDate: String(f.get('endDate') || '') || undefined,
			tripId
		});
		throw redirect(303, '/insurance');
	},
	update: async ({ request, locals }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const idResult = positiveIdFromForm(f.get('id'), 'id');
		if (!idResult.ok) return fail(400, { error: idResult.error });
		let tripId: number | undefined;
		const tripIdRaw = f.get('tripId');
		if (tripIdRaw) {
			const tripResult = positiveIdFromForm(tripIdRaw, 'tripId');
			if (!tripResult.ok) return fail(400, { error: tripResult.error });
			tripId = tripResult.value;
		}
		_updatePolicy(u.id, idResult.value, {
			provider: String(f.get('provider')),
			policyNumber: String(f.get('policyNumber') || '') || undefined,
			coverageSummary: String(f.get('coverageSummary') || '') || undefined,
			coverageAmount: f.get('coverageAmount') ? Number(f.get('coverageAmount')) : undefined,
			startDate: String(f.get('startDate') || '') || undefined,
			endDate: String(f.get('endDate') || '') || undefined,
			tripId,
			notes: String(f.get('notes') || '') || undefined
		});
		throw redirect(303, '/insurance');
	},
	delete: async ({ request, locals }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const idResult = positiveIdFromForm(f.get('id'), 'id');
		if (!idResult.ok) return fail(400, { error: idResult.error });
		deleteInsurancePolicy(idResult.value, u.id);
		throw redirect(303, '/insurance');
	}
};
