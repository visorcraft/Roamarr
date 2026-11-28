import { and, eq } from '@visorcraft/mongreldb-kit';
import { error } from '@sveltejs/kit';
import { kit } from './db';
import {
	auditLogs, fareWatches, galleryImages, insurancePolicies, reminders, segmentAttendees, segments, tripBudgetCategories,
	tripChecklists, tripChecklistItems, tripComments, tripCompanions, tripDocuments, tripDocumentLinks,
	tripDayNotes, tripEntryRequirements, tripExpenses, tripInvitations, tripHomeTasks, tripMailHolds, tripImportantItems, tripJournalEntries,
	tripMedications, tripPollVotes, tripPolls, tripShares, tripTemplates
} from './db/mongrelSchema';
import { requireOwnedTrip } from './ownership';
import * as tripsRepo from './repositories/tripsRepo';
import { logAudit } from './audit';
import { publishSharesChanged, publishTripChanged } from './eventBus';
import { scheduleIndexTrip, scheduleRemoveTrip } from './embeddings/search';

function moveCompanionReferences(donorKey: bigint, from: bigint, to: bigint): void {
	kit.updateTable(segmentAttendees).set({ companion_id: to }).where(eq(segmentAttendees.companion_id, from)).executeSync();
	kit.updateTable(tripChecklistItems).set({ assigned_to_companion_id: to }).where(eq(tripChecklistItems.assigned_to_companion_id, from)).executeSync();
	kit.updateTable(tripExpenses).set({ paid_by_companion_id: to }).where(eq(tripExpenses.paid_by_companion_id, from)).executeSync();
	for (const expense of kit.selectFrom(tripExpenses).where(eq(tripExpenses.trip_id, donorKey)).executeSync()) {
		let split: Array<string | number>;
		try {
			const raw = expense.split_among as unknown;
			const parsed = Array.isArray(raw) ? raw : JSON.parse(raw as string);
			if (!Array.isArray(parsed)) continue;
			split = parsed as Array<string | number>;
		} catch {
			continue;
		}
		const remapped = Array.from(new Set(split.map((id) => id === Number(from) ? Number(to) : id)));
		if (JSON.stringify(remapped) !== JSON.stringify(split)) kit.updateTable(tripExpenses).set({ split_among: JSON.stringify(remapped) }).where(eq(tripExpenses.id, expense.id)).executeSync();
	}
	kit.updateTable(tripMedications).set({ companion_id: to }).where(eq(tripMedications.companion_id, from)).executeSync();
	kit.updateTable(tripImportantItems).set({ companion_id: to }).where(eq(tripImportantItems.companion_id, from)).executeSync();
	kit.updateTable(tripPollVotes).set({ companion_id: to }).where(eq(tripPollVotes.companion_id, from)).executeSync();
}

function migrateTripDocuments(donorKey: bigint, recipientKey: bigint): void {
	kit.updateTable(tripDocuments).set({ trip_id: recipientKey }).where(eq(tripDocuments.trip_id, donorKey)).executeSync();
}

function migrateGalleryImages(donorKey: bigint, recipientKey: bigint): void {
	const recipientRows = kit.selectFrom(galleryImages).where(and(eq(galleryImages.owner_type, 'trip'), eq(galleryImages.owner_id, recipientKey))).executeSync();
	let nextOrder = recipientRows.reduce((max, row) => Math.max(max, Number(row.sort_order ?? 0)), -1) + 1;
	const donorRows = kit.selectFrom(galleryImages).where(and(eq(galleryImages.owner_type, 'trip'), eq(galleryImages.owner_id, donorKey))).executeSync();
	for (const row of donorRows) {
		kit.updateTable(galleryImages).set({ owner_id: recipientKey, sort_order: BigInt(nextOrder) }).where(eq(galleryImages.id, row.id)).executeSync();
		nextOrder += 1;
	}
}

function migrateDayNotes(donorKey: bigint, recipientKey: bigint): void {
	const recipientByDate = new Map<string, any>();
	for (const note of kit.selectFrom(tripDayNotes).where(eq(tripDayNotes.trip_id, recipientKey)).executeSync()) {
		recipientByDate.set(note.date as string, note);
	}
	for (const note of kit.selectFrom(tripDayNotes).where(eq(tripDayNotes.trip_id, donorKey)).executeSync()) {
		const existing = recipientByDate.get(note.date as string);
		if (existing) {
			const body = [existing.body, note.body].filter(Boolean).join('\n\n');
			kit.updateTable(tripDayNotes).set({ body, icon: (existing.icon as string | null) ?? (note.icon as string | null) }).where(eq(tripDayNotes.id, existing.id)).executeSync();
			kit.deleteFrom(tripDayNotes).where(eq(tripDayNotes.id, note.id)).executeSync();
		} else {
			kit.updateTable(tripDayNotes).set({ trip_id: recipientKey }).where(eq(tripDayNotes.id, note.id)).executeSync();
		}
	}
}

