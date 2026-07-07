import type { Trip } from './repositories/tripsRepo';
import { listInsurancePolicies } from './repositories/profileRepo';
import { listComments } from './tripComments';
import { loadTripFor } from '../../routes/trips/shared';
import { listTripCompanions } from './tripCompanions';
import { loadChecklist } from './tripChecklists';
import { listTemplates } from './packingTemplates';
import { listTripExpenses, summarizeTripExpenses, computeSettlement } from './tripExpenses';
import { listAttendeesForSegments } from './segmentAttendees';
import { listPollsWithVotes } from './tripPolls';
import { listBudgetsWithSpent } from './tripBudgets';
import { listEmergencyContacts, listCards } from './repositories/profileRepo';
import { listAttachmentsForExpenses } from './repositories/expensesRepo';
import { listTripTemplates } from './tripTemplates';
import { tripMapCity } from './tripMap';
import { resolveTileConfig } from './mapTiles';
import { getMapSettings } from './settings';
import { listFareProvidersForUser, listFareWatchesForUser } from './repositories/travelDataRepo';
import { tripWeatherOverview } from './weather';
import {
	listJournalEntriesForTrip,
	listDocumentLinksForTrip,
	listHomeTasksForTrip,
	listMedicationsForTrip,
	listEntryRequirementsForTrip,
	listImportantItemsForTrip
} from './repositories/tripMiscRepo';

function computeTripStats(
	segmentsList: Array<{ startAt: string | null; paymentStatus?: string | null }>,
	expenseSummary: ReturnType<typeof summarizeTripExpenses>,
	checklist: { items: Array<{ packed: boolean }> },
	budgets: ReturnType<typeof listBudgetsWithSpent>
) {
	const total = segmentsList.length;
	const scheduled = segmentsList.filter((s) => s.startAt).length;
	const paid = segmentsList.filter((s) => s.paymentStatus === 'fully_paid').length;
	const packed = checklist.items.filter((i) => i.packed).length;
	const budgeted = budgets.reduce((sum, b) => sum + (b.amount ?? 0), 0);
	return {
		totalSegments: total,
		scheduledSegments: scheduled,
		unscheduledSegments: total - scheduled,
		paidSegments: paid,
		unpaidSegments: total - paid,
		totalExpenses: expenseSummary.baseTotal?.amount ?? 0,
		totalExpensesCurrency: expenseSummary.baseTotal?.currency ?? null,
		budgetCap: budgeted,
		checklistTotal: checklist.items.length,
		checklistPacked: packed
	};
}

