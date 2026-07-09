import { requireUser } from '$lib/server/auth';
import { buildTripDetail } from '$lib/server/tripDetail';
import { parseTripId } from '$lib/server/params';
import { addCompanion, updateCompanion } from '$lib/server/tripCompanions';
import {
	addChecklistItem,
	toggleChecklistItem,
	deleteChecklistItem,
	setAllChecklistItems
} from '$lib/server/tripChecklists';
import { addExpense, deleteExpense } from '$lib/server/tripExpenses';
import { setAttendee } from '$lib/server/segmentAttendees';
import { addJournalEntry, deleteJournalEntry } from '$lib/server/tripJournal';
import { addDocumentLink, deleteDocumentLink } from '$lib/server/tripDocumentLinks';
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
	duplicate,
	toggleArchive,
	toggleFavorite,
	customReminder,
	segmentReminder,
	duplicateSegmentAction,
	setSegmentStatusAction,
	moveSegmentDateAction,
	attachPolicy,
	detachPolicy,
	addCommentAction,
	deleteCommentAction,
	shareItineraryWithContactAction,
	addAttachmentAction,
	uploadTripPosterAction,
	saveTripTemplateAction,
	markVisitedPlacesAction
} from '$lib/server/tripMetaActions';
import type { Actions } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params, url }) => {
	const u = requireUser(locals);
	const tripId = parseTripId(params);
	return await buildTripDetail(u, tripId, url);
};

export const actions: Actions = {
	duplicate,
	toggleArchive,
	toggleFavorite,
	customReminder,
	segmentReminder,
	duplicateSegment: duplicateSegmentAction,
	setSegmentStatus: setSegmentStatusAction,
	moveSegmentDate: moveSegmentDateAction,
	attachPolicy,
	detachPolicy,
	addComment: addCommentAction,
	deleteComment: deleteCommentAction,
	addCompanion,
	updateCompanion,
	addChecklistItem,
	toggleChecklistItem,
	deleteChecklistItem,
	setAllChecklistItems,
	addExpense,
	deleteExpense,
	setAttendee,
	addJournalEntry,
	deleteJournalEntry,
	addDocumentLink,
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
	uploadTripPoster: uploadTripPosterAction,
	saveTripTemplate: saveTripTemplateAction,
	markVisitedPlaces: markVisitedPlacesAction,
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
