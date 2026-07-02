import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
	ListToolsRequestSchema,
	CallToolRequestSchema,
	ListPromptsRequestSchema,
	GetPromptRequestSchema,
	ListResourcesRequestSchema,
	ReadResourceRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import type { Scope } from './oauth';
import * as tripsRepo from './repositories/tripsRepo';
import { requireOwnedTrip, requireEditableTrip } from './ownership';
import { listVisited, markVisited, unmarkVisited } from './visitedPlaces';
import { loadTripFor } from '../../routes/trips/shared';
import { viewerProjection } from './sharing';
import { addItem as addChecklistItem, loadChecklist } from './tripChecklists';
import { setBudget, listBudgetsWithSpent } from './tripBudgets';
import { logAudit } from './audit';
import { Validator } from './validation';
import { TRIP_STATUSES, SEGMENT_TYPES, EXPENSE_CATEGORIES } from './db/mongrelSchema';

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
		return viewerProjection(view.trip, view.segments, false);
	}
	return view.trip;
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

export function createMcpServer(userId: number, scopes: Scope[]): Server {
	const server = new Server(
		{ name: 'roamarr', version: '1.0.0' },
		{ capabilities: { tools: {}, prompts: {}, resources: {} } }
	);

	server.setRequestHandler(ListToolsRequestSchema, async () => ({
		tools: [
			{
				name: 'roamarr_trip_list',
				description: 'List all trips for the authenticated user.',
				inputSchema: { type: 'object', properties: {} }
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
						startDate: { type: 'string', description: 'ISO date YYYY-MM-DD' },
						endDate: { type: 'string', description: 'ISO date YYYY-MM-DD' }
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
						startDate: { type: 'string', description: 'ISO date YYYY-MM-DD' },
						endDate: { type: 'string', description: 'ISO date YYYY-MM-DD' },
						status: { type: 'string', enum: [...TRIP_STATUSES] }
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
						text: { type: 'string', description: 'Item description, e.g. "Passport" or "Sunscreen"' }
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
				name: 'roamarr_places_list',
				description: 'List visited countries and U.S. states.',
				inputSchema: { type: 'object', properties: {} }
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
						title: { type: 'string' }
					},
					required: ['tripId', 'offsetMinutes']
				}
			}
		]
	}));

	server.setRequestHandler(CallToolRequestSchema, async (request) => {
		const { name, arguments: args = {} } = request.params;

		switch (name) {
			case 'roamarr_trip_list': {
				if (!hasScope(scopes, 'trips:read')) return scopeError('trips:read');
				const trips = tripsRepo.listTripsForUser(userId);
				return textResult(trips.map((t) => ({
					id: t.id, name: t.name, destination: t.destination,
					destinationCountryCode: t.destinationCountryCode,
					destinationCityName: t.destinationCityName,
					startDate: t.startDate, endDate: t.endDate, status: t.status
				})));
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
					startDate: args.startDate as string | undefined,
					endDate: args.endDate as string | undefined
				});
				logAudit(userId, 'mcp_trip_create', 'trip', trip.id, { name: trip.name });
				return textResult({ id: trip.id, name: trip.name });
			}
			case 'roamarr_trip_update': {
				if (!hasScope(scopes, 'trips:write')) return scopeError('trips:write');
				const validation = validateToolInput(args as Record<string, unknown>);
				if (!validation.ok) return textResult({ error: validation.error });
				const tripId = Number(args.tripId);
				requireOwnedTrip(userId, tripId);
				const updated = tripsRepo.updateTrip(tripId, {
					name: args.name as string | undefined,
					destination: args.destination as string | undefined,
					startDate: args.startDate as string | undefined,
					endDate: args.endDate as string | undefined,
					status: args.status as any | undefined
				});
				if (!updated) return textResult({ error: 'Trip not found' });
				logAudit(userId, 'mcp_trip_update', 'trip', tripId, {});
				return textResult({ id: updated.id, name: updated.name, status: updated.status });
			}
			case 'roamarr_day_plan': {
				if (!hasScope(scopes, 'trips:write')) return scopeError('trips:write');
				const validation = validateToolInput(args as Record<string, unknown>);
				if (!validation.ok) return textResult({ error: validation.error });
				const tripId = Number(args.tripId);
				requireEditableTrip(userId, tripId);
				const { createSegment } = await import('./repositories/segmentsRepo');
				const seg = createSegment({
					trip_id: BigInt(tripId),
					type: String(args.type ?? 'event'),
					title: String(args.title ?? ''),
					start_at: String(args.startAt ?? ''),
					end_at: (args.endAt as string) || null,
					city_name: (args.cityName as string) || null,
					country_code: (args.countryCode as string) || null,
					notes: (args.notes as string) || null
				} as any);
				logAudit(userId, 'mcp_day_plan', 'segment', Number(seg.id), { tripId });
				return textResult({ id: Number(seg.id), tripId, type: args.type, title: args.title });
			}
			case 'roamarr_packing_item_add': {
				if (!hasScope(scopes, 'packing:write')) return scopeError('packing:write');
				const tripId = Number(args.tripId);
				const item = addChecklistItem(userId, tripId, String(args.text ?? ''));
				logAudit(userId, 'mcp_packing_add', 'trip_checklist_item', Number(item.id), { tripId });
				return textResult({ id: Number(item.id), tripId, text: item.text });
			}
			case 'roamarr_packing_list_build': {
				if (!hasScope(scopes, 'packing:write')) return scopeError('packing:write');
				const tripId = Number(args.tripId);
				requireEditableTrip(userId, tripId);
				if (args.templateId) {
					const { applyTemplate } = await import('./packingTemplates');
					applyTemplate(Number(args.templateId), tripId, userId);
					logAudit(userId, 'mcp_packing_build', 'trip', tripId, { templateId: args.templateId });
				}
				const checklist = loadChecklist(tripId);
				return textResult({
					tripId,
					items: checklist.items.map((i) => ({ id: Number(i.id), text: i.text, packed: i.packed }))
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
				if (!hasScope(scopes, 'budgets:write')) return scopeError('budgets:write');
				const tripId = Number(args.tripId);
				requireOwnedTrip(userId, tripId);
				const { listExpensesForTrip } = await import('./repositories/expensesRepo');
				const expenses = listExpensesForTrip(tripId);
				const budgets = listBudgetsWithSpent(tripId, expenses);
				return textResult({ tripId, budgets });
			}
			case 'roamarr_upcoming_summary': {
				if (!hasScope(scopes, 'trips:read')) return scopeError('trips:read');
				const all = tripsRepo.listTripsForUser(userId);
				const today = new Date().toISOString().slice(0, 10);
				const upcoming = all
					.filter((t) => t.startDate && t.startDate >= today && !t.archived)
					.slice(0, 5);
				return textResult(upcoming.map((t) => ({
					id: t.id, name: t.name, destination: t.destination, startDate: t.startDate
				})));
			}
			case 'roamarr_places_list': {
				if (!hasScope(scopes, 'places:read')) return scopeError('places:read');
				return textResult(listVisited(userId));
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
				const { upsertCustomReminder } = await import('./reminders');
				const tripId = Number(args.tripId);
				const offset = Number(args.offsetMinutes ?? 60);
				const t = requireOwnedTrip(userId, tripId);
				if (!t.startDate) return textResult({ error: 'Trip has no start date' });
				const startAt = `${t.startDate}T09:00:00Z`;
				upsertCustomReminder(userId, 'trip', tripId, startAt, offset);
				logAudit(userId, 'mcp_reminder_add', 'trip', tripId, { offsetMinutes: offset });
				return textResult({ ok: true, tripId, offsetMinutes: offset });
			}
			default:
				return {
					content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }],
					isError: true
				};
		}
	});

	const PROMPTS = [
		{ name: 'trip-details', description: 'Detailed overview of a specific trip including segments.' },
		{ name: 'trip-summary', description: 'Brief summary of all upcoming trips.' },
		{ name: 'itinerary', description: 'Day-by-day itinerary for a trip.' },
		{ name: 'flight-info', description: 'Flight segments for a trip.' },
		{ name: 'hotel-info', description: 'Hotel/lodging segments for a trip.' },
		{ name: 'packing-check', description: 'Packing checklist status for a trip.' },
		{ name: 'budget-overview', description: 'Budget categories and spending for a trip.' },
		{ name: 'documents-checklist', description: 'Travel documents and expiry summaries.' },
		{ name: 'weather-overview', description: 'Weather forecast for a trip destination.' },
		{ name: 'places-visited', description: 'Countries and U.S. states you have visited.' }
	];

	server.setRequestHandler(ListPromptsRequestSchema, async () => ({
		prompts: PROMPTS
	}));

	server.setRequestHandler(GetPromptRequestSchema, async (request) => {
		const promptName = request.params.name;
		const tripIdArg = (request.params.arguments as Record<string, string> | undefined)?.tripId;
		const tripId = tripIdArg ? Number(tripIdArg) : 0;

		function tripContext(tid: number) {
			if (!tid || !hasScope(scopes, 'trips:read')) return null;
			try {
				return safeTripProjection(tid, userId);
			} catch {
				return null;
			}
		}

		function makePrompt(title: string, body: string) {
			return { description: title, messages: [{ role: 'user' as const, content: { type: 'text' as const, text: body } }] };
		}

		switch (promptName) {
			case 'trip-summary': {
				if (!hasScope(scopes, 'trips:read')) return makePrompt('Error', 'Missing scope: trips:read');
				const all = tripsRepo.listTripsForUser(userId);
				const today = new Date().toISOString().slice(0, 10);
				const upcoming = all.filter((t) => t.startDate && t.startDate >= today && !t.archived).slice(0, 5);
				return makePrompt('Trip summary', JSON.stringify(upcoming.map((t) => ({
					name: t.name, destination: t.destination, startDate: t.startDate, endDate: t.endDate
				})), null, 2));
			}
			case 'places-visited': {
				if (!hasScope(scopes, 'places:read')) return makePrompt('Error', 'Missing scope: places:read');
				return makePrompt('Places visited', JSON.stringify(listVisited(userId)));
			}
			case 'weather-overview': {
				if (!hasScope(scopes, 'trips:read')) return makePrompt('Error', 'Missing scope: trips:read');
				if (!tripId) return makePrompt('Error', 'tripId argument required');
				// Authorize before leaking destination/lat-lng/dates for an arbitrary trip id.
				if (!tripContext(tripId)) return makePrompt('Error', 'Trip not found or inaccessible.');
				const { tripWeatherOverview } = await import('./weather');
				const weather = await tripWeatherOverview(tripId, userId);
				return makePrompt('Weather overview', JSON.stringify(weather));
			}
			case 'documents-checklist': {
				if (!hasScope(scopes, 'profile:read')) return makePrompt('Error', 'Missing scope: profile:read');
				const { listTravelDocuments } = await import('./repositories/profileRepo');
				const docs = listTravelDocuments(userId);
				return makePrompt('Documents checklist', JSON.stringify(docs.map((d) => ({
					type: d.type, expiresOn: d.expiresOn
				}))));
			}
			default: {
				const projected = tripContext(tripId);
				if (!projected) return makePrompt('Error', 'Trip not found or inaccessible.');
				const t = projected as Record<string, unknown>;
				const allSegs: any[] = Array.isArray(t.segments) ? t.segments : [];
				switch (promptName) {
					case 'trip-details':
						return makePrompt('Trip details', JSON.stringify({ trip: t }));
					case 'itinerary':
						return makePrompt('Itinerary', JSON.stringify(t));
					case 'flight-info': {
						const segs = allSegs.filter((s: any) => s.type === 'flight');
						return makePrompt('Flight info', JSON.stringify(segs));
					}
					case 'hotel-info': {
						const segs = allSegs.filter((s: any) => s.type === 'hotel');
						return makePrompt('Hotel info', JSON.stringify(segs));
					}
					case 'packing-check': {
						const { loadChecklist } = await import('./tripChecklists');
						const checklist = loadChecklist(tripId);
						return makePrompt('Packing check', JSON.stringify(checklist.items.map((i) => ({ text: i.text, packed: i.packed }))));
					}
					case 'budget-overview': {
						const { listExpensesForTrip } = await import('./repositories/expensesRepo');
						const budgets = listBudgetsWithSpent(tripId, listExpensesForTrip(tripId));
						return makePrompt('Budget overview', JSON.stringify(budgets));
					}
					default:
						return makePrompt('Error', `Unknown prompt: ${promptName}`);
				}
			}
		}
	});

	server.setRequestHandler(ListResourcesRequestSchema, async () => ({
		resources: []
	}));

	server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
		const uri = request.params.uri;
		const match = /^trip:\/\/(\d+)$/.exec(uri);
		if (!match) throw new Error(`Unknown resource URI: ${uri}`);
		const tid = Number(match[1]);
		if (!hasScope(scopes, 'trips:read')) throw new Error('Missing scope: trips:read');
		const projected = safeTripProjection(tid, userId);
		return {
			contents: [{
				uri,
				mimeType: 'application/json',
				text: JSON.stringify({ trip: projected })
			}]
		};
	});

	return server;
}
