import {
	listBenefitTemplates as listRepo,
	getBenefitTemplateById,
	ensureDefaultBenefitTemplates as ensureRepo,
	createBenefitTemplate as createRepo,
	updateBenefitTemplate as updateRepo,
	deleteBenefitTemplate as deleteRepo
} from './repositories/settingsRepo';

export function listBenefitTemplates() {
	return listRepo();
}

export function getBenefitTemplate(id: number) {
	return getBenefitTemplateById(id);
}

export function ensureDefaultBenefitTemplates() {
	ensureRepo();
}

export function createBenefitTemplate(input: Parameters<typeof createRepo>[0]) {
	return createRepo(input);
}

export function updateBenefitTemplate(id: number, patch: Parameters<typeof updateRepo>[1]) {
	return updateRepo(id, patch);
}

export function deleteBenefitTemplate(id: number) {
	return deleteRepo(id);
}
