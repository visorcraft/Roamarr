import { requireOwnedTrip } from '$lib/server/ownership';
import {
	createInsurancePolicy,
	updateInsurancePolicy,
	type InsurancePolicy,
	type InsurancePolicyInput
} from '$lib/server/repositories/profileRepo';

export type { InsurancePolicy, InsurancePolicyInput };

export function addPolicy(userId: number, input: InsurancePolicyInput): InsurancePolicy {
	if (input.tripId != null) requireOwnedTrip(userId, input.tripId);
	return createInsurancePolicy(userId, input);
}

export function updatePolicy(
	userId: number,
	id: number,
	input: InsurancePolicyInput
): InsurancePolicy | null {
	if (input.tripId != null) requireOwnedTrip(userId, input.tripId);
	return updateInsurancePolicy(id, userId, input);
}
