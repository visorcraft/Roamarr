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
import { saveChecklistTemplate, applyChecklistTemplate } from '$lib/server/packingTemplates';
import {
	addHomeTaskAction,
	toggleHomeTaskAction,
	deleteHomeTaskAction
} from '$lib/server/tripHomeTasks';
import {
	addMedicationAction,
	deleteMedicationAction
} from '$lib/server/tripMedications';
import {
	addEntryRequirementAction,
	updateEntryRequirementStatusAction,
	deleteEntryRequirementAction
} from '$lib/server/tripEntryRequirements';
import {
	addImportantItemAction,
	deleteImportantItemAction
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
import type { Actions } from '@sveltejs/kit';
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
	toggleHomeTask: toggleHomeTaskAction,
	deleteHomeTask: deleteHomeTaskAction,
	addMedication: addMedicationAction,
	deleteMedication: deleteMedicationAction,
	addEntryRequirement: addEntryRequirementAction,
	updateEntryRequirementStatus: updateEntryRequirementStatusAction,
	deleteEntryRequirement: deleteEntryRequirementAction,
	addImportantItem: addImportantItemAction,
	deleteImportantItem: deleteImportantItemAction
};
