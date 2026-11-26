import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
	ListPromptsRequestSchema,
	GetPromptRequestSchema,
	ListResourcesRequestSchema,
	ReadResourceRequestSchema,
	ListResourceTemplatesRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import type { Scope } from './oauth';
import * as tripsRepo from './repositories/tripsRepo';
import { listVisited } from './visitedPlaces';
import { viewChecklist } from './tripChecklists';
import { listBudgetsWithSpent } from './tripBudgets';
import { requireOwnedTrip, requireViewableTrip } from './ownership';
import { canEdit, companionViewerProjection } from './sharing';
import { projectCard, projectLoyalty, projectInsurance, projectTravelDocument } from './mcpHelpers';

function hasScope(scopes: Scope[], required: Scope): boolean {
	return scopes.includes(required);
}

// ---------------------------------------------------------------------------
// Prompt registry
//
// Each prompt is self-describing: the metadata (name, description, arguments,
// required scope, whether it needs a trip context) is declared once and the
// handler reads the same metadata.  This keeps prompts/list and prompts/get
// in sync and lets MCP clients render the right UI for arguments.
// ---------------------------------------------------------------------------

type PromptScope = Scope;

interface PromptArgument {
	name: string;
	description?: string;
	required?: boolean;
}

interface PromptEntry {
	name: string;
	description: string;
	arguments?: PromptArgument[];
	scope: PromptScope;
	/** When true, the prompt resolves a trip view (and enforces trips:read IDOR) before building output. */
	requiresTrip?: boolean;
	/** When true the prompt may run without a tripId (e.g. listings across all trips). */
	requiresTripArgument?: boolean;
	build(ctx: PromptBuildContext): Promise<PromptOutput> | PromptOutput;
}

interface PromptBuildContext {
	userId: number;
	tripId: number;
	scopes: Scope[];
	trip: Record<string, unknown> | null;
}

interface PromptOutput {
	description: string;
	text: string;
}

const TRIP_ID_ARG: PromptArgument = {
	name: 'tripId',
	description: 'Numeric trip ID',
	required: true
};

function makePromptMessage(description: string, text: string) {
	return {
		description,
		messages: [{ role: 'user' as const, content: { type: 'text' as const, text } }]
	};
}

function errorPrompt(message: string) {
	return makePromptMessage('Error', message);
}

function textOut(description: string, body: unknown): PromptOutput {
	return { description, text: JSON.stringify(body, null, 2) };
}

