import {
	listLoyaltyPrograms as listRepo,
	createLoyaltyProgram as createRepo,
	updateLoyaltyProgram as updateRepo,
	deleteLoyaltyProgram as deleteRepo
} from './repositories/profileRepo';

export function listLoyaltyPrograms(userId: number) {
	return listRepo(userId);
}

export function createLoyaltyProgram(
	userId: number,
	input: Parameters<typeof createRepo>[1]
) {
	return createRepo(userId, input);
}

export function updateLoyaltyProgram(
	userId: number,
	id: number,
	input: Parameters<typeof updateRepo>[2]
) {
	return updateRepo(id, userId, input);
}

export function deleteLoyaltyProgram(userId: number, id: number) {
	return deleteRepo(id, userId);
}
