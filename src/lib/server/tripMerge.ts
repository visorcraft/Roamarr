import { and, eq } from '@visorcraft/mongreldb-kit';
import { error } from '@sveltejs/kit';
import { kit } from './db';
import {
	auditLogs, fareWatches, insurancePolicies, reminders, segmentAttendees, segments, tripBudgetCategories,
	tripChecklists, tripChecklistItems, tripComments, tripCompanions, tripDocumentLinks,
	tripEntryRequirements, tripExpenses, tripHomeTasks, tripImportantItems, tripJournalEntries,
	tripMedications, tripPollVotes, tripPolls, tripShares, tripTemplates
} from './db/mongrelSchema';
import { requireOwnedTrip } from './ownership';
import * as tripsRepo from './repositories/tripsRepo';
import { logAudit } from './audit';

function moveCompanionReferences(from: bigint, to: bigint): void {
	kit.updateTable(segmentAttendees).set({ companion_id: to }).where(eq(segmentAttendees.companion_id, from)).executeSync();
	kit.updateTable(tripChecklistItems).set({ assigned_to_companion_id: to }).where(eq(tripChecklistItems.assigned_to_companion_id, from)).executeSync();
	kit.updateTable(tripExpenses).set({ paid_by_companion_id: to }).where(eq(tripExpenses.paid_by_companion_id, from)).executeSync();
	for (const expense of kit.selectFrom(tripExpenses).executeSync()) {
		const split = JSON.parse(expense.split_among as string) as Array<string | number>;
		const remapped = split.map((id) => id === Number(from) ? Number(to) : id);
		if (remapped.some((id, index) => id !== split[index])) kit.updateTable(tripExpenses).set({ split_among: JSON.stringify(remapped) }).where(eq(tripExpenses.id, expense.id)).executeSync();
	}
	kit.updateTable(tripMedications).set({ companion_id: to }).where(eq(tripMedications.companion_id, from)).executeSync();
	kit.updateTable(tripImportantItems).set({ companion_id: to }).where(eq(tripImportantItems.companion_id, from)).executeSync();
	kit.updateTable(tripPollVotes).set({ companion_id: to }).where(eq(tripPollVotes.companion_id, from)).executeSync();
}