export const MCP_PROMPTS: readonly PromptEntry[] = [
	{
		name: 'trip-summary',
		description: 'Brief summary of all upcoming trips.',
		scope: 'trips:read',
		build({ userId }) {
			// Include shared trips so the caller sees everything they have
			// access to (matches roamarr_trip_list and the web UI).
			const all = tripsRepo
				.listViewableTripIdsForUser(userId)
				.map((id) => tripsRepo.getTripById(id))
				.filter((t): t is NonNullable<typeof t> => t !== null);
			const today = new Date().toISOString().slice(0, 10);
			const upcoming = all
				.filter((t) => t.startDate && t.startDate >= today && !t.archived)
				.slice(0, 5)
				.map((t) => ({
					name: t.name,
					destination: t.destination,
					startDate: t.startDate,
					endDate: t.endDate
				}));
			return textOut('Trip summary', upcoming);
		}
	},
	{
		name: 'places-visited',
		description: 'Countries and U.S. states you have visited.',
		scope: 'places:read',
		build({ userId }) {
			return textOut('Places visited', listVisited(userId));
		}
	},
	{
		name: 'documents-checklist',
		description: 'Travel documents and expiry summaries.',
		scope: 'profile:read',
		async build({ userId }) {
			const { listTravelDocuments } = await import('./repositories/profileRepo');
			const docs = listTravelDocuments(userId).map((d) => ({ type: d.type, expiresOn: d.expiresOn }));
			return textOut('Documents checklist', docs);
		}
	},
	{
		name: 'trip-details',
		description: 'Detailed overview of a specific trip including segments.',
		arguments: [TRIP_ID_ARG],
		scope: 'trips:read',
		requiresTrip: true,
		requiresTripArgument: true,
		build({ trip }) {
			return textOut('Trip details', { trip });
		}
	},
	{
		name: 'itinerary',
		description: 'Day-by-day itinerary for a trip.',
		arguments: [TRIP_ID_ARG],
		scope: 'trips:read',
		requiresTrip: true,
		requiresTripArgument: true,
		build({ trip }) {
			return textOut('Itinerary', trip);
		}
	},
	{
		name: 'flight-info',
		description: 'Flight segments for a trip.',
		arguments: [TRIP_ID_ARG],
		scope: 'trips:read',
		requiresTrip: true,
		requiresTripArgument: true,
		build({ trip }) {
			const segments = segmentList(trip, 'flight');
			return textOut('Flight info', segments);
		}
	},
	{
		name: 'hotel-info',
		description: 'Hotel/lodging segments for a trip.',
		arguments: [TRIP_ID_ARG],
		scope: 'trips:read',
		requiresTrip: true,
		requiresTripArgument: true,
		build({ trip }) {
			const segments = segmentList(trip, 'hotel');
			return textOut('Hotel info', segments);
		}
	},
	{
		name: 'packing-check',
		description: 'Packing checklist status for a trip.',
		arguments: [TRIP_ID_ARG],
		scope: 'packing:read',
		requiresTrip: true,
		requiresTripArgument: true,
		build({ tripId }) {
			const items = viewChecklist(tripId).items.map((i) => ({ text: i.text, packed: i.packed }));
			return textOut('Packing check', items);
		}
	},
	{
		name: 'budget-overview',
		description: 'Budget categories and spending for a trip.',
		arguments: [TRIP_ID_ARG],
		scope: 'budgets:read',
		requiresTrip: true,
		requiresTripArgument: true,
		async build({ tripId }) {
			const { listExpensesForTrip } = await import('./repositories/expensesRepo');
			const budgets = listBudgetsWithSpent(tripId, listExpensesForTrip(tripId));
			return textOut('Budget overview', budgets);
		}
	},
	{
		name: 'weather-overview',
		description: 'Weather forecast for a trip destination.',
		arguments: [TRIP_ID_ARG],
		scope: 'trips:read',
		requiresTrip: true,
		requiresTripArgument: true,
		async build({ userId, tripId }) {
			const { tripWeatherOverview } = await import('./weather');
			const weather = await tripWeatherOverview(tripId, userId);
			return textOut('Weather overview', weather);
		}
	},
	// ---- Round 3 prompts ----
	{
		name: 'upcoming-checklist',
		description: 'Pre-trip prep summary: outstanding docs, packing %, home tasks.',
		arguments: [TRIP_ID_ARG],
		scope: 'trips:read',
		requiresTrip: true,
		requiresTripArgument: true,
		async build({ userId, tripId }) {
			// Real data: aggregate travel-doc status, packing %, home tasks.
			const { listTravelDocuments } = await import('./repositories/profileRepo');
			const { viewChecklist } = await import('./tripChecklists');
			const { listHomeTasksForTrip } = await import('./repositories/tripMiscRepo');
			const { getUserById } = await import('./repositories/usersRepo');
			const user = getUserById(userId);
			const leadDays = Number(user?.document_expiry_lead_days ?? 90);
			const today = new Date().toISOString().slice(0, 10);
			const cutoff = new Date(Date.now() + leadDays * 86400_000).toISOString().slice(0, 10);
			const docs = listTravelDocuments(userId);
			const expiringSoon = docs.filter((d) => d.expiresOn && d.expiresOn >= today && d.expiresOn <= cutoff);
			const expired = docs.filter((d) => d.expiresOn && d.expiresOn < today);
			const checklist = viewChecklist(tripId);
			const total = checklist.items.length;
			const packed = checklist.items.filter((i) => i.packed).length;
			const packingPct = total > 0 ? Math.round((packed / total) * 100) : 0;
			const tasks = listHomeTasksForTrip(tripId);
			const openTasks = tasks.filter((t) => !t.done);
			return textOut('Upcoming checklist', {
				tripId,
				documents: {
					expiringSoon: expiringSoon.map((d) => ({ type: d.type, expiresOn: d.expiresOn })),
					expired: expired.map((d) => ({ type: d.type, expiresOn: d.expiresOn })),
					windowDays: leadDays
				},
				packing: { total, packed, percent: packingPct },
				homeTasks: { open: openTasks.length, total: tasks.length, items: openTasks.map((t) => ({ title: t.text, dueDate: t.dueDate })) }
			});
		}
	},
	{
		name: 'expense-summary',
		description: 'Per-trip expense breakdown by category (counts, totals in cents).',
		arguments: [TRIP_ID_ARG],
		scope: 'expenses:read',
		requiresTrip: true,
		requiresTripArgument: true,
		async build({ tripId }) {
			// Real data: aggregate listExpensesForTrip by category. Totals
			// are per-currency because adding cents across currencies
			// would mix them (5000 USD + 5000 JPY != 10000 of anything).
			const { listExpensesForTrip } = await import('./repositories/expensesRepo');
			const { listBudgetsWithSpent } = await import('./tripBudgets');
			const expenses = listExpensesForTrip(tripId);
			const budgets = listBudgetsWithSpent(tripId, expenses);
			const byCategory: Record<string, { count: number; totalCents: number; currency: string }> = {};
			for (const e of expenses) {
				const cat = e.category ?? 'other';
				const key = `${cat}:${e.currency}`;
				const cur = byCategory[key] ?? { count: 0, totalCents: 0, currency: e.currency };
				cur.count++;
				cur.totalCents += e.amount;
				byCategory[key] = cur;
			}
			// Per-currency totals — never sum across currencies.
			const byCurrency: Record<string, { count: number; totalCents: number }> = {};
			for (const e of expenses) {
				const cur = byCurrency[e.currency] ?? { count: 0, totalCents: 0 };
				cur.count++;
				cur.totalCents += e.amount;
				byCurrency[e.currency] = cur;
			}
			return textOut('Expense summary', {
				tripId,
				count: expenses.length,
				byCategory: Object.fromEntries(
					Object.entries(byCategory).map(([k, v]) => [k, { category: k.split(':')[0], count: v.count, totalCents: v.totalCents, currency: v.currency }])
				),
				byCurrency,
				budgets: budgets.map((b) => ({ category: b.category, amountCents: b.amount, spentCents: b.spent, currency: b.currency }))
			});
		}
	},
	{
		name: 'wallet-overview',
		description: 'Cards + loyalty + insurance at a glance. Member/policy numbers are redacted. Requires cards:read AND loyalty:read AND insurance:read; the prompt returns the empty subset for any missing scope.',
		scope: 'cards:read',
		async build({ userId, scopes }) {
			const { listCards, listLoyaltyPrograms, listInsurancePolicies } = await import('./repositories/profileRepo');
			// Require all three scopes. If a token carries only one,
			// the other counts return 0 and the prompt says so, instead
			// of silently returning data the token isn't authorized to see.
			const has = (s: Scope) => scopes.includes(s);
			return textOut('Wallet overview', {
				cards: has('cards:read') ? listCards(userId).length : 0,
				loyalty: has('loyalty:read') ? listLoyaltyPrograms(userId).length : 0,
				insurance: has('insurance:read') ? listInsurancePolicies(userId).length : 0,
				note:
					has('cards:read') && has('loyalty:read') && has('insurance:read')
						? undefined
						: 'One or more wallet scopes missing; counts shown only for granted scopes.'
			});
		}
	},
	{
		name: 'doc-renewals',
		description: 'Passport/visa/license expiring within 90 days (numbers redacted).',
		scope: 'travel-docs:read',
		async build({ userId }) {
			const { listTravelDocuments } = await import('./repositories/profileRepo');
			const today = new Date().toISOString().slice(0, 10);
			const cutoff = new Date(Date.now() + 90 * 86400_000).toISOString().slice(0, 10);
			const expiring = listTravelDocuments(userId).filter((d) => d.expiresOn && d.expiresOn >= today && d.expiresOn <= cutoff);
			return textOut('Doc renewals', expiring.map(projectTravelDocument));
		}
	},
	{
		name: 'poll-status',
		description: 'Polls with no votes yet across your active trips (waiting on input).',
		scope: 'polls:read',
		async build({ userId }) {
			// Include shared trips so editors/viewers see polls on trips that
			// have been shared with them (matches roamarr_trip_list).
			const trips = tripsRepo
				.listViewableTripIdsForUser(userId)
				.map((id) => tripsRepo.getTripById(id))
				.filter((t): t is NonNullable<typeof t> => t !== null);
			const { listPollsForTrip } = await import('./repositories/pollsRepo');
			// Outstanding = no votes cast yet. The schema has no
			// closedAt, so "unanswered" is the closest signal.
			const all = trips.flatMap((t) =>
				listPollsForTrip(t.id)
					.filter((p) => p.options.every((o) => o.voteCount === 0))
					.map((p) => ({ ...p, tripId: t.id, tripName: t.name }))
			);
			return textOut('Poll status', all);
		}
	},
	{
		name: 'trip-budget-status',
		description: 'Spent vs budget per category for a trip.',
		arguments: [TRIP_ID_ARG],
		scope: 'budgets:read',
		requiresTrip: true,
		requiresTripArgument: true,
		async build({ tripId, userId }) {
			const { listExpensesForTrip } = await import('./repositories/expensesRepo');
			const budgets = listBudgetsWithSpent(tripId, listExpensesForTrip(tripId));
			return textOut('Trip budget status', { tripId, budgets });
		}
	}
];

