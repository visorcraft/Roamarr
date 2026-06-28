import { error } from '@sveltejs/kit';
import { requireOwnedTrip } from './ownership';
import {
	listInsurancePolicies,
	attachInsurancePolicyToTrip,
	detachInsurancePolicyFromTrip
} from './repositories/profileRepo';

export { listInsurancePolicies as listPoliciesForUser } from './repositories/profileRepo';

export function attachPolicyToTrip(userId: number, policyId: number, tripId: number) {
	requireOwnedTrip(userId, tripId);
	attachInsurancePolicyToTrip(userId, policyId, tripId);
}

export function detachPolicyFromTrip(userId: number, policyId: number) {
	detachInsurancePolicyFromTrip(userId, policyId);
}
