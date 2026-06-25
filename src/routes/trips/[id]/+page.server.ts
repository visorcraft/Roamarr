import { error, fail, redirect, type Actions } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { buildTripDetail } from '$lib/server/tripDetail';
import { parseTripId } from '$lib/server/params';
import {
	addCompanion,
	updateCompanion,
	deleteCompanion
} from '$lib/server/tripCompanions';
import {
	addChecklistItem,
	toggleChecklistItem,
	deleteChecklistItem
} from '$lib/server/tripChecklists';
import { addExpense, deleteExpense } from '$lib/server/tripExpenses';
import { setAttendeeStatus, removeAttendee } from '$lib/server/segmentAttendees';
import {
	addJournalEntry,
	updateJournalEntry,
	deleteJournalEntry
} from '$lib/server/tripJournal';
import {
	addDocumentLink,
	updateDocumentLink,
	deleteDocumentLink
} from '$lib/server/tripDocumentLinks';
import { createPoll, votePoll, deletePoll } from '$lib/server/tripPolls';
import { setBudgetAction, deleteBudgetAction } from '$lib/server/tripBudgets';
import { listTemplates, saveChecklistTemplate, applyChecklistTemplate } from '$lib/server/packingTemplates';
import {
	addHomeTaskAction,
	toggleHomeTask,
	deleteHomeTask
} from '$lib/server/tripHomeTasks';
import {
	addMedication,
	deleteMedication
} from '$lib/server/tripMedications';
import {
	addEntryRequirement,
	updateEntryRequirementStatus,
	deleteEntryRequirement
} from '$lib/server/tripEntryRequirements';
import {
	addImportantItem,
	deleteImportantItem
} from '$lib/server/tripImportantItems';
import {
	regenerateCalendarFeed,
	revokeCalendarFeed,
	duplicate,
	toggleArchive,
	toggleFavorite,
	customReminder,
	segmentReminder,
	duplicateSegmentAction,
	setSegmentStatusAction,
	attachPolicy,
	detachPolicy,
	addCommentAction,
	deleteCommentAction,
	shareItineraryWithContactAction,
	addAttachmentAction,
	deleteAttachmentAction,
	saveTripTemplateAction
} from '$lib/server/tripMetaActions';
import { withTripAction } from '$lib/server/actions';
import { positiveIdFromForm } from '$lib/server/validation';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, params, url }) => {
	const u = requireUser(locals);
	const tripId = parseTripId(params);
	return buildTripDetail(u, tripId, url);
};