export function mergeTrips(ownerId: number, donorId: number, recipientId: number): void {
	if (donorId === recipientId) throw error(400, 'Donor and recipient must be different trips');
	const donor = requireOwnedTrip(ownerId, donorId);
	const recipient = requireOwnedTrip(ownerId, recipientId);
	const donorKey = BigInt(donorId), recipientKey = BigInt(recipientId);

	const recipientCompanions = kit.selectFrom(tripCompanions).where(eq(tripCompanions.trip_id, recipientKey)).executeSync();
	const donorCompanions = kit.selectFrom(tripCompanions).where(eq(tripCompanions.trip_id, donorKey)).executeSync();
	for (const companion of donorCompanions) {
		const duplicate = companion.user_id == null ? null : recipientCompanions.find((row) => row.user_id === companion.user_id);
		if (!duplicate) continue;
		moveCompanionReferences(companion.id, duplicate.id);
		kit.deleteFrom(tripCompanions).where(eq(tripCompanions.id, companion.id)).executeSync();
	}

	const donorChecklist = kit.selectFrom(tripChecklists).where(eq(tripChecklists.trip_id, donorKey)).executeSync()[0];
	const recipientChecklist = kit.selectFrom(tripChecklists).where(eq(tripChecklists.trip_id, recipientKey)).executeSync()[0];
	if (donorChecklist && recipientChecklist) {
		kit.updateTable(tripChecklistItems).set({ checklist_id: recipientChecklist.id }).where(eq(tripChecklistItems.checklist_id, donorChecklist.id)).executeSync();
		kit.deleteFrom(tripChecklists).where(eq(tripChecklists.id, donorChecklist.id)).executeSync();
	} else if (donorChecklist) {
		kit.updateTable(tripChecklists).set({ trip_id: recipientKey }).where(eq(tripChecklists.id, donorChecklist.id)).executeSync();
	}

	const recipientBudgets = kit.selectFrom(tripBudgetCategories).where(eq(tripBudgetCategories.trip_id, recipientKey)).executeSync();
	for (const budget of kit.selectFrom(tripBudgetCategories).where(eq(tripBudgetCategories.trip_id, donorKey)).executeSync()) {
		const duplicate = recipientBudgets.find((row) => row.category === budget.category);
		if (!duplicate) {
			kit.updateTable(tripBudgetCategories).set({ trip_id: recipientKey }).where(eq(tripBudgetCategories.id, budget.id)).executeSync();
		} else if (duplicate.currency === budget.currency) {
			kit.updateTable(tripBudgetCategories).set({ amount: duplicate.amount + budget.amount }).where(eq(tripBudgetCategories.id, duplicate.id)).executeSync();
			kit.deleteFrom(tripBudgetCategories).where(eq(tripBudgetCategories.id, budget.id)).executeSync();
		} else {
			kit.updateTable(tripBudgetCategories).set({ trip_id: recipientKey, category: `${budget.category} (${donor.name})` }).where(eq(tripBudgetCategories.id, budget.id)).executeSync();
		}
	}

	const recipientShares = kit.selectFrom(tripShares).where(eq(tripShares.trip_id, recipientKey)).executeSync();
	for (const share of kit.selectFrom(tripShares).where(eq(tripShares.trip_id, donorKey)).executeSync()) {
		const duplicate = recipientShares.find((row) => row.shared_with_user_id === share.shared_with_user_id && row.shared_with_group_id === share.shared_with_group_id);
		if (duplicate) {
			kit.updateTable(tripShares).set({ permission: duplicate.permission === 'edit' || share.permission === 'edit' ? 'edit' : 'read', show_details: duplicate.show_details || share.show_details }).where(eq(tripShares.id, duplicate.id)).executeSync();
			kit.deleteFrom(tripShares).where(eq(tripShares.id, share.id)).executeSync();
		} else kit.updateTable(tripShares).set({ trip_id: recipientKey }).where(eq(tripShares.id, share.id)).executeSync();
	}

	kit.updateTable(tripComments).set({ trip_id: recipientKey }).where(eq(tripComments.trip_id, donorKey)).executeSync();
	kit.updateTable(segments).set({ trip_id: recipientKey }).where(eq(segments.trip_id, donorKey)).executeSync();
	kit.updateTable(fareWatches).set({ trip_id: recipientKey }).where(eq(fareWatches.trip_id, donorKey)).executeSync();
	kit.updateTable(tripCompanions).set({ trip_id: recipientKey }).where(eq(tripCompanions.trip_id, donorKey)).executeSync();
	kit.updateTable(tripExpenses).set({ trip_id: recipientKey }).where(eq(tripExpenses.trip_id, donorKey)).executeSync();
	kit.updateTable(tripJournalEntries).set({ trip_id: recipientKey }).where(eq(tripJournalEntries.trip_id, donorKey)).executeSync();
	kit.updateTable(tripDocumentLinks).set({ trip_id: recipientKey }).where(eq(tripDocumentLinks.trip_id, donorKey)).executeSync();
	kit.updateTable(tripPolls).set({ trip_id: recipientKey }).where(eq(tripPolls.trip_id, donorKey)).executeSync();
	kit.updateTable(tripHomeTasks).set({ trip_id: recipientKey }).where(eq(tripHomeTasks.trip_id, donorKey)).executeSync();
	kit.updateTable(tripMedications).set({ trip_id: recipientKey }).where(eq(tripMedications.trip_id, donorKey)).executeSync();
	kit.updateTable(tripEntryRequirements).set({ trip_id: recipientKey }).where(eq(tripEntryRequirements.trip_id, donorKey)).executeSync();
	kit.updateTable(tripImportantItems).set({ trip_id: recipientKey }).where(eq(tripImportantItems.trip_id, donorKey)).executeSync();
	kit.updateTable(insurancePolicies).set({ trip_id: recipientKey }).where(eq(insurancePolicies.trip_id, donorKey)).executeSync();
	kit.updateTable(tripTemplates).set({ source_trip_id: recipientKey }).where(eq(tripTemplates.source_trip_id, donorKey)).executeSync();
	kit.updateTable(reminders).set({ ref_id: recipientKey }).where(and(eq(reminders.ref_type, 'trip'), eq(reminders.ref_id, donorKey))).executeSync();
	kit.updateTable(auditLogs).set({ entity_id: recipientKey }).where(and(eq(auditLogs.entity_type, 'trip'), eq(auditLogs.entity_id, donorKey))).executeSync();

	const startDate = [recipient.startDate, donor.startDate].filter(Boolean).sort()[0] ?? null;
	const endDate = [recipient.endDate, donor.endDate].filter(Boolean).sort().at(-1) ?? null;
	const tags = [...new Set([...JSON.parse(recipient.tags || '[]'), ...JSON.parse(donor.tags || '[]')])];
	const notes = [recipient.notes, donor.notes].filter(Boolean).join('\n\n') || null;
	tripsRepo.updateTrip(recipientId, { startDate, endDate, tags: JSON.stringify(tags), notes,
		posterAttachmentId: recipient.posterAttachmentId ?? donor.posterAttachmentId });
	tripsRepo.deleteTrip(donorId);
	logAudit(ownerId, 'trip_merge', 'trip', recipientId, { donorTripId: donorId });
}