function segmentList(trip: Record<string, unknown> | null, type: string): unknown[] {
	if (!trip) return [];
	const segments = Array.isArray(trip.segments) ? (trip.segments as unknown[]) : [];
	return segments.filter((s) => {
		if (!s || typeof s !== 'object') return false;
		return (s as { type?: unknown }).type === type;
	});
}

const TRIP_RESOURCE_TEMPLATE = 'trip://{tripId}';
const TRIP_RESOURCE_URI_RE = /^trip:\/\/(\d+)$/;
const COMPANION_URI_RE = /^companion:\/\/(\d+)$/;
const CARD_URI_RE = /^card:\/\/(\d+)$/;
const LOYALTY_URI_RE = /^loyalty:\/\/(\d+)$/;
const INSURANCE_URI_RE = /^insurance:\/\/(\d+)$/;
const DOC_URI_RE = /^document:\/\/(\d+)$/;
const POLL_URI_RE = /^poll:\/\/(\d+)$/;
const JOURNAL_URI_RE = /^journal:\/\/trip-(\d+)\/(\d{4}-\d{2}-\d{2})$/;
const FARE_WATCH_URI_RE = /^fare-watch:\/\/(\d+)$/;

export const MCP_RESOURCE_TEMPLATES: readonly {
	scope: Scope;
	name: string;
	title: string;
	uriTemplate: string;
	description: string;
	mimeType: 'application/json';
}[] = [
	{
		scope: 'trips:read',
		name: 'trip',
		title: 'Trip',
		uriTemplate: TRIP_RESOURCE_TEMPLATE,
		description: 'A single trip with its itinerary and metadata.',
		mimeType: 'application/json'
	},
	{
		scope: 'companions:read',
		name: 'companion',
		title: 'Companion',
		uriTemplate: 'companion://{companionId}',
		description: 'A trip companion by id.',
		mimeType: 'application/json'
	},
	{
		scope: 'cards:read',
		name: 'card',
		title: 'Card',
		uriTemplate: 'card://{cardId}',
		description: 'A payment card by id (network + last4 only).',
		mimeType: 'application/json'
	},
	{
		scope: 'loyalty:read',
		name: 'loyalty',
		title: 'Loyalty program',
		uriTemplate: 'loyalty://{loyaltyId}',
		description: 'A loyalty program by id (member number redacted).',
		mimeType: 'application/json'
	},
	{
		scope: 'insurance:read',
		name: 'insurance',
		title: 'Insurance policy',
		uriTemplate: 'insurance://{insuranceId}',
		description: 'An insurance policy by id (policy number redacted).',
		mimeType: 'application/json'
	},
	{
		scope: 'travel-docs:read',
		name: 'document',
		title: 'Travel document',
		uriTemplate: 'document://{documentId}',
		description: 'A travel document by id (number redacted).',
		mimeType: 'application/json'
	},
	{
		scope: 'polls:read',
		name: 'poll',
		title: 'Poll',
		uriTemplate: 'poll://{pollId}',
		description: 'A trip poll with vote counts.',
		mimeType: 'application/json'
	},
	{
		scope: 'journal:read',
		name: 'journal',
		title: 'Journal entry',
		uriTemplate: 'journal://trip-{tripId}/{isoDate}',
		description: 'A journal entry for a specific date on a trip.',
		mimeType: 'application/json'
	},
	{
		scope: 'fares:read',
		name: 'fare-watch',
		title: 'Fare watch',
		uriTemplate: 'fare-watch://{fareWatchId}',
		description: 'A fare watch with latest price snapshot.',
		mimeType: 'application/json'
	}
];

