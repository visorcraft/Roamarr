import type { McpToolModule } from './context';
import { error } from '@sveltejs/kit';
import * as tripsRepo from '../repositories/tripsRepo';
import { requireEditableTrip } from '../ownership';
import { requireViewableTrip } from '../ownership';
import { canEdit } from '../sharing';
import { canViewDetails } from '../sharing';
import { companionViewerProjection } from '../sharing';
import { logAudit } from '../audit';
import { Validator } from '../validation';
import type { CompanionCategory } from '../db/mongrelSchema';
import { reqString } from '../mcpHelpers';
import { toPositiveIdArg } from '../mcpArgParsers';
import { textResult, canReadPrivateDetails, projectMailHold } from './context';

export const tripExtrasTools: McpToolModule = {
	'roamarr_companion_list': {
		scope: 'companions:read',
		handler: async ({ userId, args }) => {
			const { listTripCompanions } = await import('../tripCompanions');
			const tripId = Number(args.tripId);
			const trip = requireViewableTrip(userId, tripId);
			const items = listTripCompanions(tripId);
			return textResult({
				tripId,
				items: canEdit(userId, trip) ? items : items.map(companionViewerProjection)
			});
		}
	},
	'roamarr_companion_create': {
		scope: 'companions:write',
		handler: async ({ userId, args }) => {
			const { insertTripCompanion } = await import('../tripCompanions');
			const tripId = Number(args.tripId);
			requireEditableTrip(userId, tripId);
			const c = insertTripCompanion(userId, tripId, {
				name: args.name as string | undefined,
				category: (args.category === undefined ? 'adult' : args.category) as CompanionCategory,
				dietary: (args.dietary as string) ?? undefined, allergies: (args.allergies as string) ?? undefined,
				medicalNotes: (args.medicalNotes as string) ?? undefined,
				needsCarSeat: args.needsCarSeat === undefined ? false : (args.needsCarSeat as boolean),
				needsStroller: args.needsStroller === undefined ? false : (args.needsStroller as boolean),
				needsCrib: args.needsCrib === undefined ? false : (args.needsCrib as boolean),
				needsKidsMeal: args.needsKidsMeal === undefined ? false : (args.needsKidsMeal as boolean),
				childTicketDiscount: (args.childTicketDiscount as string) ?? undefined, seatPreference: (args.seatPreference as string) ?? undefined,
				bedPreference: (args.bedPreference as string) ?? undefined, accessibilityNeeds: (args.accessibilityNeeds as string) ?? undefined,
				roomNotes: (args.roomNotes as string) ?? undefined, notes: (args.notes as string) ?? undefined
			});
			logAudit(userId, 'mcp_companion_create', 'trip_companion', c.id, { tripId });
			return textResult({ id: c.id });
		}
	},
	'roamarr_companion_update': {
		scope: 'companions:write',
		handler: async ({ userId, args }) => {
			const { getCompanionTripId, patchTripCompanion } = await import('../tripCompanions');
			const id = Number(args.companionId);
			const tripId = getCompanionTripId(id);
			if (tripId == null) return { content: [{ type: 'text' as const, text: 'Companion not found' }], isError: true };
			requireEditableTrip(userId, tripId);
			patchTripCompanion(userId, tripId, id, {
				name: (args.name as string) ?? undefined,
				category: (args.category as CompanionCategory) ?? undefined,
				dietary: (args.dietary as string) ?? undefined, allergies: (args.allergies as string) ?? undefined,
				medicalNotes: (args.medicalNotes as string) ?? undefined,
				needsCarSeat: (args.needsCarSeat ?? undefined) as boolean | undefined, needsStroller: (args.needsStroller ?? undefined) as boolean | undefined,
				needsCrib: (args.needsCrib ?? undefined) as boolean | undefined, needsKidsMeal: (args.needsKidsMeal ?? undefined) as boolean | undefined,
				childTicketDiscount: (args.childTicketDiscount as string) ?? undefined, seatPreference: (args.seatPreference as string) ?? undefined,
				bedPreference: (args.bedPreference as string) ?? undefined, accessibilityNeeds: (args.accessibilityNeeds as string) ?? undefined,
				roomNotes: (args.roomNotes as string) ?? undefined, notes: (args.notes as string) ?? undefined
			});
			logAudit(userId, 'mcp_companion_update', 'trip_companion', id, {});
			return textResult({ ok: true, companionId: id });
		}
	},
	'roamarr_companion_delete': {
		scope: 'companions:write',
		confirm: true,
		handler: async ({ userId, args }) => {
			const { getCompanionTripId, removeTripCompanion } = await import('../tripCompanions');
			const id = Number(args.companionId);
			const tripId = getCompanionTripId(id);
			if (tripId == null) return { content: [{ type: 'text' as const, text: 'Companion not found' }], isError: true };
			removeTripCompanion(userId, tripId, id);
			logAudit(userId, 'mcp_companion_delete', 'trip_companion', id, {});
			return textResult({ ok: true, companionId: id });
		}
	},
	'roamarr_poll_list': {
		scope: 'polls:read',
		handler: async ({ userId, args }) => {
			const tripId = toPositiveIdArg(args.tripId);
			if (tripId === null)
				return { content: [{ type: 'text' as const, text: 'Invalid tripId: expected a positive integer' }], isError: true };
			const { listPollsForTrip } = await import('../repositories/pollsRepo');
			requireViewableTrip(userId, tripId);
			return textResult({ tripId, polls: listPollsForTrip(tripId) });
		}
	},
	'roamarr_poll_create': {
		scope: 'polls:write',
		handler: async ({ userId, args }) => {
			const tripId = toPositiveIdArg(args.tripId);
			if (tripId === null)
				return { content: [{ type: 'text' as const, text: 'Invalid tripId: expected a positive integer' }], isError: true };
			if (typeof args.question !== 'string')
				return { content: [{ type: 'text' as const, text: 'Invalid question: expected a string' }], isError: true };
			if (!Array.isArray(args.options) || !args.options.every((o) => typeof o === 'string'))
				return { content: [{ type: 'text' as const, text: 'Invalid options: expected an array of strings' }], isError: true };
			// Route through createTripPoll so the same validation as the
			// web UI applies (question length, 2-10 options, per-option
			// length, bumpTripUpdatedAt, audit). The previous impl
			// called the low-level repo createPoll directly and let
			// callers mint polls with empty questions or 1 option.
			const { createTripPoll } = await import('../tripPolls');
			const p = createTripPoll(userId, tripId, args.question, args.options);
			logAudit(userId, 'mcp_poll_create', 'trip_poll', p.id, { tripId });
			return textResult({ id: p.id, options: p.options });
		}
	},
	'roamarr_poll_cast_vote': {
		scope: 'polls:write',
		handler: async ({ userId, args }) => {
			const pollId = toPositiveIdArg(args.pollId);
			if (pollId === null)
				return { content: [{ type: 'text' as const, text: 'Invalid pollId: expected a positive integer' }], isError: true };
			const optionId = toPositiveIdArg(args.optionId);
			if (optionId === null)
				return { content: [{ type: 'text' as const, text: 'Invalid optionId: expected a positive integer' }], isError: true };
			let companionIdArg: number | null = null;
			if (args.companionId != null) {
				companionIdArg = toPositiveIdArg(args.companionId);
				if (companionIdArg === null)
					return { content: [{ type: 'text' as const, text: 'Invalid companionId: expected a positive integer' }], isError: true };
			}
			// Route through tripPolls.castVote so requireEditableTrip
			// (owner OR editor) is enforced, matching the web UI.
			// The previous impl called requireOwnedTrip directly, which
			// blocked editors of shared trips from voting.
			const { getPollById } = await import('../repositories/pollsRepo');
			const { castVote } = await import('../tripPolls');
			const { requireCompanionOnTrip } = await import('../ownership');
			const { getOrCreateOwnerCompanion } = await import('../tripCompanions');
			const poll = getPollById(pollId);
			if (!poll) return { content: [{ type: 'text' as const, text: 'Poll not found' }], isError: true };
			// getOrCreateOwnerCompanion writes a self-companion row and bumps
			// updated_at, so authorization must happen before any of that.
			requireEditableTrip(userId, poll.tripId);
			// companionId: positive int = companion id; null/missing =
			// the trip owner / editor. The self-companion is recorded
			// against the calling user (via user_id) so the FK and the
			// (poll_id, companion_id) uniqueness are satisfied per-user.
			let companionId: number;
			if (args.companionId == null) {
				companionId = getOrCreateOwnerCompanion(userId, poll.tripId).id;
			} else {
				companionId = companionIdArg!;
				requireCompanionOnTrip(companionId, poll.tripId);
			}
			castVote(userId, pollId, companionId, optionId);
			logAudit(userId, 'mcp_poll_vote', 'trip_poll', pollId, { optionId, companionId });
			return textResult({ ok: true, pollId });
		}
	},
	'roamarr_poll_delete': {
		scope: 'polls:write',
		confirm: true,
		handler: async ({ userId, args }) => {
			const pollId = toPositiveIdArg(args.pollId);
			if (pollId === null)
				return { content: [{ type: 'text' as const, text: 'Invalid pollId: expected a positive integer' }], isError: true };
			// Route through tripPolls.removeTripPoll so requireEditableTrip
			// + bumpTripUpdatedAt + canonical audit apply, matching the
			// web UI. The previous impl used requireOwnedTrip and skipped
			// bumpTripUpdatedAt.
			const { removeTripPoll } = await import('../tripPolls');
			removeTripPoll(userId, pollId);
			logAudit(userId, 'mcp_poll_delete', 'trip_poll', pollId, {});
			return textResult({ ok: true, pollId });
		}
	},
	'roamarr_journal_list': {
		scope: 'journal:read',
		handler: async ({ userId, args }) => {
			const { listJournalEntriesForTrip } = await import('../repositories/tripMiscRepo');
			const tripId = Number(args.tripId);
			requireViewableTrip(userId, tripId);
			return textResult({ tripId, items: listJournalEntriesForTrip(tripId) });
		}
	},
	'roamarr_journal_create': {
		scope: 'journal:write',
		handler: async ({ userId, args }) => {
			const { createJournalEntry } = await import('../tripJournal');
			const tripId = Number(args.tripId);
			const e = createJournalEntry(userId, tripId, {
				entryDate: String(args.entryDate),
				title: String(args.title ?? ''),
				body: String(args.body ?? '')
			});
			logAudit(userId, 'mcp_journal_create', 'trip_journal_entry', e.id, { tripId });
			return textResult({ id: e.id });
		}
	},
	'roamarr_journal_update': {
		scope: 'journal:write',
		handler: async ({ userId, args }) => {
			const entryId = toPositiveIdArg(args.entryId);
			if (entryId === null)
				return { content: [{ type: 'text' as const, text: 'Invalid entryId: expected a positive integer' }], isError: true };
			// Route through tripJournal.modifyJournalEntry so the entry is
			// re-read, validated, and requireEditableTrip is enforced, matching the web UI.
			const { modifyJournalEntry } = await import('../tripJournal');
			modifyJournalEntry(userId, entryId, { entryDate: args.entryDate as string | undefined, title: args.title as string | undefined, body: args.body as string | undefined });
			logAudit(userId, 'mcp_journal_update', 'trip_journal_entry', entryId, {});
			return textResult({ ok: true, entryId });
		}
	},
	'roamarr_journal_delete': {
		scope: 'journal:write',
		confirm: true,
		handler: async ({ userId, args }) => {
			const entryId = toPositiveIdArg(args.entryId);
			if (entryId === null)
				return { content: [{ type: 'text' as const, text: 'Invalid entryId: expected a positive integer' }], isError: true };
			// Route through tripJournal.removeJournalEntry so the lookup,
			// requireEditableTrip, delete, and canonical audit apply, matching the web UI.
			const { removeJournalEntry } = await import('../tripJournal');
			removeJournalEntry(userId, entryId);
			logAudit(userId, 'mcp_journal_delete', 'trip_journal_entry', entryId, {});
			return textResult({ ok: true, entryId });
		}
	},
	'roamarr_trip_day_notes_list': {
		scope: 'day-notes:read',
		handler: async ({ userId, args }) => {
			const { listDayNotes } = await import('../tripDayNotes');
			const tripId = Number(args.tripId);
			return textResult({ tripId, items: listDayNotes(userId, tripId) });
		}
	},
	'roamarr_trip_day_notes_set': {
		scope: 'day-notes:write',
		handler: async ({ userId, args }) => {
			const { setDayNote } = await import('../tripDayNotes');
			const tripId = Number(args.tripId);
			const note = setDayNote(userId, tripId, args.date, {
				icon: args.icon != null && String(args.icon).trim() !== '' ? String(args.icon) : null,
				body: String(args.body ?? '')
			});
			return textResult(note);
		}
	},
	'roamarr_trip_day_notes_delete': {
		scope: 'day-notes:write',
		confirm: true,
		handler: async ({ userId, args }) => {
			const { deleteDayNote } = await import('../tripDayNotes');
			const tripId = Number(args.tripId);
			deleteDayNote(userId, tripId, args.date);
			return textResult({ ok: true, tripId, date: String(args.date ?? '') });
		}
	},
	'roamarr_home_task_list': {
		scope: 'home-tasks:read',
		handler: async ({ userId, args }) => {
			const { listHomeTasksForTrip } = await import('../repositories/tripMiscRepo');
			const tripId = Number(args.tripId);
			requireViewableTrip(userId, tripId);
			return textResult({ tripId, items: listHomeTasksForTrip(tripId) });
		}
	},
	'roamarr_home_task_create': {
		scope: 'home-tasks:write',
		handler: async ({ userId, args }) => {
			const tripId = toPositiveIdArg(args.tripId);
			if (tripId === null)
				return { content: [{ type: 'text' as const, text: 'Invalid tripId: expected a positive integer' }], isError: true };
			if (args.dueDate != null && typeof args.dueDate !== 'string') {
				throw error(400, 'dueDate must be a valid date (YYYY-MM-DD)');
			}
			const text = reqString(args.text, 'text', 200);
			const v = new Validator();
			const dueDate = v.date(args.dueDate, 'dueDate') ?? null;
			if (!v.ok()) throw error(400, 'dueDate must be a valid date (YYYY-MM-DD)');
			const { addHomeTask } = await import('../tripHomeTasks');
			const task = addHomeTask(
				userId,
				tripId,
				{ text, dueDate },
				'mcp_home_task_create'
			);
			return textResult({ id: task.id });
		}
	},
	'roamarr_home_task_toggle_done': {
		scope: 'home-tasks:write',
		handler: async ({ userId, args }) => {
			const { getHomeTaskById, updateHomeTask } = await import('../repositories/tripMiscRepo');
			const t = getHomeTaskById(Number(args.taskId));
			if (!t) return { content: [{ type: 'text' as const, text: 'Task not found' }], isError: true };
			requireEditableTrip(userId, t.tripId);
			const updated = updateHomeTask(Number(args.taskId), { done: !t.done });
			logAudit(userId, 'mcp_home_task_toggle', 'trip_home_task', Number(args.taskId), { done: updated?.done });
			return textResult({ ok: true, taskId: Number(args.taskId), done: updated?.done });
		}
	},
	'roamarr_home_task_delete': {
		scope: 'home-tasks:write',
		confirm: true,
		handler: async ({ userId, args }) => {
			const { getHomeTaskById, deleteHomeTask } = await import('../repositories/tripMiscRepo');
			const t = getHomeTaskById(Number(args.taskId));
			if (!t) return { content: [{ type: 'text' as const, text: 'Task not found' }], isError: true };
			requireEditableTrip(userId, t.tripId);
			deleteHomeTask(Number(args.taskId));
			logAudit(userId, 'mcp_home_task_delete', 'trip_home_task', Number(args.taskId), {});
			return textResult({ ok: true, taskId: Number(args.taskId) });
		}
	},
	'roamarr_mail_hold_list': {
		scope: 'mail-holds:read',
		handler: async ({ userId, scopes, args }) => {
			const { listMailHolds } = await import('../tripMailHolds');
			const tripId = Number(args.tripId);
			const trip = requireEditableTrip(userId, tripId);
			const includePrivate = canReadPrivateDetails(scopes) && canViewDetails(userId, trip);
			return textResult({ tripId, items: listMailHolds(tripId).map((hold) => projectMailHold(hold, includePrivate)) });
		}
	},
	'roamarr_mail_hold_create': {
		scope: 'mail-holds:write',
		handler: async ({ userId, scopes, args }) => {
			const { addMailHold } = await import('../tripMailHolds');
			const tripId = Number(args.tripId);
			const trip = requireEditableTrip(userId, tripId);
			const includePrivate = canReadPrivateDetails(scopes) && canViewDetails(userId, trip);
			const created = addMailHold(userId, tripId, {
				carrier: args.carrier as string | undefined,
				startDate: String(args.startDate ?? ''),
				endDate: String(args.endDate ?? ''),
				confirmationNumber: (args.confirmationNumber as string) ?? null,
				addressLabel: (args.addressLabel as string) ?? null,
				notes: (args.notes as string) ?? null,
				status: args.status == null ? undefined : String(args.status)
			});
			return textResult({ id: created.hold.id, warning: created.warning, hold: projectMailHold(created.hold, includePrivate) });
		}
	},
	'roamarr_mail_hold_update': {
		scope: 'mail-holds:write',
		handler: async ({ userId, scopes, args }) => {
			const holdId = toPositiveIdArg(args.holdId);
			if (holdId === null) return { content: [{ type: 'text' as const, text: 'holdId must be a positive integer' }], isError: true };
			const { getMailHoldById } = await import('../repositories/tripMiscRepo');
			const { updateMailHold } = await import('../tripMailHolds');
			const existing = getMailHoldById(holdId);
			if (!existing) return { content: [{ type: 'text' as const, text: 'Mail hold not found' }], isError: true };
			const trip = requireEditableTrip(userId, existing.tripId);
			const includePrivate = canReadPrivateDetails(scopes) && canViewDetails(userId, trip);
			const patch: Record<string, string | null> = {};
			if (args.carrier !== undefined) patch.carrier = String(args.carrier ?? '');
			if (args.startDate !== undefined) patch.startDate = String(args.startDate ?? '');
			if (args.endDate !== undefined) patch.endDate = String(args.endDate ?? '');
			if (args.confirmationNumber !== undefined) patch.confirmationNumber = args.confirmationNumber == null ? null : String(args.confirmationNumber);
			if (args.addressLabel !== undefined) patch.addressLabel = args.addressLabel == null ? null : String(args.addressLabel);
			if (args.notes !== undefined) patch.notes = args.notes == null ? null : String(args.notes);
			if (args.status !== undefined) patch.status = String(args.status ?? '');
			if (Object.keys(patch).length === 0) {
				const { uspsHoldWarning } = await import('../mailHoldCoverage');
				return textResult({
					id: existing.id,
					warning: uspsHoldWarning(existing.carrier, existing.startDate, existing.endDate),
					hold: projectMailHold(existing, includePrivate)
				});
			}
			const updated = updateMailHold(userId, existing.tripId, existing.id, patch);
			return textResult({ id: updated.hold.id, warning: updated.warning, hold: projectMailHold(updated.hold, includePrivate) });
		}
	},
	'roamarr_mail_hold_delete': {
		scope: 'mail-holds:write',
		confirm: true,
		handler: async ({ userId, args }) => {
			const holdId = toPositiveIdArg(args.holdId);
			if (holdId === null) return { content: [{ type: 'text' as const, text: 'holdId must be a positive integer' }], isError: true };
			const { getMailHoldById } = await import('../repositories/tripMiscRepo');
			const { deleteMailHold } = await import('../tripMailHolds');
			const existing = getMailHoldById(holdId);
			if (!existing) return { content: [{ type: 'text' as const, text: 'Mail hold not found' }], isError: true };
			deleteMailHold(userId, existing.tripId, existing.id);
			return textResult({ ok: true, holdId: existing.id });
		}
	},
	'roamarr_mail_hold_coverage': {
		scope: 'mail-holds:read',
		handler: async ({ userId, args }) => {
			const { listMailHolds, mailHoldCoverageForTrip } = await import('../tripMailHolds');
			const tripId = Number(args.tripId);
			const trip = requireEditableTrip(userId, tripId);
			return textResult(mailHoldCoverageForTrip(trip.startDate, trip.endDate, listMailHolds(tripId)));
		}
	},
	'roamarr_medication_list': {
		scope: 'medications:read',
		handler: async ({ userId, args }) => {
			const { listMedicationsForTrip } = await import('../repositories/tripMiscRepo');
			const tripId = Number(args.tripId);
			requireEditableTrip(userId, tripId);
			return textResult({ tripId, items: listMedicationsForTrip(tripId) });
		}
	},
	'roamarr_medication_create': {
		scope: 'medications:write',
		handler: async ({ userId, args }) => {
			const { addMedication } = await import('../tripMedications');
			const tripId = Number(args.tripId);
			const m = addMedication(userId, tripId, {
				name: String(args.name ?? ''),
				companionId: args.companionId == null ? null : Number(args.companionId), dosage: (args.dosage as string) ?? null,
				schedule: (args.schedule as string) ?? null, startsAt: (args.startsAt as string) ?? null,
				endsAt: (args.endsAt as string) ?? null, notes: (args.notes as string) ?? null
			});
			logAudit(userId, 'mcp_medication_create', 'trip_medication', m.id, { tripId });
			return textResult({ id: m.id });
		}
	},
	'roamarr_medication_delete': {
		scope: 'medications:write',
		confirm: true,
		handler: async ({ userId, args }) => {
			const { getMedicationById, deleteMedication } = await import('../repositories/tripMiscRepo');
			const m = getMedicationById(Number(args.medicationId));
			if (!m) return { content: [{ type: 'text' as const, text: 'Medication not found' }], isError: true };
			requireEditableTrip(userId, m.tripId);
			deleteMedication(Number(args.medicationId));
			logAudit(userId, 'mcp_medication_delete', 'trip_medication', Number(args.medicationId), {});
			return textResult({ ok: true, medicationId: Number(args.medicationId) });
		}
	},
	'roamarr_important_item_list': {
		scope: 'items:read',
		handler: async ({ userId, args }) => {
			const { listImportantItemsForTrip } = await import('../repositories/tripMiscRepo');
			const tripId = Number(args.tripId);
			requireEditableTrip(userId, tripId);
			return textResult({ tripId, items: listImportantItemsForTrip(tripId) });
		}
	},
	'roamarr_important_item_create': {
		scope: 'items:write',
		handler: async ({ userId, args }) => {
			const { addImportantItem } = await import('../tripImportantItems');
			const tripId = Number(args.tripId);
			const i = addImportantItem(userId, tripId, {
				name: String(args.name ?? ''), companionId: args.companionId == null ? null : Number(args.companionId),
				serialNumber: (args.serialNumber as string) ?? null, trackerId: (args.trackerId as string) ?? null, notes: (args.notes as string) ?? null
			});
			logAudit(userId, 'mcp_important_item_create', 'trip_important_item', i.id, { tripId });
			return textResult({ id: i.id });
		}
	},
	'roamarr_important_item_delete': {
		scope: 'items:write',
		confirm: true,
		handler: async ({ userId, args }) => {
			const { getImportantItemById, deleteImportantItem } = await import('../repositories/tripMiscRepo');
			const i = getImportantItemById(Number(args.itemId));
			if (!i) return { content: [{ type: 'text' as const, text: 'Item not found' }], isError: true };
			requireEditableTrip(userId, i.tripId);
			deleteImportantItem(Number(args.itemId));
			logAudit(userId, 'mcp_important_item_delete', 'trip_important_item', Number(args.itemId), {});
			return textResult({ ok: true, itemId: Number(args.itemId) });
		}
	},
	'roamarr_entry_requirement_list': {
		scope: 'requirements:read',
		handler: async ({ userId, args }) => {
			const { listEntryRequirementsForTrip } = await import('../repositories/tripMiscRepo');
			const tripId = Number(args.tripId);
			requireEditableTrip(userId, tripId);
			return textResult({ tripId, items: listEntryRequirementsForTrip(tripId) });
		}
	},
	'roamarr_entry_requirement_create': {
		scope: 'requirements:write',
		handler: async ({ userId, args }) => {
			const { addEntryRequirement } = await import('../tripEntryRequirements');
			const tripId = Number(args.tripId);
			const r = addEntryRequirement(userId, tripId, {
				country: String(args.country ?? ''), requirementType: String(args.requirementType ?? ''),
				status: (args.status as string) ?? 'needed', dueDate: (args.dueDate as string) ?? null, notes: (args.notes as string) ?? null
			});
			logAudit(userId, 'mcp_entry_requirement_create', 'trip_entry_requirement', r.id, { tripId });
			return textResult({ id: r.id });
		}
	},
	'roamarr_entry_requirement_update': {
		scope: 'requirements:write',
		handler: async ({ userId, args }) => {
			const { getEntryRequirementById } = await import('../repositories/tripMiscRepo');
			const id = Number(args.requirementId);
			if (!Number.isInteger(id) || id <= 0) {
				return { content: [{ type: 'text' as const, text: 'requirementId must be a positive integer' }], isError: true };
			}
			const r = getEntryRequirementById(id);
			if (!r) return { content: [{ type: 'text' as const, text: 'Requirement not found' }], isError: true };
			const { patchEntryRequirement } = await import('../tripEntryRequirements');
			patchEntryRequirement(userId, r.tripId, id, {
				status: args.status as string | undefined,
				dueDate: args.dueDate as string | null | undefined,
				notes: args.notes as string | null | undefined
			});
			logAudit(userId, 'mcp_entry_requirement_update', 'trip_entry_requirement', id, {});
			return textResult({ ok: true, requirementId: id });
		}
	},
	'roamarr_entry_requirement_delete': {
		scope: 'requirements:write',
		confirm: true,
		handler: async ({ userId, args }) => {
			const { getEntryRequirementById, deleteEntryRequirement } = await import('../repositories/tripMiscRepo');
			const r = getEntryRequirementById(Number(args.requirementId));
			if (!r) return { content: [{ type: 'text' as const, text: 'Requirement not found' }], isError: true };
			requireEditableTrip(userId, r.tripId);
			deleteEntryRequirement(Number(args.requirementId));
			logAudit(userId, 'mcp_entry_requirement_delete', 'trip_entry_requirement', Number(args.requirementId), {});
			return textResult({ ok: true, requirementId: Number(args.requirementId) });
		}
	},
	'roamarr_comment_list': {
		scope: 'comments:read',
		handler: async ({ userId, args }) => {
			const { listCommentsForTrip } = await import('../repositories/tripsRepo');
			const tripId = Number(args.tripId);
			requireViewableTrip(userId, tripId);
			return textResult({ tripId, items: listCommentsForTrip(tripId) });
		}
	},
	'roamarr_comment_create': {
		scope: 'comments:write',
		handler: async ({ userId, args }) => {
			const { createComment } = await import('../repositories/tripsRepo');
			const tripId = Number(args.tripId);
			requireEditableTrip(userId, tripId);
			const c = createComment(userId, tripId, String(args.body ?? ''));
			logAudit(userId, 'mcp_comment_create', 'trip_comment', c.id, { tripId });
			return textResult({ id: c.id });
		}
	},
	'roamarr_comment_delete': {
		scope: 'comments:write',
		confirm: true,
		handler: async ({ userId, args }) => {
			const { deleteComment } = await import('../repositories/tripsRepo');
			const id = Number(args.commentId);
			const n = deleteComment(userId, id);
			// deleteComment enforces user_id match; 0 means the comment
			// doesn't exist or wasn't authored by this user. Treat as
			// not-found so a non-author can't probe for comment ids.
			if (n === 0) return { content: [{ type: 'text' as const, text: 'Comment not found' }], isError: true };
			logAudit(userId, 'mcp_comment_delete', 'trip_comment', id, {});
			return textResult({ ok: true, commentId: id });
		}
	},
};