function migrateInvitations(donorKey: bigint, recipientKey: bigint): void {
	const recipientByEmail = new Map<string, any>();
	for (const invitation of kit.selectFrom(tripInvitations).where(eq(tripInvitations.trip_id, recipientKey)).executeSync()) {
		recipientByEmail.set(String(invitation.email).toLowerCase(), invitation);
	}
	for (const invitation of kit.selectFrom(tripInvitations).where(eq(tripInvitations.trip_id, donorKey)).executeSync()) {
		const existing = recipientByEmail.get(String(invitation.email).toLowerCase());
		if (existing) {
			if (invitation.permission === 'edit' && existing.permission !== 'edit') {
				kit.updateTable(tripInvitations).set({ permission: 'edit' }).where(eq(tripInvitations.id, existing.id)).executeSync();
			}
			kit.deleteFrom(tripInvitations).where(eq(tripInvitations.id, invitation.id)).executeSync();
		} else {
			kit.updateTable(tripInvitations).set({ trip_id: recipientKey }).where(eq(tripInvitations.id, invitation.id)).executeSync();
		}
	}
}

export function mergeTrips(ownerId: number, donorId: number, recipientId: number): void {
	if (donorId === recipientId) throw error(400, 'Donor and recipient must be different trips');
	const donor = requireOwnedTrip(ownerId, donorId);
	const recipient = requireOwnedTrip(ownerId, recipientId);
	const donorKey = BigInt(donorId), recipientKey = BigInt(recipientId);

	const donorShares = kit.selectFrom(tripShares).where(eq(tripShares.trip_id, donorKey)).executeSync();
	const affectedUserIds = new Set<number>();
	for (const share of donorShares) {
		if (share.shared_with_user_id != null) {
			affectedUserIds.add(Number(share.shared_with_user_id));
		}
		if (share.shared_with_group_id != null) {
			for (const member of tripsRepo.listMembersForGroup(Number(share.shared_with_group_id))) {
				affectedUserIds.add(member.id);
			}
		}
	}
	affectedUserIds.delete(ownerId);

	const recipientCompanions = kit.selectFrom(tripCompanions).where(eq(tripCompanions.trip_id, recipientKey)).executeSync();
	const donorCompanions = kit.selectFrom(tripCompanions).where(eq(tripCompanions.trip_id, donorKey)).executeSync();
	for (const companion of donorCompanions) {
		const duplicate = companion.user_id == null ? null : recipientCompanions.find((row) => row.user_id === companion.user_id);
		if (!duplicate) continue;
		moveCompanionReferences(donorKey, companion.id, duplicate.id);
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
	kit.updateTable(tripMailHolds).set({ trip_id: recipientKey }).where(eq(tripMailHolds.trip_id, donorKey)).executeSync();
	kit.updateTable(tripMedications).set({ trip_id: recipientKey }).where(eq(tripMedications.trip_id, donorKey)).executeSync();
	kit.updateTable(tripEntryRequirements).set({ trip_id: recipientKey }).where(eq(tripEntryRequirements.trip_id, donorKey)).executeSync();
	kit.updateTable(tripImportantItems).set({ trip_id: recipientKey }).where(eq(tripImportantItems.trip_id, donorKey)).executeSync();
	kit.updateTable(insurancePolicies).set({ trip_id: recipientKey }).where(eq(insurancePolicies.trip_id, donorKey)).executeSync();
	kit.updateTable(tripTemplates).set({ source_trip_id: recipientKey }).where(eq(tripTemplates.source_trip_id, donorKey)).executeSync();
	kit.updateTable(reminders).set({ ref_id: recipientKey }).where(and(eq(reminders.ref_type, 'trip'), eq(reminders.ref_id, donorKey))).executeSync();
	kit.updateTable(auditLogs).set({ entity_id: recipientKey }).where(and(eq(auditLogs.entity_type, 'trip'), eq(auditLogs.entity_id, donorKey))).executeSync();

	migrateTripDocuments(donorKey, recipientKey);
	migrateGalleryImages(donorKey, recipientKey);
	migrateDayNotes(donorKey, recipientKey);
	migrateInvitations(donorKey, recipientKey);

	const startDate = [recipient.startDate, donor.startDate].filter(Boolean).sort()[0] ?? null;
	const endDate = [recipient.endDate, donor.endDate].filter(Boolean).sort().at(-1) ?? null;
	const tags = [...new Set([...JSON.parse(recipient.tags || '[]'), ...JSON.parse(donor.tags || '[]')])];
	const notes = [recipient.notes, donor.notes].filter(Boolean).join('\n\n') || null;
	tripsRepo.updateTrip(recipientId, { startDate, endDate, tags: JSON.stringify(tags), notes,
		posterAttachmentId: recipient.posterAttachmentId ?? donor.posterAttachmentId });
	tripsRepo.deleteTrip(donorId);

	publishTripChanged(recipientId);
	publishTripChanged(donorId);
	if (affectedUserIds.size > 0) publishSharesChanged(affectedUserIds);
	scheduleIndexTrip(recipientId);
	scheduleRemoveTrip(donorId);

	logAudit(ownerId, 'trip_merge', 'trip', recipientId, { donorTripId: donorId });
}