export function registerMcpPromptsAndResources(
	server: Server,
	ctx: {
		userId: number;
		scopes: Scope[];
		safeTripProjection: (tripId: number, userId: number, scopes: Scope[]) => Record<string, unknown>;
	}
): void {
	const { userId, scopes, safeTripProjection } = ctx;

	server.setRequestHandler(ListPromptsRequestSchema, async () => ({
		prompts: MCP_PROMPTS.map((p) => ({
			name: p.name,
			description: p.description,
			arguments: p.arguments
		}))
	}));

	server.setRequestHandler(GetPromptRequestSchema, async (request) => {
		const promptName = request.params.name;
		const entry = MCP_PROMPTS.find((p) => p.name === promptName);
		if (!entry) return errorPrompt(`Unknown prompt: ${promptName}`);
		if (!hasScope(scopes, entry.scope)) {
			return errorPrompt(`Missing required scope: ${entry.scope}`);
		}

		const args = (request.params.arguments ?? {}) as Record<string, string>;
		const tripId = args.tripId ? Number(args.tripId) : 0;
		if (entry.requiresTripArgument && !tripId) {
			return errorPrompt('tripId argument required');
		}

		let trip: Record<string, unknown> | null = null;
		if (entry.requiresTrip && tripId) {
			try {
				trip = safeTripProjection(tripId, userId, scopes) as Record<string, unknown>;
			} catch {
				return errorPrompt('Trip not found or inaccessible.');
			}
		}

		const output = await entry.build({ userId, tripId, scopes, trip });
		return makePromptMessage(output.description, output.text);
	});

	server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
		const templates = MCP_RESOURCE_TEMPLATES.filter((t) => hasScope(scopes, t.scope)).map((t) => ({
			name: t.name,
			title: t.title,
			uriTemplate: t.uriTemplate,
			description: t.description,
			mimeType: t.mimeType
		}));
		return { resourceTemplates: templates };
	});

	server.setRequestHandler(ListResourcesRequestSchema, async () => {
		if (!hasScope(scopes, 'trips:read')) return { resources: [] };
		const tripIds = tripsRepo.listViewableTripIdsForUser(userId);
		const trips = tripIds
			.map((id) => tripsRepo.getTripById(id))
			.filter((t): t is NonNullable<typeof t> => t !== null && !t.archived);
		return {
			resources: trips.map((t) => ({
				uri: `trip://${t.id}`,
				name: t.name,
				title: t.name,
				description: t.destination || `Trip ${t.id}`,
				mimeType: 'application/json'
			}))
		};
	});

	server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
		const uri = request.params.uri;
		const tripMatch = TRIP_RESOURCE_URI_RE.exec(uri);
		if (tripMatch) {
			if (!hasScope(scopes, 'trips:read')) throw new Error('Missing scope: trips:read');
			const tripId = Number(tripMatch[1]);
			const projected = safeTripProjection(tripId, userId, scopes);
			return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify({ trip: projected }) }] };
		}
		const companionMatch = COMPANION_URI_RE.exec(uri);
		if (companionMatch) {
			if (!hasScope(scopes, 'companions:read')) throw new Error('Missing scope: companions:read');
			const { getCompanionTripId } = await import('./tripCompanions');
			const tripId = getCompanionTripId(Number(companionMatch[1]));
			if (tripId == null) throw new Error('Companion not found');
			const trip = requireViewableTrip(userId, tripId);
			const { listTripCompanions } = await import('./tripCompanions');
			const c = listTripCompanions(tripId).find((x) => x.id === Number(companionMatch[1]));
			if (!c) throw new Error('Companion not found');
			return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify({ companion: canEdit(userId, trip) ? c : companionViewerProjection(c) }) }] };
		}
		const cardMatch = CARD_URI_RE.exec(uri);
		if (cardMatch) {
			if (!hasScope(scopes, 'cards:read')) throw new Error('Missing scope: cards:read');
			const { getCardById } = await import('./repositories/profileRepo');
			const c = getCardById(Number(cardMatch[1]), userId);
			if (!c) throw new Error('Card not found');
			return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify({ card: projectCard(c) }) }] };
		}
		const loyaltyMatch = LOYALTY_URI_RE.exec(uri);
		if (loyaltyMatch) {
			if (!hasScope(scopes, 'loyalty:read')) throw new Error('Missing scope: loyalty:read');
			const { getLoyaltyProgramById } = await import('./repositories/profileRepo');
			const l = getLoyaltyProgramById(Number(loyaltyMatch[1]), userId);
			if (!l) throw new Error('Loyalty not found');
			return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify({ loyalty: projectLoyalty(l) }) }] };
		}
		const insuranceMatch = INSURANCE_URI_RE.exec(uri);
		if (insuranceMatch) {
			if (!hasScope(scopes, 'insurance:read')) throw new Error('Missing scope: insurance:read');
			const { getInsurancePolicyById } = await import('./repositories/profileRepo');
			const i = getInsurancePolicyById(Number(insuranceMatch[1]), userId);
			if (!i) throw new Error('Insurance not found');
			return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify({ insurance: projectInsurance(i) }) }] };
		}
		const docMatch = DOC_URI_RE.exec(uri);
		if (docMatch) {
			if (!hasScope(scopes, 'travel-docs:read')) throw new Error('Missing scope: travel-docs:read');
			const { getTravelDocumentById } = await import('./repositories/profileRepo');
			const d = getTravelDocumentById(Number(docMatch[1]), userId);
			if (!d) throw new Error('Document not found');
			return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify({ document: projectTravelDocument(d) }) }] };
		}
		const pollMatch = POLL_URI_RE.exec(uri);
		if (pollMatch) {
			if (!hasScope(scopes, 'polls:read')) throw new Error('Missing scope: polls:read');
			const { getPollById } = await import('./repositories/pollsRepo');
			const p = getPollById(Number(pollMatch[1]));
			if (!p) throw new Error('Poll not found');
			requireViewableTrip(userId, p.tripId);
			return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify({ poll: p }) }] };
		}
		const journalMatch = JOURNAL_URI_RE.exec(uri);
		if (journalMatch) {
			if (!hasScope(scopes, 'journal:read')) throw new Error('Missing scope: journal:read');
			const tripId = Number(journalMatch[1]);
			requireViewableTrip(userId, tripId);
			const { listJournalEntriesForTrip } = await import('./repositories/tripMiscRepo');
			const date = journalMatch[2];
			const entry = listJournalEntriesForTrip(tripId).find((e) => e.entryDate === date);
			if (!entry) throw new Error('Journal entry not found');
			return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify({ journal: entry }) }] };
		}
		const fareMatch = FARE_WATCH_URI_RE.exec(uri);
		if (fareMatch) {
			if (!hasScope(scopes, 'fares:read')) throw new Error('Missing scope: fares:read');
			const { getFareWatchById } = await import('./repositories/travelDataRepo');
			const w = getFareWatchById(Number(fareMatch[1]));
			if (!w) throw new Error('Fare watch not found');
			requireOwnedTrip(userId, w.tripId);
			return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify({ fareWatch: w }) }] };
		}
		throw new Error(`Unknown resource URI: ${uri}`);
	});
}