export const actions: Actions = {
	regenerateCalendarFeed,
	revokeCalendarFeed,
	duplicate,
	toggleArchive,
	toggleFavorite,
	customReminder,
	segmentReminder,
	duplicateSegment: duplicateSegmentAction,
	setSegmentStatus: setSegmentStatusAction,
	attachPolicy,
	detachPolicy,
	addComment: addCommentAction,
	deleteComment: deleteCommentAction,
	addCompanion,
	updateCompanion,
	deleteCompanion,
	addChecklistItem,
	toggleChecklistItem,
	deleteChecklistItem,
	addExpense,
	deleteExpense,
	setAttendeeStatus,
	removeAttendee,
	addJournalEntry,
	updateJournalEntry,
	deleteJournalEntry,
	addDocumentLink,
	updateDocumentLink,
	deleteDocumentLink,
	createPoll,
	votePoll,
	deletePoll,
	saveChecklistTemplate,
	applyChecklistTemplate,
	setBudget: setBudgetAction,
	deleteBudget: deleteBudgetAction,
	shareItineraryWithContact: shareItineraryWithContactAction,
	addAttachment: addAttachmentAction,
	deleteAttachment: deleteAttachmentAction,
	saveTripTemplate: saveTripTemplateAction,
	addHomeTask: addHomeTaskAction,
	toggleHomeTask: async (event) => {
		const { user, tripId, formData } = await withTripAction(event);
		const taskIdResult = positiveIdFromForm(formData.get('taskId'), 'taskId');
		if (!taskIdResult.ok) return fail(400, { error: taskIdResult.error });
		toggleHomeTask(user.id, tripId, taskIdResult.value);
		throw redirect(303, `/trips/${tripId}`);
	},
	deleteHomeTask: async (event) => {
		const { user, tripId, formData } = await withTripAction(event);
		const taskIdResult = positiveIdFromForm(formData.get('taskId'), 'taskId');
		if (!taskIdResult.ok) return fail(400, { error: taskIdResult.error });
		deleteHomeTask(user.id, tripId, taskIdResult.value);
		throw redirect(303, `/trips/${tripId}`);
	},
	addMedication: async (event) => {
		const { user, tripId, formData } = await withTripAction(event);
		const name = String(formData.get('name') || '');
		const companionIdRaw = formData.get('companionId');
		const companionId = companionIdRaw ? Number(companionIdRaw) : null;
		const dosage = String(formData.get('dosage') || '');
		const schedule = String(formData.get('schedule') || '');
		const startsAt = String(formData.get('startsAt') || '');
		const endsAt = String(formData.get('endsAt') || '');
		const notes = String(formData.get('notes') || '');
		addMedication(user.id, tripId, {
			name,
			companionId: companionId && Number.isFinite(companionId) ? companionId : null,
			dosage,
			schedule,
			startsAt,
			endsAt,
			notes
		});
		throw redirect(303, `/trips/${tripId}`);
	},
	deleteMedication: async (event) => {
		const { user, tripId, formData } = await withTripAction(event);
		const medicationIdResult = positiveIdFromForm(formData.get('medicationId'), 'medicationId');
		if (!medicationIdResult.ok) return fail(400, { error: medicationIdResult.error });
		deleteMedication(user.id, tripId, medicationIdResult.value);
		throw redirect(303, `/trips/${tripId}`);
	},
	addEntryRequirement: async (event) => {
		const { user, tripId, formData } = await withTripAction(event);
		const country = String(formData.get('country') || '');
		const requirementType = String(formData.get('requirementType') || '');
		const status = String(formData.get('status') || 'needed');
		const dueDate = String(formData.get('dueDate') || '') || null;
		const notes = String(formData.get('notes') || '');
		addEntryRequirement(user.id, tripId, { country, requirementType, status, dueDate, notes });
		throw redirect(303, `/trips/${tripId}`);
	},
	updateEntryRequirementStatus: async (event) => {
		const { user, tripId, formData } = await withTripAction(event);
		const requirementIdResult = positiveIdFromForm(formData.get('requirementId'), 'requirementId');
		if (!requirementIdResult.ok) return fail(400, { error: requirementIdResult.error });
		const status = String(formData.get('status') || '');
		updateEntryRequirementStatus(user.id, tripId, requirementIdResult.value, status);
		throw redirect(303, `/trips/${tripId}`);
	},
	deleteEntryRequirement: async (event) => {
		const { user, tripId, formData } = await withTripAction(event);
		const requirementIdResult = positiveIdFromForm(formData.get('requirementId'), 'requirementId');
		if (!requirementIdResult.ok) return fail(400, { error: requirementIdResult.error });
		deleteEntryRequirement(user.id, tripId, requirementIdResult.value);
		throw redirect(303, `/trips/${tripId}`);
	},
	addImportantItem: async (event) => {
		const { user, tripId, formData } = await withTripAction(event);
		const name = String(formData.get('name') || '');
		const companionIdRaw = formData.get('companionId');
		const companionId = companionIdRaw ? Number(companionIdRaw) : null;
		const serialNumber = String(formData.get('serialNumber') || '');
		const trackerId = String(formData.get('trackerId') || '');
		const notes = String(formData.get('notes') || '');
		addImportantItem(user.id, tripId, {
			name,
			companionId: companionId && Number.isFinite(companionId) ? companionId : null,
			serialNumber,
			trackerId,
			notes
		});
		throw redirect(303, `/trips/${tripId}`);
	},
	deleteImportantItem: async (event) => {
		const { user, tripId, formData } = await withTripAction(event);
		const itemIdResult = positiveIdFromForm(formData.get('itemId'), 'itemId');
		if (!itemIdResult.ok) return fail(400, { error: itemIdResult.error });
		deleteImportantItem(user.id, tripId, itemIdResult.value);
		throw redirect(303, `/trips/${tripId}`);
	}
};