export async function buildTripDetail(
	u: { id: number; defaultCurrency?: string | null },
	tripId: number,
	url: URL
) {
	const view = loadTripFor(u.id, tripId);
	const weather = await tripWeatherOverview(view.trip.id, u.id);
	const baseCurrency = ((view.trip as Trip).baseCurrency as string | undefined) ?? 'USD';
	const companions = listTripCompanions(view.trip.id).map((c) =>
		view.editor
			? c
			: {
					...c,
					notes: null,
					dietary: null,
					allergies: null,
					medicalNotes: null,
					needsCarSeat: null,
					needsStroller: null,
					needsCrib: null,
					needsKidsMeal: null,
					childTicketDiscount: null,
					seatPreference: null,
					bedPreference: null,
					accessibilityNeeds: null,
					roomNotes: null
			  }
	);

	// Private trip modules are only loaded for editors. Read-only viewers get the
	// public projection already returned by loadTripFor and should not see
	// expenses, journal entries, medications, document links, polls, etc.
	const checklist = view.editor ? loadChecklist(view.trip.id) : { items: [] };
	const expenseRows = view.editor ? listTripExpenses(view.trip.id) : [];
	const attachmentsByExpense = view.editor ? listAttachmentsForExpenses(expenseRows.map((e) => e.id)) : new Map<number, ReturnType<typeof listAttachmentsForExpenses> extends Map<number, infer V> ? V : never>();
	const expenses = view.editor
		? expenseRows.map((e) => ({
				...e,
				attachments: attachmentsByExpense.get(e.id) ?? []
		  }))
		: [];
	const expenseSummary = summarizeTripExpenses(expenses, companions, baseCurrency);
	const expenseSettlement = computeSettlement(expenses, companions);
	const budgets = view.editor
		? listBudgetsWithSpent(view.trip.id, expenses, u.defaultCurrency ?? 'USD')
		: [];
	const journalEntries = view.editor ? listJournalEntriesForTrip(view.trip.id) : [];
	const documentLinks = view.editor ? listDocumentLinksForTrip(view.trip.id) : [];
	const polls = view.editor ? listPollsWithVotes(view.trip.id) : [];
	const homeTasks = view.editor ? listHomeTasksForTrip(view.trip.id) : [];
	const medications = view.editor ? listMedicationsForTrip(view.trip.id) : [];
	const entryRequirements = view.editor ? listEntryRequirementsForTrip(view.trip.id) : [];
	const importantItems = view.editor ? listImportantItemsForTrip(view.trip.id) : [];
	const stats = computeTripStats(
		view.editor ? view.segments : (view.trip as { segments: Array<{ startAt: string | null; paymentStatus?: string | null }> }).segments,
		expenseSummary,
		checklist,
		budgets
	);
	let attendeesBySegment = new Map<
		number,
		ReturnType<typeof listAttendeesForSegments> extends Map<number, infer V> ? V : never
	>();
	if (view.editor) {
		const segmentIds = view.segments.map((s) => s.id).filter((id): id is number => !!id);
		attendeesBySegment = listAttendeesForSegments(segmentIds);
	}
	if (view.owner) {
		const providers = listFareProvidersForUser(u.id)
			.filter((p) => p.enabled)
			.map((p) => ({
				id: p.id,
				providerKey: p.providerKey,
				label: p.label
			}));
		const segmentTitleMap = new Map(view.segments.map((s) => [s.id, s.title]));
		const watches = listFareWatchesForUser(u.id)
			.filter((w) => w.tripId === view.trip.id)
			.map((w) => ({
				id: w.id,
				status: w.status,
				segmentId: w.segmentId,
				providerKey: providers.find((p) => p.id === w.providerId)?.providerKey ?? null,
				label: providers.find((p) => p.id === w.providerId)?.label ?? null,
				lastCheckedAt: w.lastCheckedAt,
				lastResultJson: w.lastResultJson,
				segmentTitle: w.segmentId != null ? segmentTitleMap.get(w.segmentId) ?? null : null
			}));
		const feedUrl = view.trip.calendarToken
			? `${url.origin}/trips/${view.trip.id}/calendar/feed?token=${encodeURIComponent(view.trip.calendarToken)}`
			: null;
		const publicShareUrl = view.trip.publicToken
			? `${url.origin}/share/${encodeURIComponent(view.trip.publicToken)}`
			: null;
		const userCards = listCards(u.id);
		const allPolicies = listInsurancePolicies(u.id);
		const policies = allPolicies.filter((p) => p.tripId === view.trip.id);
		const availablePolicies = allPolicies.filter((p) => p.tripId !== view.trip.id);
		const comments = listComments(view.trip.id);
		const packingTemplates = listTemplates(u.id);
		const tripTemplates = listTripTemplates(u.id);
		const emergencyContacts = listEmergencyContacts(u.id);
		const mapEnabled = getMapSettings().mapsEnabled;
		const nextCity = mapEnabled ? tripMapCity(view.trip.id) : null;
		const tileConfig = mapEnabled ? resolveTileConfig() : null;
		return {
			...view,
			companions,
			checklist,
			expenses,
			expenseSummary,
			expenseSettlement,
			budgets,
			journalEntries,
			documentLinks,
			polls,
			attendeesBySegment,
			providers,
			watches,
			cards: userCards,
			policies,
			availablePolicies,
			feedUrl,
			publicShareUrl,
			comments,
			packingTemplates,
			tripTemplates,
			emergencyContacts,
			homeTasks,
			medications,
			entryRequirements,
			importantItems,
			stats,
			nextCity,
			tileConfig,
			weather
		};
	}
	const mapEnabled = getMapSettings().mapsEnabled;
	return {
		...view,
		companions,
		checklist,
		expenses,
		expenseSummary,
		expenseSettlement,
		budgets,
		journalEntries,
		documentLinks,
		polls,
		attendeesBySegment,
		comments: view.editor ? listComments(view.trip.id) : [],
		homeTasks,
		medications,
		entryRequirements,
		importantItems,
		stats,
		nextCity: mapEnabled ? tripMapCity(view.trip.id) : null,
		tileConfig: mapEnabled ? resolveTileConfig() : null,
		weather
	};
}
