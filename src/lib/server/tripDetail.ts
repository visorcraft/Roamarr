import { and, eq } from 'drizzle-orm';
import { db } from './db';
import { cards, fareProviders, fareWatches, segments, trips } from './db/schema';
import { listPoliciesForUser } from './insurance';
import { listComments } from './tripComments';
import { loadTripFor } from '../../routes/trips/shared';
import { listTripCompanions } from './tripCompanions';
import { loadChecklist } from './tripChecklists';
import { listTemplates } from './packingTemplates';
import { listTripExpenses, summarizeTripExpenses, computeSettlement } from './tripExpenses';
import { listAttendeesForSegments } from './segmentAttendees';
import { listJournalEntries } from './tripJournal';
import { listDocumentLinks } from './tripDocumentLinks';
import { listPollsWithVotes } from './tripPolls';
import { listBudgetsWithSpent } from './tripBudgets';
import { listEmergencyContacts } from './emergencyContacts';
import { listAttachments } from './tripExpenseAttachments';
import { listTripTemplates } from './tripTemplates';
import { listHomeTasks } from './tripHomeTasks';
import { listMedications } from './tripMedications';
import { listEntryRequirements } from './tripEntryRequirements';
import { listImportantItems } from './tripImportantItems';
import { selectNextSegmentCity } from './tripMap';
import { resolveTileConfig } from './mapTiles';
import { getMapSettings } from './settings';

function computeTripStats(
	segmentsList: Array<{ startAt: string | null; paymentStatus?: string | null }>,
	expenseSummary: ReturnType<typeof summarizeTripExpenses>,
	checklist: ReturnType<typeof loadChecklist>,
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

export function buildTripDetail(u: { id: number; defaultCurrency?: string | null }, tripId: number, url: URL) {
	const view = loadTripFor(u.id, tripId);
	const baseCurrency = ((view.trip as typeof trips.$inferSelect).baseCurrency as string | undefined) ?? 'USD';
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
	const checklist = loadChecklist(view.trip.id);
	const expenses = listTripExpenses(view.trip.id).map((e) => ({
		...e,
		attachments: listAttachments(e.id)
	}));
	const expenseSummary = summarizeTripExpenses(expenses, companions, baseCurrency);
	const expenseSettlement = computeSettlement(expenses, companions);
	const budgets = listBudgetsWithSpent(view.trip.id, expenses, u.defaultCurrency ?? 'USD');
	const journalEntries = listJournalEntries(view.trip.id);
	const documentLinks = listDocumentLinks(view.trip.id);
	const polls = listPollsWithVotes(view.trip.id);
	const homeTasks = listHomeTasks(view.trip.id);
	const medications = listMedications(view.trip.id);
	const entryRequirements = listEntryRequirements(view.trip.id);
	const importantItems = listImportantItems(view.trip.id);
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
		const providers = db
			.select({
				id: fareProviders.id,
				providerKey: fareProviders.providerKey,
				label: fareProviders.label
			})
			.from(fareProviders)
			.where(and(eq(fareProviders.userId, u.id), eq(fareProviders.enabled, true)))
			.all();
		const watches = db
			.select({
				id: fareWatches.id,
				status: fareWatches.status,
				segmentId: fareWatches.segmentId,
				segmentTitle: segments.title,
				providerKey: fareProviders.providerKey,
				label: fareProviders.label,
				lastCheckedAt: fareWatches.lastCheckedAt,
				lastResultJson: fareWatches.lastResultJson
			})
			.from(fareWatches)
			.innerJoin(fareProviders, eq(fareWatches.providerId, fareProviders.id))
			.leftJoin(segments, eq(fareWatches.segmentId, segments.id))
			.where(eq(fareWatches.tripId, view.trip.id))
			.all();
		const feedUrl = view.trip.calendarToken
			? `${url.origin}/trips/${view.trip.id}/calendar/feed?token=${encodeURIComponent(view.trip.calendarToken)}`
			: null;
		const publicShareUrl = view.trip.publicToken
			? `${url.origin}/share/${encodeURIComponent(view.trip.publicToken)}`
			: null;
		const userCards = db
			.select({ id: cards.id, nickname: cards.nickname, network: cards.network, last4: cards.last4 })
			.from(cards)
			.where(eq(cards.userId, u.id))
			.all();
		const allPolicies = listPoliciesForUser(u.id);
		const policies = allPolicies.filter((p) => p.tripId === view.trip.id);
		const availablePolicies = allPolicies.filter((p) => p.tripId !== view.trip.id);
		const comments = listComments(view.trip.id);
		const packingTemplates = listTemplates(u.id);
		const tripTemplates = listTripTemplates(u.id);
		const emergencyContacts = listEmergencyContacts(u.id);
		const mapEnabled = getMapSettings().mapsEnabled;
		const nextCity = mapEnabled ? selectNextSegmentCity(view.trip.id) : null;
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
			tileConfig
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
		comments: listComments(view.trip.id),
		homeTasks,
		medications,
		entryRequirements,
		importantItems,
		stats,
		nextCity: mapEnabled ? selectNextSegmentCity(view.trip.id) : null,
		tileConfig: mapEnabled ? resolveTileConfig() : null
	};
}
