import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { error } from '@sveltejs/kit';
import {
	ListToolsRequestSchema,
	CallToolRequestSchema,
	ListPromptsRequestSchema,
	GetPromptRequestSchema,
	ListResourcesRequestSchema,
	ReadResourceRequestSchema,
	ListResourceTemplatesRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import type { Scope } from './oauth';
import * as tripsRepo from './repositories/tripsRepo';
import * as segmentsRepo from './repositories/segmentsRepo';
import { requireOwnedTrip, requireEditableTrip, requireViewableTrip, requireOwnedGroup } from './ownership';
import { listVisited, markVisited, unmarkVisited } from './visitedPlaces';
import { loadTripFor } from '../../routes/trips/shared';
import { viewerProjection } from './sharing';
import { addItem as addChecklistItem, viewChecklist } from './tripChecklists';
import { setBudget, listBudgetsWithSpent } from './tripBudgets';
import { logAudit } from './audit';
import { Validator } from './validation';
import { TRIP_STATUSES, SEGMENT_TYPES, EXPENSE_CATEGORIES, type CompanionCategory } from './db/mongrelSchema';
import {
	projectCard,
	projectLoyalty,
	projectInsurance,
	projectTravelDocument,
	paginateList,
	requireConfirm
} from './mcpHelpers';

function hasScope(scopes: Scope[], required: Scope): boolean {
	return scopes.includes(required);
}

function scopeError(required: Scope) {
	return {
		content: [{ type: 'text' as const, text: `Missing required scope: ${required}` }],
		isError: true
	};
}

function textResult(obj: unknown) {
	return {
		content: [{ type: 'text' as const, text: JSON.stringify(obj, null, 2) }]
	};
}

function safeTripProjection(tripId: number, userId: number) {
	const view = loadTripFor(userId, tripId);
	if (view.editor) {
		return { ...viewerProjection(view.trip, view.segments, false), canEdit: true, owner: view.owner };
	}
	return { ...view.trip, canEdit: false, owner: false };
}

function validateToolInput(args: Record<string, unknown>): { ok: true } | { ok: false; error: string } {
	const v = new Validator();
	if (args.status != null) v.enumValue(args.status, TRIP_STATUSES, 'status');
	if (args.type != null) v.enumValue(args.type, SEGMENT_TYPES, 'type');
	if (args.category != null) v.enumValue(args.category, EXPENSE_CATEGORIES, 'category');
	if (v.ok()) return { ok: true };
	const messages = Object.values(v.errors);
	return { ok: false, error: messages.join('; ') };
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

const PROMPTS: readonly PromptEntry[] = [
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

// ---------------------------------------------------------------------------
// Resource registry
//
// Trips are exposed as `trip://<id>` resources.  `resources/list` enumerates
// the concrete trips the token can read (so MCP clients can populate a
// picker), and `resources/templates/list` advertises the URI template so a
// client can construct a resource URI directly when it already knows the ID.
// ---------------------------------------------------------------------------

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

export function createMcpServer(userId: number, scopes: Scope[]): Server {
	const server = new Server(
		{ name: 'roamarr', version: '1.0.0' },
		{ capabilities: { tools: {}, prompts: {}, resources: {} } }
	);

	server.setRequestHandler(ListToolsRequestSchema, async () => ({
		tools: [
			{
				name: 'roamarr_trip_list',
				description: 'List all trips for the authenticated user. Cursor-paginated.',
				inputSchema: {
					type: 'object',
					properties: {
						limit: { type: 'integer', description: '1-200, default 50' },
						cursor: { type: 'string' }
					}
				}
			},
			{
				name: 'roamarr_trip_get',
				description: 'Get details of a specific trip including segments and itinerary.',
				inputSchema: {
					type: 'object',
					properties: { tripId: { type: 'number', description: 'Trip ID' } },
					required: ['tripId']
				}
			},
			{
				name: 'roamarr_trip_create',
				description: 'Create a new trip.',
				inputSchema: {
					type: 'object',
					properties: {
						name: { type: 'string' },
						destination: { type: 'string' },
						destinationCountryCode: { type: 'string' },
						destinationCityName: { type: 'string' }, destinationCityLat: { type: 'number' }, destinationCityLng: { type: 'number' },
						startDate: { type: 'string', description: 'ISO date YYYY-MM-DD' },
						endDate: { type: 'string', description: 'ISO date YYYY-MM-DD' }, notes: { type: 'string' },
						tags: { type: 'array', items: { type: 'string' } }, baseCurrency: { type: 'string' },
						defaultVisibility: { type: 'string', enum: ['private', 'shared', 'public'] }, status: { type: 'string', enum: [...TRIP_STATUSES] }
					},
					required: ['name']
				}
			},
			{
				name: 'roamarr_trip_update',
				description: 'Update an existing trip (name, destination, dates, etc.).',
				inputSchema: {
					type: 'object',
					properties: {
						tripId: { type: 'number' },
						name: { type: 'string' },
						destination: { type: 'string' },
						destinationCountryCode: { type: 'string' }, destinationCityName: { type: 'string' },
						destinationCityLat: { type: 'number' }, destinationCityLng: { type: 'number' },
						startDate: { type: 'string', description: 'ISO date YYYY-MM-DD' },
						endDate: { type: 'string', description: 'ISO date YYYY-MM-DD' },
						notes: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } }, baseCurrency: { type: 'string' },
						defaultVisibility: { type: 'string', enum: ['private', 'shared', 'public'] }, status: { type: 'string', enum: [...TRIP_STATUSES] }
					},
					required: ['tripId']
				}
			},
			{
				name: 'roamarr_day_plan',
				description: 'Plan a day: create a segment (event, lodging, transport, etc.) for a specific trip on a given date.',
				inputSchema: {
					type: 'object',
					properties: {
						tripId: { type: 'number' },
						type: { type: 'string', description: 'Segment type: flight, hotel, event, restaurant, etc.' },
						title: { type: 'string' },
						startAt: { type: 'string', description: 'ISO timestamp' },
						endAt: { type: 'string', description: 'ISO timestamp (optional)' },
						cityName: { type: 'string' },
						countryCode: { type: 'string' },
						notes: { type: 'string' }
					},
					required: ['tripId', 'type', 'title', 'startAt']
				}
			},
			{
				name: 'roamarr_packing_item_add',
				description: 'Add an item to a trip\u2019s packing checklist.',
				inputSchema: {
					type: 'object',
					properties: {
						tripId: { type: 'number' },
						text: { type: 'string', description: 'Item description, e.g. "Passport" or "Sunscreen"' }, assignedToCompanionId: { type: 'number' }
					},
					required: ['tripId', 'text']
				}
			},
			{
				name: 'roamarr_packing_list_build',
				description: 'Apply a saved packing template to a trip, or list the current checklist.',
				inputSchema: {
					type: 'object',
					properties: {
						tripId: { type: 'number' },
						templateId: { type: 'number', description: 'Optional template ID to apply. Omit to just list current items.' }
					},
					required: ['tripId']
				}
			},
			{
				name: 'roamarr_budget_set',
				description: 'Set or update a budget category amount for a trip.',
				inputSchema: {
					type: 'object',
					properties: {
						tripId: { type: 'number' },
						category: { type: 'string', description: 'Budget category (e.g. lodging, transport, food, activities, other)' },
						amount: { type: 'number', description: 'Budget amount' },
						currency: { type: 'string', description: 'ISO currency code, default USD' }
					},
					required: ['tripId', 'category', 'amount']
				}
			},
			{
				name: 'roamarr_budget_update',
				description: 'View the current budget categories and spent amounts for a trip.',
				inputSchema: {
					type: 'object',
					properties: {
						tripId: { type: 'number' }
					},
					required: ['tripId']
				}
			},
			{
				name: 'roamarr_upcoming_summary',
				description: 'Get a summary of upcoming trips.',
				inputSchema: { type: 'object', properties: {} }
			},
			{
				name: 'roamarr_weather_overview',
				description: 'Get the weather forecast for a trip destination.',
				inputSchema: { type: 'object', properties: { tripId: { type: 'number' } }, required: ['tripId'] }
			},
			{
				name: 'roamarr_places_list',
				description: 'List visited countries and U.S. states. Cursor-paginated across both collections.',
				inputSchema: {
					type: 'object',
					properties: {
						limit: { type: 'integer', description: '1-200, default 50' },
						cursor: { type: 'string' }
					}
				}
			},
			{
				name: 'roamarr_places_mark',
				description: 'Mark a country or U.S. state as visited.',
				inputSchema: {
					type: 'object',
					properties: {
						kind: { type: 'string', enum: ['country', 'state'] },
						code: { type: 'string', description: 'ISO country code or US state code' }
					},
					required: ['kind', 'code']
				}
			},
			{
				name: 'roamarr_places_unmark',
				description: 'Remove a country or U.S. state from visited.',
				inputSchema: {
					type: 'object',
					properties: {
						kind: { type: 'string', enum: ['country', 'state'] },
						code: { type: 'string', description: 'ISO country code or US state code' }
					},
					required: ['kind', 'code']
				}
			},
			{
				name: 'roamarr_reminder_add',
				description: 'Add a reminder to a trip.',
				inputSchema: {
					type: 'object',
					properties: {
						tripId: { type: 'number' },
						offsetMinutes: { type: 'number', description: 'Minutes before the trip start' },
						title: { type: 'string' }, reminderType: { type: 'string', enum: ['trip', 'document'] },
						name: { type: 'string' }, description: { type: 'string' }, fireAt: { type: 'string' }, refId: { type: 'number' }
					},
					required: []
				}
			},
			// Round 1: trip planning vertical — 17 new tools.
			{
				name: 'roamarr_segment_update',
				description: 'Update an existing segment. Pass any subset of: type, title, startAt, endAt, cityName, countryCode, paymentStatus.',
				inputSchema: {
					type: 'object',
					properties: {
						segmentId: { type: 'number' },
						type: { type: 'string', enum: [...SEGMENT_TYPES] },
						title: { type: 'string' },
						startAt: { type: 'string', description: 'ISO timestamp' },
						endAt: { type: 'string', description: 'ISO timestamp (optional)' },
						cityName: { type: 'string' },
						countryCode: { type: 'string' },
						paymentStatus: { type: 'string', enum: ['quoted', 'deposit_paid', 'fully_paid', 'refunded'] }
					},
					required: ['segmentId']
				}
			},
			{
				name: 'roamarr_segment_delete',
				description: 'Delete a segment. Cancels its reminders.',
				inputSchema: {
					type: 'object',
					properties: { segmentId: { type: 'number' },
					confirm: { type: "boolean", description: "Must be true to confirm destructive action" },},
					required: ['segmentId']
				}
			},
			{
				name: 'roamarr_segment_move',
				description: 'Reschedule a segment to a new date. Time-of-day is preserved; only the calendar date changes. To change the time too, use roamarr_segment_update.',
				inputSchema: {
					type: 'object',
					properties: {
						segmentId: { type: 'number' },
						targetDate: { type: 'string', description: 'ISO date YYYY-MM-DD' }
					},
					required: ['segmentId', 'targetDate']
				}
			},
			{
				name: 'roamarr_segment_status',
				description: 'Set the lifecycle status of a segment.',
				inputSchema: {
					type: 'object',
					properties: {
						segmentId: { type: 'number' },
						status: { type: 'string', enum: ['planned', 'checked_in', 'boarded', 'arrived', 'completed'] }
					},
					required: ['segmentId', 'status']
				}
			},
			{
				name: 'roamarr_trip_delete',
				description: 'Permanently delete a trip. Cancels all reminders and shares. Cannot be undone.',
				inputSchema: {
					type: 'object',
					properties: {
						tripId: { type: 'number' },
						confirm: { type: 'boolean', description: 'Must be true to confirm destructive action' }
					},
					required: ['tripId', 'confirm']
				}
			},
			{
				name: 'roamarr_trip_archive',
				description: 'Toggle the archived flag on a trip.',
				inputSchema: {
					type: 'object',
					properties: { tripId: { type: 'number' } },
					required: ['tripId']
				}
			},
			{
				name: 'roamarr_trip_duplicate',
				description: 'Duplicate a trip including its segments (not companions, shares, or comments).',
				inputSchema: {
					type: 'object',
					properties: { tripId: { type: 'number' } },
					required: ['tripId']
				}
			},
			{
				name: 'roamarr_expense_create',
				description: 'Record an expense. amount is in integer cents (e.g. $12.34 → 1234).',
				inputSchema: {
					type: 'object',
					properties: {
						tripId: { type: 'number' },
						description: { type: 'string' },
						amount: { type: 'integer', description: 'Amount in integer cents' },
						currency: { type: 'string', description: 'ISO currency code, default USD' },
						category: { type: 'string', description: 'lodging, transport, food, activities, other' },
						exchangeRate: { type: 'integer', description: 'Rate × 10000 (default 10000 = 1.0)' },
						baseAmount: { type: 'integer', description: 'Amount in cents in base currency' },
						paidByCompanionId: { type: 'number' },
						splitAmong: { type: 'array', items: { oneOf: [{ type: 'string', enum: ['owner'] }, { type: 'number' }] } }
					},
					required: ['tripId', 'description', 'amount']
				}
			},
			{
				name: 'roamarr_expense_list',
				description: 'List expenses for a trip.',
				inputSchema: {
					type: 'object',
					properties: {
						tripId: { type: 'number' },
						limit: { type: 'integer', description: '1-200, default 50' },
						cursor: { type: 'string' }
					},
					required: ['tripId']
				}
			},
			{
				name: 'roamarr_expense_update',
				description: 'Update an expense by id.',
				inputSchema: {
					type: 'object',
					properties: {
						expenseId: { type: 'number' },
						description: { type: 'string' },
						amount: { type: 'integer' },
						currency: { type: 'string' },
						category: { type: 'string' }, exchangeRate: { type: 'integer' }, baseAmount: { type: 'integer' },
						paidByCompanionId: { type: 'number' }, splitAmong: { type: 'array', items: { oneOf: [{ type: 'string', enum: ['owner'] }, { type: 'number' }] } }
					},
					required: ['expenseId']
				}
			},
			{
				name: 'roamarr_expense_delete',
				description: 'Delete an expense.',
				inputSchema: {
					type: 'object',
					properties: { expenseId: { type: 'number' },
					confirm: { type: "boolean", description: "Must be true to confirm destructive action" },},
					required: ['expenseId']
				}
			},
			{
				name: 'roamarr_packing_item_toggle',
				description: 'Toggle the packed/unpacked state of a checklist item.',
				inputSchema: {
					type: 'object',
					properties: { itemId: { type: 'number' } },
					required: ['itemId']
				}
			},
			{
				name: 'roamarr_packing_item_update',
				description: 'Rename a packing checklist item.',
				inputSchema: {
					type: 'object',
					properties: {
						itemId: { type: 'number' },
						text: { type: 'string' }, assignedToCompanionId: { type: 'number' }
					},
					required: ['itemId']
				}
			},
			{
				name: 'roamarr_packing_item_delete',
				description: 'Delete a packing checklist item.',
				inputSchema: {
					type: 'object',
					properties: { itemId: { type: 'number' },
					confirm: { type: "boolean", description: "Must be true to confirm destructive action" },},
					required: ['itemId']
				}
			},
			{
				name: 'roamarr_reminder_list',
				description: 'List your reminders. Optionally filter by tripId.',
				inputSchema: {
					type: 'object',
					properties: {
						tripId: { type: 'number' },
						limit: { type: 'integer' },
						cursor: { type: 'string' }
					}
				}
			},
			{
				name: 'roamarr_reminder_update',
				description: 'Update a custom reminder. Only the three user-safe fields are accepted.',
				inputSchema: {
					type: 'object',
					properties: {
						reminderId: { type: 'number' },
						title: { type: 'string', maxLength: 200 },
						customNote: { type: 'string', maxLength: 1000 },
						offsetMinutes: { type: 'integer', minimum: -10080, maximum: 10080 },
						name: { type: 'string' }, description: { type: 'string' }, fireAt: { type: 'string' }, refId: { type: 'number' }
					},
					required: ['reminderId']
				}
			},
			{
				name: 'roamarr_reminder_delete',
				description: 'Delete a reminder by id.',
				inputSchema: {
					type: 'object',
					properties: { reminderId: { type: 'number' },
					confirm: { type: "boolean", description: "Must be true to confirm destructive action" },},
					required: ['reminderId']
				}
			},
			// ---- Round 2: wallet, sharing, calendar, contacts, profile, notifications ----
			{
				name: 'roamarr_card_list',
				description: 'List your payment cards (network + last4 only; never full PAN). Cursor-paginated.',
				inputSchema: {
					type: 'object',
					properties: {
						limit: { type: 'integer', description: '1-200, default 50' },
						cursor: { type: 'string' }
					}
				}
			},
			{
				name: 'roamarr_card_create',
				description: 'Add a payment card. last4 only; never pass full PAN.',
				inputSchema: {
					type: 'object',
					properties: {
						network: { type: 'string', enum: ['visa', 'mc', 'amex', 'disc', 'other'] },
						last4: { type: 'string', description: '4 digits' },
						label: { type: 'string' }
					},
					required: ['network', 'last4']
				}
			},
			{
				name: 'roamarr_card_update',
				description: 'Update a card by id.',
				inputSchema: {
					type: 'object',
					properties: { cardId: { type: 'number' }, label: { type: 'string' } },
					required: ['cardId']
				}
			},
			{
				name: 'roamarr_card_delete',
				description: 'Delete a card by id.',
				inputSchema: {
					type: 'object',
					properties: { cardId: { type: 'number' },
					confirm: { type: "boolean", description: "Must be true to confirm destructive action" },},
					required: ['cardId']
				}
			},
			{
				name: 'roamarr_loyalty_list',
				description: 'List your loyalty programs. Member numbers are redacted by default. Cursor-paginated.',
				inputSchema: {
					type: 'object',
					properties: {
						limit: { type: 'integer', description: '1-200, default 50' },
						cursor: { type: 'string' }
					}
				}
			},
			{
				name: 'roamarr_loyalty_create',
				description: 'Add a loyalty program.',
				inputSchema: {
					type: 'object',
					properties: {
						programName: { type: 'string' },
						memberNumber: { type: 'string' }
					},
					required: ['programName']
				}
			},
			{
				name: 'roamarr_loyalty_update',
				description: 'Update a loyalty program by id.',
				inputSchema: {
					type: 'object',
					properties: {
						loyaltyId: { type: 'number' },
						programName: { type: 'string' },
						memberNumber: { type: 'string' }
					},
					required: ['loyaltyId']
				}
			},
			{
				name: 'roamarr_loyalty_delete',
				description: 'Delete a loyalty program by id.',
				inputSchema: {
					type: 'object',
					properties: { loyaltyId: { type: 'number' },
					confirm: { type: "boolean", description: "Must be true to confirm destructive action" },},
					required: ['loyaltyId']
				}
			},
			{
				name: 'roamarr_insurance_list',
				description: 'List your insurance policies. Policy numbers and notes redacted by default. Cursor-paginated.',
				inputSchema: {
					type: 'object',
					properties: {
						limit: { type: 'integer', description: '1-200, default 50' },
						cursor: { type: 'string' }
					}
				}
			},
			{
				name: 'roamarr_insurance_create',
				description: 'Add an insurance policy.',
				inputSchema: {
					type: 'object',
					properties: {
						provider: { type: 'string' },
						policyNumber: { type: 'string' },
						coverageType: { type: 'string' },
						notes: { type: 'string' }
					},
					required: ['provider']
				}
			},
			{
				name: 'roamarr_insurance_update',
				description: 'Update an insurance policy by id.',
				inputSchema: {
					type: 'object',
					properties: {
						insuranceId: { type: 'number' },
						provider: { type: 'string' },
						policyNumber: { type: 'string' },
						notes: { type: 'string' }
					},
					required: ['insuranceId']
				}
			},
			{
				name: 'roamarr_insurance_delete',
				description: 'Delete an insurance policy by id.',
				inputSchema: {
					type: 'object',
					properties: { insuranceId: { type: 'number' },
					confirm: { type: "boolean", description: "Must be true to confirm destructive action" },},
					required: ['insuranceId']
				}
			},
			{
				name: 'roamarr_travel_doc_list',
				description: 'List your travel documents (passport, visa, etc.). Encrypted numbers redacted. Cursor-paginated.',
				inputSchema: {
					type: 'object',
					properties: {
						limit: { type: 'integer', description: '1-200, default 50' },
						cursor: { type: 'string' }
					}
				}
			},
			{
				name: 'roamarr_travel_doc_create',
				description: 'Add a travel document. number is encrypted at rest.',
				inputSchema: {
					type: 'object',
					properties: {
						type: { type: 'string', enum: ['passport', 'drivers_license', 'global_entry', 'visa'] },
						issuer: { type: 'string' },
						number: { type: 'string' },
						expiresOn: { type: 'string', description: 'ISO date' }
					},
					required: ['type']
				}
			},
			{
				name: 'roamarr_travel_doc_update',
				description: 'Update a travel document by id.',
				inputSchema: {
					type: 'object',
					properties: {
						docId: { type: 'number' },
						issuer: { type: 'string' },
						number: { type: 'string' },
						expiresOn: { type: 'string' }
					},
					required: ['docId']
				}
			},
			{
				name: 'roamarr_travel_doc_delete',
				description: 'Delete a travel document by id.',
				inputSchema: {
					type: 'object',
					properties: { docId: { type: 'number' },
					confirm: { type: "boolean", description: "Must be true to confirm destructive action" },},
					required: ['docId']
				}
			},
			{
				name: 'roamarr_doc_link_list',
				description: 'List per-trip document links for a trip. Cursor-paginated.',
				inputSchema: {
					type: 'object',
					properties: {
						tripId: { type: 'number' },
						limit: { type: 'integer', description: '1-200, default 50' },
						cursor: { type: 'string' }
					},
					required: ['tripId']
				}
			},
			{
				name: 'roamarr_doc_link_create',
				description: 'Attach a document link to a trip.',
				inputSchema: {
					type: 'object',
					properties: {
						tripId: { type: 'number' },
						label: { type: 'string' }, url: { type: 'string' }, notes: { type: 'string' }
					},
					required: ['tripId', 'label', 'url']
				}
			},
			{
				name: 'roamarr_doc_link_update',
				description: 'Update a doc link by id.',
				inputSchema: {
					type: 'object',
					properties: {
						linkId: { type: 'number' },
						label: { type: 'string' }, url: { type: 'string' }, notes: { type: 'string' }
					},
					required: ['linkId']
				}
			},
			{
				name: 'roamarr_doc_link_delete',
				description: 'Delete a doc link by id.',
				inputSchema: {
					type: 'object',
					properties: { linkId: { type: 'number' },
					confirm: { type: "boolean", description: "Must be true to confirm destructive action" },},
					required: ['linkId']
				}
			},
			{
				name: 'roamarr_share_list',
				description: 'List shares on a trip.',
				inputSchema: {
					type: 'object',
					properties: { tripId: { type: 'number' } },
					required: ['tripId']
				}
			},
			{
				name: 'roamarr_share_create',
				description: 'Share a trip with a user (by email), group, or as a public link.',
				inputSchema: {
					type: 'object',
					properties: {
						tripId: { type: 'number' },
						kind: { type: 'string', enum: ['user', 'group', 'public'] },
						email: { type: 'string' },
						groupId: { type: 'number' },
						permission: { type: 'string', enum: ['read', 'edit'] },
						showDetails: { type: 'boolean' }
					},
					required: ['tripId', 'kind']
				}
			},
			{
				name: 'roamarr_share_update',
				description: 'Update a share by id (permission, showDetails).',
				inputSchema: {
					type: 'object',
					properties: {
						shareId: { type: 'number' },
						permission: { type: 'string', enum: ['read', 'edit'] },
						showDetails: { type: 'boolean' }
					},
					required: ['shareId']
				}
			},
			{
				name: 'roamarr_share_revoke',
				description: 'Revoke a share by id.',
				inputSchema: {
					type: 'object',
					properties: { shareId: { type: 'number' },
					confirm: { type: "boolean", description: "Must be true to confirm destructive action" },},
					required: ['shareId']
				}
			},
			{
				name: 'roamarr_group_list',
				description: 'List your sharing groups.',
				inputSchema: { type: 'object', properties: {} }
			},
			{
				name: 'roamarr_group_create',
				description: 'Create a sharing group.',
				inputSchema: {
					type: 'object',
					properties: { name: { type: 'string' } },
					required: ['name']
				}
			},
			{
				name: 'roamarr_group_member_add',
				description: 'Add a user to a group by email.',
				inputSchema: {
					type: 'object',
					properties: {
						groupId: { type: 'number' },
						email: { type: 'string' }
					},
					required: ['groupId', 'email']
				}
			},
			{
				name: 'roamarr_group_member_remove',
				description: 'Remove a user from a group by id.',
				inputSchema: {
					type: 'object',
					properties: {
						groupId: { type: 'number' },
						userId: { type: 'number' },
						confirm: { type: 'boolean', description: 'Must be true to confirm destructive action' }
					},
					required: ['groupId', 'userId']
				}
			},
			{
				name: 'roamarr_calendar_rotate_token',
				description: 'Rotate the calendar feed token for a trip. Old token is revoked.',
				inputSchema: {
					type: 'object',
					properties: { tripId: { type: 'number' } },
					required: ['tripId']
				}
			},
			{
				name: 'roamarr_contact_list',
				description: 'List your emergency contacts.',
				inputSchema: { type: 'object', properties: {} }
			},
			{
				name: 'roamarr_contact_create',
				description: 'Add an emergency contact.',
				inputSchema: {
					type: 'object',
					properties: {
						name: { type: 'string' },
						relationship: { type: 'string' },
						phone: { type: 'string' },
						email: { type: 'string' }, isPrimary: { type: 'boolean' }
					},
					required: ['name']
				}
			},
			{
				name: 'roamarr_contact_update',
				description: 'Update an emergency contact by id.',
				inputSchema: {
					type: 'object',
					properties: {
						contactId: { type: 'number' },
						name: { type: 'string' },
						relationship: { type: 'string' },
						phone: { type: 'string' },
						email: { type: 'string' }, isPrimary: { type: 'boolean' }
					},
					required: ['contactId']
				}
			},
			{
				name: 'roamarr_contact_delete',
				description: 'Delete an emergency contact by id.',
				inputSchema: {
					type: 'object',
					properties: { contactId: { type: 'number' },
					confirm: { type: "boolean", description: "Must be true to confirm destructive action" },},
					required: ['contactId']
				}
			},
			{
				name: 'roamarr_profile_get',
				description: 'Get your profile preferences (timezone, default leads, currency, theme).',
				inputSchema: { type: 'object', properties: {} }
			},
			{
				name: 'roamarr_profile_update',
				description: 'Update your profile preferences.',
				inputSchema: {
					type: 'object',
					properties: {
						displayName: { type: 'string' },
						timezone: { type: 'string' },
						defaultCurrency: { type: 'string' },
						flightCheckinLeadHours: { type: 'integer' },
						documentExpiryLeadDays: { type: 'integer' },
						themeId: { type: 'string' }
					}
				}
			},
			{
				name: 'roamarr_notification_channels_get',
				description: 'Get your notification channel preferences (email/webhook).',
				inputSchema: { type: 'object', properties: {} }
			},
			{
				name: 'roamarr_notification_channels_update',
				description: 'Update your notification channel preferences.',
				inputSchema: {
					type: 'object',
					properties: {
						emailNotifications: { type: 'boolean' },
						webhookNotifications: { type: 'boolean' }
					}
				}
			},
			{
				name: 'roamarr_user_smtp_get',
				description: 'Get your SMTP override (no password exposed).',
				inputSchema: { type: 'object', properties: {} }
			},
			{
				name: 'roamarr_user_smtp_set',
				description: 'Set your SMTP override.',
				inputSchema: {
					type: 'object',
					properties: {
						host: { type: 'string' },
						port: { type: 'integer' },
						username: { type: 'string' },
						password: { type: 'string' },
						fromAddress: { type: 'string' },
						security: { type: 'string', enum: ['none', 'starttls', 'ssl/tls'] }
					},
					required: ['host', 'port', 'username', 'fromAddress']
				}
			},
			{
				name: 'roamarr_user_smtp_clear',
				description: 'Clear your SMTP override.',
				inputSchema: { type: 'object', properties: {
				confirm: { type: "boolean", description: "Must be true to confirm destructive action" },} }
			},
			// ---- Round 3: depth + UX ----
			{
				name: 'roamarr_packing_template_list',
				description: 'List your packing templates.',
				inputSchema: { type: 'object', properties: {} }
			},
			{
				name: 'roamarr_packing_template_create',
				description: 'Create a packing template from a trip checklist.',
				inputSchema: {
					type: 'object',
					properties: { name: { type: 'string' }, sourceTripId: { type: 'number' } },
					required: ['name', 'sourceTripId']
				}
			},
			{
				name: 'roamarr_packing_template_delete',
				description: 'Delete a packing template.',
				inputSchema: {
					type: 'object',
					properties: { templateId: { type: 'number' },
					confirm: { type: "boolean", description: "Must be true to confirm destructive action" },},
					required: ['templateId']
				}
			},
			{
				name: 'roamarr_trip_template_list',
				description: 'List your trip templates.',
				inputSchema: { type: 'object', properties: {} }
			},
			{
				name: 'roamarr_trip_template_create',
				description: 'Create a trip template from an owned trip.',
				inputSchema: {
					type: 'object',
					properties: { name: { type: 'string' }, sourceTripId: { type: 'number' } },
					required: ['name', 'sourceTripId']
				}
			},
			{
				name: 'roamarr_trip_template_apply',
				description: 'Apply a trip template to create a new trip.',
				inputSchema: {
					type: 'object',
					properties: { templateId: { type: 'number' } },
					required: ['templateId']
				}
			},
			{
				name: 'roamarr_trip_template_delete',
				description: 'Delete a trip template.',
				inputSchema: {
					type: 'object',
					properties: { templateId: { type: 'number' },
					confirm: { type: "boolean", description: "Must be true to confirm destructive action" },},
					required: ['templateId']
				}
			},
			{
				name: 'roamarr_companion_list',
				description: 'List companions for a trip.',
				inputSchema: {
					type: 'object',
					properties: { tripId: { type: 'number' } },
					required: ['tripId']
				}
			},
			{
				name: 'roamarr_companion_create',
				description: 'Add a companion to a trip.',
				inputSchema: {
					type: 'object',
					properties: {
						tripId: { type: 'number' },
						name: { type: 'string' },
						category: { type: 'string', enum: ['adult', 'child', 'other', 'guide', 'driver'] },
						dietary: { type: 'string' }, allergies: { type: 'string' }, medicalNotes: { type: 'string' },
						needsCarSeat: { type: 'boolean' }, needsStroller: { type: 'boolean' }, needsCrib: { type: 'boolean' }, needsKidsMeal: { type: 'boolean' },
						childTicketDiscount: { type: 'string' }, seatPreference: { type: 'string' }, bedPreference: { type: 'string' },
						accessibilityNeeds: { type: 'string' }, roomNotes: { type: 'string' }, notes: { type: 'string' }
					},
					required: ['tripId', 'name']
				}
			},
			{
				name: 'roamarr_companion_update',
				description: 'Update a companion by id.',
				inputSchema: {
					type: 'object',
					properties: {
						companionId: { type: 'number' },
						name: { type: 'string' },
						category: { type: 'string', enum: ['adult', 'child', 'other', 'guide', 'driver'] },
						dietary: { type: 'string' }, allergies: { type: 'string' }, medicalNotes: { type: 'string' },
						needsCarSeat: { type: 'boolean' }, needsStroller: { type: 'boolean' }, needsCrib: { type: 'boolean' }, needsKidsMeal: { type: 'boolean' },
						childTicketDiscount: { type: 'string' }, seatPreference: { type: 'string' }, bedPreference: { type: 'string' },
						accessibilityNeeds: { type: 'string' }, roomNotes: { type: 'string' }, notes: { type: 'string' }
					},
					required: ['companionId']
				}
			},
			{
				name: 'roamarr_companion_delete',
				description: 'Delete a companion by id.',
				inputSchema: {
					type: 'object',
					properties: { companionId: { type: 'number' },
					confirm: { type: "boolean", description: "Must be true to confirm destructive action" },},
					required: ['companionId']
				}
			},
			{
				name: 'roamarr_poll_list',
				description: 'List polls for a trip.',
				inputSchema: {
					type: 'object',
					properties: { tripId: { type: 'number' } },
					required: ['tripId']
				}
			},
			{
				name: 'roamarr_poll_create',
				description: 'Create a poll for a trip.',
				inputSchema: {
					type: 'object',
					properties: {
						tripId: { type: 'number' },
						question: { type: 'string' },
						options: { type: 'array', items: { type: 'string' } }
					},
					required: ['tripId', 'question', 'options']
				}
			},
			{
				name: 'roamarr_poll_cast_vote',
				description: 'Cast a vote on a poll option.',
				inputSchema: {
					type: 'object',
					properties: {
						pollId: { type: 'number' },
						optionId: { type: 'number' },
						companionId: { type: 'number' }
					},
					required: ['pollId', 'optionId']
				}
			},
			{
				name: 'roamarr_poll_delete',
				description: 'Delete a poll by id.',
				inputSchema: {
					type: 'object',
					properties: { pollId: { type: 'number' },
					confirm: { type: "boolean", description: "Must be true to confirm destructive action" },},
					required: ['pollId']
				}
			},
			{
				name: 'roamarr_journal_list',
				description: 'List journal entries for a trip.',
				inputSchema: {
					type: 'object',
					properties: { tripId: { type: 'number' } },
					required: ['tripId']
				}
			},
			{
				name: 'roamarr_journal_create',
				description: 'Create a journal entry for a trip.',
				inputSchema: {
					type: 'object',
					properties: {
						tripId: { type: 'number' },
						entryDate: { type: 'string', description: 'ISO date' },
						title: { type: 'string' },
						body: { type: 'string' }
					},
					required: ['tripId', 'entryDate', 'title', 'body']
				}
			},
			{
				name: 'roamarr_journal_update',
				description: 'Update a journal entry by id.',
				inputSchema: {
					type: 'object',
					properties: {
						entryId: { type: 'number' },
						entryDate: { type: 'string' }, title: { type: 'string' }, body: { type: 'string' }
					},
					required: ['entryId']
				}
			},
			{
				name: 'roamarr_journal_delete',
				description: 'Delete a journal entry by id.',
				inputSchema: {
					type: 'object',
					properties: { entryId: { type: 'number' },
					confirm: { type: "boolean", description: "Must be true to confirm destructive action" },},
					required: ['entryId']
				}
			},
			{
				name: 'roamarr_home_task_list',
				description: 'List home tasks for a trip.',
				inputSchema: {
					type: 'object',
					properties: { tripId: { type: 'number' } },
					required: ['tripId']
				}
			},
			{
				name: 'roamarr_home_task_create',
				description: 'Create a home task for a trip.',
				inputSchema: {
					type: 'object',
					properties: {
						tripId: { type: 'number' },
						text: { type: 'string' },
						dueDate: { type: 'string' }
					},
					required: ['tripId', 'text']
				}
			},
			{
				name: 'roamarr_home_task_toggle_done',
				description: 'Toggle the done flag on a home task.',
				inputSchema: {
					type: 'object',
					properties: { taskId: { type: 'number' } },
					required: ['taskId']
				}
			},
			{
				name: 'roamarr_home_task_delete',
				description: 'Delete a home task by id.',
				inputSchema: {
					type: 'object',
					properties: { taskId: { type: 'number' },
					confirm: { type: "boolean", description: "Must be true to confirm destructive action" },},
					required: ['taskId']
				}
			},
			{
				name: 'roamarr_medication_list',
				description: 'List medications for a trip.',
				inputSchema: {
					type: 'object',
					properties: { tripId: { type: 'number' } },
					required: ['tripId']
				}
			},
			{
				name: 'roamarr_medication_create',
				description: 'Add a medication to a trip.',
				inputSchema: {
					type: 'object',
					properties: {
						tripId: { type: 'number' },
						name: { type: 'string' },
						companionId: { type: 'number' }, dosage: { type: 'string' }, schedule: { type: 'string' },
						startsAt: { type: 'string' }, endsAt: { type: 'string' }, notes: { type: 'string' }
					},
					required: ['tripId', 'name']
				}
			},
			{
				name: 'roamarr_medication_delete',
				description: 'Delete a medication by id.',
				inputSchema: {
					type: 'object',
					properties: { medicationId: { type: 'number' },
					confirm: { type: "boolean", description: "Must be true to confirm destructive action" },},
					required: ['medicationId']
				}
			},
			{
				name: 'roamarr_important_item_list',
				description: 'List important items (valuables, trackers).',
				inputSchema: {
					type: 'object',
					properties: { tripId: { type: 'number' } },
					required: ['tripId']
				}
			},
			{
				name: 'roamarr_important_item_create',
				description: 'Add an important item to a trip.',
				inputSchema: {
					type: 'object',
					properties: {
						tripId: { type: 'number' },
						name: { type: 'string' }, companionId: { type: 'number' }, serialNumber: { type: 'string' },
						trackerId: { type: 'string' }, notes: { type: 'string' }
					},
					required: ['tripId', 'name']
				}
			},
			{
				name: 'roamarr_important_item_delete',
				description: 'Delete an important item by id.',
				inputSchema: {
					type: 'object',
					properties: { itemId: { type: 'number' },
					confirm: { type: "boolean", description: "Must be true to confirm destructive action" },},
					required: ['itemId']
				}
			},
			{
				name: 'roamarr_entry_requirement_list',
				description: 'List entry requirements for a trip.',
				inputSchema: {
					type: 'object',
					properties: { tripId: { type: 'number' } },
					required: ['tripId']
				}
			},
			{
				name: 'roamarr_entry_requirement_create',
				description: 'Add an entry requirement to a trip.',
				inputSchema: {
					type: 'object',
					properties: {
						tripId: { type: 'number' },
						country: { type: 'string' }, requirementType: { type: 'string', enum: ['visa', 'vaccination', 'other'] },
						status: { type: 'string', enum: ['needed', 'in_progress', 'complete', 'not_needed'] }, dueDate: { type: 'string' }, notes: { type: 'string' }
					},
					required: ['tripId', 'country', 'requirementType']
				}
			},
			{
				name: 'roamarr_entry_requirement_update',
				description: 'Update an entry requirement by id.',
				inputSchema: {
					type: 'object',
					properties: {
						requirementId: { type: 'number' },
						notes: { type: 'string' },
						status: { type: 'string', enum: ['needed', 'in_progress', 'complete', 'not_needed'] }
					},
					required: ['requirementId']
				}
			},
			{
				name: 'roamarr_entry_requirement_delete',
				description: 'Delete an entry requirement by id.',
				inputSchema: {
					type: 'object',
					properties: { requirementId: { type: 'number' },
					confirm: { type: "boolean", description: "Must be true to confirm destructive action" },},
					required: ['requirementId']
				}
			},
			{
				name: 'roamarr_comment_list',
				description: 'List comments on a trip.',
				inputSchema: {
					type: 'object',
					properties: { tripId: { type: 'number' } },
					required: ['tripId']
				}
			},
			{
				name: 'roamarr_comment_create',
				description: 'Post a comment on a trip.',
				inputSchema: {
					type: 'object',
					properties: {
						tripId: { type: 'number' },
						body: { type: 'string' }
					},
					required: ['tripId', 'body']
				}
			},
			{
				name: 'roamarr_comment_delete',
				description: 'Delete a comment by id.',
				inputSchema: {
					type: 'object',
					properties: { commentId: { type: 'number' },
					confirm: { type: "boolean", description: "Must be true to confirm destructive action" },},
					required: ['commentId']
				}
			},
			{
				name: 'roamarr_search',
				description: 'Search across your trips by name, destination, or segment title.',
				inputSchema: {
					type: 'object',
					properties: { query: { type: 'string' } },
					required: ['query']
				}
			}
		]
	}));

	server.setRequestHandler(CallToolRequestSchema, async (request) => {
		const { name, arguments: args = {} } = request.params;
		// Convert any thrown SvelteKit `error()` (404/400/etc.) from helper
		// functions into an MCP `isError: true` result instead of leaking
		// an unhandled 500 to the transport. The default case (unknown
		// tool) and explicit isError returns are unaffected.
		const toolHandler = async () => {
			switch (name) {
				case 'roamarr_trip_list': {
				if (!hasScope(scopes, 'trips:read')) return scopeError('trips:read');
				// Include shared trips, matching what the user sees in the web
				// UI. The previous impl used listTripsForUser (owner-only),
				// which silently hid trips shared with the calling user.
				const tripIds = tripsRepo.listViewableTripIdsForUser(userId);
				const trips = tripIds.map((id) => safeTripProjection(id, userId));
				const page = paginateList(
					trips,
					args,
					(t) => t.id
				);
				return textResult({
					items: page.items.map((t) => ({
						id: t.id, name: t.name, destination: 'destination' in t ? t.destination : null,
						destinationCountryCode: t.destinationCountryCode,
						destinationCityName: t.destinationCityName,
						startDate: t.startDate, endDate: t.endDate, status: t.status
					})),
					nextCursor: page.nextCursor,
				});
			}
			case 'roamarr_trip_get': {
				if (!hasScope(scopes, 'trips:read')) return scopeError('trips:read');
				const tripId = Number(args.tripId);
				const projected = safeTripProjection(tripId, userId);
				return textResult({ trip: projected });
			}
			case 'roamarr_trip_create': {
				if (!hasScope(scopes, 'trips:write')) return scopeError('trips:write');
				const trip = tripsRepo.createTrip(userId, {
					name: String(args.name ?? ''),
					destination: args.destination as string | undefined,
					destinationCountryCode: args.destinationCountryCode as string | undefined,
					destinationCityName: args.destinationCityName as string | undefined,
					destinationCityLat: args.destinationCityLat as number | undefined, destinationCityLng: args.destinationCityLng as number | undefined,
					startDate: args.startDate as string | undefined,
					endDate: args.endDate as string | undefined, notes: args.notes as string | undefined,
					tags: Array.isArray(args.tags) ? JSON.stringify(args.tags) : undefined, baseCurrency: args.baseCurrency as string | undefined,
					defaultVisibility: args.defaultVisibility as any, status: args.status as any
				});
				logAudit(userId, 'mcp_trip_create', 'trip', trip.id, { name: trip.name });
				return textResult({ id: trip.id, name: trip.name });
			}
			case 'roamarr_trip_update': {
				if (!hasScope(scopes, 'trips:write')) return scopeError('trips:write');
				const validation = validateToolInput(args as Record<string, unknown>);
				if (!validation.ok) return textResult({ error: validation.error });
				const tripId = Number(args.tripId);
				// Editors of shared trips can update trip metadata, matching
				// the web UI /trips/[id]/edit save action (requireEditableTrip).
				requireEditableTrip(userId, tripId);
				const updated = tripsRepo.updateTrip(tripId, {
					name: args.name as string | undefined,
					destination: args.destination as string | undefined,
					destinationCountryCode: args.destinationCountryCode as string | undefined, destinationCityName: args.destinationCityName as string | undefined,
					destinationCityLat: args.destinationCityLat as number | undefined, destinationCityLng: args.destinationCityLng as number | undefined,
					startDate: args.startDate as string | undefined,
					endDate: args.endDate as string | undefined,
					notes: args.notes as string | undefined, tags: Array.isArray(args.tags) ? JSON.stringify(args.tags) : undefined,
					baseCurrency: args.baseCurrency as string | undefined, defaultVisibility: args.defaultVisibility as any,
					status: args.status as any | undefined
				});
				if (!updated) return textResult({ error: 'Trip not found' });
				logAudit(userId, 'mcp_trip_update', 'trip', tripId, {});
				return textResult({ id: updated.id, name: updated.name, status: updated.status });
			}
			case 'roamarr_day_plan': {
				// Segment creation needs segments:write. Goes through addSegment
				// helper which enforces trip ownership, validates the type,
				// converts local time, creates flight reminders, etc.
				if (!hasScope(scopes, 'segments:write')) return scopeError('segments:write');
				const validation = validateToolInput(args as Record<string, unknown>);
				if (!validation.ok) return { content: [{ type: 'text' as const, text: validation.error }], isError: true };
				const { addSegment } = await import('./segments');
				const seg = addSegment(userId, Number(args.tripId), {
					type: String(args.type ?? 'event') as Parameters<typeof addSegment>[2]['type'],
					title: String(args.title ?? ''),
					localStart: String(args.startAt ?? ''),
					startTz: 'UTC',
					endAt: (args.endAt as string) || undefined,
					cityName: (args.cityName as string) || undefined,
					countryCode: (args.countryCode as string) || undefined
				});
				logAudit(userId, 'mcp_day_plan', 'segment', seg.id, { tripId: seg.tripId });
				return textResult({ id: seg.id, tripId: seg.tripId, type: args.type, title: args.title });
			}
			case 'roamarr_packing_item_add': {
				if (!hasScope(scopes, 'packing:write')) return scopeError('packing:write');
				const tripId = Number(args.tripId);
				const item = addChecklistItem(userId, tripId, String(args.text ?? ''), args.assignedToCompanionId == null ? null : Number(args.assignedToCompanionId));
				logAudit(userId, 'mcp_packing_add', 'trip_checklist_item', Number(item.id), { tripId });
				return textResult({ id: Number(item.id), tripId, text: item.text });
			}
			case 'roamarr_packing_list_build': {
				const tripId = Number(args.tripId);
				if (args.templateId) {
					if (!hasScope(scopes, 'packing:write')) return scopeError('packing:write');
					requireEditableTrip(userId, tripId);
					const { applyTemplate } = await import('./packingTemplates');
					applyTemplate(Number(args.templateId), tripId, userId);
					logAudit(userId, 'mcp_packing_build', 'trip', tripId, { templateId: args.templateId });
				} else {
					if (!hasScope(scopes, 'packing:read')) return scopeError('packing:read');
					requireViewableTrip(userId, tripId);
				}
				const checklist = viewChecklist(tripId);
				return textResult({
					tripId,
					items: checklist.items.map((i) => ({ id: Number(i.id), text: i.text, packed: i.packed, assignedToCompanionId: i.assignedToCompanionId, assignedToName: i.assignedToName }))
				});
			}
			case 'roamarr_budget_set': {
				if (!hasScope(scopes, 'budgets:write')) return scopeError('budgets:write');
				const validation = validateToolInput(args as Record<string, unknown>);
				if (!validation.ok) return textResult({ error: validation.error });
				const tripId = Number(args.tripId);
				requireEditableTrip(userId, tripId);
				setBudget(tripId, args.category as any, Number(args.amount), (args.currency as string) || 'USD');
				logAudit(userId, 'mcp_budget_set', 'trip_budget_category', tripId, {
					category: args.category, amount: args.amount
				});
				return textResult({ ok: true, tripId, category: args.category, amount: args.amount });
			}
			case 'roamarr_budget_update': {
				if (!hasScope(scopes, 'budgets:read')) return scopeError('budgets:read');
				const tripId = Number(args.tripId);
				requireViewableTrip(userId, tripId);
				const { listExpensesForTrip } = await import('./repositories/expensesRepo');
				const expenses = listExpensesForTrip(tripId);
				const budgets = listBudgetsWithSpent(tripId, expenses);
				return textResult({ tripId, budgets });
			}
			case 'roamarr_upcoming_summary': {
				if (!hasScope(scopes, 'trips:read')) return scopeError('trips:read');
				// Include shared trips (matches roamarr_trip_list semantics).
				const all = tripsRepo
					.listViewableTripIdsForUser(userId)
					.map((id) => tripsRepo.getTripById(id))
					.filter((t): t is NonNullable<typeof t> => t !== null);
				const today = new Date().toISOString().slice(0, 10);
				const upcoming = all
					.filter((t) => t.startDate && t.startDate >= today && !t.archived)
					.slice(0, 5);
				return textResult(upcoming.map((t) => ({
					id: t.id, name: t.name, destination: t.destination, startDate: t.startDate
				})));
			}
			case 'roamarr_weather_overview': {
				if (!hasScope(scopes, 'trips:read')) return scopeError('trips:read');
				const { tripWeatherOverview } = await import('./weather');
				return textResult(await tripWeatherOverview(Number(args.tripId), userId));
			}
			case 'roamarr_places_list': {
				if (!hasScope(scopes, 'places:read')) return scopeError('places:read');
				// Ponytail: paginate a flat (kind, code, createdAt) view across
				// both collections so the cursor covers them as one stream.
				const visited = listVisited(userId);
				const flat = [
					...visited.countries.map((p) => ({ kind: 'country' as const, ...p })),
					...visited.usStates.map((p) => ({ kind: 'state' as const, ...p }))
				].sort((a, b) => {
					if (a.createdAt !== b.createdAt) return b.createdAt.localeCompare(a.createdAt);
					return a.code.localeCompare(b.code);
				});
				const page = paginateList(
					flat,
					args,
					(p) => `${p.kind}:${p.code}`
				);
				const items = page.items.map((p) => ({
					kind: p.kind,
					code: p.code,
					visitedOn: p.visitedOn,
					firstVisitedOn: p.firstVisitedOn,
					lastVisitedOn: p.lastVisitedOn,
					source: p.source
				}));
				return textResult({ items, nextCursor: page.nextCursor, });
			}
			case 'roamarr_places_mark': {
				if (!hasScope(scopes, 'places:write')) return scopeError('places:write');
				const kind = args.kind === 'state' ? 'state' : 'country';
				const result = markVisited(userId, kind as any, String(args.code ?? ''), {
					source: 'ai'
				});
				logAudit(userId, 'mcp_places_mark', 'visited_' + kind, userId, {
					code: args.code, created: result.created
				});
				return textResult(result);
			}
			case 'roamarr_places_unmark': {
				if (!hasScope(scopes, 'places:write')) return scopeError('places:write');
				const kind = args.kind === 'state' ? 'state' : 'country';
				const result = unmarkVisited(userId, kind as any, String(args.code ?? ''));
				logAudit(userId, 'mcp_places_unmark', 'visited_' + kind, userId, { code: args.code });
				return textResult(result);
			}
			case 'roamarr_reminder_add': {
				if (!hasScope(scopes, 'reminders:write')) return scopeError('reminders:write');
				if (args.fireAt != null) {
					const { createReminder } = await import('./repositories/remindersRepo');
					const refType = args.reminderType === 'document' ? 'document' : 'trip';
					const refId = args.refId == null ? 0 : Number(args.refId);
					if (!String(args.name ?? '').trim()) return { content: [{ type: 'text' as const, text: 'name is required' }], isError: true };
					if (!Number.isFinite(Date.parse(String(args.fireAt)))) return { content: [{ type: 'text' as const, text: 'fireAt must be a valid ISO date and time' }], isError: true };
					if (refType === 'trip' && refId) requireViewableTrip(userId, refId);
					if (refType === 'document' && refId) { const { getTravelDocumentById } = await import('./repositories/profileRepo'); if (!getTravelDocumentById(refId, userId)) return { content: [{ type: 'text' as const, text: 'Document not found' }], isError: true }; }
					const reminder = createReminder({ userId, kind: 'custom', refType, refId, fireAt: new Date(String(args.fireAt)).toISOString(), name: String(args.name).trim(), description: String(args.description ?? '').trim() || null });
					logAudit(userId, 'mcp_reminder_add', 'reminder', reminder.id, {});
					return textResult({ id: reminder.id });
				}
				const { upsertCustomReminder } = await import('./reminders');
				const tripId = Number(args.tripId);
				const offset = Number(args.offsetMinutes ?? 60);
				// Editors of shared trips can attach their own custom
				// trip-start reminders; the reminder is scoped to userId.
				const t = requireEditableTrip(userId, tripId);
				if (!t.startDate) return textResult({ error: 'Trip has no start date' });
				const startAt = `${t.startDate}T09:00:00Z`;
				upsertCustomReminder(userId, 'trip', tripId, startAt, offset);
				logAudit(userId, 'mcp_reminder_add', 'trip', tripId, { offsetMinutes: offset });
				return textResult({ ok: true, tripId, offsetMinutes: offset });
			}
			// ---- Round 1: trip planning vertical ----
			case 'roamarr_segment_update': {
				if (!hasScope(scopes, 'segments:write')) return scopeError('segments:write');
				const { patchSegment } = await import('./segments');
				const segId = Number(args.segmentId);
				patchSegment(userId, segId, {
					type: args.type as import('$lib/segmentLabels').SegmentType | undefined,
					title: args.title as string | undefined,
					startAt: args.startAt as string | undefined,
					endAt: args.endAt as string | undefined,
					cityName: args.cityName as string | undefined,
					countryCode: args.countryCode as string | undefined,
					paymentStatus: args.paymentStatus as string | undefined
				});
				logAudit(userId, 'mcp_segment_update', 'segment', segId, {});
				return textResult({ ok: true, segmentId: segId });
			}
			case 'roamarr_segment_delete': {
				if (!hasScope(scopes, 'segments:write')) return scopeError('segments:write');
				const confirmErr = requireConfirm(args, 'roamarr_segment_delete');
				if (confirmErr) return confirmErr;
				const { deleteSegment } = await import('./segments');
				const segId = Number(args.segmentId);
				const segRow = segmentsRepo.getSegmentById(segId);
				if (!segRow) return { content: [{ type: 'text' as const, text: 'Segment not found' }], isError: true };
				deleteSegment(userId, segRow.tripId, segId);
				logAudit(userId, 'mcp_segment_delete', 'segment', segId, { tripId: segRow.tripId });
				return textResult({ ok: true, segmentId: segId });
			}
			case 'roamarr_segment_move': {
				if (!hasScope(scopes, 'segments:write')) return scopeError('segments:write');
				const { moveSegmentToDate } = await import('./segments');
				const segId = Number(args.segmentId);
				const segRow = segmentsRepo.getSegmentById(segId);
				if (!segRow) return { content: [{ type: 'text' as const, text: 'Segment not found' }], isError: true };
				// Schema is targetDate (YYYY-MM-DD). The helper preserves time-of-day
				// and shifts only the calendar date. To change time, use
				// roamarr_segment_update.
				const targetDate = String(args.targetDate);
				moveSegmentToDate(userId, segRow.tripId, segId, targetDate);
				logAudit(userId, 'mcp_segment_move', 'segment', segId, { tripId: segRow.tripId, targetDate });
				return textResult({ ok: true, segmentId: segId, targetDate });
			}
			case 'roamarr_segment_status': {
				if (!hasScope(scopes, 'segments:write')) return scopeError('segments:write');
				const { setSegmentStatus } = await import('./segments');
				const segId = Number(args.segmentId);
				const segRow = segmentsRepo.getSegmentById(segId);
				if (!segRow) return { content: [{ type: 'text' as const, text: 'Segment not found' }], isError: true };
				setSegmentStatus(userId, segRow.tripId, segId, String(args.status) as 'planned' | 'checked_in' | 'boarded' | 'arrived' | 'completed');
				logAudit(userId, 'mcp_segment_status', 'segment', segId, { tripId: segRow.tripId, status: args.status });
				return textResult({ ok: true, segmentId: segId, status: args.status });
			}
			case 'roamarr_trip_delete': {
				if (!hasScope(scopes, 'trips:write')) return scopeError('trips:write');
				if (args.confirm !== true) {
					return { content: [{ type: 'text' as const, text: 'confirm: true is required to delete a trip' }], isError: true };
				}
				const tripId = Number(args.tripId);
				// Use the same helper as the web UI: cancels trip + segment
				// reminders, then deletes, then logs trip_delete. MCP logs
				// its own mcp_trip_delete on top for traceability.
				const { _deleteTrip } = await import('../../routes/trips/[id]/edit/+page.server');
				_deleteTrip(userId, tripId);
				logAudit(userId, 'mcp_trip_delete', 'trip', tripId, {});
				return textResult({ ok: true, tripId, deleted: true });
			}
			case 'roamarr_trip_archive': {
				if (!hasScope(scopes, 'trips:write')) return scopeError('trips:write');
				const tripId = Number(args.tripId);
				const t = requireOwnedTrip(userId, tripId);
				tripsRepo.updateTrip(tripId, { archived: !t.archived });
				logAudit(userId, 'mcp_trip_archive', 'trip', tripId, { archived: !t.archived });
				return textResult({ ok: true, tripId, archived: !t.archived });
			}
			case 'roamarr_trip_duplicate': {
				if (!hasScope(scopes, 'trips:write')) return scopeError('trips:write');
				const { duplicateTrip } = await import('../../routes/trips/shared');
				const tripId = Number(args.tripId);
				requireOwnedTrip(userId, tripId);
				const copy = duplicateTrip(userId, tripId);
				logAudit(userId, 'mcp_trip_duplicate', 'trip', copy.id, { sourceTripId: tripId });
				return textResult({ ok: true, sourceTripId: tripId, newTripId: copy.id });
			}
			case 'roamarr_expense_create': {
				if (!hasScope(scopes, 'expenses:write')) return scopeError('expenses:write');
				const { addTripExpense } = await import('./tripExpenses/repository');
				const { toCents, reqString, optString } = await import('./mcpHelpers');
				const tripId = Number(args.tripId);
				requireEditableTrip(userId, tripId);
				const amount = toCents(args.amount, 'amount');
				const result = addTripExpense(userId, tripId, {
					description: reqString(args.description, 'description', 500),
					amount,
					currency: optString(args.currency) ?? 'USD',
					category: optString(args.category),
					exchangeRate: args.exchangeRate != null ? toCents(args.exchangeRate, 'exchangeRate') : undefined,
					baseAmount: args.baseAmount != null ? toCents(args.baseAmount, 'baseAmount') : undefined,
					paidByCompanionId: args.paidByCompanionId != null ? Number(args.paidByCompanionId) : undefined,
					splitAmong: Array.isArray(args.splitAmong)
						? args.splitAmong.map((v) => (v === 'owner' ? 'owner' : Number(v)))
						: undefined
				});
				logAudit(userId, 'mcp_expense_create', 'trip_expense', Number(result.id), { tripId, amount });
				return textResult({ id: Number(result.id), tripId, amount });
			}
			case 'roamarr_expense_list': {
				if (!hasScope(scopes, 'expenses:read')) return scopeError('expenses:read');
				const { listTripExpenses } = await import('./tripExpenses/repository');
				const tripId = Number(args.tripId);
				requireViewableTrip(userId, tripId);
				const all = listTripExpenses(tripId);
				const page = paginateList(all, args, (e) => e.id);
				return textResult({
					tripId,
					items: page.items,
					nextCursor: page.nextCursor,
				});
			}
			case 'roamarr_expense_update': {
				if (!hasScope(scopes, 'expenses:write')) return scopeError('expenses:write');
				const { updateTripExpense } = await import('./tripExpenses/repository');
				const { toCents, optString } = await import('./mcpHelpers');
				const id = Number(args.expenseId);
				const updated = updateTripExpense(userId, id, {
					description: optString(args.description, 500) ?? undefined,
					amount: args.amount != null ? toCents(args.amount, 'amount') : undefined,
					currency: optString(args.currency) ?? undefined,
					category: optString(args.category) ?? undefined, exchangeRate: args.exchangeRate == null ? undefined : Number(args.exchangeRate),
					baseAmount: args.baseAmount == null ? undefined : Number(args.baseAmount),
					paidByCompanionId: args.paidByCompanionId == null ? undefined : Number(args.paidByCompanionId),
					splitAmong: Array.isArray(args.splitAmong) ? args.splitAmong.map((v) => v === 'owner' ? 'owner' : Number(v)) : undefined
				});
				logAudit(userId, 'mcp_expense_update', 'trip_expense', id, {});
				return textResult({ ok: true, expenseId: id, updated });
			}
			case 'roamarr_expense_delete': {
				if (!hasScope(scopes, 'expenses:write')) return scopeError('expenses:write');
				const confirmErr = requireConfirm(args, 'roamarr_expense_delete');
				if (confirmErr) return confirmErr;
				const { deleteTripExpense } = await import('./tripExpenses/repository');
				const id = Number(args.expenseId);
				deleteTripExpense(userId, id);
				logAudit(userId, 'mcp_expense_delete', 'trip_expense', id, {});
				return textResult({ ok: true, expenseId: id });
			}
			case 'roamarr_packing_item_toggle': {
				if (!hasScope(scopes, 'packing:write')) return scopeError('packing:write');
				const { toggleItemById } = await import('./tripChecklists');
				const itemId = Number(args.itemId);
				const updated = toggleItemById(userId, itemId);
				logAudit(userId, 'mcp_packing_toggle', 'trip_checklist_item', itemId, { packed: updated.packed });
				return textResult({ ok: true, itemId, packed: updated.packed });
			}
			case 'roamarr_packing_item_update': {
				if (!hasScope(scopes, 'packing:write')) return scopeError('packing:write');
				const { renameItem } = await import('./tripChecklists');
				const { getChecklistItemTripId, updateChecklistItem } = await import('./repositories/tripMiscRepo');
				const itemId = Number(args.itemId);
				if (args.text != null) renameItem(userId, itemId, String(args.text));
				if (args.assignedToCompanionId !== undefined) {
					const tripId = getChecklistItemTripId(itemId);
					if (tripId == null) throw error(404, 'Item not found');
					requireEditableTrip(userId, tripId);
					const { requireCompanionOnTrip } = await import('./ownership');
					updateChecklistItem(itemId, { assignedToCompanionId: requireCompanionOnTrip(args.assignedToCompanionId == null ? null : Number(args.assignedToCompanionId), tripId) });
				}
				logAudit(userId, 'mcp_packing_update', 'trip_checklist_item', itemId, {});
				return textResult({ ok: true, itemId });
			}
			case 'roamarr_packing_item_delete': {
				if (!hasScope(scopes, 'packing:write')) return scopeError('packing:write');
				const confirmErr = requireConfirm(args, 'roamarr_packing_item_delete');
				if (confirmErr) return confirmErr;
				const { deleteItemById } = await import('./tripChecklists');
				const itemId = Number(args.itemId);
				deleteItemById(userId, itemId);
				logAudit(userId, 'mcp_packing_delete', 'trip_checklist_item', itemId, {});
				return textResult({ ok: true, itemId });
			}
			case 'roamarr_reminder_list': {
				if (!hasScope(scopes, 'reminders:read')) return scopeError('reminders:read');
				const { listRemindersForUser } = await import('./reminders');
				const { listSegmentsForTrip } = await import('./repositories/segmentsRepo');
				const { requireViewableTrip } = await import('./ownership');
				const all = listRemindersForUser(userId);
				// When tripId is given, include trip-level reminders AND
				// segment-level reminders whose segment belongs to that trip.
				const tripId = args.tripId != null ? Number(args.tripId) : null;
				if (tripId != null) requireViewableTrip(userId, tripId);
				const segIds = new Set(tripId != null ? listSegmentsForTrip(tripId).map((s) => s.id) : []);
				const filtered = tripId != null
					? all.filter((r) =>
							(r.refType === 'trip' && r.refId === tripId) ||
							(r.refType === 'segment' && segIds.has(r.refId))
						)
					: all;
				const page = paginateList(filtered, args, (r) => r.id);
				return textResult({
					items: page.items.map((r) => ({
						id: r.id,
						refType: r.refType,
						refId: r.refId,
						kind: r.kind,
						name: r.name,
						description: r.description,
						fireAt: r.fireAt,
						status: r.status
					})),
					nextCursor: page.nextCursor,
				});
			}
			case 'roamarr_reminder_update': {
				if (!hasScope(scopes, 'reminders:write')) return scopeError('reminders:write');
				if (args.fireAt != null || args.name != null || args.description != null || args.refId != null) {
					const { getReminderById, updateReminderUserFields } = await import('./repositories/remindersRepo');
					const id = Number(args.reminderId), reminder = getReminderById(id);
					if (!reminder || reminder.userId !== userId) return { content: [{ type: 'text' as const, text: 'Reminder not found' }], isError: true };
					if (args.fireAt != null && !Number.isFinite(Date.parse(String(args.fireAt)))) return { content: [{ type: 'text' as const, text: 'fireAt must be a valid ISO date and time' }], isError: true };
					const refId = args.refId == null ? reminder.refId : Number(args.refId);
					if (reminder.kind === 'custom' && reminder.refType === 'trip' && refId) requireViewableTrip(userId, refId);
					if (reminder.kind === 'custom' && reminder.refType === 'document' && refId) { const { getTravelDocumentById } = await import('./repositories/profileRepo'); if (!getTravelDocumentById(refId, userId)) return { content: [{ type: 'text' as const, text: 'Document not found' }], isError: true }; }
					updateReminderUserFields(id, { name: args.name == null ? reminder.name : String(args.name).trim() || null, description: args.description == null ? reminder.description : String(args.description).trim() || null, fireAt: args.fireAt == null ? reminder.fireAt : new Date(String(args.fireAt)).toISOString(), refId: reminder.kind === 'custom' ? refId : reminder.refId });
					logAudit(userId, 'mcp_reminder_update', 'reminder', id, {});
					return textResult({ ok: true, reminderId: id });
				}
				const { safeUpdateCustomReminder } = await import('./reminders');
				safeUpdateCustomReminder(userId, Number(args.reminderId), {
					title: args.title as string | undefined,
					customNote: args.customNote as string | undefined,
					offsetMinutes: args.offsetMinutes != null ? Number(args.offsetMinutes) : undefined
				});
				logAudit(userId, 'mcp_reminder_update', 'reminder', Number(args.reminderId), {});
				return textResult({ ok: true, reminderId: Number(args.reminderId) });
			}
			case 'roamarr_reminder_delete': {
				if (!hasScope(scopes, 'reminders:write')) return scopeError('reminders:write');
				const confirmErr = requireConfirm(args, 'roamarr_reminder_delete');
				if (confirmErr) return confirmErr;
				const { cancelReminder } = await import('./reminders');
				cancelReminder(userId, Number(args.reminderId));
				logAudit(userId, 'mcp_reminder_delete', 'reminder', Number(args.reminderId), {});
				return textResult({ ok: true, reminderId: Number(args.reminderId) });
			}
			// ---- Round 2: wallet, sharing, calendar, contacts, profile ----
			case 'roamarr_card_list': {
				if (!hasScope(scopes, 'cards:read')) return scopeError('cards:read');
				const { listCards } = await import('./repositories/profileRepo');
				const cards = listCards(userId);
				const page = paginateList(cards, args, (c) => c.id);
				return textResult({
					items: page.items.map((c) => projectCard(c)),
					nextCursor: page.nextCursor,
				});
			}
			case 'roamarr_card_create': {
				if (!hasScope(scopes, 'cards:write')) return scopeError('cards:write');
				const { createCard } = await import('./repositories/profileRepo');
				// last4 must be exactly 4 digits. The MCP interface is
				// last4-only; never pass a full PAN.
				const last4Raw = String(args.last4 ?? '');
				if (!/^\d{4}$/.test(last4Raw)) {
					return { content: [{ type: 'text' as const, text: 'last4 must be exactly 4 digits' }], isError: true };
				}
				const c = createCard(userId, { network: String(args.network), last4: last4Raw, nickname: String(args.label ?? '') });
				logAudit(userId, 'mcp_card_create', 'card', c.id, {});
				return textResult({ id: c.id });
			}
			case 'roamarr_card_update': {
				if (!hasScope(scopes, 'cards:write')) return scopeError('cards:write');
				const { updateCard, getCardById } = await import('./repositories/profileRepo');
				const id = Number(args.cardId);
				const existing = getCardById(id, userId);
				if (!existing) return { content: [{ type: 'text' as const, text: 'Card not found' }], isError: true };
				// updateCard is a full-row replace; carry over notes so a
				// partial update (e.g. renaming) does not wipe them.
				updateCard(id, userId, {
					network: existing.network,
					last4: existing.last4,
					nickname: String(args.label ?? existing.nickname),
					notes: existing.notes
				});
				logAudit(userId, 'mcp_card_update', 'card', id, {});
				return textResult({ ok: true, cardId: id });
			}
			case 'roamarr_card_delete': {
				if (!hasScope(scopes, 'cards:write')) return scopeError('cards:write');
				const confirmErr = requireConfirm(args, 'roamarr_card_delete');
				if (confirmErr) return confirmErr;
				const { deleteCard, getCardById } = await import('./repositories/profileRepo');
				const id = Number(args.cardId);
				if (!getCardById(id, userId)) return { content: [{ type: 'text' as const, text: 'Card not found' }], isError: true };
				deleteCard(id, userId);
				logAudit(userId, 'mcp_card_delete', 'card', id, {});
				return textResult({ ok: true, cardId: id });
			}
			case 'roamarr_loyalty_list': {
				if (!hasScope(scopes, 'loyalty:read')) return scopeError('loyalty:read');
				const { listLoyaltyPrograms } = await import('./repositories/profileRepo');
				const programs = listLoyaltyPrograms(userId);
				const page = paginateList(programs, args, (l) => l.id);
				return textResult({
					items: page.items.map((l) => projectLoyalty(l)),
					nextCursor: page.nextCursor,
				});
			}
			case 'roamarr_loyalty_create': {
				if (!hasScope(scopes, 'loyalty:write')) return scopeError('loyalty:write');
				const { createLoyaltyProgram } = await import('./repositories/profileRepo');
				const l = createLoyaltyProgram(userId, {
					programName: String(args.programName ?? ''),
					membershipNumber: (args.memberNumber as string) ?? null
				});
				logAudit(userId, 'mcp_loyalty_create', 'loyalty_program', l.id, {});
				return textResult({ id: l.id });
			}
			case 'roamarr_loyalty_update': {
				if (!hasScope(scopes, 'loyalty:write')) return scopeError('loyalty:write');
				const { updateLoyaltyProgram, getLoyaltyProgramById } = await import('./repositories/profileRepo');
				const id = Number(args.loyaltyId);
				const existing = getLoyaltyProgramById(id, userId);
				if (!existing) return { content: [{ type: 'text' as const, text: 'Loyalty program not found' }], isError: true };
				// updateLoyaltyProgram is a full-row replace; carry over
				// balance and notes so a partial update does not wipe the
				// tracked points balance or reset balance_updated_at.
				updateLoyaltyProgram(id, userId, {
					programName: (args.programName as string) ?? existing.programName,
					membershipNumber: (args.memberNumber as string) ?? existing.membershipNumber,
					balance: existing.balance,
					notes: existing.notes
				});
				logAudit(userId, 'mcp_loyalty_update', 'loyalty_program', id, {});
				return textResult({ ok: true, loyaltyId: id });
			}
			case 'roamarr_loyalty_delete': {
				if (!hasScope(scopes, 'loyalty:write')) return scopeError('loyalty:write');
				const confirmErr = requireConfirm(args, 'roamarr_loyalty_delete');
				if (confirmErr) return confirmErr;
				const { deleteLoyaltyProgram, getLoyaltyProgramById } = await import('./repositories/profileRepo');
				const id = Number(args.loyaltyId);
				if (!getLoyaltyProgramById(id, userId)) return { content: [{ type: 'text' as const, text: 'Loyalty program not found' }], isError: true };
				deleteLoyaltyProgram(id, userId);
				logAudit(userId, 'mcp_loyalty_delete', 'loyalty_program', id, {});
				return textResult({ ok: true, loyaltyId: id });
			}
			case 'roamarr_insurance_list': {
				if (!hasScope(scopes, 'insurance:read')) return scopeError('insurance:read');
				const { listInsurancePolicies } = await import('./repositories/profileRepo');
				const policies = listInsurancePolicies(userId);
				const page = paginateList(policies, args, (p) => p.id);
				return textResult({
					items: page.items.map((p) => projectInsurance(p)),
					nextCursor: page.nextCursor,
				});
			}
			case 'roamarr_insurance_create': {
				if (!hasScope(scopes, 'insurance:write')) return scopeError('insurance:write');
				const { createInsurancePolicy } = await import('./repositories/profileRepo');
				const p = createInsurancePolicy(userId, {
					provider: String(args.provider ?? ''),
					policyNumber: (args.policyNumber as string) ?? null,
					coverageSummary: (args.coverageType as string) ?? null,
					notes: (args.notes as string) ?? null
				});
				logAudit(userId, 'mcp_insurance_create', 'insurance_policy', p.id, {});
				return textResult({ id: p.id });
			}
			case 'roamarr_insurance_update': {
				if (!hasScope(scopes, 'insurance:write')) return scopeError('insurance:write');
				const { updateInsurancePolicy, getInsurancePolicyById } = await import('./repositories/profileRepo');
				const id = Number(args.insuranceId);
				const existing = getInsurancePolicyById(id, userId);
				if (!existing) return { content: [{ type: 'text' as const, text: 'Insurance not found' }], isError: true };
				// updateInsurancePolicy is a full-row replace; carry over
				// coverage / date / trip linkage so a partial update does
				// not silently wipe coverage details or detach the policy.
				updateInsurancePolicy(id, userId, {
					provider: (args.provider as string) ?? existing.provider,
					policyNumber: (args.policyNumber as string) ?? existing.policyNumber ?? null,
					coverageSummary: existing.coverageSummary,
					coverageAmount: existing.coverageAmount,
					currency: existing.currency,
					startDate: existing.startDate,
					endDate: existing.endDate,
					tripId: existing.tripId,
					notes: (args.notes as string) ?? existing.notes ?? null
				});
				logAudit(userId, 'mcp_insurance_update', 'insurance_policy', id, {});
				return textResult({ ok: true, insuranceId: id });
			}
			case 'roamarr_insurance_delete': {
				if (!hasScope(scopes, 'insurance:write')) return scopeError('insurance:write');
				const confirmErr = requireConfirm(args, 'roamarr_insurance_delete');
				if (confirmErr) return confirmErr;
				const { deleteInsurancePolicy, getInsurancePolicyById } = await import('./repositories/profileRepo');
				const id = Number(args.insuranceId);
				if (!getInsurancePolicyById(id, userId)) return { content: [{ type: 'text' as const, text: 'Insurance not found' }], isError: true };
				deleteInsurancePolicy(id, userId);
				logAudit(userId, 'mcp_insurance_delete', 'insurance_policy', id, {});
				return textResult({ ok: true, insuranceId: id });
			}
			case 'roamarr_travel_doc_list': {
				if (!hasScope(scopes, 'travel-docs:read')) return scopeError('travel-docs:read');
				const { listTravelDocuments } = await import('./repositories/profileRepo');
				const docs = listTravelDocuments(userId);
				const page = paginateList(docs, args, (d) => d.id);
				return textResult({
					items: page.items.map((d) => projectTravelDocument(d)),
					nextCursor: page.nextCursor,
				});
			}
			case 'roamarr_travel_doc_create': {
				if (!hasScope(scopes, 'travel-docs:write')) return scopeError('travel-docs:write');
				const { createTravelDocument } = await import('./repositories/profileRepo');
				const d = createTravelDocument(userId, {
					type: String(args.type) as 'passport' | 'drivers_license' | 'global_entry' | 'visa',
					issuingAuthority: (args.issuer as string) ?? null,
					number: (args.number as string) ?? null,
					expiresOn: (args.expiresOn as string) ?? null
				});
				logAudit(userId, 'mcp_travel_doc_create', 'travel_document', d.id, {});
				return textResult({ id: d.id });
			}
			case 'roamarr_travel_doc_update': {
				if (!hasScope(scopes, 'travel-docs:write')) return scopeError('travel-docs:write');
				const { updateTravelDocument, getTravelDocumentById } = await import('./repositories/profileRepo');
				const id = Number(args.docId);
				const existing = getTravelDocumentById(id, userId);
				if (!existing) return { content: [{ type: 'text' as const, text: 'Document not found' }], isError: true };
				// updateTravelDocument is a full-row replace; carry over
				// notes and companionId so a partial update does not wipe
				// user notes or detach the document from its companion.
				updateTravelDocument(id, userId, {
					type: existing.type,
					issuingAuthority: (args.issuer as string) ?? existing.issuingAuthority,
					number: (args.number as string) ?? existing.number,
					expiresOn: (args.expiresOn as string) ?? existing.expiresOn,
					notes: existing.notes,
					companionId: existing.companionId
				});
				logAudit(userId, 'mcp_travel_doc_update', 'travel_document', id, {});
				return textResult({ ok: true, docId: id });
			}
			case 'roamarr_travel_doc_delete': {
				if (!hasScope(scopes, 'travel-docs:write')) return scopeError('travel-docs:write');
				const confirmErr = requireConfirm(args, 'roamarr_travel_doc_delete');
				if (confirmErr) return confirmErr;
				const { deleteTravelDocument, getTravelDocumentById } = await import('./repositories/profileRepo');
				const id = Number(args.docId);
				if (!getTravelDocumentById(id, userId)) return { content: [{ type: 'text' as const, text: 'Document not found' }], isError: true };
				deleteTravelDocument(id, userId);
				logAudit(userId, 'mcp_travel_doc_delete', 'travel_document', id, {});
				return textResult({ ok: true, docId: id });
			}
			case 'roamarr_doc_link_list': {
				if (!hasScope(scopes, 'doc-links:read')) return scopeError('doc-links:read');
				const { listDocumentLinksForTrip } = await import('./repositories/tripMiscRepo');
				const tripId = Number(args.tripId);
				requireViewableTrip(userId, tripId);
				const links = listDocumentLinksForTrip(tripId);
				const page = paginateList(links, args, (l) => l.id);
				return textResult({
					tripId,
					items: page.items,
					nextCursor: page.nextCursor,
				});
			}
			case 'roamarr_doc_link_create': {
				if (!hasScope(scopes, 'doc-links:write')) return scopeError('doc-links:write');
				const { createDocumentLink } = await import('./tripDocumentLinks');
				const tripId = Number(args.tripId);
				// Helper enforces ownership + URL validation + audit log.
				const link = createDocumentLink(userId, tripId, {
					label: String(args.label ?? ''),
					url: String(args.url ?? ''),
					notes: (args.notes as string) ?? null
				});
				logAudit(userId, 'mcp_doc_link_create', 'trip_document_link', link.id, { tripId });
				return textResult({ id: link.id, tripId });
			}
			case 'roamarr_doc_link_update': {
				if (!hasScope(scopes, 'doc-links:write')) return scopeError('doc-links:write');
				const { editDocumentLink } = await import('./tripDocumentLinks');
				const { getDocumentLinkById } = await import('./repositories/tripMiscRepo');
				const id = Number(args.linkId);
				const existing = getDocumentLinkById(id);
				if (!existing) return { content: [{ type: 'text' as const, text: 'Link not found' }], isError: true };
				editDocumentLink(userId, existing.tripId, id, {
					label: String(args.label ?? existing.label),
					url: String(args.url ?? ''),
					notes: (args.notes as string) ?? existing.notes ?? null
				});
				logAudit(userId, 'mcp_doc_link_update', 'trip_document_link', id, {});
				return textResult({ ok: true, linkId: id });
			}
			case 'roamarr_doc_link_delete': {
				if (!hasScope(scopes, 'doc-links:write')) return scopeError('doc-links:write');
				const confirmErr = requireConfirm(args, 'roamarr_doc_link_delete');
				if (confirmErr) return confirmErr;
				const { deleteDocumentLink, getDocumentLinkById } = await import('./repositories/tripMiscRepo');
				const id = Number(args.linkId);
				const existing = getDocumentLinkById(id);
				if (!existing) return { content: [{ type: 'text' as const, text: 'Link not found' }], isError: true };
				requireEditableTrip(userId, existing.tripId);
				deleteDocumentLink(id);
				logAudit(userId, 'mcp_doc_link_delete', 'trip_document_link', id, {});
				return textResult({ ok: true, linkId: id });
			}
			case 'roamarr_share_list': {
				if (!hasScope(scopes, 'sharing:read')) return scopeError('sharing:read');
				const { listSharesForTrip } = await import('./repositories/tripsRepo');
				const tripId = Number(args.tripId);
				requireOwnedTrip(userId, tripId);
				return textResult({ tripId, items: listSharesForTrip(tripId) });
			}
			case 'roamarr_share_create': {
				if (!hasScope(scopes, 'sharing:write')) return scopeError('sharing:write');
				const { createShare } = await import('./repositories/tripsRepo');
				const { getUserByEmail } = await import('./repositories/usersRepo');
				const { normalizeEmail } = await import('./users');
				const tripId = Number(args.tripId);
				requireOwnedTrip(userId, tripId);
				const kind = String(args.kind);
				let sharedWithUserId: number | null = null;
				let sharedWithGroupId: number | null = null;
				if (kind === 'user') {
					const u = args.email ? getUserByEmail(normalizeEmail(String(args.email))) : null;
					if (!u) return { content: [{ type: 'text' as const, text: 'User not found' }], isError: true };
					sharedWithUserId = Number(u.id);
				} else if (kind === 'group') {
					const gid = Number(args.groupId);
					// IDOR: caller must own the group before sharing a trip to it.
					requireOwnedGroup(userId, gid);
					sharedWithGroupId = gid;
				} else if (kind === 'public') {
					// Public share mints a per-trip public token via the
					// existing helper. The web UI does the same.
					const { _mintPublicToken } = await import('../../routes/trips/[id]/share/+page.server');
					const publicShowDetails = args.showDetails != null ? Boolean(args.showDetails) : false;
					const token = _mintPublicToken(userId, tripId, publicShowDetails, null);
					logAudit(userId, 'mcp_share_create', 'trip', tripId, { kind: 'public' });
					return textResult({ kind: 'public', tripId, publicToken: token });
				} else {
					return { content: [{ type: 'text' as const, text: `Unknown share kind: ${kind}` }], isError: true };
				}
				const share = createShare({
					tripId,
					sharedWithUserId,
					sharedWithGroupId,
					permission: (args.permission as any) ?? 'read',
					showDetails: args.showDetails != null ? Boolean(args.showDetails) : false
				});
				logAudit(userId, 'mcp_share_create', 'trip_share', share.id, { tripId });
				return textResult({ id: share.id, tripId });
			}
			case 'roamarr_share_update': {
				if (!hasScope(scopes, 'sharing:write')) return scopeError('sharing:write');
				const { updateShare, getShareById } = await import('./repositories/tripsRepo');
				const id = Number(args.shareId);
				const existing = getShareById(id);
				if (!existing) return { content: [{ type: 'text' as const, text: 'Share not found' }], isError: true };
				requireOwnedTrip(userId, existing.tripId);
				updateShare(id, {
					permission: (args.permission as any) ?? undefined,
					showDetails: args.showDetails != null ? Boolean(args.showDetails) : undefined
				});
				logAudit(userId, 'mcp_share_update', 'trip_share', id, {});
				return textResult({ ok: true, shareId: id });
			}
			case 'roamarr_share_revoke': {
				if (!hasScope(scopes, 'sharing:write')) return scopeError('sharing:write');
				const confirmErr = requireConfirm(args, 'roamarr_share_revoke');
				if (confirmErr) return confirmErr;
				const { deleteShare, getShareById } = await import('./repositories/tripsRepo');
				const id = Number(args.shareId);
				const existing = getShareById(id);
				if (!existing) return { content: [{ type: 'text' as const, text: 'Share not found' }], isError: true };
				requireOwnedTrip(userId, existing.tripId);
				deleteShare(id);
				logAudit(userId, 'mcp_share_revoke', 'trip_share', id, {});
				return textResult({ ok: true, shareId: id });
			}
			case 'roamarr_group_list': {
				if (!hasScope(scopes, 'sharing:read')) return scopeError('sharing:read');
				const { listGroupsForUser } = await import('./sharing');
				return textResult({ items: listGroupsForUser(userId) });
			}
			case 'roamarr_group_create': {
				if (!hasScope(scopes, 'sharing:write')) return scopeError('sharing:write');
				const { createGroup } = await import('./repositories/tripsRepo');
				const g = createGroup({ ownerId: userId, name: String(args.name ?? '') });
				logAudit(userId, 'mcp_group_create', 'group', g.id, {});
				return textResult({ id: g.id, name: g.name });
			}
			case 'roamarr_group_member_add': {
				if (!hasScope(scopes, 'sharing:write')) return scopeError('sharing:write');
				const { addGroupMember } = await import('./repositories/tripsRepo');
				const { getUserByEmail } = await import('./repositories/usersRepo');
				const { normalizeEmail } = await import('./users');
				const { requireOwnedGroup } = await import('./ownership');
				const groupId = Number(args.groupId);
				// IDOR: caller must own the group.
				requireOwnedGroup(userId, groupId);
				const u = args.email ? getUserByEmail(normalizeEmail(String(args.email))) : null;
				if (!u) return { content: [{ type: 'text' as const, text: 'User not found' }], isError: true };
				addGroupMember(groupId, Number(u.id));
				logAudit(userId, 'mcp_group_member_add', 'group', groupId, { userId: Number(u.id) });
				return textResult({ ok: true, groupId, userId: Number(u.id) });
			}
			case 'roamarr_group_member_remove': {
				if (!hasScope(scopes, 'sharing:write')) return scopeError('sharing:write');
				const confirmErr = requireConfirm(args, 'roamarr_group_member_remove');
				if (confirmErr) return confirmErr;
				const { removeGroupMember } = await import('./repositories/tripsRepo');
				const { requireOwnedGroup } = await import('./ownership');
				const groupId = Number(args.groupId);
				// IDOR: caller must own the group.
				requireOwnedGroup(userId, groupId);
				const targetUserId = Number(args.userId);
				const n = removeGroupMember(groupId, targetUserId);
				if (n === 0) return { content: [{ type: 'text' as const, text: 'Member not in group' }], isError: true };
				logAudit(userId, 'mcp_group_member_remove', 'group', groupId, { userId: targetUserId });
				return textResult({ ok: true, groupId, userId: targetUserId });
			}
			case 'roamarr_calendar_rotate_token': {
				if (!hasScope(scopes, 'calendar:write')) return scopeError('calendar:write');
				const { regenerateCalendarToken } = await import('../../routes/trips/shared');
				const tripId = Number(args.tripId);
				requireOwnedTrip(userId, tripId);
				regenerateCalendarToken(userId, tripId);
				logAudit(userId, 'mcp_calendar_rotate_token', 'trip', tripId, {});
				return textResult({ ok: true, tripId });
			}
			case 'roamarr_contact_list': {
				if (!hasScope(scopes, 'contacts:read')) return scopeError('contacts:read');
				const { listEmergencyContacts } = await import('./repositories/profileRepo');
				return textResult({ items: listEmergencyContacts(userId) });
			}
			case 'roamarr_contact_create': {
				if (!hasScope(scopes, 'contacts:write')) return scopeError('contacts:write');
				const { createEmergencyContact } = await import('./repositories/profileRepo');
				const c = createEmergencyContact(userId, {
					name: String(args.name ?? ''),
					relationship: (args.relationship as string) ?? null,
					phone: (args.phone as string) ?? null,
					email: (args.email as string) ?? null,
					isPrimary: Boolean(args.isPrimary)
				});
				logAudit(userId, 'mcp_contact_create', 'emergency_contact', c.id, {});
				return textResult({ id: c.id });
			}
			case 'roamarr_contact_update': {
				if (!hasScope(scopes, 'contacts:write')) return scopeError('contacts:write');
				const { updateEmergencyContact, getEmergencyContactById } = await import('./repositories/profileRepo');
				const id = Number(args.contactId);
				const existing = getEmergencyContactById(id, userId);
				if (!existing) return { content: [{ type: 'text' as const, text: 'Contact not found' }], isError: true };
				// updateEmergencyContact is a full-row replace (it always sets
				// relationship/phone/email/isPrimary). Merge from existing so
				// omitted args preserve the current values instead of being
				// wiped to null / demoted from primary.
				updateEmergencyContact(id, userId, {
					name: (args.name as string) ?? existing.name,
					relationship: (args.relationship as string) ?? existing.relationship,
					phone: (args.phone as string) ?? existing.phone,
					email: (args.email as string) ?? existing.email,
					isPrimary: args.isPrimary == null ? existing.isPrimary : Boolean(args.isPrimary)
				});
				logAudit(userId, 'mcp_contact_update', 'emergency_contact', id, {});
				return textResult({ ok: true, contactId: id });
			}
			case 'roamarr_contact_delete': {
				if (!hasScope(scopes, 'contacts:write')) return scopeError('contacts:write');
				const confirmErr = requireConfirm(args, 'roamarr_contact_delete');
				if (confirmErr) return confirmErr;
				const { deleteEmergencyContact, getEmergencyContactById } = await import('./repositories/profileRepo');
				const id = Number(args.contactId);
				if (!getEmergencyContactById(id, userId)) return { content: [{ type: 'text' as const, text: 'Contact not found' }], isError: true };
				deleteEmergencyContact(id, userId);
				logAudit(userId, 'mcp_contact_delete', 'emergency_contact', id, {});
				return textResult({ ok: true, contactId: id });
			}
			case 'roamarr_profile_get': {
				if (!hasScope(scopes, 'profile-prefs:read')) return scopeError('profile-prefs:read');
				const { getUserById } = await import('./repositories/usersRepo');
				const u = getUserById(userId);
				if (!u) return { content: [{ type: 'text' as const, text: 'User not found' }], isError: true };
				return textResult({
					role: u.role,
					displayName: u.display_name,
					timezone: u.timezone,
					defaultCurrency: u.default_currency,
					flightCheckinLeadHours: Number(u.flight_checkin_lead_hours),
					documentExpiryLeadDays: Number(u.document_expiry_lead_days),
					themeId: u.theme_id
				});
			}
			case 'roamarr_profile_update': {
				if (!hasScope(scopes, 'profile-prefs:write')) return scopeError('profile-prefs:write');
				const { updateUser, getUserById } = await import('./repositories/usersRepo');
				// updateUser is a full-row set: undefined fields become NULL
				// in the kit. Read the existing user and merge so omitted
				// fields are preserved.
				const existing = getUserById(userId);
				if (!existing) return { content: [{ type: 'text' as const, text: 'User not found' }], isError: true };
				// Validate integers inline; do not round-trip through Number +
				// BigInt (precision loss for large ints). Lead hours/days are
				// small in practice but enforce bounds to be safe.
				let leadHours: bigint | undefined;
				if (args.flightCheckinLeadHours != null) {
					const v = Number(args.flightCheckinLeadHours);
					if (!Number.isInteger(v) || v < 0 || v > 168) {
						return { content: [{ type: 'text' as const, text: 'flightCheckinLeadHours must be an integer 0-168' }], isError: true };
					}
					leadHours = BigInt(v);
				}
				let expiryDays: bigint | undefined;
				if (args.documentExpiryLeadDays != null) {
					const v = Number(args.documentExpiryLeadDays);
					if (!Number.isInteger(v) || v < 0 || v > 3650) {
						return { content: [{ type: 'text' as const, text: 'documentExpiryLeadDays must be an integer 0-3650' }], isError: true };
					}
					expiryDays = BigInt(v);
				}
				updateUser(userId, {
					display_name: (args.displayName as string | undefined)?.trim() || existing.display_name,
					timezone: (args.timezone as string | undefined) ?? existing.timezone,
					default_currency: (args.defaultCurrency as string | undefined) ?? existing.default_currency,
					flight_checkin_lead_hours: leadHours ?? existing.flight_checkin_lead_hours,
					document_expiry_lead_days: expiryDays ?? existing.document_expiry_lead_days,
					theme_id: (args.themeId as string | undefined) ?? existing.theme_id
				});
				logAudit(userId, 'mcp_profile_update', 'user', userId, {});
				return textResult({ ok: true });
			}
			case 'roamarr_notification_channels_get': {
				if (!hasScope(scopes, 'notifications:read')) return scopeError('notifications:read');
				const { getUserById } = await import('./repositories/usersRepo');
				const u = getUserById(userId);
				if (!u) return { content: [{ type: 'text' as const, text: 'User not found' }], isError: true };
				return textResult({
					emailNotifications: Boolean(u.email_notifications),
					webhookNotifications: Boolean(u.webhook_notifications)
				});
			}
			case 'roamarr_notification_channels_update': {
				if (!hasScope(scopes, 'notifications:write')) return scopeError('notifications:write');
				const { updateUser } = await import('./repositories/usersRepo');
				// updateUser's patch treats explicit `undefined` as SQL NULL
				// (the kit merges {...existing, ...patch} then stores null for
				// undefined cells). Only set keys the caller actually supplied
				// so a single-channel update does not null the other column.
				const patch: Record<string, unknown> = {};
				if (args.emailNotifications != null) patch.email_notifications = Boolean(args.emailNotifications);
				if (args.webhookNotifications != null) patch.webhook_notifications = Boolean(args.webhookNotifications);
				if (Object.keys(patch).length === 0) {
					return textResult({ ok: true, unchanged: true });
				}
				updateUser(userId, patch);
				logAudit(userId, 'mcp_notification_channels_update', 'user', userId, patch);
				return textResult({ ok: true });
			}
			case 'roamarr_user_smtp_get': {
				if (!hasScope(scopes, 'user-smtp:read')) return scopeError('user-smtp:read');
				const { getUserSmtpOverride } = await import('./smtpConfig');
				const o = getUserSmtpOverride(userId);
				if (!o) return textResult({ configured: false });
				return textResult({ configured: true, host: o.host, port: o.port, username: o.username, fromAddress: o.fromAddress, security: o.security });
			}
			case 'roamarr_user_smtp_set': {
				if (!hasScope(scopes, 'user-smtp:write')) return scopeError('user-smtp:write');
				const { upsertUserSmtpOverride } = await import('./smtpConfig');
				// Validate port + security upfront; the helper takes its own
				// patch shape and `undefined` password means "keep existing".
				const port = Number(args.port);
				if (!Number.isInteger(port) || port < 1 || port > 65535) {
					return { content: [{ type: 'text' as const, text: 'port must be 1-65535' }], isError: true };
				}
				const security = String(args.security ?? 'starttls');
				if (security !== 'none' && security !== 'starttls' && security !== 'ssl/tls') {
					return { content: [{ type: 'text' as const, text: 'security must be none|starttls|ssl/tls' }], isError: true };
				}
				upsertUserSmtpOverride(userId, {
					host: String(args.host),
					port,
					username: String(args.username),
					// undefined → keep saved password; explicit string → set.
					password: args.password === undefined ? undefined : String(args.password),
					fromAddress: String(args.fromAddress),
					security
				});
				logAudit(userId, 'mcp_user_smtp_set', 'user_smtp_override', userId, {});
				return textResult({ ok: true });
			}
			case 'roamarr_user_smtp_clear': {
				if (!hasScope(scopes, 'user-smtp:write')) return scopeError('user-smtp:write');
				const confirmErr = requireConfirm(args, 'roamarr_user_smtp_clear');
				if (confirmErr) return confirmErr;
				const { deleteUserSmtpOverride } = await import('./smtpConfig');
				deleteUserSmtpOverride(userId);
				logAudit(userId, 'mcp_user_smtp_clear', 'user_smtp_override', userId, {});
				return textResult({ ok: true });
			}
			// ---- Round 3: templates, companions, polls, journal, home-tasks, medications, important-items, entry-requirements, comments, search ----
			case 'roamarr_packing_template_list': {
				if (!hasScope(scopes, 'templates:read')) return scopeError('templates:read');
				const { listTemplates } = await import('./packingTemplates');
				return textResult({ items: listTemplates(userId) });
			}
			case 'roamarr_packing_template_create': {
				if (!hasScope(scopes, 'templates:write')) return scopeError('templates:write');
				const { saveTemplate } = await import('./packingTemplates');
				const id = saveTemplate(userId, String(args.name ?? ''), [], Number(args.sourceTripId));
				logAudit(userId, 'mcp_packing_template_create', 'packing_template', id, {});
				return textResult({ id });
			}
			case 'roamarr_packing_template_delete': {
				if (!hasScope(scopes, 'templates:write')) return scopeError('templates:write');
				const confirmErr = requireConfirm(args, 'roamarr_packing_template_delete');
				if (confirmErr) return confirmErr;
				const { deletePackingTemplateForUser } = await import('./repositories/templatesRepo');
				// Owner-scoped delete prevents IDOR: only the template's
				// owner can remove it.
				const id = Number(args.templateId);
				const n = deletePackingTemplateForUser(id, userId);
				if (n === 0) return { content: [{ type: 'text' as const, text: 'Template not found' }], isError: true };
				logAudit(userId, 'mcp_packing_template_delete', 'packing_template', id, {});
				return textResult({ ok: true, templateId: Number(args.templateId) });
			}
			case 'roamarr_trip_template_list': {
				if (!hasScope(scopes, 'templates:read')) return scopeError('templates:read');
				const { listTripTemplates } = await import('./repositories/templatesRepo');
				return textResult({ items: listTripTemplates(userId) });
			}
			case 'roamarr_trip_template_create': {
				if (!hasScope(scopes, 'templates:write')) return scopeError('templates:write');
				const { saveTripTemplate } = await import('./tripTemplates');
				const t = saveTripTemplate(userId, Number(args.sourceTripId), String(args.name ?? ''));
				logAudit(userId, 'mcp_trip_template_create', 'trip_template', t.id, {});
				return textResult({ id: t.id });
			}
			case 'roamarr_trip_template_apply': {
				if (!hasScope(scopes, 'templates:write')) return scopeError('templates:write');
				// Look up the trip_template row (NOT the trips table — the
				// previous impl passed templateId to tripsRepo.getTripById,
				// which silently ignored templates and duplicated whatever
				// trip happened to share the id). Verify the caller owns the
				// template before applying it; duplicateTrip then re-checks
				// ownership of the source trip referenced by the template.
				const { getTripTemplateById } = await import('./repositories/templatesRepo');
				const tpl = getTripTemplateById(Number(args.templateId));
				if (!tpl) return { content: [{ type: 'text' as const, text: 'Template not found' }], isError: true };
				if (tpl.userId !== userId) return { content: [{ type: 'text' as const, text: 'Template not found' }], isError: true };
				if (tpl.sourceTripId == null) {
					return { content: [{ type: 'text' as const, text: 'Template has no source trip to apply' }], isError: true };
				}
				const { createTripFromTemplate } = await import('./tripTemplates');
				const copy = createTripFromTemplate(userId, tpl.id, {});
				logAudit(userId, 'mcp_trip_template_apply', 'trip', copy.id, { templateId: tpl.id, sourceTripId: tpl.sourceTripId });
				return textResult({ newTripId: copy.id, name: copy.name });
			}
			case 'roamarr_trip_template_delete': {
				if (!hasScope(scopes, 'templates:write')) return scopeError('templates:write');
				const confirmErr = requireConfirm(args, 'roamarr_trip_template_delete');
				if (confirmErr) return confirmErr;
				const { deleteTripTemplateForUser } = await import('./repositories/templatesRepo');
				const id = Number(args.templateId);
				const n = deleteTripTemplateForUser(id, userId);
				if (n === 0) return { content: [{ type: 'text' as const, text: 'Template not found' }], isError: true };
				logAudit(userId, 'mcp_trip_template_delete', 'trip_template', id, {});
				return textResult({ ok: true, templateId: Number(args.templateId) });
			}
			case 'roamarr_companion_list': {
				if (!hasScope(scopes, 'companions:read')) return scopeError('companions:read');
				const { listTripCompanions } = await import('./tripCompanions');
				const tripId = Number(args.tripId);
				requireViewableTrip(userId, tripId);
				return textResult({ tripId, items: listTripCompanions(tripId) });
			}
			case 'roamarr_companion_create': {
				if (!hasScope(scopes, 'companions:write')) return scopeError('companions:write');
				const { insertTripCompanion } = await import('./tripCompanions');
				const tripId = Number(args.tripId);
				requireEditableTrip(userId, tripId);
				const c = insertTripCompanion(userId, tripId, {
					name: String(args.name ?? ''),
					category: (args.category as CompanionCategory) ?? 'adult',
					dietary: (args.dietary as string) ?? undefined, allergies: (args.allergies as string) ?? undefined,
					medicalNotes: (args.medicalNotes as string) ?? undefined, needsCarSeat: Boolean(args.needsCarSeat),
					needsStroller: Boolean(args.needsStroller), needsCrib: Boolean(args.needsCrib), needsKidsMeal: Boolean(args.needsKidsMeal),
					childTicketDiscount: (args.childTicketDiscount as string) ?? undefined, seatPreference: (args.seatPreference as string) ?? undefined,
					bedPreference: (args.bedPreference as string) ?? undefined, accessibilityNeeds: (args.accessibilityNeeds as string) ?? undefined,
					roomNotes: (args.roomNotes as string) ?? undefined, notes: (args.notes as string) ?? undefined
				});
				logAudit(userId, 'mcp_companion_create', 'trip_companion', c.id, { tripId });
				return textResult({ id: c.id });
			}
			case 'roamarr_companion_update': {
				if (!hasScope(scopes, 'companions:write')) return scopeError('companions:write');
				const { getCompanionTripId, patchTripCompanion } = await import('./tripCompanions');
				const id = Number(args.companionId);
				const tripId = getCompanionTripId(id);
				if (tripId == null) return { content: [{ type: 'text' as const, text: 'Companion not found' }], isError: true };
				requireEditableTrip(userId, tripId);
				patchTripCompanion(userId, tripId, id, {
					name: (args.name as string) ?? undefined,
					category: (args.category as CompanionCategory) ?? undefined,
					dietary: (args.dietary as string) ?? undefined, allergies: (args.allergies as string) ?? undefined,
					medicalNotes: (args.medicalNotes as string) ?? undefined,
					needsCarSeat: args.needsCarSeat as boolean | undefined, needsStroller: args.needsStroller as boolean | undefined,
					needsCrib: args.needsCrib as boolean | undefined, needsKidsMeal: args.needsKidsMeal as boolean | undefined,
					childTicketDiscount: (args.childTicketDiscount as string) ?? undefined, seatPreference: (args.seatPreference as string) ?? undefined,
					bedPreference: (args.bedPreference as string) ?? undefined, accessibilityNeeds: (args.accessibilityNeeds as string) ?? undefined,
					roomNotes: (args.roomNotes as string) ?? undefined, notes: (args.notes as string) ?? undefined
				});
				logAudit(userId, 'mcp_companion_update', 'trip_companion', id, {});
				return textResult({ ok: true, companionId: id });
			}
			case 'roamarr_companion_delete': {
				if (!hasScope(scopes, 'companions:write')) return scopeError('companions:write');
				const confirmErr = requireConfirm(args, 'roamarr_companion_delete');
				if (confirmErr) return confirmErr;
				const { getCompanionTripId, removeTripCompanion } = await import('./tripCompanions');
				const id = Number(args.companionId);
				const tripId = getCompanionTripId(id);
				if (tripId == null) return { content: [{ type: 'text' as const, text: 'Companion not found' }], isError: true };
				removeTripCompanion(userId, tripId, id);
				logAudit(userId, 'mcp_companion_delete', 'trip_companion', id, {});
				return textResult({ ok: true, companionId: id });
			}
			case 'roamarr_poll_list': {
				if (!hasScope(scopes, 'polls:read')) return scopeError('polls:read');
				const { listPollsForTrip } = await import('./repositories/pollsRepo');
				const tripId = Number(args.tripId);
				requireViewableTrip(userId, tripId);
				return textResult({ tripId, polls: listPollsForTrip(tripId) });
			}
			case 'roamarr_poll_create': {
				if (!hasScope(scopes, 'polls:write')) return scopeError('polls:write');
				// Route through createTripPoll so the same validation as the
				// web UI applies (question length, 2-10 options, per-option
				// length, bumpTripUpdatedAt, audit). The previous impl
				// called the low-level repo createPoll directly and let
				// callers mint polls with empty questions or 1 option.
				const { createTripPoll } = await import('./tripPolls');
				const tripId = Number(args.tripId);
				const options = Array.isArray(args.options) ? args.options.map((o) => String(o)) : [];
				const p = createTripPoll(userId, tripId, String(args.question ?? ''), options);
				logAudit(userId, 'mcp_poll_create', 'trip_poll', p.id, { tripId });
				return textResult({ id: p.id, options: p.options });
			}
			case 'roamarr_poll_cast_vote': {
				if (!hasScope(scopes, 'polls:write')) return scopeError('polls:write');
				// Route through tripPolls.castVote so requireEditableTrip
				// (owner OR editor) is enforced, matching the web UI.
				// The previous impl called requireOwnedTrip directly, which
				// blocked editors of shared trips from voting.
				const { getPollById } = await import('./repositories/pollsRepo');
				const { castVote } = await import('./tripPolls');
				const { requireCompanionOnTrip } = await import('./ownership');
				const { getOrCreateOwnerCompanion } = await import('./tripCompanions');
				const pollId = Number(args.pollId);
				const poll = getPollById(pollId);
				if (!poll) return { content: [{ type: 'text' as const, text: 'Poll not found' }], isError: true };
				// companionId: positive int = companion id; null/missing =
				// the trip owner / editor. The self-companion is recorded
				// against the calling user (via user_id) so the FK and the
				// (poll_id, companion_id) uniqueness are satisfied per-user.
				let companionId: number;
				if (args.companionId == null) {
					companionId = getOrCreateOwnerCompanion(userId, poll.tripId).id;
				} else {
					companionId = Number(args.companionId);
					requireCompanionOnTrip(companionId, poll.tripId);
				}
				castVote(userId, pollId, companionId, Number(args.optionId));
				logAudit(userId, 'mcp_poll_vote', 'trip_poll', pollId, { optionId: args.optionId, companionId });
				return textResult({ ok: true, pollId });
			}
			case 'roamarr_poll_delete': {
				if (!hasScope(scopes, 'polls:write')) return scopeError('polls:write');
				const confirmErr = requireConfirm(args, 'roamarr_poll_delete');
				if (confirmErr) return confirmErr;
				// Route through tripPolls.removeTripPoll so requireEditableTrip
				// + bumpTripUpdatedAt + canonical audit apply, matching the
				// web UI. The previous impl used requireOwnedTrip and skipped
				// bumpTripUpdatedAt.
				const { removeTripPoll } = await import('./tripPolls');
				removeTripPoll(userId, Number(args.pollId));
				logAudit(userId, 'mcp_poll_delete', 'trip_poll', Number(args.pollId), {});
				return textResult({ ok: true, pollId: Number(args.pollId) });
			}
			case 'roamarr_journal_list': {
				if (!hasScope(scopes, 'journal:read')) return scopeError('journal:read');
				const { listJournalEntriesForTrip } = await import('./repositories/tripMiscRepo');
				const tripId = Number(args.tripId);
				requireViewableTrip(userId, tripId);
				return textResult({ tripId, items: listJournalEntriesForTrip(tripId) });
			}
			case 'roamarr_journal_create': {
				if (!hasScope(scopes, 'journal:write')) return scopeError('journal:write');
				const { createJournalEntry } = await import('./tripJournal');
				const tripId = Number(args.tripId);
				const e = createJournalEntry(userId, tripId, {
					entryDate: String(args.entryDate),
					title: String(args.title ?? ''),
					body: String(args.body ?? '')
				});
				logAudit(userId, 'mcp_journal_create', 'trip_journal_entry', e.id, { tripId });
				return textResult({ id: e.id });
			}
			case 'roamarr_journal_update': {
				if (!hasScope(scopes, 'journal:write')) return scopeError('journal:write');
				const { getJournalEntryById } = await import('./repositories/tripMiscRepo');
				const { modifyJournalEntry } = await import('./tripJournal');
				const e = getJournalEntryById(Number(args.entryId));
				if (!e) return { content: [{ type: 'text' as const, text: 'Entry not found' }], isError: true };
				modifyJournalEntry(userId, Number(args.entryId), { entryDate: args.entryDate as string | undefined, title: args.title as string | undefined, body: args.body as string | undefined });
				logAudit(userId, 'mcp_journal_update', 'trip_journal_entry', Number(args.entryId), {});
				return textResult({ ok: true, entryId: Number(args.entryId) });
			}
			case 'roamarr_journal_delete': {
				if (!hasScope(scopes, 'journal:write')) return scopeError('journal:write');
				const confirmErr = requireConfirm(args, 'roamarr_journal_delete');
				if (confirmErr) return confirmErr;
				const { getJournalEntryById, deleteJournalEntry } = await import('./repositories/tripMiscRepo');
				const e = getJournalEntryById(Number(args.entryId));
				if (!e) return { content: [{ type: 'text' as const, text: 'Entry not found' }], isError: true };
				requireEditableTrip(userId, e.tripId);
				deleteJournalEntry(Number(args.entryId));
				logAudit(userId, 'mcp_journal_delete', 'trip_journal_entry', Number(args.entryId), {});
				return textResult({ ok: true, entryId: Number(args.entryId) });
			}
			case 'roamarr_home_task_list': {
				if (!hasScope(scopes, 'home-tasks:read')) return scopeError('home-tasks:read');
				const { listHomeTasksForTrip } = await import('./repositories/tripMiscRepo');
				const tripId = Number(args.tripId);
				requireViewableTrip(userId, tripId);
				return textResult({ tripId, items: listHomeTasksForTrip(tripId) });
			}
			case 'roamarr_home_task_create': {
				if (!hasScope(scopes, 'home-tasks:write')) return scopeError('home-tasks:write');
				const { createHomeTask } = await import('./repositories/tripMiscRepo');
				const tripId = Number(args.tripId);
				requireEditableTrip(userId, tripId);
				const t = createHomeTask({
					tripId,
					text: String(args.text ?? ''),
					dueDate: (args.dueDate as string) ?? null
				});
				logAudit(userId, 'mcp_home_task_create', 'trip_home_task', t.id, { tripId });
				return textResult({ id: t.id });
			}
			case 'roamarr_home_task_toggle_done': {
				if (!hasScope(scopes, 'home-tasks:write')) return scopeError('home-tasks:write');
				const { getHomeTaskById, updateHomeTask } = await import('./repositories/tripMiscRepo');
				const t = getHomeTaskById(Number(args.taskId));
				if (!t) return { content: [{ type: 'text' as const, text: 'Task not found' }], isError: true };
				requireEditableTrip(userId, t.tripId);
				const updated = updateHomeTask(Number(args.taskId), { done: !t.done });
				logAudit(userId, 'mcp_home_task_toggle', 'trip_home_task', Number(args.taskId), { done: updated?.done });
				return textResult({ ok: true, taskId: Number(args.taskId), done: updated?.done });
			}
			case 'roamarr_home_task_delete': {
				if (!hasScope(scopes, 'home-tasks:write')) return scopeError('home-tasks:write');
				const confirmErr = requireConfirm(args, 'roamarr_home_task_delete');
				if (confirmErr) return confirmErr;
				const { getHomeTaskById, deleteHomeTask } = await import('./repositories/tripMiscRepo');
				const t = getHomeTaskById(Number(args.taskId));
				if (!t) return { content: [{ type: 'text' as const, text: 'Task not found' }], isError: true };
				requireEditableTrip(userId, t.tripId);
				deleteHomeTask(Number(args.taskId));
				logAudit(userId, 'mcp_home_task_delete', 'trip_home_task', Number(args.taskId), {});
				return textResult({ ok: true, taskId: Number(args.taskId) });
			}
			case 'roamarr_medication_list': {
				if (!hasScope(scopes, 'medications:read')) return scopeError('medications:read');
				const { listMedicationsForTrip } = await import('./repositories/tripMiscRepo');
				const tripId = Number(args.tripId);
				requireViewableTrip(userId, tripId);
				return textResult({ tripId, items: listMedicationsForTrip(tripId) });
			}
			case 'roamarr_medication_create': {
				if (!hasScope(scopes, 'medications:write')) return scopeError('medications:write');
				const { addMedication } = await import('./tripMedications');
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
			case 'roamarr_medication_delete': {
				if (!hasScope(scopes, 'medications:write')) return scopeError('medications:write');
				const confirmErr = requireConfirm(args, 'roamarr_medication_delete');
				if (confirmErr) return confirmErr;
				const { getMedicationById, deleteMedication } = await import('./repositories/tripMiscRepo');
				const m = getMedicationById(Number(args.medicationId));
				if (!m) return { content: [{ type: 'text' as const, text: 'Medication not found' }], isError: true };
				requireEditableTrip(userId, m.tripId);
				deleteMedication(Number(args.medicationId));
				logAudit(userId, 'mcp_medication_delete', 'trip_medication', Number(args.medicationId), {});
				return textResult({ ok: true, medicationId: Number(args.medicationId) });
			}
			case 'roamarr_important_item_list': {
				if (!hasScope(scopes, 'items:read')) return scopeError('items:read');
				const { listImportantItemsForTrip } = await import('./repositories/tripMiscRepo');
				const tripId = Number(args.tripId);
				requireViewableTrip(userId, tripId);
				return textResult({ tripId, items: listImportantItemsForTrip(tripId) });
			}
			case 'roamarr_important_item_create': {
				if (!hasScope(scopes, 'items:write')) return scopeError('items:write');
				const { addImportantItem } = await import('./tripImportantItems');
				const tripId = Number(args.tripId);
				const i = addImportantItem(userId, tripId, {
					name: String(args.name ?? ''), companionId: args.companionId == null ? null : Number(args.companionId),
					serialNumber: (args.serialNumber as string) ?? null, trackerId: (args.trackerId as string) ?? null, notes: (args.notes as string) ?? null
				});
				logAudit(userId, 'mcp_important_item_create', 'trip_important_item', i.id, { tripId });
				return textResult({ id: i.id });
			}
			case 'roamarr_important_item_delete': {
				if (!hasScope(scopes, 'items:write')) return scopeError('items:write');
				const confirmErr = requireConfirm(args, 'roamarr_important_item_delete');
				if (confirmErr) return confirmErr;
				const { getImportantItemById, deleteImportantItem } = await import('./repositories/tripMiscRepo');
				const i = getImportantItemById(Number(args.itemId));
				if (!i) return { content: [{ type: 'text' as const, text: 'Item not found' }], isError: true };
				requireEditableTrip(userId, i.tripId);
				deleteImportantItem(Number(args.itemId));
				logAudit(userId, 'mcp_important_item_delete', 'trip_important_item', Number(args.itemId), {});
				return textResult({ ok: true, itemId: Number(args.itemId) });
			}
			case 'roamarr_entry_requirement_list': {
				if (!hasScope(scopes, 'requirements:read')) return scopeError('requirements:read');
				const { listEntryRequirementsForTrip } = await import('./repositories/tripMiscRepo');
				const tripId = Number(args.tripId);
				requireViewableTrip(userId, tripId);
				return textResult({ tripId, items: listEntryRequirementsForTrip(tripId) });
			}
			case 'roamarr_entry_requirement_create': {
				if (!hasScope(scopes, 'requirements:write')) return scopeError('requirements:write');
				const { addEntryRequirement } = await import('./tripEntryRequirements');
				const tripId = Number(args.tripId);
				const r = addEntryRequirement(userId, tripId, {
					country: String(args.country ?? ''), requirementType: String(args.requirementType ?? ''),
					status: (args.status as string) ?? 'needed', dueDate: (args.dueDate as string) ?? null, notes: (args.notes as string) ?? null
				});
				logAudit(userId, 'mcp_entry_requirement_create', 'trip_entry_requirement', r.id, { tripId });
				return textResult({ id: r.id });
			}
			case 'roamarr_entry_requirement_update': {
				if (!hasScope(scopes, 'requirements:write')) return scopeError('requirements:write');
				const { getEntryRequirementById, updateEntryRequirement } = await import('./repositories/tripMiscRepo');
				const r = getEntryRequirementById(Number(args.requirementId));
				if (!r) return { content: [{ type: 'text' as const, text: 'Requirement not found' }], isError: true };
				requireEditableTrip(userId, r.tripId);
				updateEntryRequirement(Number(args.requirementId), {
					status: (args.status as any) ?? undefined,
					dueDate: (args.dueDate as string) ?? undefined,
					notes: (args.notes as string) ?? undefined
				});
				logAudit(userId, 'mcp_entry_requirement_update', 'trip_entry_requirement', Number(args.requirementId), {});
				return textResult({ ok: true, requirementId: Number(args.requirementId) });
			}
			case 'roamarr_entry_requirement_delete': {
				if (!hasScope(scopes, 'requirements:write')) return scopeError('requirements:write');
				const confirmErr = requireConfirm(args, 'roamarr_entry_requirement_delete');
				if (confirmErr) return confirmErr;
				const { getEntryRequirementById, deleteEntryRequirement } = await import('./repositories/tripMiscRepo');
				const r = getEntryRequirementById(Number(args.requirementId));
				if (!r) return { content: [{ type: 'text' as const, text: 'Requirement not found' }], isError: true };
				requireEditableTrip(userId, r.tripId);
				deleteEntryRequirement(Number(args.requirementId));
				logAudit(userId, 'mcp_entry_requirement_delete', 'trip_entry_requirement', Number(args.requirementId), {});
				return textResult({ ok: true, requirementId: Number(args.requirementId) });
			}
			case 'roamarr_comment_list': {
				if (!hasScope(scopes, 'comments:read')) return scopeError('comments:read');
				const { listCommentsForTrip } = await import('./repositories/tripsRepo');
				const tripId = Number(args.tripId);
				requireViewableTrip(userId, tripId);
				return textResult({ tripId, items: listCommentsForTrip(tripId) });
			}
			case 'roamarr_comment_create': {
				if (!hasScope(scopes, 'comments:write')) return scopeError('comments:write');
				const { createComment } = await import('./repositories/tripsRepo');
				const tripId = Number(args.tripId);
				requireEditableTrip(userId, tripId);
				const c = createComment(userId, tripId, String(args.body ?? ''));
				logAudit(userId, 'mcp_comment_create', 'trip_comment', c.id, { tripId });
				return textResult({ id: c.id });
			}
			case 'roamarr_comment_delete': {
				if (!hasScope(scopes, 'comments:write')) return scopeError('comments:write');
				const confirmErr = requireConfirm(args, 'roamarr_comment_delete');
				if (confirmErr) return confirmErr;
				const { deleteComment } = await import('./repositories/tripsRepo');
				const id = Number(args.commentId);
				const n = deleteComment(userId, id);
				// deleteComment enforces user_id match; 0 means the comment
				// doesn't exist or wasn't authored by this user. Treat as
				// not-found so a non-author can't probe for comment ids.
				if (n === 0) return { content: [{ type: 'text' as const, text: 'Comment not found' }], isError: true };
				logAudit(userId, 'mcp_comment_delete', 'trip_comment', id, {});
				return textResult({ ok: true, commentId: id });
			}
			case 'roamarr_search': {
				if (!hasScope(scopes, 'search:read')) return scopeError('search:read');
				const q = String(args.query ?? '').trim();
				const { listViewableTrips } = await import('./sharing');
				const trips = q ? listViewableTrips(userId, { q, filter: 'active' }) : [];
				return textResult({ query: q, trips: trips.map((t) => ({ id: t.id, name: t.name, destination: 'destination' in t ? t.destination : null, destinationCityName: t.destinationCityName, isShared: t.isShared })) });
			}
			default:
				return {
					content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }],
					isError: true
				};
			}
		};
		try {
			return await toolHandler();
		} catch (e) {
			const status = (e as { status?: number })?.status;
			const message = (e as Error)?.message ?? String(e);
			return {
				content: [{ type: 'text' as const, text: status ? `Error ${status}: ${message}` : `Error: ${message}` }],
				isError: true
			};
		}
	});

	server.setRequestHandler(ListPromptsRequestSchema, async () => ({
		prompts: PROMPTS.map((p) => ({
			name: p.name,
			description: p.description,
			arguments: p.arguments
		}))
	}));

	server.setRequestHandler(GetPromptRequestSchema, async (request) => {
		const promptName = request.params.name;
		const entry = PROMPTS.find((p) => p.name === promptName);
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
				trip = safeTripProjection(tripId, userId) as Record<string, unknown>;
			} catch {
				return errorPrompt('Trip not found or inaccessible.');
			}
		}

		const output = await entry.build({ userId, tripId, scopes, trip });
		return makePromptMessage(output.description, output.text);
	});

	server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
		const templates = [];
		if (hasScope(scopes, 'trips:read')) {
			templates.push({
				name: 'trip',
				title: 'Trip',
				uriTemplate: TRIP_RESOURCE_TEMPLATE,
				description: 'A single trip with its itinerary and metadata.',
				mimeType: 'application/json'
			});
		}
		if (hasScope(scopes, 'companions:read')) {
			templates.push({
				name: 'companion',
				title: 'Companion',
				uriTemplate: 'companion://{companionId}',
				description: 'A trip companion by id.',
				mimeType: 'application/json'
			});
		}
		if (hasScope(scopes, 'cards:read')) {
			templates.push({
				name: 'card',
				title: 'Card',
				uriTemplate: 'card://{cardId}',
				description: 'A payment card by id (network + last4 only).',
				mimeType: 'application/json'
			});
		}
		if (hasScope(scopes, 'loyalty:read')) {
			templates.push({
				name: 'loyalty',
				title: 'Loyalty program',
				uriTemplate: 'loyalty://{loyaltyId}',
				description: 'A loyalty program by id (member number redacted).',
				mimeType: 'application/json'
			});
		}
		if (hasScope(scopes, 'insurance:read')) {
			templates.push({
				name: 'insurance',
				title: 'Insurance policy',
				uriTemplate: 'insurance://{insuranceId}',
				description: 'An insurance policy by id (policy number redacted).',
				mimeType: 'application/json'
			});
		}
		if (hasScope(scopes, 'travel-docs:read')) {
			templates.push({
				name: 'document',
				title: 'Travel document',
				uriTemplate: 'document://{documentId}',
				description: 'A travel document by id (number redacted).',
				mimeType: 'application/json'
			});
		}
		if (hasScope(scopes, 'polls:read')) {
			templates.push({
				name: 'poll',
				title: 'Poll',
				uriTemplate: 'poll://{pollId}',
				description: 'A trip poll with vote counts.',
				mimeType: 'application/json'
			});
		}
		if (hasScope(scopes, 'journal:read')) {
			templates.push({
				name: 'journal',
				title: 'Journal entry',
				uriTemplate: 'journal://trip-{tripId}/{isoDate}',
				description: 'A journal entry for a specific date on a trip.',
				mimeType: 'application/json'
			});
		}
		if (hasScope(scopes, 'fares:read')) {
			templates.push({
				name: 'fare-watch',
				title: 'Fare watch',
				uriTemplate: 'fare-watch://{fareWatchId}',
				description: 'A fare watch with latest price snapshot.',
				mimeType: 'application/json'
			});
		}
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
			const projected = safeTripProjection(tripId, userId);
			return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify({ trip: projected }) }] };
		}
		const companionMatch = COMPANION_URI_RE.exec(uri);
		if (companionMatch) {
			if (!hasScope(scopes, 'companions:read')) throw new Error('Missing scope: companions:read');
			const { getCompanionTripId } = await import('./tripCompanions');
			const tripId = getCompanionTripId(Number(companionMatch[1]));
			if (tripId == null) throw new Error('Companion not found');
			requireViewableTrip(userId, tripId);
			const { listTripCompanions } = await import('./tripCompanions');
			const c = listTripCompanions(tripId).find((x) => x.id === Number(companionMatch[1]));
			if (!c) throw new Error('Companion not found');
			return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify({ companion: c }) }] };
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
			requireViewableTrip(userId, w.tripId);
			return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify({ fareWatch: w }) }] };
		}
		throw new Error(`Unknown resource URI: ${uri}`);
	});

	return server;
}
