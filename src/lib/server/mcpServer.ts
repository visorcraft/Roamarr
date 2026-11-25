import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { error } from '@sveltejs/kit';
import { DateTime } from 'luxon';
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
import type { SharePermission } from './repositories/tripsRepo';
import * as segmentsRepo from './repositories/segmentsRepo';
import { requireOwnedTrip, requireEditableTrip, requireViewableTrip, requireOwnedGroup } from './ownership';
import { listVisited, markVisited, unmarkVisited } from './visitedPlaces';
import { loadTripFor } from '../../routes/trips/shared';
import { viewerProjection, canEdit, canViewDetails, companionViewerProjection } from './sharing';
import { addItem as addChecklistItem, viewChecklist } from './tripChecklists';
import { setBudget, listBudgetsWithSpent, BUDGET_CATEGORIES } from './tripBudgets';
import { logAudit } from './audit';
import { Validator } from './validation';
import { findCity, resolveCitySelection } from './cities';
import { TRIP_STATUSES, VISIBILITIES, SEGMENT_TYPES, EXPENSE_CATEGORIES, TRAVEL_DOCUMENT_TYPES, type TravelDocumentType, type CompanionCategory } from './db/mongrelSchema';
import {
	projectCard,
	projectLoyalty,
	projectInsurance,
	projectTravelDocument,
	paginateList,
	requireConfirm,
	optString,
	reqString,
	fileFromAttachmentBase64,
	parseAttachmentByteRange,
	streamToBase64
} from './mcpHelpers';
import type { TripDocumentRow } from './repositories/tripDocumentsRepo';
import type { MailHold } from './repositories/tripMiscRepo';
import type { PlaceLinkPatch } from './placeLinks';
import { getSettings } from './settings';
import { effectiveTripStatus, todayForUser } from './tripLifecycle';

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

function withDerivedStatus<T extends { status?: string | null; startDate?: string | null; endDate?: string | null }>(
	userId: number,
	trip: T
): T & { status: ReturnType<typeof effectiveTripStatus> } {
	return { ...trip, status: effectiveTripStatus(trip, todayForUser(userId)) };
}

function canReadPrivateDetails(scopes: Scope[]): boolean {
	return getSettings().allowMcpPii && hasScope(scopes, 'private-details:read');
}

function safeTripProjection(tripId: number, userId: number, scopes: Scope[]) {
	const view = loadTripFor(userId, tripId);
	const includePrivateDetails = canReadPrivateDetails(scopes);
	if (view.editor) {
		const projection = viewerProjection(view.trip, view.segments, false);
		return withDerivedStatus(userId, {
			...projection,
			...(includePrivateDetails && {
				notes: view.trip.notes,
				segments: view.segments.map(({ tripId: _tripId, cardId: _cardId, ...segment }) => segment)
			}),
			canEdit: true,
			owner: view.owner
		});
	}
	if (includePrivateDetails) return withDerivedStatus(userId, { ...view.trip, canEdit: false, owner: false });
	return withDerivedStatus(userId, {
		...view.trip,
		segments: view.trip.segments.map((segment) => {
			const safe = { ...segment } as Record<string, unknown>;
			delete safe.confirmationNumber;
			delete safe.detailsJson;
			return safe;
		}),
		canEdit: false,
		owner: false
	});
}

function validateToolInput(args: Record<string, unknown>): { ok: true } | { ok: false; error: string } {
	const v = new Validator();
	if (args.status != null) v.enumValue(args.status, TRIP_STATUSES, 'status');
	if (args.type != null) v.enumValue(args.type, SEGMENT_TYPES, 'type');
	if (args.category != null) v.enumValue(args.category, EXPENSE_CATEGORIES, 'category');
	if (args.startAt != null) v.dateTime(args.startAt, 'startAt');
	if (args.endAt != null) v.dateTime(args.endAt, 'endAt');
	if (args.startTz != null) v.timezone(args.startTz, 'startTz');
	if (args.endTz != null) v.timezone(args.endTz, 'endTz');
	if (v.ok()) return { ok: true };
	const messages = Object.values(v.errors);
	return { ok: false, error: messages.join('; ') };
}

// Validated MCP reminder offset. Callers handle absent (null/undefined)
// themselves. Returns the integer, or null when invalid.
function parseReminderOffsetMinutes(raw: unknown): number | null {
	if (raw == null) return null;
	if (typeof raw !== 'number' && typeof raw !== 'string') return null;
	if (typeof raw === 'string' && raw.trim() === '') return null;
	const n = Number(raw);
	if (!Number.isInteger(n) || n < -10080 || n > 10080) return null;
	return n;
}

type BudgetSetArgsResult =
	| { ok: true; tripId: number; category: (typeof BUDGET_CATEGORIES)[number]; amount: number; currency: string }
	| { ok: false; error: string };

// Strict parser for roamarr_budget_set. The tool schema declares amount as a
// number, but clients sometimes send strings, booleans, or floats, which would
// otherwise be coerced into a misleading budget.
function parseBudgetSetArgs(args: Record<string, unknown>): BudgetSetArgsResult {
	const rawTripId = args.tripId;
	if (typeof rawTripId !== 'number' || !Number.isSafeInteger(rawTripId) || rawTripId <= 0) {
		return { ok: false, error: 'tripId must be a positive integer' };
	}
	const rawCategory = args.category;
	if (typeof rawCategory !== 'string') {
		return { ok: false, error: `category must be one of: ${BUDGET_CATEGORIES.join(', ')}` };
	}
	const category = rawCategory.trim();
	if (!(BUDGET_CATEGORIES as readonly string[]).includes(category)) {
		return { ok: false, error: `category must be one of: ${BUDGET_CATEGORIES.join(', ')}` };
	}
	const amount = args.amount;
	if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount <= 0) {
		return { ok: false, error: 'amount must be a positive integer number of cents' };
	}
	const rawCurrency = args.currency;
	let currency: string;
	if (rawCurrency == null || (typeof rawCurrency === 'string' && rawCurrency.trim() === '')) {
		currency = 'USD';
	} else if (typeof rawCurrency !== 'string') {
		return { ok: false, error: 'currency must be a 3-letter ISO currency code' };
	} else {
		const normalized = rawCurrency.trim().toUpperCase();
		if (!/^[A-Z]{3}$/.test(normalized)) {
			return { ok: false, error: 'currency must be a 3-letter ISO currency code' };
		}
		currency = normalized;
	}
	return { ok: true, tripId: rawTripId, category: category as (typeof BUDGET_CATEGORIES)[number], amount, currency };
}

type ShareArgsResult =
	| { ok: true; permission: SharePermission | undefined; showDetails: boolean | undefined }
	| { ok: false; error: string };

// Strict parsers for the share tools. MCP clients sometimes send "false" or 0
// for booleans, and Boolean("false") is true, which would silently turn on
// private-detail visibility for a share. Only real booleans are accepted.
function parseShareArgs(args: Record<string, unknown>): ShareArgsResult {
	const permission = args.permission;
	if (permission != null && permission !== 'read' && permission !== 'edit') {
		return { ok: false, error: 'permission must be one of: read, edit' };
	}
	const showDetails = args.showDetails;
	if (showDetails != null && typeof showDetails !== 'boolean') {
		return { ok: false, error: 'showDetails must be a boolean' };
	}
	return {
		ok: true,
		permission: (permission as SharePermission | undefined) ?? undefined,
		showDetails: (showDetails as boolean | undefined) ?? undefined
	};
}

// Strict parser for roamarr_segment_update. The SDK does not enforce the
// declared inputSchema, and patchSegment gates every column with `!== undefined`,
// so a client that sends null (the usual JSON rendering of an omitted optional
// field) or a mistyped value writes it straight through. Only keys that were
// actually supplied are returned; the input object is never mutated. Null is
// accepted ONLY as "clear" for the nullable fields; every other updatable field
// rejects null with a message naming the field. Date/time and timezone validity
// of startAt/endAt/startTz/endTz, and the type enum, stay with the existing
// validateToolInput call.
const SEGMENT_UPDATE_NULLABLE_FIELDS = new Set([
	'endAt',
	'cityName',
	'countryCode',
	'admin1Code',
	'cityLat',
	'cityLng',
	'location',
	'venue',
	'confirmationNumber'
]);

const SEGMENT_UPDATE_FIELD_ORDER = [
	'type',
	'title',
	'startAt',
	'startTz',
	'endAt',
	'endTz',
	'cityName',
	'countryCode',
	'admin1Code',
	'cityLat',
	'cityLng',
	'location',
	'venue',
	'confirmationNumber',
	'notes',
	'details',
	'paymentStatus'
] as const;

const SEGMENT_UPDATE_STRING_FIELDS = new Set([
	'startTz',
	'endTz',
	'cityName',
	'countryCode',
	'admin1Code',
	'location',
	'venue',
	'confirmationNumber',
	'notes',
	'paymentStatus'
]);

type SegmentUpdateArgsResult =
	| { ok: true; patch: Record<string, unknown> }
	| { ok: false; error: string };

function parseSegmentUpdateArgs(args: Record<string, unknown>): SegmentUpdateArgsResult {
	const patch: Record<string, unknown> = {};
	for (const field of SEGMENT_UPDATE_FIELD_ORDER) {
		const value = args[field];
		if (value === undefined) continue;
		if (value === null) {
			if (SEGMENT_UPDATE_NULLABLE_FIELDS.has(field)) {
				patch[field] = null;
				continue;
			}
			return { ok: false, error: `${field} cannot be null; omit it to leave the field unchanged` };
		}
		if (field === 'title') {
			if (typeof value !== 'string' || !value.trim()) {
				return { ok: false, error: 'title must be a non-empty string' };
			}
			patch.title = value;
			continue;
		}
		if (field === 'cityLat' || field === 'cityLng') {
			const [min, max] = field === 'cityLat' ? [-90, 90] : [-180, 180];
			if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
				return { ok: false, error: `${field} must be a finite number between ${min} and ${max}` };
			}
			patch[field] = value;
			continue;
		}
		if (field === 'details') {
			if (typeof value !== 'object' || Array.isArray(value)) {
				return { ok: false, error: 'details must be an object' };
			}
			patch.details = value;
			continue;
		}
		if (SEGMENT_UPDATE_STRING_FIELDS.has(field)) {
			if (typeof value !== 'string') {
				return { ok: false, error: `${field} must be a string` };
			}
			patch[field] = value;
			continue;
		}
		// type, startAt, endAt: require string here (Validator.dateTime ignores non-strings);
		// format/enum validity stays with validateToolInput.
		if (typeof value !== 'string') {
			return { ok: false, error: `${field} must be a string` };
		}
		patch[field] = value;
	}
	if (Object.keys(patch).length === 0) {
		return { ok: false, error: 'at least one field to update is required' };
	}
	return { ok: true, patch };
}

// Strict parser shared by roamarr_trip_create and roamarr_trip_update. The SDK
// does not enforce the declared inputSchema, so every field that reaches
// tripsRepo is checked here. Absent keys are omitted so a partial update leaves
// the stored value alone; an explicit null clears notes and dates. The web
// rules mirrored here live in /trips/[id]/edit save (name 200, notes 5000,
// YYYY-MM-DD dates, 1-3 letter currency, visibility/status enums).
type TripFieldPatch = {
	name?: string;
	notes?: string | null;
	startDate?: string | null;
	endDate?: string | null;
	baseCurrency?: string;
	defaultVisibility?: (typeof VISIBILITIES)[number];
	status?: (typeof TRIP_STATUSES)[number];
};

type TripFieldsResult = { ok: true; fields: TripFieldPatch } | { ok: false; error: string };

// `existing` is the stored trip for an update and null for a create.
function parseTripFieldsArgs(
	args: Record<string, unknown>,
	existing: { startDate: string | null; endDate: string | null } | null
): TripFieldsResult {
	const v = new Validator();
	const fields: TripFieldPatch = {};

	// Create always needs a name; update only validates it when supplied.
	if (existing === null || args.name !== undefined) {
		const name = v.requiredString(args.name, 'name', { max: 200 });
		if (name !== undefined) fields.name = name;
	}

	if (args.notes !== undefined) {
		if (args.notes === null) fields.notes = null;
		else fields.notes = v.optionalString(args.notes, 'notes', { max: 5000 }) ?? null;
	}

	for (const key of ['startDate', 'endDate'] as const) {
		const raw = args[key];
		if (raw === undefined) continue;
		if (raw === null || (typeof raw === 'string' && raw.trim() === '')) {
			fields[key] = null;
			continue;
		}
		const date = v.date(raw, key);
		if (date !== undefined) fields[key] = date;
		else if (typeof raw !== 'string') v.addError(key, `${key} must be a valid date (YYYY-MM-DD)`);
	}

	// Only re-check the range when this call writes a date, so a legacy row with
	// an inverted range stays editable for unrelated fields. Compare against the
	// stored counterpart, and only when both sides are well-formed dates.
	if (fields.startDate !== undefined || fields.endDate !== undefined) {
		const start = fields.startDate !== undefined ? fields.startDate : (existing?.startDate ?? null);
		const end = fields.endDate !== undefined ? fields.endDate : (existing?.endDate ?? null);
		if (/^\d{4}-\d{2}-\d{2}$/.test(start ?? '') && /^\d{4}-\d{2}-\d{2}$/.test(end ?? '')) {
			v.dateRange(start ?? undefined, end ?? undefined);
		}
	}

	if (args.baseCurrency != null) {
		if (typeof args.baseCurrency !== 'string') {
			v.addError('baseCurrency', 'baseCurrency must be a 1-3 letter code');
		} else {
			const currency = args.baseCurrency.trim().toUpperCase();
			if (!/^[A-Z]{1,3}$/.test(currency)) v.addError('baseCurrency', 'baseCurrency must be a 1-3 letter code');
			else fields.baseCurrency = currency;
		}
	}

	if (args.defaultVisibility != null) {
		const visibility = v.enumValue(args.defaultVisibility, VISIBILITIES, 'defaultVisibility');
		if (visibility !== undefined) fields.defaultVisibility = visibility;
	}
	if (args.status != null) {
		const status = v.enumValue(args.status, TRIP_STATUSES, 'status');
		if (status !== undefined) fields.status = status;
	}

	if (!v.ok()) return { ok: false, error: Object.values(v.errors).join('; ') };
	return { ok: true, fields };
}

type PlaceLinkPatchResult =
	| { ok: true; linkId: number; patch: PlaceLinkPatch; empty: boolean }
	| { ok: false; error: string };

// Strict parser for roamarr_place_links_update. Only real strings are accepted:
// String(null) === 'null' and String({}) === '[object Object]' would otherwise be
// persisted as the label or notes. Trimming, length caps, and URL format stay in
// placeLinks.ts (validateLabel/validateUrl/validateNotes) and are not duplicated.
function parsePlaceLinkArgs(args: Record<string, unknown>): PlaceLinkPatchResult {
	const raw = args.linkId;
	const linkId = Number(raw);
	if (typeof raw !== 'number' || !Number.isSafeInteger(linkId) || linkId <= 0) {
		return { ok: false, error: 'linkId must be a positive integer' };
	}
	const patch: PlaceLinkPatch = {};
	if (args.label !== undefined) {
		if (typeof args.label !== 'string') return { ok: false, error: 'label must be a string' };
		patch.label = args.label;
	}
	if (args.url !== undefined) {
		if (typeof args.url !== 'string') return { ok: false, error: 'url must be a string' };
		patch.url = args.url;
	}
	if (args.notes !== undefined) {
		if (args.notes !== null && typeof args.notes !== 'string') {
			return { ok: false, error: 'notes must be a string or null' };
		}
		patch.notes = args.notes;
	}
	return { ok: true, linkId, patch, empty: Object.keys(patch).length === 0 };
}

function destinationCityPatch(
	args: Record<string, unknown>,
	current?: ReturnType<typeof tripsRepo.getTripById>
) {
	const destinationCityName = args.destinationCityName as string | undefined;
	const destinationCountryCode = args.destinationCountryCode as string | undefined;
	const destinationAdmin1Code =
		(args.destinationAdmin1Code as string | undefined) ??
		(args.admin1Code as string | undefined);
	const latArg = args.destinationCityLat as number | undefined;
	const lngArg = args.destinationCityLng as number | undefined;

	// Metadata-only updates (name/notes/status/…) must not touch destination
	// fields — otherwise a missed findCity would write null lat/lng and wipe
	// stored coordinates (updateTrip treats null as an intentional clear).
	const touchingDestination =
		destinationCityName !== undefined ||
		destinationCountryCode !== undefined ||
		destinationAdmin1Code !== undefined ||
		latArg !== undefined ||
		lngArg !== undefined;
	if (!touchingDestination) return {};

	const name = destinationCityName ?? current?.destinationCityName ?? null;
	const countryCode = destinationCountryCode ?? current?.destinationCountryCode ?? null;
	const admin1 =
		destinationAdmin1Code !== undefined
			? destinationAdmin1Code
			: (current?.destinationAdmin1Code ?? null);
	const hasCoords = latArg != null && lngArg != null;
	// Prefer explicit coords; otherwise look up highest-pop exact name in
	// country (+ admin1 when set). findCity works even when maps UI is off
	// as long as the city table has rows (MCP/import enrichment path).
	const city = name && countryCode ? findCity(countryCode, name, admin1) : null;

	// Only include keys that should be written. Omitting lat/lng on a miss
	// leaves updateTrip as a no-op for those columns (undefined ≠ null wipe).
	const patch: {
		destinationCountryCode?: string | null;
		destinationAdmin1Code?: string | null;
		destinationCityName?: string | null;
		destinationCityLat?: number | null;
		destinationCityLng?: number | null;
	} = {};

	if (destinationCountryCode !== undefined) {
		patch.destinationCountryCode = destinationCountryCode || null;
	}
	if (destinationAdmin1Code !== undefined) {
		patch.destinationAdmin1Code = destinationAdmin1Code || null;
	} else if (city?.admin1Code != null) {
		patch.destinationAdmin1Code = city.admin1Code;
	}
	if (destinationCityName !== undefined) {
		patch.destinationCityName = (city?.name ?? destinationCityName) || null;
	} else if (city?.name) {
		patch.destinationCityName = city.name;
	}
	if (hasCoords) {
		patch.destinationCityLat = latArg!;
		patch.destinationCityLng = lngArg!;
	} else if (city) {
		patch.destinationCityLat = city.lat;
		patch.destinationCityLng = city.lng;
	}

	return patch;
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

function positiveId(value: unknown, field: string): number {
	const n =
		typeof value === 'number'
			? value
			: typeof value === 'string' && value.trim() !== ''
				? Number(value)
				: Number.NaN;
	if (!Number.isSafeInteger(n) || n < 1) throw error(400, `${field} must be a positive integer`);
	return n;
}

function optionalPositiveId(value: unknown, field: string): number | null {
	if (value == null || value === '') return null;
	return positiveId(value, field);
}

function parseMailHoldId(raw: unknown): number | null {
	if (typeof raw === 'number') {
		return Number.isSafeInteger(raw) && raw >= 1 ? raw : null;
	}
	if (typeof raw === 'string' && /^\d+$/.test(raw)) {
		const n = Number(raw);
		return Number.isSafeInteger(n) && n >= 1 ? n : null;
	}
	return null;
}

function attachmentFilename(value: unknown): string {
	const filename = reqString(value, 'filename', 255);
	if (filename === '.' || filename === '..' || /[\\/\0]/.test(filename)) {
		throw error(400, 'filename must not contain path separators');
	}
	return filename;
}

function attachmentMimeType(value: unknown): string {
	const mime = reqString(value, 'mimeType', 127).split(';', 1)[0]!.trim().toLowerCase();
	if (!mime) throw error(400, 'mimeType is required');
	return mime;
}

function boundedOptional(value: unknown, field: string, max: number): string | null {
	if (value == null) return null;
	if (typeof value !== 'string') throw error(400, `${field} must be a string`);
	return optString(value, max);
}

/** tripId, segmentId, or both. A segment id alone resolves its trip. */
function resolveAttachmentTarget(args: Record<string, unknown>): { tripId: number; segmentId: number | null } {
	const tripId = optionalPositiveId(args.tripId, 'tripId');
	const segmentId = optionalPositiveId(args.segmentId, 'segmentId');
	if (tripId == null && segmentId == null) throw error(400, 'tripId or segmentId is required');
	if (tripId == null) {
		const seg = segmentsRepo.getSegmentById(segmentId!);
		if (!seg) throw error(404, 'Not found');
		return { tripId: seg.tripId, segmentId };
	}
	return { tripId, segmentId };
}

function projectTripDocument(row: Omit<TripDocumentRow, 'attachmentId'>, includeNotes: boolean) {
	return {
		id: row.id,
		tripId: row.tripId,
		segmentId: row.segmentId,
		label: row.label,
		notes: includeNotes ? row.notes : null,
		filename: row.filename,
		contentType: row.contentType,
		sizeBytes: row.sizeBytes,
		createdAt: row.createdAt
	};
}

function projectMailHold(hold: MailHold, includePrivate: boolean) {
	return {
		...hold,
		confirmationNumber: includePrivate ? hold.confirmationNumber : null,
		notes: includePrivate ? hold.notes : null
	};
}

/** View-authorized trip document. Optional tripId must match the file's trip. */
async function loadTripDocumentForView(userId: number, args: Record<string, unknown>) {
	const documentId = positiveId(args.documentId, 'documentId');
	const expectedTripId = optionalPositiveId(args.tripId, 'tripId');
	const { getTripDocumentLinkById } = await import('./repositories/tripDocumentsRepo');
	const link = getTripDocumentLinkById(documentId);
	if (!link || (expectedTripId != null && link.tripId !== expectedTripId)) {
		throw error(404, 'Document not found');
	}
	const trip = requireViewableTrip(userId, link.tripId);
	const { listTripDocuments } = await import('./tripDocuments');
	const row = listTripDocuments(link.tripId).find((item) => item.id === link.id);
	if (!row) throw error(404, 'Document not found');
	return { row, trip };
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

export function createMcpServer(userId: number, scopes: Scope[]): Server {
	const server = new Server(
		{ name: 'roamarr', version: '1.0.0' },
		{ capabilities: { tools: {}, prompts: {}, resources: {} } }
	);

	server.setRequestHandler(ListToolsRequestSchema, async () => ({
		tools: [
			{
				name: 'roamarr_trip_list',
				description:
					'List trips you can view, including ones shared with you. Cursor-paginated. status follows dates in your profile timezone: completed after the end date, active while today falls on the trip (the end date still counts as current). A saved planning, booked, active, or completed value is not overwritten.',
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
						destinationAdmin1Code: {
							type: 'string',
							description: 'State/province/territory (GeoNames admin1 code, e.g. TX, ON)'
						},
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
						destinationCountryCode: { type: 'string' },
						destinationAdmin1Code: {
							type: 'string',
							description: 'State/province/territory (GeoNames admin1 code, e.g. TX, ON)'
						},
						destinationCityName: { type: 'string' },
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
				description:
					'Create a segment on a trip. Times are LOCAL WALL CLOCK in startTz/endTz (not UTC instants). Pass IANA zones for every non-UTC place (e.g. America/Chicago, Asia/Bangkok, Asia/Seoul). Stored value is the UTC instant of that local time; the UI shows the wall clock in the zone.',
				inputSchema: {
					type: 'object',
					properties: {
						tripId: { type: 'number' },
						type: { type: 'string', description: 'Segment type: flight, hotel, event, restaurant, etc.' },
						title: { type: 'string' },
						startAt: {
							type: 'string',
							description:
								'Local wall-clock start in startTz: YYYY-MM-DDTHH:mm[:ss]. Digits are the clock face at the place (e.g. "2026-12-01T22:50:00" for 10:50 PM Dallas). Do not convert to UTC yourself. A trailing Z or ±offset is ignored; digits are still interpreted in startTz.'
						},
						startTz: {
							type: 'string',
							description:
								'IANA timezone for startAt wall clock (default UTC). Use airport/hotel local zone: America/Chicago, Asia/Bangkok, Asia/Taipei, Asia/Seoul, etc.'
						},
						endAt: {
							type: 'string',
							description:
								'Local wall-clock end in endTz (same rules as startAt). For flights, use the arrival airport local time with endTz set to that airport zone.'
						},
						endTz: {
							type: 'string',
							description: 'IANA timezone for endAt wall clock (defaults to startTz).'
						},
						cityName: { type: 'string' },
						countryCode: { type: 'string' },
						admin1Code: {
							type: 'string',
							description: 'State/province/territory (GeoNames admin1 code) when applicable'
						},
						cityLat: { type: 'number' },
						cityLng: { type: 'number' },
						location: { type: 'string' },
						venue: { type: 'string', description: 'Venue or street address shown in the itinerary editor' },
						confirmationNumber: { type: 'string' },
						notes: { type: 'string' },
						details: { type: 'object' },
						paymentStatus: { type: 'string', enum: ['quoted', 'deposit_paid', 'fully_paid', 'refunded'] }
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
						amount: { type: 'integer', description: 'Budget amount in integer cents (e.g. $150.00 → 15000); must be greater than 0' },
						currency: { type: 'string', description: '3-letter ISO currency code (case-insensitive), default USD' }
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
						offsetMinutes: { type: 'integer', minimum: -10080, maximum: 10080, description: 'Minutes before the trip start' },
						title: { type: 'string' }, reminderType: { type: 'string', enum: ['trip', 'document'] },
						name: { type: 'string' }, description: { type: 'string' }, fireAt: { type: 'string' }, refId: { type: 'number' }
					},
					required: []
				}
			},
			// Round 1: trip planning vertical — 17 new tools.
			{
				name: 'roamarr_segment_update',
				description:
					'Update a segment. When changing times, pass LOCAL WALL CLOCK + IANA zone (same contract as roamarr_day_plan). Do not pre-convert to UTC; trailing Z/offset on startAt/endAt is ignored.',
				inputSchema: {
					type: 'object',
					properties: {
						segmentId: { type: 'number' },
						type: { type: 'string', enum: [...SEGMENT_TYPES] },
						title: { type: 'string' },
						startAt: {
							type: 'string',
							description:
								'Local wall-clock start in startTz: YYYY-MM-DDTHH:mm[:ss]. Digits are the clock face at the place. Do not convert to UTC. Trailing Z/offset is ignored.'
						},
						startTz: {
							type: 'string',
							description: 'IANA timezone for startAt wall clock (e.g. America/Chicago, Asia/Bangkok).'
						},
						endAt: {
							type: 'string',
							description: 'Local wall-clock end in endTz (same rules as startAt).'
						},
						endTz: {
							type: 'string',
							description: 'IANA timezone for endAt wall clock.'
						},
						cityName: { type: 'string' },
						countryCode: { type: 'string' },
						admin1Code: {
							type: 'string',
							description: 'State/province/territory (GeoNames admin1 code) when applicable'
						},
						cityLat: { type: 'number' },
						cityLng: { type: 'number' },
						location: { type: 'string' },
						venue: { type: 'string', description: 'Venue or street address shown in the itinerary editor' },
						confirmationNumber: { type: 'string' },
						notes: { type: 'string' },
						details: { type: 'object' },
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
				name: 'roamarr_trip_day_optimize',
				description:
					'Optimize the visiting order of one trip day using nearest-neighbor + 2-opt over haversine distances. Only untimed (date-only, midnight start) segments with coordinates are reordered; timed segments keep their time order. Without confirm: true this returns the proposed order as a preview and changes nothing; with confirm: true the new per-day order is persisted.',
				inputSchema: {
					type: 'object',
					properties: {
						tripId: { type: 'number' },
						date: { type: 'string', description: 'ISO date YYYY-MM-DD (local trip day)' },
						confirm: { type: 'boolean', description: 'Must be true to apply the optimized order' }
					},
					required: ['tripId', 'date']
				}
			},
			{
				name: 'roamarr_trip_day_directions_url',
				description:
					'Build a Google Maps directions URL for one trip day from its coordinate-bearing segments in display order (untimed by optimized order first, then timed by local time). Returns null when the day has fewer than two mappable points.',
				inputSchema: {
					type: 'object',
					properties: {
						tripId: { type: 'number' },
						date: { type: 'string', description: 'ISO date YYYY-MM-DD (local trip day)' }
					},
					required: ['tripId', 'date']
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
						category: { type: 'string' },
						exchangeRate: { type: 'integer', description: 'Rate × 10000 (10000 = 1.0)' },
						baseAmount: { type: 'integer', description: 'Amount in cents in base currency' },
						paidByCompanionId: { type: 'number' },
						splitAmong: { type: 'array', items: { oneOf: [{ type: 'string', enum: ['owner'] }, { type: 'number' }] } }
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
				description: 'Update a reminder. Pass either the raw fields (name, description, fireAt, refId) or the custom fields (title, customNote, offsetMinutes) in one call, not a mix of both.',
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
						type: { type: 'string', enum: [...TRAVEL_DOCUMENT_TYPES] },
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
						mailHoldLeadDays: { type: 'integer' },
						themeId: { type: 'string' },
						temperatureUnit: { type: 'string', enum: ['c', 'f'] },
						timeFormat: { type: 'string', enum: ['12h', '24h'] }
					}
				}
			},
			{
				name: 'roamarr_notification_channels_get',
				description: 'Get your notification channel preferences (email/webhook/ntfy).',
				inputSchema: { type: 'object', properties: {} }
			},
			{
				name: 'roamarr_notification_channels_update',
				description: 'Update your notification channel preferences.',
				inputSchema: {
					type: 'object',
					properties: {
						emailNotifications: { type: 'boolean' },
						webhookNotifications: { type: 'boolean' },
						ntfyNotifications: { type: 'boolean' }
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
			// ---- Round 4: saved places library ----
			{
				name: 'roamarr_saved_places_list',
				description: 'List your saved places (POI library), optionally filtered. Cursor-paginated.',
				inputSchema: {
					type: 'object',
					properties: {
						categoryId: { type: 'number' },
						status: { type: 'string', enum: ['planned', 'visited'] },
						favorite: { type: 'boolean' },
						q: { type: 'string', description: 'Free-text search over name/address/notes' },
						limit: { type: 'integer', description: '1-200, default 50' },
						cursor: { type: 'string' }
					}
				}
			},
			{
				name: 'roamarr_saved_places_get',
				description: 'Get one saved place by id.',
				inputSchema: {
					type: 'object',
					properties: { placeId: { type: 'number' } },
					required: ['placeId']
				}
			},
			{
				name: 'roamarr_saved_places_create',
				description: 'Create a saved place. priceCents is minor currency units.',
				inputSchema: {
					type: 'object',
					properties: {
						name: { type: 'string' },
						categoryId: { type: 'number' },
						address: { type: 'string' },
						cityId: { type: 'number', description: 'GeoNames geoname_id' },
						lat: { type: 'number' },
						lng: { type: 'number' },
						durationMin: { type: 'integer' },
						priceCents: { type: 'integer' },
						description: { type: 'string' },
						status: { type: 'string', enum: ['planned', 'visited'] },
						favorite: { type: 'boolean' }
					},
					required: ['name']
				}
			},
			{
				name: 'roamarr_saved_places_update',
				description: 'Update a saved place by id. Only provided fields change.',
				inputSchema: {
					type: 'object',
					properties: {
						placeId: { type: 'number' },
						name: { type: 'string' },
						categoryId: { type: 'number', nullable: true },
						address: { type: 'string', nullable: true },
						cityId: { type: 'number', nullable: true },
						lat: { type: 'number', nullable: true },
						lng: { type: 'number', nullable: true },
						durationMin: { type: 'integer', nullable: true },
						priceCents: { type: 'integer', nullable: true },
						description: { type: 'string', nullable: true },
						status: { type: 'string', enum: ['planned', 'visited'] },
						favorite: { type: 'boolean' }
					},
					required: ['placeId']
				}
			},
			{
				name: 'roamarr_saved_places_delete',
				description: 'Delete a saved place by id.',
				inputSchema: {
					type: 'object',
					properties: { placeId: { type: 'number' },
					confirm: { type: "boolean", description: "Must be true to confirm destructive action" },},
					required: ['placeId']
				}
			},
			{
				name: 'roamarr_saved_places_mark_visited',
				description: 'Mark a saved place as visited (records visited timestamp).',
				inputSchema: {
					type: 'object',
					properties: { placeId: { type: 'number' } },
					required: ['placeId']
				}
			},
			{
				name: 'roamarr_saved_places_unmark_visited',
				description: 'Return a visited saved place to planned.',
				inputSchema: {
					type: 'object',
					properties: { placeId: { type: 'number' } },
					required: ['placeId']
				}
			},
			{
				name: 'roamarr_place_category_list',
				description: 'List your saved-place categories (seeds defaults on first use).',
				inputSchema: { type: 'object', properties: {} }
			},
			{
				name: 'roamarr_place_category_create',
				description: 'Create a saved-place category. color is a hex value like #2f9e44.',
				inputSchema: {
					type: 'object',
					properties: { name: { type: 'string' }, color: { type: 'string' } },
					required: ['name']
				}
			},
			{
				name: 'roamarr_place_category_update',
				description: 'Rename and/or recolor a saved-place category. Omitted fields keep their current value.',
				inputSchema: {
					type: 'object',
					properties: { categoryId: { type: 'number' }, name: { type: 'string' }, color: { type: 'string' } },
					required: ['categoryId']
				}
			},
			{
				name: 'roamarr_place_category_delete',
				description: 'Delete a saved-place category. Places in it are kept but unlinked.',
				inputSchema: {
					type: 'object',
					properties: { categoryId: { type: 'number' },
					confirm: { type: "boolean", description: "Must be true to confirm destructive action" },},
					required: ['categoryId']
				}
			},
			{
				name: 'roamarr_saved_places_search',
				description: 'Search OpenStreetMap (Nominatim) for a place to save; returns name/address/coords candidates.',
				inputSchema: {
					type: 'object',
					properties: {
						query: { type: 'string' },
						limit: { type: 'integer', description: '1-20, default 8' }
					},
					required: ['query']
				}
			},
			{
				name: 'roamarr_saved_places_import',
				description: 'Bulk-import saved places from structured rows. Duplicates (exact name or within 50 m) are skipped by default.',
				inputSchema: {
					type: 'object',
					properties: {
						rows: {
							type: 'array',
							description: 'Up to 10,000 rows',
							items: {
								type: 'object',
								properties: {
									name: { type: 'string' },
									lat: { type: 'number' },
									lng: { type: 'number' },
									address: { type: 'string' },
									description: { type: 'string' },
									category: { type: 'string', description: 'Category name matched case-insensitively against existing categories' }
								},
								required: ['name']
							}
						},
						categoryId: { type: 'number', description: 'Bulk category override for every imported row' },
						skipDuplicates: { type: 'boolean', description: 'Default true' },
						confirm: { type: 'boolean', description: 'Must be true to confirm the bulk import' }
					},
					required: ['rows', 'confirm']
				}
			},
			{
				name: 'roamarr_place_links_list',
				description: 'List external links attached to a saved place. Cursor-paginated.',
				inputSchema: {
					type: 'object',
					properties: {
						placeId: { type: 'number' },
						limit: { type: 'integer', description: '1-200, default 50' },
						cursor: { type: 'string' }
					},
					required: ['placeId']
				}
			},
			{
				name: 'roamarr_place_links_create',
				description: 'Attach an external link (http/https URL) to a saved place.',
				inputSchema: {
					type: 'object',
					properties: {
						placeId: { type: 'number' },
						label: { type: 'string' }, url: { type: 'string' }, notes: { type: 'string' }
					},
					required: ['placeId', 'label', 'url']
				}
			},
			{
				name: 'roamarr_place_links_update',
				description: 'Update a saved-place link by id. Only provided fields change.',
				inputSchema: {
					type: 'object',
					properties: {
						linkId: { type: 'number' },
						label: { type: 'string' }, url: { type: 'string' }, notes: { type: 'string', nullable: true }
					},
					required: ['linkId']
				}
			},
			{
				name: 'roamarr_place_links_delete',
				description: 'Delete a saved-place link by id.',
				inputSchema: {
					type: 'object',
					properties: { linkId: { type: 'number' },
					confirm: { type: "boolean", description: "Must be true to confirm destructive action" },},
					required: ['linkId']
				}
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
				name: 'roamarr_trip_day_notes_list',
				description: 'List per-day notes for a trip itinerary.',
				inputSchema: {
					type: 'object',
					properties: { tripId: { type: 'number' } },
					required: ['tripId']
				}
			},
			{
				name: 'roamarr_trip_day_notes_set',
				description: 'Set (upsert) the note for one trip day.',
				inputSchema: {
					type: 'object',
					properties: {
						tripId: { type: 'number' },
						date: { type: 'string', description: 'Local trip day, YYYY-MM-DD' },
						icon: { type: 'string', description: 'Optional icon name (document, info, warning, star, reminder); omit or empty for none' },
						body: { type: 'string' }
					},
					required: ['tripId', 'date', 'body']
				}
			},
			{
				name: 'roamarr_trip_day_notes_delete',
				description: 'Delete the note for one trip day.',
				inputSchema: {
					type: 'object',
					properties: { tripId: { type: 'number' }, date: { type: 'string', description: 'Local trip day, YYYY-MM-DD' },
					confirm: { type: "boolean", description: "Must be true to confirm destructive action" },},
					required: ['tripId', 'date']
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
						text: { type: 'string', description: 'Task text, 1-200 characters' },
						dueDate: { type: 'string', description: 'Optional due date, YYYY-MM-DD' }
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
				name: 'roamarr_mail_hold_list',
				description: 'List mail holds for a trip the caller can edit. Holds show when a home is empty, so read-only collaborators, public share links, and calendar feeds do not receive them.',
				inputSchema: {
					type: 'object',
					properties: { tripId: { type: 'number' } },
					required: ['tripId']
				}
			},
			{
				name: 'roamarr_mail_hold_create',
				description: 'Create a mail hold for a trip. Carrier defaults to USPS. endDate must be on or after startDate. A USPS hold longer than 30 days is saved and returned with a warning.',
				inputSchema: {
					type: 'object',
					properties: {
						tripId: { type: 'number' },
						carrier: { type: 'string' },
						startDate: { type: 'string', description: 'YYYY-MM-DD' },
						endDate: { type: 'string', description: 'YYYY-MM-DD' },
						confirmationNumber: { type: 'string' },
						addressLabel: { type: 'string' },
						notes: { type: 'string' },
						status: { type: 'string', enum: ['requested', 'active', 'ended', 'cancelled'] }
					},
					required: ['tripId', 'startDate', 'endDate']
				}
			},
			{
				name: 'roamarr_mail_hold_update',
				description: 'Update a mail hold. Omitted fields stay as they are. Rescheduling or cancelling replaces the end reminder.',
				inputSchema: {
					type: 'object',
					properties: {
						holdId: { type: 'number' },
						carrier: { type: 'string' },
						startDate: { type: 'string' },
						endDate: { type: 'string' },
						confirmationNumber: { type: 'string' },
						addressLabel: { type: 'string' },
						notes: { type: 'string' },
						status: { type: 'string', enum: ['requested', 'active', 'ended', 'cancelled'] }
					},
					required: ['holdId']
				}
			},
			{
				name: 'roamarr_mail_hold_delete',
				description: 'Delete a mail hold and its end reminder.',
				inputSchema: {
					type: 'object',
					properties: {
						holdId: { type: 'number' },
						confirm: { type: 'boolean', description: 'Must be true to confirm destructive action' }
					},
					required: ['holdId']
				}
			},
			{
				name: 'roamarr_mail_hold_coverage',
				description: 'Report uncovered away days, each hold renewal date, and a suggested next 30-day window. Requires edit access to the trip.',
				inputSchema: {
					type: 'object',
					properties: { tripId: { type: 'number' } },
					required: ['tripId']
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
						status: { type: 'string', enum: ['needed', 'in_progress', 'complete', 'not_needed'] },
						dueDate: { type: 'string', description: 'Due date as YYYY-MM-DD; an empty string clears it' },
						notes: { type: 'string', description: 'Free-text notes (max 2000 characters)' }
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
				description:
					'Search across your trips, segments, and saved places. Uses contextual semantic ranking (local MiniLM + MongrelDB ANN) when an admin has enabled embeddings; otherwise substring match on name, destination, and segment titles. Returns trips plus optional hits[] (place hits carry a place projection with name, category, coordinates, and status) and a semantic flag.',
				inputSchema: {
					type: 'object',
					properties: {
						query: {
							type: 'string',
							description:
								'Natural-language or keyword query (e.g. "spring cherry blossoms in Japan" or "Tokyo").'
						}
					},
					required: ['query']
				}
			},
			{
				name: 'roamarr_gallery_list',
				description:
					'List gallery photos for a saved place or a trip (captions and order). Image upload is web-only; MCP cannot transfer binary files.',
				inputSchema: {
					type: 'object',
					properties: {
						ownerType: { type: 'string', enum: ['place', 'trip'] },
						ownerId: { type: 'number' }
					},
					required: ['ownerType', 'ownerId']
				}
			},
			{
				name: 'roamarr_gallery_remove',
				description: 'Remove a gallery photo and delete its stored image.',
				inputSchema: {
					type: 'object',
					properties: { imageId: { type: 'number' },
					confirm: { type: "boolean", description: "Must be true to confirm destructive action" },},
					required: ['imageId']
				}
			},
			{
				name: 'roamarr_gallery_reorder',
				description:
					'Reorder a gallery. imageIds must list every current image id exactly once, in the desired order.',
				inputSchema: {
					type: 'object',
					properties: {
						ownerType: { type: 'string', enum: ['place', 'trip'] },
						ownerId: { type: 'number' },
						imageIds: { type: 'array', items: { type: 'number' } }
					},
					required: ['ownerType', 'ownerId', 'imageIds']
				}
			},
			{
				name: 'roamarr_gallery_set_caption',
				description: 'Set or clear (empty string) the caption of a gallery photo.',
				inputSchema: {
					type: 'object',
					properties: {
						imageId: { type: 'number' },
						caption: { type: 'string', description: 'Up to 200 characters; empty clears' }
					},
					required: ['imageId', 'caption']
				}
			},
			{
				name: 'roamarr_attachment_upload',
				description:
					'Upload a PDF, JPEG, PNG, WebP, or GPX file onto a trip or one itinerary segment (the trip Documents tab). Pass tripId, segmentId, or both. contentBase64 is the raw file bytes (standard or URL-safe base64). No size limit. Optional label (200 characters) and notes (2000). This is not an expense receipt or a gallery photo.',
				inputSchema: {
					type: 'object',
					properties: {
						tripId: { type: 'number', description: 'Trip to attach the file to. Optional when segmentId is set.' },
						segmentId: {
							type: 'number',
							description: 'Itinerary segment on that trip. Omit for a whole-trip file.'
						},
						filename: { type: 'string', description: 'Original file name, without a directory.' },
						mimeType: {
							type: 'string',
							description: 'image/jpeg, image/png, image/webp, application/pdf, or a GPX type for a .gpx file.'
						},
						contentBase64: { type: 'string', description: 'Base64-encoded file bytes.' },
						label: { type: 'string', description: 'Optional display label, up to 200 characters. Defaults to the filename.' },
						notes: { type: 'string', description: 'Optional notes, up to 2000 characters.' }
					},
					required: ['filename', 'mimeType', 'contentBase64']
				}
			},
			{
				name: 'roamarr_attachment_list',
				description:
					'List files attached to a trip or one segment. Pass tripId, segmentId, or both. Cursor-paginated. Each id is the trip document id used by roamarr_attachment_get and roamarr_attachment_delete.',
				inputSchema: {
					type: 'object',
					properties: {
						tripId: { type: 'number' },
						segmentId: { type: 'number', description: 'When set, only files on this segment are returned.' },
						limit: { type: 'integer', description: '1-200, default 50' },
						cursor: { type: 'string' }
					}
				}
			},
			{
				name: 'roamarr_attachment_get',
				description:
					'Read one trip or segment file by documentId. Always returns metadata. Set includeContent to true to also return the full file as contentBase64, whatever its size. Optional offset and length (bytes) return just that slice for clients that prefer chunked reads; the result reports totalBytes, contentOffset, contentBytes, complete, and nextOffset.',
				inputSchema: {
					type: 'object',
					properties: {
						documentId: { type: 'number', description: 'Trip document id from roamarr_attachment_list.' },
						tripId: { type: 'number', description: 'Optional. When set, the file must belong to this trip.' },
						includeContent: {
							type: 'boolean',
							description: 'When true, include the file bytes as base64. The whole file is returned unless offset/length are set.'
						},
						offset: {
							type: 'integer',
							description: 'Optional first byte to return (0-based). Default 0. Only used with includeContent.'
						},
						length: {
							type: 'integer',
							description: 'Optional maximum number of bytes to return from offset. Default: through the end of the file.'
						}
					},
					required: ['documentId']
				}
			},
			{
				name: 'roamarr_attachment_delete',
				description: 'Delete a trip or segment file by documentId. Requires confirm: true.',
				inputSchema: {
					type: 'object',
					properties: {
						documentId: { type: 'number' },
						tripId: { type: 'number', description: 'Optional. When set, the file must belong to this trip.' },
						confirm: { type: 'boolean', description: 'Must be true to confirm this destructive action.' }
					},
					required: ['documentId']
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
				const page = paginateList(tripIds, args, (id) => id);
				return textResult({
					items: page.items.map((id) => {
						const t = safeTripProjection(id, userId, scopes);
						return {
							id: t.id, name: t.name, destination: 'destination' in t ? t.destination : null,
							destinationCountryCode: t.destinationCountryCode,
							destinationAdmin1Code: 'destinationAdmin1Code' in t ? t.destinationAdmin1Code : null,
							destinationCityName: t.destinationCityName,
							startDate: t.startDate, endDate: t.endDate, status: t.status
						};
					}),
					nextCursor: page.nextCursor,
				});
			}
			case 'roamarr_trip_get': {
				if (!hasScope(scopes, 'trips:read')) return scopeError('trips:read');
				const tripId = Number(args.tripId);
				const projected = safeTripProjection(tripId, userId, scopes);
				return textResult({ trip: projected });
			}
			case 'roamarr_trip_create': {
				if (!hasScope(scopes, 'trips:write')) return scopeError('trips:write');
				const validation = validateToolInput(args as Record<string, unknown>);
				if (!validation.ok) return textResult({ error: validation.error });
				const parsed = parseTripFieldsArgs(args as Record<string, unknown>, null);
				if (!parsed.ok) return textResult({ error: parsed.error });
				const { name, ...fields } = parsed.fields;
				if (name === undefined) return textResult({ error: 'name is required' }); // unreachable after the parser; keeps the type honest without `!`
				const destination = destinationCityPatch(args);
				const trip = tripsRepo.createTrip(userId, {
					destination: args.destination as string | undefined,
					...destination,
					tags: Array.isArray(args.tags) ? JSON.stringify(args.tags) : undefined,
					...fields,
					name
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
				const existing = requireEditableTrip(userId, tripId);
				// Same guard as the web edit action: an editor whose share lacks
				// showDetails must not overwrite the owner's private notes.
				if (args.notes !== undefined && !canViewDetails(userId, existing)) {
					return textResult({
						error: 'notes cannot be changed without permission to view private trip details; omit notes and retry'
					});
				}
				const parsed = parseTripFieldsArgs(args as Record<string, unknown>, existing);
				if (!parsed.ok) return textResult({ error: parsed.error });
				const destination = destinationCityPatch(args, existing);
				const updated = tripsRepo.updateTrip(tripId, {
					destination: args.destination as string | undefined,
					...destination,
					tags: Array.isArray(args.tags) ? JSON.stringify(args.tags) : undefined,
					...parsed.fields
				});
				if (!updated) return textResult({ error: 'Trip not found' });
				logAudit(userId, 'mcp_trip_update', 'trip', tripId, {});
				return textResult({
					id: updated.id,
					name: updated.name,
					status: effectiveTripStatus(updated, todayForUser(userId))
				});
			}
			case 'roamarr_day_plan': {
				// Segment creation needs segments:write. Goes through addSegment
				// helper which enforces trip ownership, validates the type,
				// converts local time, creates flight reminders, etc.
				if (!hasScope(scopes, 'segments:write')) return scopeError('segments:write');
				const validation = validateToolInput(args as Record<string, unknown>);
				if (!validation.ok) return { content: [{ type: 'text' as const, text: validation.error }], isError: true };
				const { addSegment } = await import('./segments');
				const countryCode = (args.countryCode as string) || undefined;
				const cityNameArg = (args.cityName as string) || undefined;
				const admin1Code = (args.admin1Code as string) || undefined;
				const latArg = args.cityLat as number | undefined;
				const lngArg = args.cityLng as number | undefined;
				const hasCoords = latArg != null && lngArg != null;
				const city =
					countryCode && cityNameArg
						? findCity(countryCode, cityNameArg, admin1Code)
						: null;
				const seg = addSegment(userId, Number(args.tripId), {
					type: String(args.type ?? 'event') as Parameters<typeof addSegment>[2]['type'],
					title: String(args.title ?? ''),
					localStart: String(args.startAt ?? ''),
					startTz: String(args.startTz ?? 'UTC'),
					endAt: (args.endAt as string) || undefined,
					endTz: (args.endTz as string) || undefined,
					cityName: city?.name ?? cityNameArg,
					countryCode,
					admin1Code: admin1Code ?? city?.admin1Code ?? undefined,
					cityLat: hasCoords ? latArg : (city?.lat ?? undefined),
					cityLng: hasCoords ? lngArg : (city?.lng ?? undefined),
					location: (args.location as string) || undefined,
					venue:
						(args.venue as string) ||
						(String(args.type) === 'hotel' ? (args.location as string) : undefined),
					confirmationNumber: (args.confirmationNumber as string) || undefined,
					details: {
						...((args.details as Record<string, unknown> | undefined) ?? {}),
						...(args.notes ? { notes: args.notes } : {})
					},
					paymentStatus: args.paymentStatus as string | undefined
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
				const parsed = parseBudgetSetArgs(args as Record<string, unknown>);
				if (!parsed.ok) {
					return { content: [{ type: 'text' as const, text: parsed.error }], isError: true };
				}
				const validation = validateToolInput(args as Record<string, unknown>);
				if (!validation.ok) return textResult({ error: validation.error });
				requireEditableTrip(userId, parsed.tripId);
				const row = setBudget(parsed.tripId, parsed.category, parsed.amount, parsed.currency);
				logAudit(userId, 'mcp_budget_set', 'trip_budget_category', parsed.tripId, {
					category: parsed.category, amount: parsed.amount, currency: parsed.currency
				});
				return textResult({ ok: true, tripId: parsed.tripId, category: parsed.category, amount: parsed.amount, currency: row.currency });
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
					if (typeof args.name !== 'string' || !args.name.trim()) return { content: [{ type: 'text' as const, text: 'name is required' }], isError: true };
					if (args.name.length > 200) return { content: [{ type: 'text' as const, text: 'name must be a string up to 200 chars' }], isError: true };
					if (args.description != null && (typeof args.description !== 'string' || args.description.length > 1000)) return { content: [{ type: 'text' as const, text: 'description must be a string up to 1000 chars' }], isError: true };
					const parsedFireAt =
						typeof args.fireAt === 'string' && args.fireAt.trim() !== ''
							? DateTime.fromISO(args.fireAt.trim(), { zone: 'utc' })
							: null;
					const fireAtIso = parsedFireAt?.isValid ? parsedFireAt.toUTC().toISO() : null;
					if (!fireAtIso) return { content: [{ type: 'text' as const, text: 'fireAt must be a valid ISO date and time' }], isError: true };
					const refId = parseMailHoldId(args.refId);
					if (refId === null) return { content: [{ type: 'text' as const, text: 'refId must be a positive integer' }], isError: true };
					if (refType === 'trip') requireViewableTrip(userId, refId);
					if (refType === 'document') { const { getTravelDocumentById } = await import('./repositories/profileRepo'); if (!getTravelDocumentById(refId, userId)) return { content: [{ type: 'text' as const, text: 'Document not found' }], isError: true }; }
					const reminder = createReminder({ userId, kind: 'custom', refType, refId, fireAt: fireAtIso, name: args.name.trim(), description: String(args.description ?? '').trim() || null });
					logAudit(userId, 'mcp_reminder_add', 'reminder', reminder.id, {});
					return textResult({ id: reminder.id });
				}
				const { upsertCustomReminder } = await import('./reminders');
				const tripId = parseMailHoldId(args.tripId);
				if (tripId === null) return { content: [{ type: 'text' as const, text: 'tripId must be a positive integer' }], isError: true };
				let offset: number;
				if (args.offsetMinutes == null) {
					offset = 60;
				} else {
					const parsedOffset = parseReminderOffsetMinutes(args.offsetMinutes);
					if (parsedOffset === null) return { content: [{ type: 'text' as const, text: 'offsetMinutes must be an integer between -10080 and 10080' }], isError: true };
					offset = parsedOffset;
				}
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
				const raw = args.segmentId;
				const segId = Number(raw);
				if (typeof raw !== 'number' || !Number.isSafeInteger(segId) || segId <= 0) {
					return { content: [{ type: 'text' as const, text: 'segmentId must be a positive integer' }], isError: true };
				}
				const parsed = parseSegmentUpdateArgs(args as Record<string, unknown>);
				if (!parsed.ok) return { content: [{ type: 'text' as const, text: parsed.error }], isError: true };
				const validation = validateToolInput(args as Record<string, unknown>);
				if (!validation.ok) return { content: [{ type: 'text' as const, text: validation.error }], isError: true };
				const patch = parsed.patch;
				const { patchSegment } = await import('./segments');
				const existing = segmentsRepo.getSegmentById(segId);
				patchSegment(userId, segId, {
					type: patch.type as import('$lib/segmentLabels').SegmentType | undefined,
					title: patch.title as string | undefined,
					startAt: patch.startAt as string | undefined,
					startTz: patch.startTz as string | undefined,
					endAt: patch.endAt as string | null | undefined,
					endTz: patch.endTz as string | undefined,
					cityName: patch.cityName as string | null | undefined,
					countryCode: patch.countryCode as string | null | undefined,
					admin1Code: patch.admin1Code as string | null | undefined,
					cityLat: patch.cityLat as number | null | undefined,
					cityLng: patch.cityLng as number | null | undefined,
					location: patch.location as string | null | undefined,
					venue:
						patch.venue !== undefined
							? (patch.venue as string | null)
							: existing?.type === 'hotel'
								? (patch.location as string | undefined)
								: undefined,
					confirmationNumber: patch.confirmationNumber as string | null | undefined,
					notes: patch.notes as string | undefined,
					details: patch.details as Record<string, unknown> | undefined,
					paymentStatus: patch.paymentStatus as string | undefined
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
			case 'roamarr_trip_day_optimize': {
				if (!hasScope(scopes, 'segments:write')) return scopeError('segments:write');
				const { optimizeTripDay, planTripDay } = await import('./tripDayOptimize');
				const tripId = Number(args.tripId);
				const date = String(args.date);
				if (args.confirm === true) {
					const applied = optimizeTripDay(userId, tripId, date);
					logAudit(userId, 'mcp_trip_day_optimize', 'trip', tripId, { date, applied: applied.applied });
					return textResult({ ok: true, ...applied });
				}
				// Preview: proposed order only, nothing persisted.
				const preview = planTripDay(userId, tripId, date);
				return textResult({ ok: true, preview: true, ...preview });
			}
			case 'roamarr_trip_day_directions_url': {
				if (!hasScope(scopes, 'segments:read')) return scopeError('segments:read');
				const { tripDayDirectionsPoints } = await import('./tripDayOptimize');
				const { buildGoogleMapsDirectionsUrl } = await import('$lib/googleMaps');
				const tripId = Number(args.tripId);
				const date = String(args.date);
				const points = tripDayDirectionsPoints(userId, tripId, date);
				return textResult({ ok: true, tripId, date, url: buildGoogleMapsDirectionsUrl(points) });
			}
			case 'roamarr_trip_delete': {
				if (!hasScope(scopes, 'trips:write')) return scopeError('trips:write');
				const confirmErr = requireConfirm(args, 'roamarr_trip_delete');
				if (confirmErr) return confirmErr;
				const raw = args.tripId;
				const tripId = Number(raw);
				if (typeof raw !== 'number' || !Number.isSafeInteger(tripId) || tripId <= 0) {
					return { content: [{ type: 'text' as const, text: 'tripId must be a positive integer' }], isError: true };
				}
				// Use the same helper as the web UI: cancels trip + segment
				// reminders, then deletes, then logs trip_delete. MCP logs
				// its own mcp_trip_delete on top for traceability.
				const { _deleteTrip } = await import('../../routes/trips/[id]/edit/+page.server');
				await _deleteTrip(userId, tripId);
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
				const raw = args.expenseId;
				const id = Number(raw);
				if (typeof raw !== 'number' || !Number.isSafeInteger(id) || id <= 0) {
					return { content: [{ type: 'text' as const, text: 'expenseId must be a positive integer' }], isError: true };
				}
				const { updateTripExpense } = await import('./tripExpenses/repository');
				const { toCents, optString } = await import('./mcpHelpers');
				const updated = updateTripExpense(userId, id, {
					description: optString(args.description, 500) ?? undefined,
					amount: args.amount != null ? toCents(args.amount, 'amount') : undefined,
					currency: optString(args.currency) ?? undefined,
					category: optString(args.category) ?? undefined,
					exchangeRate: args.exchangeRate != null ? toCents(args.exchangeRate, 'exchangeRate') : undefined,
					baseAmount: args.baseAmount != null ? toCents(args.baseAmount, 'baseAmount') : undefined,
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
				const { parsePositiveId } = await import('./params');
				const toPositiveId = (value: unknown): number | null =>
					typeof value === 'number' || typeof value === 'string' ? parsePositiveId(String(value)) : null;
				const itemId = toPositiveId(args.itemId);
				if (itemId === null)
					return { content: [{ type: 'text' as const, text: 'itemId must be a positive integer' }], isError: true };
				const { toggleItemById } = await import('./tripChecklists');
				const updated = toggleItemById(userId, itemId);
				logAudit(userId, 'mcp_packing_toggle', 'trip_checklist_item', itemId, { packed: updated.packed });
				return textResult({ ok: true, itemId, packed: updated.packed });
			}
			case 'roamarr_packing_item_update': {
				if (!hasScope(scopes, 'packing:write')) return scopeError('packing:write');
				const { parsePositiveId } = await import('./params');
				const toPositiveId = (value: unknown): number | null =>
					typeof value === 'number' || typeof value === 'string' ? parsePositiveId(String(value)) : null;
				const itemId = toPositiveId(args.itemId);
				if (itemId === null)
					return { content: [{ type: 'text' as const, text: 'itemId must be a positive integer' }], isError: true };
				const text = args.text;
				const hasText = text != null;
				const hasAssignee = args.assignedToCompanionId !== undefined;
				if (!hasText && !hasAssignee)
					return { content: [{ type: 'text' as const, text: 'Provide text or assignedToCompanionId to update' }], isError: true };
				if (hasText && typeof text !== 'string')
					return { content: [{ type: 'text' as const, text: 'text must be a string' }], isError: true };
				let assignee: number | null = null;
				if (hasAssignee && args.assignedToCompanionId !== null) {
					assignee = toPositiveId(args.assignedToCompanionId);
					if (assignee === null)
						return { content: [{ type: 'text' as const, text: 'assignedToCompanionId must be a positive integer or null' }], isError: true };
				}
				if (hasAssignee) {
					const { getChecklistItemTripId, updateChecklistItem } = await import('./repositories/tripMiscRepo');
					const { requireCompanionOnTrip } = await import('./ownership');
					const tripId = getChecklistItemTripId(itemId);
					if (tripId == null) throw error(404, 'Item not found');
					requireEditableTrip(userId, tripId);
					requireCompanionOnTrip(assignee, tripId);
					if (typeof text === 'string') (await import('./tripChecklists')).renameItem(userId, itemId, text);
					updateChecklistItem(itemId, { assignedToCompanionId: assignee });
				} else if (typeof text === 'string') {
					(await import('./tripChecklists')).renameItem(userId, itemId, text);
				}
				logAudit(userId, 'mcp_packing_update', 'trip_checklist_item', itemId, {});
				return textResult({ ok: true, itemId });
			}
			case 'roamarr_packing_item_delete': {
				if (!hasScope(scopes, 'packing:write')) return scopeError('packing:write');
				const confirmErr = requireConfirm(args, 'roamarr_packing_item_delete');
				if (confirmErr) return confirmErr;
				const { parsePositiveId } = await import('./params');
				const toPositiveId = (value: unknown): number | null =>
					typeof value === 'number' || typeof value === 'string' ? parsePositiveId(String(value)) : null;
				const itemId = toPositiveId(args.itemId);
				if (itemId === null)
					return { content: [{ type: 'text' as const, text: 'itemId must be a positive integer' }], isError: true };
				const { deleteItemById } = await import('./tripChecklists');
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
				const id = Number(args.reminderId);
				if (!Number.isSafeInteger(id) || id <= 0) {
					return { content: [{ type: 'text' as const, text: 'reminderId must be a positive integer' }], isError: true };
				}
				// title maps to name and customNote to description, and offsetMinutes re-arms
				// fireAt from the trip start, so a call that mixes both groups is ambiguous.
				const hasRaw = args.fireAt != null || args.name != null || args.description != null || args.refId != null;
				const hasCustom = args.title !== undefined || args.customNote !== undefined || args.offsetMinutes !== undefined;
				if (hasRaw && hasCustom) {
					return { content: [{ type: 'text' as const, text: 'roamarr_reminder_update takes either name/description/fireAt/refId or title/customNote/offsetMinutes per call, not both. Send the other group in a second call.' }], isError: true };
				}
				if (!hasRaw && !hasCustom) return textResult({ ok: true, reminderId: id, updated: false });
				if (hasRaw) {
					const { getReminderById } = await import('./repositories/remindersRepo');
					const reminder = getReminderById(id);
					if (!reminder || reminder.userId !== userId) return { content: [{ type: 'text' as const, text: 'Reminder not found' }], isError: true };
					const { safeUpdateReminderFields } = await import('./reminders');
					safeUpdateReminderFields(userId, id, {
						name: args.name == null ? undefined : (args.name as string),
						description: args.description == null ? undefined : (args.description as string),
						fireAt: args.fireAt == null ? undefined : (args.fireAt as string),
						refId: args.refId == null ? undefined : typeof args.refId === 'boolean' ? NaN : Number(args.refId)
					});
					logAudit(userId, 'mcp_reminder_update', 'reminder', id, {});
					return textResult({ ok: true, reminderId: id });
				}
				const { safeUpdateCustomReminder } = await import('./reminders');
				let offsetMinutes: number | undefined;
				if (args.offsetMinutes != null) {
					const parsedOffset = parseReminderOffsetMinutes(args.offsetMinutes);
					if (parsedOffset === null) return { content: [{ type: 'text' as const, text: 'offsetMinutes must be an integer between -10080 and 10080' }], isError: true };
					offsetMinutes = parsedOffset;
				}
				safeUpdateCustomReminder(userId, id, {
					title: args.title as string | undefined,
					customNote: args.customNote as string | undefined,
					offsetMinutes
				});
				logAudit(userId, 'mcp_reminder_update', 'reminder', id, {});
				return textResult({ ok: true, reminderId: id });
			}
			case 'roamarr_reminder_delete': {
				if (!hasScope(scopes, 'reminders:write')) return scopeError('reminders:write');
				const confirmErr = requireConfirm(args, 'roamarr_reminder_delete');
				if (confirmErr) return confirmErr;
				const id = parseMailHoldId(args.reminderId);
				if (id === null) {
					return { content: [{ type: 'text' as const, text: 'reminderId must be a positive integer' }], isError: true };
				}
				const { cancelReminder } = await import('./reminders');
				cancelReminder(userId, id);
				logAudit(userId, 'mcp_reminder_delete', 'reminder', id, {});
				return textResult({ ok: true, reminderId: id });
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
					type: String(args.type) as TravelDocumentType,
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
				if (!Number.isSafeInteger(id) || id <= 0) {
					return { content: [{ type: 'text' as const, text: 'linkId must be a positive integer' }], isError: true };
				}
				const existing = getDocumentLinkById(id);
				if (!existing) return { content: [{ type: 'text' as const, text: 'Link not found' }], isError: true };
				editDocumentLink(userId, existing.tripId, id, {
					label: String(args.label ?? existing.label),
					url: String(args.url ?? existing.url),
					notes: args.notes === undefined ? (existing.notes ?? null) : args.notes === null ? null : String(args.notes)
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
				if (typeof args.tripId !== 'number' || !Number.isSafeInteger(args.tripId) || args.tripId < 1) {
					return { content: [{ type: 'text' as const, text: 'tripId must be a positive integer' }], isError: true };
				}
				const { createShare } = await import('./repositories/tripsRepo');
				const { getUserByEmail } = await import('./repositories/usersRepo');
				const { normalizeEmail } = await import('./users');
				const tripId = args.tripId;
				requireOwnedTrip(userId, tripId);
				const parsed = parseShareArgs(args);
				if (!parsed.ok) return { content: [{ type: 'text' as const, text: parsed.error }], isError: true };
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
					const publicShowDetails = parsed.showDetails ?? false;
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
					permission: parsed.permission ?? 'read',
					showDetails: parsed.showDetails ?? false
				});
				logAudit(userId, 'mcp_share_create', 'trip_share', share.id, { tripId });
				return textResult({ id: share.id, tripId });
			}
			case 'roamarr_share_update': {
				if (!hasScope(scopes, 'sharing:write')) return scopeError('sharing:write');
				const { updateShare, getShareById } = await import('./repositories/tripsRepo');
				if (typeof args.shareId !== 'number' || !Number.isSafeInteger(args.shareId) || args.shareId < 1) {
					return { content: [{ type: 'text' as const, text: 'shareId must be a positive integer' }], isError: true };
				}
				const id = args.shareId;
				const existing = getShareById(id);
				if (!existing) return { content: [{ type: 'text' as const, text: 'Share not found' }], isError: true };
				requireOwnedTrip(userId, existing.tripId);
				const parsed = parseShareArgs(args);
				if (!parsed.ok) return { content: [{ type: 'text' as const, text: parsed.error }], isError: true };
				if (parsed.permission === undefined && parsed.showDetails === undefined) {
					return { content: [{ type: 'text' as const, text: 'provide permission or showDetails to update' }], isError: true };
				}
				const patch: { permission?: SharePermission; showDetails?: boolean } = {};
				if (parsed.permission !== undefined) patch.permission = parsed.permission;
				if (parsed.showDetails !== undefined) patch.showDetails = parsed.showDetails;
				const updated = updateShare(id, patch);
				if (!updated) return { content: [{ type: 'text' as const, text: 'Share not found' }], isError: true };
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
				const { getSettings } = await import('./settings');
				const u = getUserById(userId);
				if (!u) return { content: [{ type: 'text' as const, text: 'User not found' }], isError: true };
				const settings = getSettings();
				return textResult({
					role: u.role,
					displayName: u.display_name,
					timezone: u.timezone,
					defaultCurrency: u.default_currency,
					flightCheckinLeadHours: Number(u.flight_checkin_lead_hours),
					documentExpiryLeadDays: Number(u.document_expiry_lead_days),
					mailHoldLeadDays: Number(u.mail_hold_lead_days ?? 3),
					themeId: u.theme_id,
					temperatureUnit: u.temperature_unit === 'f' ? 'f' : 'c',
					timeFormat: u.time_format === '12h' ? '12h' : '24h',
					// Instance display formats (same values the web UI uses) for mobile clients.
					dateFormat: settings.defaultDateFormat || 'yyyy-MM-dd',
					datetimeFormat: settings.defaultDatetimeFormat || 'yyyy-MM-dd h:mm a'
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
				let mailHoldDays: bigint | undefined;
				if (args.mailHoldLeadDays != null) {
					const v = Number(args.mailHoldLeadDays);
					if (!Number.isInteger(v) || v < 0 || v > 3650) {
						return { content: [{ type: 'text' as const, text: 'mailHoldLeadDays must be an integer 0-3650' }], isError: true };
					}
					mailHoldDays = BigInt(v);
				}
				if (args.temperatureUnit != null && args.temperatureUnit !== 'c' && args.temperatureUnit !== 'f') {
					return { content: [{ type: 'text' as const, text: "temperatureUnit must be 'c' or 'f'" }], isError: true };
				}
				if (args.timeFormat != null && args.timeFormat !== '12h' && args.timeFormat !== '24h') {
					return { content: [{ type: 'text' as const, text: "timeFormat must be '12h' or '24h'" }], isError: true };
				}
				updateUser(userId, {
					display_name: (args.displayName as string | undefined)?.trim() || existing.display_name,
					timezone: (args.timezone as string | undefined) ?? existing.timezone,
					default_currency: (args.defaultCurrency as string | undefined) ?? existing.default_currency,
					flight_checkin_lead_hours: leadHours ?? existing.flight_checkin_lead_hours,
					document_expiry_lead_days: expiryDays ?? existing.document_expiry_lead_days,
					mail_hold_lead_days: mailHoldDays ?? existing.mail_hold_lead_days,
					theme_id: (args.themeId as string | undefined) ?? existing.theme_id,
					temperature_unit: (args.temperatureUnit as 'c' | 'f' | undefined) ?? existing.temperature_unit,
					time_format: (args.timeFormat as '12h' | '24h' | undefined) ?? existing.time_format
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
					webhookNotifications: Boolean(u.webhook_notifications),
					ntfyNotifications: u.ntfy_notifications ?? true
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
				if (args.ntfyNotifications != null) patch.ntfy_notifications = Boolean(args.ntfyNotifications);
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
				const trip = requireViewableTrip(userId, tripId);
				const items = listTripCompanions(tripId);
				return textResult({
					tripId,
					items: canEdit(userId, trip) ? items : items.map(companionViewerProjection)
				});
			}
			case 'roamarr_companion_create': {
				if (!hasScope(scopes, 'companions:write')) return scopeError('companions:write');
				const { insertTripCompanion } = await import('./tripCompanions');
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
					needsCarSeat: (args.needsCarSeat ?? undefined) as boolean | undefined, needsStroller: (args.needsStroller ?? undefined) as boolean | undefined,
					needsCrib: (args.needsCrib ?? undefined) as boolean | undefined, needsKidsMeal: (args.needsKidsMeal ?? undefined) as boolean | undefined,
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
				const { parsePositiveId } = await import('./params');
				const toPositiveId = (value: unknown): number | null =>
					typeof value === 'number' || typeof value === 'string' ? parsePositiveId(String(value)) : null;
				const pollId = toPositiveId(args.pollId);
				if (pollId === null)
					return { content: [{ type: 'text' as const, text: 'Invalid pollId: expected a positive integer' }], isError: true };
				const optionId = toPositiveId(args.optionId);
				if (optionId === null)
					return { content: [{ type: 'text' as const, text: 'Invalid optionId: expected a positive integer' }], isError: true };
				let companionIdArg: number | null = null;
				if (args.companionId != null) {
					companionIdArg = toPositiveId(args.companionId);
					if (companionIdArg === null)
						return { content: [{ type: 'text' as const, text: 'Invalid companionId: expected a positive integer' }], isError: true };
				}
				// Route through tripPolls.castVote so requireEditableTrip
				// (owner OR editor) is enforced, matching the web UI.
				// The previous impl called requireOwnedTrip directly, which
				// blocked editors of shared trips from voting.
				const { getPollById } = await import('./repositories/pollsRepo');
				const { castVote } = await import('./tripPolls');
				const { requireCompanionOnTrip } = await import('./ownership');
				const { getOrCreateOwnerCompanion } = await import('./tripCompanions');
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
				const { parsePositiveId } = await import('./params');
				const toPositiveId = (value: unknown): number | null =>
					typeof value === 'number' || typeof value === 'string' ? parsePositiveId(String(value)) : null;
				const entryId = toPositiveId(args.entryId);
				if (entryId === null)
					return { content: [{ type: 'text' as const, text: 'Invalid entryId: expected a positive integer' }], isError: true };
				// Route through tripJournal.modifyJournalEntry so the entry is
				// re-read, validated, and requireEditableTrip is enforced, matching the web UI.
				const { modifyJournalEntry } = await import('./tripJournal');
				modifyJournalEntry(userId, entryId, { entryDate: args.entryDate as string | undefined, title: args.title as string | undefined, body: args.body as string | undefined });
				logAudit(userId, 'mcp_journal_update', 'trip_journal_entry', entryId, {});
				return textResult({ ok: true, entryId });
			}
			case 'roamarr_journal_delete': {
				if (!hasScope(scopes, 'journal:write')) return scopeError('journal:write');
				const confirmErr = requireConfirm(args, 'roamarr_journal_delete');
				if (confirmErr) return confirmErr;
				const { parsePositiveId } = await import('./params');
				const toPositiveId = (value: unknown): number | null =>
					typeof value === 'number' || typeof value === 'string' ? parsePositiveId(String(value)) : null;
				const entryId = toPositiveId(args.entryId);
				if (entryId === null)
					return { content: [{ type: 'text' as const, text: 'Invalid entryId: expected a positive integer' }], isError: true };
				// Route through tripJournal.removeJournalEntry so the lookup,
				// requireEditableTrip, delete, and canonical audit apply, matching the web UI.
				const { removeJournalEntry } = await import('./tripJournal');
				removeJournalEntry(userId, entryId);
				logAudit(userId, 'mcp_journal_delete', 'trip_journal_entry', entryId, {});
				return textResult({ ok: true, entryId });
			}
			case 'roamarr_trip_day_notes_list': {
				if (!hasScope(scopes, 'day-notes:read')) return scopeError('day-notes:read');
				const { listDayNotes } = await import('./tripDayNotes');
				const tripId = Number(args.tripId);
				return textResult({ tripId, items: listDayNotes(userId, tripId) });
			}
			case 'roamarr_trip_day_notes_set': {
				if (!hasScope(scopes, 'day-notes:write')) return scopeError('day-notes:write');
				const { setDayNote } = await import('./tripDayNotes');
				const tripId = Number(args.tripId);
				const note = setDayNote(userId, tripId, args.date, {
					icon: args.icon != null && String(args.icon).trim() !== '' ? String(args.icon) : null,
					body: String(args.body ?? '')
				});
				return textResult(note);
			}
			case 'roamarr_trip_day_notes_delete': {
				if (!hasScope(scopes, 'day-notes:write')) return scopeError('day-notes:write');
				const confirmErr = requireConfirm(args, 'roamarr_trip_day_notes_delete');
				if (confirmErr) return confirmErr;
				const { deleteDayNote } = await import('./tripDayNotes');
				const tripId = Number(args.tripId);
				deleteDayNote(userId, tripId, args.date);
				return textResult({ ok: true, tripId, date: String(args.date ?? '') });
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
				if (args.dueDate != null && typeof args.dueDate !== 'string') {
					throw error(400, 'dueDate must be a valid date (YYYY-MM-DD)');
				}
				const text = reqString(args.text, 'text', 200);
				const v = new Validator();
				const dueDate = v.date(args.dueDate, 'dueDate') ?? null;
				if (!v.ok()) throw error(400, 'dueDate must be a valid date (YYYY-MM-DD)');
				const { addHomeTask } = await import('./tripHomeTasks');
				const task = addHomeTask(
					userId,
					Number(args.tripId),
					{ text, dueDate },
					'mcp_home_task_create'
				);
				return textResult({ id: task.id });
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
			case 'roamarr_mail_hold_list': {
				if (!hasScope(scopes, 'mail-holds:read')) return scopeError('mail-holds:read');
				const { listMailHolds } = await import('./tripMailHolds');
				const tripId = Number(args.tripId);
				const trip = requireEditableTrip(userId, tripId);
				const includePrivate = canReadPrivateDetails(scopes) && canViewDetails(userId, trip);
				return textResult({ tripId, items: listMailHolds(tripId).map((hold) => projectMailHold(hold, includePrivate)) });
			}
			case 'roamarr_mail_hold_create': {
				if (!hasScope(scopes, 'mail-holds:write')) return scopeError('mail-holds:write');
				const { addMailHold } = await import('./tripMailHolds');
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
			case 'roamarr_mail_hold_update': {
				if (!hasScope(scopes, 'mail-holds:write')) return scopeError('mail-holds:write');
				const holdId = parseMailHoldId(args.holdId);
				if (holdId === null) return { content: [{ type: 'text' as const, text: 'holdId must be a positive integer' }], isError: true };
				const { getMailHoldById } = await import('./repositories/tripMiscRepo');
				const { updateMailHold } = await import('./tripMailHolds');
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
					const { uspsHoldWarning } = await import('./mailHoldCoverage');
					return textResult({
						id: existing.id,
						warning: uspsHoldWarning(existing.carrier, existing.startDate, existing.endDate),
						hold: projectMailHold(existing, includePrivate)
					});
				}
				const updated = updateMailHold(userId, existing.tripId, existing.id, patch);
				return textResult({ id: updated.hold.id, warning: updated.warning, hold: projectMailHold(updated.hold, includePrivate) });
			}
			case 'roamarr_mail_hold_delete': {
				if (!hasScope(scopes, 'mail-holds:write')) return scopeError('mail-holds:write');
				const confirmErr = requireConfirm(args, 'roamarr_mail_hold_delete');
				if (confirmErr) return confirmErr;
				const holdId = parseMailHoldId(args.holdId);
				if (holdId === null) return { content: [{ type: 'text' as const, text: 'holdId must be a positive integer' }], isError: true };
				const { getMailHoldById } = await import('./repositories/tripMiscRepo');
				const { deleteMailHold } = await import('./tripMailHolds');
				const existing = getMailHoldById(holdId);
				if (!existing) return { content: [{ type: 'text' as const, text: 'Mail hold not found' }], isError: true };
				deleteMailHold(userId, existing.tripId, existing.id);
				return textResult({ ok: true, holdId: existing.id });
			}
			case 'roamarr_mail_hold_coverage': {
				if (!hasScope(scopes, 'mail-holds:read')) return scopeError('mail-holds:read');
				const { listMailHolds, mailHoldCoverageForTrip } = await import('./tripMailHolds');
				const tripId = Number(args.tripId);
				const trip = requireEditableTrip(userId, tripId);
				return textResult(mailHoldCoverageForTrip(trip.startDate, trip.endDate, listMailHolds(tripId)));
			}
			case 'roamarr_medication_list': {
				if (!hasScope(scopes, 'medications:read')) return scopeError('medications:read');
				const { listMedicationsForTrip } = await import('./repositories/tripMiscRepo');
				const tripId = Number(args.tripId);
				requireEditableTrip(userId, tripId);
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
				requireEditableTrip(userId, tripId);
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
				requireEditableTrip(userId, tripId);
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
				const { getEntryRequirementById } = await import('./repositories/tripMiscRepo');
				const id = Number(args.requirementId);
				if (!Number.isInteger(id) || id <= 0) {
					return { content: [{ type: 'text' as const, text: 'requirementId must be a positive integer' }], isError: true };
				}
				const r = getEntryRequirementById(id);
				if (!r) return { content: [{ type: 'text' as const, text: 'Requirement not found' }], isError: true };
				const { patchEntryRequirement } = await import('./tripEntryRequirements');
				patchEntryRequirement(userId, r.tripId, id, {
					status: args.status as string | undefined,
					dueDate: args.dueDate as string | null | undefined,
					notes: args.notes as string | null | undefined
				});
				logAudit(userId, 'mcp_entry_requirement_update', 'trip_entry_requirement', id, {});
				return textResult({ ok: true, requirementId: id });
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
			case 'roamarr_saved_places_list': {
			if (!hasScope(scopes, 'saved-places:read')) return scopeError('saved-places:read');
			const { listPlaces, projectPlace } = await import('./places');
			const places = listPlaces(userId, {
				categoryId: args.categoryId != null ? Number(args.categoryId) : undefined,
				status: args.status as 'planned' | 'visited' | undefined,
				favorite: args.favorite === true || undefined,
				search: (args.q as string) ?? undefined
			});
			const page = paginateList(places, args, (p) => p.id);
			return textResult({ items: page.items.map(projectPlace), nextCursor: page.nextCursor });
		}
		case 'roamarr_saved_places_get': {
			if (!hasScope(scopes, 'saved-places:read')) return scopeError('saved-places:read');
			const { getPlaceById, projectPlace } = await import('./places');
			const place = getPlaceById(Number(args.placeId), userId);
			if (!place) return { content: [{ type: 'text' as const, text: 'Place not found' }], isError: true };
			return textResult(projectPlace(place));
		}
		case 'roamarr_saved_places_create': {
			if (!hasScope(scopes, 'saved-places:write')) return scopeError('saved-places:write');
			const { createPlace, projectPlace } = await import('./places');
			const place = createPlace(userId, {
				name: String(args.name ?? ''),
				categoryId: args.categoryId != null ? Number(args.categoryId) : null,
				address: (args.address as string) ?? null,
				cityId: args.cityId != null ? Number(args.cityId) : null,
				lat: args.lat != null ? Number(args.lat) : null,
				lng: args.lng != null ? Number(args.lng) : null,
				durationMin: args.durationMin != null ? Number(args.durationMin) : null,
				priceCents: args.priceCents != null ? Number(args.priceCents) : null,
				description: (args.description as string) ?? null,
				status: args.status as 'planned' | 'visited' | undefined,
				favorite: args.favorite === true
			});
			logAudit(userId, 'mcp_place_create', 'place', place.id, {});
			return textResult(projectPlace(place));
		}
		case 'roamarr_saved_places_update': {
			if (!hasScope(scopes, 'saved-places:write')) return scopeError('saved-places:write');
			const { getPlaceById, updatePlace, projectPlace } = await import('./places');
			const id = Number(args.placeId);
			if (!getPlaceById(id, userId)) return { content: [{ type: 'text' as const, text: 'Place not found' }], isError: true };
			// Partial patch: absent keys are omitted entirely so they are never
			// written as NULL (Kit treats explicit undefined as NULL).
			const patch: Parameters<typeof updatePlace>[2] = {};
			if (args.name !== undefined) patch.name = String(args.name);
			if (args.categoryId !== undefined) patch.categoryId = args.categoryId === null ? null : Number(args.categoryId);
			if (args.address !== undefined) patch.address = args.address as string | null;
			if (args.cityId !== undefined) patch.cityId = args.cityId === null ? null : Number(args.cityId);
			if (args.lat !== undefined) patch.lat = args.lat === null ? null : Number(args.lat);
			if (args.lng !== undefined) patch.lng = args.lng === null ? null : Number(args.lng);
			if (args.durationMin !== undefined) patch.durationMin = args.durationMin === null ? null : Number(args.durationMin);
			if (args.priceCents !== undefined) patch.priceCents = args.priceCents === null ? null : Number(args.priceCents);
			if (args.description !== undefined) patch.description = args.description as string | null;
			if (args.status !== undefined) patch.status = args.status as 'planned' | 'visited';
			if (args.favorite !== undefined) patch.favorite = args.favorite === true;
			const place = updatePlace(id, userId, patch);
			logAudit(userId, 'mcp_place_update', 'place', id, {});
			return textResult(place ? projectPlace(place) : { ok: false });
		}
		case 'roamarr_saved_places_delete': {
			if (!hasScope(scopes, 'saved-places:write')) return scopeError('saved-places:write');
			const confirmErr = requireConfirm(args, 'roamarr_saved_places_delete');
			if (confirmErr) return confirmErr;
			const { getPlaceById, deletePlace } = await import('./places');
			const id = Number(args.placeId);
			if (!getPlaceById(id, userId)) return { content: [{ type: 'text' as const, text: 'Place not found' }], isError: true };
			await deletePlace(id, userId);
			logAudit(userId, 'mcp_place_delete', 'place', id, {});
			return textResult({ ok: true, placeId: id });
		}
		case 'roamarr_saved_places_mark_visited': {
			if (!hasScope(scopes, 'saved-places:write')) return scopeError('saved-places:write');
			const { setPlaceVisited, projectPlace } = await import('./places');
			const id = Number(args.placeId);
			const place = setPlaceVisited(id, userId, true);
			logAudit(userId, 'mcp_place_mark_visited', 'place', id, {});
			return textResult(projectPlace(place));
		}
		case 'roamarr_saved_places_unmark_visited': {
			if (!hasScope(scopes, 'saved-places:write')) return scopeError('saved-places:write');
			const { setPlaceVisited, projectPlace } = await import('./places');
			const id = Number(args.placeId);
			const place = setPlaceVisited(id, userId, false);
			logAudit(userId, 'mcp_place_unmark_visited', 'place', id, {});
			return textResult(projectPlace(place));
		}
		case 'roamarr_place_category_list': {
			if (!hasScope(scopes, 'saved-places:read')) return scopeError('saved-places:read');
			const { listPlaceCategories, projectPlaceCategory } = await import('./places');
			return textResult({ items: listPlaceCategories(userId).map(projectPlaceCategory) });
		}
		case 'roamarr_place_category_create': {
			if (!hasScope(scopes, 'saved-places:write')) return scopeError('saved-places:write');
			const { createPlaceCategory, projectPlaceCategory } = await import('./places');
			if (typeof args.name !== 'string') throw error(400, 'name must be a string');
			if (args.color != null && typeof args.color !== 'string') throw error(400, 'color must be a string');
			const category = createPlaceCategory(userId, {
				name: args.name,
				color: args.color == null ? null : args.color
			});
			logAudit(userId, 'mcp_place_category_create', 'place_category', category.id, {});
			return textResult(projectPlaceCategory(category));
		}
		case 'roamarr_place_category_update': {
			if (!hasScope(scopes, 'saved-places:write')) return scopeError('saved-places:write');
			const { getPlaceCategoryById, updatePlaceCategory, projectPlaceCategory } = await import('./places');
			const id = Number(args.categoryId);
			if (!Number.isSafeInteger(id) || id < 1) throw error(400, 'categoryId must be a positive integer');
			const existing = getPlaceCategoryById(id, userId);
			if (!existing) return { content: [{ type: 'text' as const, text: 'Category not found' }], isError: true };
			if (args.name !== undefined && typeof args.name !== 'string') throw error(400, 'name must be a string');
			if (args.color != null && typeof args.color !== 'string') throw error(400, 'color must be a string');
			const name = args.name === undefined ? existing.name : args.name;
			const color = typeof args.color === 'string' && args.color.trim() ? args.color : existing.color;
			const category = updatePlaceCategory(id, userId, { name, color });
			logAudit(userId, 'mcp_place_category_update', 'place_category', id, {});
			return textResult(category ? projectPlaceCategory(category) : { ok: false });
		}
		case 'roamarr_place_category_delete': {
			if (!hasScope(scopes, 'saved-places:write')) return scopeError('saved-places:write');
			const confirmErr = requireConfirm(args, 'roamarr_place_category_delete');
			if (confirmErr) return confirmErr;
			const { getPlaceCategoryById, deletePlaceCategory } = await import('./places');
			const id = Number(args.categoryId);
			if (!getPlaceCategoryById(id, userId)) return { content: [{ type: 'text' as const, text: 'Category not found' }], isError: true };
			deletePlaceCategory(id, userId);
			logAudit(userId, 'mcp_place_category_delete', 'place_category', id, {});
			return textResult({ ok: true, categoryId: id });
		}
		case 'roamarr_saved_places_search': {
			if (!hasScope(scopes, 'saved-places:read')) return scopeError('saved-places:read');
			const { searchPlaceCatalog } = await import('./placeSearch');
			const outcome = await searchPlaceCatalog(String(args.query ?? ''), {
				limit: args.limit != null ? Number(args.limit) : undefined
			});
			if (!outcome.ok) return { content: [{ type: 'text' as const, text: outcome.error }], isError: true };
			return textResult({ results: outcome.results });
		}
		case 'roamarr_saved_places_import': {
			if (!hasScope(scopes, 'saved-places:write')) return scopeError('saved-places:write');
			const confirmErr = requireConfirm(args, 'roamarr_saved_places_import');
			if (confirmErr) return confirmErr;
			const { executeGeoImport, GEO_IMPORT_MAX_ROWS } = await import('./geoImport');
			if (!Array.isArray(args.rows)) {
				return { content: [{ type: 'text' as const, text: 'rows must be an array of { name, lat, lng, address, description, categoryId }' }], isError: true };
			}
			if (args.rows.length === 0 || args.rows.length > GEO_IMPORT_MAX_ROWS) {
				return { content: [{ type: 'text' as const, text: `rows must contain 1-${GEO_IMPORT_MAX_ROWS} entries` }], isError: true };
			}
			const rows = args.rows.map((r) => {
				const row = (r ?? {}) as Record<string, unknown>;
				return {
					name: typeof row.name === 'string' ? row.name : '',
					lat: row.lat != null && Number.isFinite(Number(row.lat)) ? Number(row.lat) : null,
					lng: row.lng != null && Number.isFinite(Number(row.lng)) ? Number(row.lng) : null,
					address: typeof row.address === 'string' ? row.address : null,
					description: typeof row.description === 'string' ? row.description : null,
					sourceUrl: null,
					categoryGuess: typeof row.category === 'string' ? row.category : null
				};
			});
			if (rows.some((r) => !r.name.trim())) {
				return { content: [{ type: 'text' as const, text: 'Every row needs a non-empty name' }], isError: true };
			}
			const result = executeGeoImport(userId, rows, {
				categoryId: args.categoryId != null ? Number(args.categoryId) : null,
				skipDuplicates: args.skipDuplicates !== false
			});
			logAudit(userId, 'mcp_places_import', 'place', 0, { created: result.created });
			return textResult(result);
		}
		case 'roamarr_place_links_list': {
			if (!hasScope(scopes, 'saved-places:read')) return scopeError('saved-places:read');
			const { getPlaceById } = await import('./places');
			const { listPlaceLinks } = await import('./placeLinks');
			const placeId = Number(args.placeId);
			if (!getPlaceById(placeId, userId)) return { content: [{ type: 'text' as const, text: 'Place not found' }], isError: true };
			const links = listPlaceLinks(placeId);
			const page = paginateList(links, args, (l) => l.id);
			return textResult({ placeId, items: page.items, nextCursor: page.nextCursor });
		}
		case 'roamarr_place_links_create': {
			if (!hasScope(scopes, 'saved-places:write')) return scopeError('saved-places:write');
			const { getPlaceById } = await import('./places');
			const { createPlaceLink } = await import('./placeLinks');
			const placeId = Number(args.placeId);
			if (!getPlaceById(placeId, userId)) return { content: [{ type: 'text' as const, text: 'Place not found' }], isError: true };
			// Helper enforces URL validation + audit log.
			const link = createPlaceLink(userId, placeId, {
				label: String(args.label ?? ''),
				url: String(args.url ?? ''),
				notes: (args.notes as string) ?? null
			});
			logAudit(userId, 'mcp_place_link_create', 'place_link', link.id, { placeId });
			return textResult({ id: link.id, placeId });
		}
		case 'roamarr_place_links_update': {
			if (!hasScope(scopes, 'saved-places:write')) return scopeError('saved-places:write');
			const parsed = parsePlaceLinkArgs(args);
			if (!parsed.ok) {
				return { content: [{ type: 'text' as const, text: parsed.error }], isError: true };
			}
			if (parsed.empty) {
				return textResult({ ok: true, linkId: parsed.linkId, updated: false });
			}
			const { getPlaceById } = await import('./places');
			const { getPlaceLinkById, updatePlaceLink } = await import('./placeLinks');
			const existing = getPlaceLinkById(parsed.linkId);
			if (!existing || !getPlaceById(existing.placeId, userId)) {
				return { content: [{ type: 'text' as const, text: 'Link not found' }], isError: true };
			}
			// Partial patch: absent keys are omitted entirely so they are never
			// written as NULL (Kit treats explicit undefined as NULL).
			updatePlaceLink(userId, existing.placeId, parsed.linkId, parsed.patch);
			logAudit(userId, 'mcp_place_link_update', 'place_link', parsed.linkId, {});
			return textResult({ ok: true, linkId: parsed.linkId, updated: true });
		}
		case 'roamarr_place_links_delete': {
			if (!hasScope(scopes, 'saved-places:write')) return scopeError('saved-places:write');
			const confirmErr = requireConfirm(args, 'roamarr_place_links_delete');
			if (confirmErr) return confirmErr;
			const { getPlaceById } = await import('./places');
			const { getPlaceLinkById, deletePlaceLink } = await import('./placeLinks');
			const id = Number(args.linkId);
			const existing = getPlaceLinkById(id);
			if (!existing || !getPlaceById(existing.placeId, userId)) {
				return { content: [{ type: 'text' as const, text: 'Link not found' }], isError: true };
			}
			deletePlaceLink(userId, existing.placeId, id);
			logAudit(userId, 'mcp_place_link_delete', 'place_link', id, {});
			return textResult({ ok: true, linkId: id });
		}
		case 'roamarr_search': {
				if (!hasScope(scopes, 'search:read')) return scopeError('search:read');
				const q = String(args.query ?? '').trim();
				const { globalSearch } = await import('./embeddings/search');
				const result = q
					? await globalSearch(userId, q)
					: { trips: [], hits: [], semantic: false, q: '' };
				// Place hits are owner-filtered upstream; hydrate a useful projection here.
				let hits: unknown[] = result.hits;
				if (result.hits.some((h) => h.entityType === 'place')) {
					const { getPlaceById, getPlaceCategoryById } = await import('./places');
					hits = result.hits.map((h) => {
						if (h.entityType !== 'place') return h;
						const place = getPlaceById(h.entityId, userId);
						if (!place) return h;
						const category =
							place.categoryId != null ? getPlaceCategoryById(place.categoryId, userId) : null;
						return {
							...h,
							snippet: h.body,
							place: {
								id: place.id,
								name: place.name,
								category: category?.name ?? null,
								lat: place.lat,
								lng: place.lng,
								status: place.status
							}
						};
					});
				}
				return textResult({
					query: result.q,
					semantic: result.semantic,
					hits,
					trips: result.trips.map((t) => ({
						id: t.id,
						name: t.name,
						destination: 'destination' in t ? (t as { destination?: string | null }).destination : null,
						destinationCityName: t.destinationCityName,
						isShared: t.isShared
					}))
				});
			}
			case 'roamarr_gallery_list': {
			if (!hasScope(scopes, 'gallery:read')) return scopeError('gallery:read');
			const ownerType = String(args.ownerType ?? '');
			if (ownerType !== 'place' && ownerType !== 'trip') {
				return { content: [{ type: 'text' as const, text: 'ownerType must be place or trip' }], isError: true };
			}
			const { listGallery, projectGalleryImage } = await import('./gallery');
			const ownerId = Number(args.ownerId);
			return textResult({ ownerType, ownerId, items: listGallery(userId, ownerType, ownerId).map(projectGalleryImage) });
		}
		case 'roamarr_gallery_remove': {
			if (!hasScope(scopes, 'gallery:write')) return scopeError('gallery:write');
			const confirmErr = requireConfirm(args, 'roamarr_gallery_remove');
			if (confirmErr) return confirmErr;
			const { removeGalleryImage } = await import('./gallery');
			const imageId = Number(args.imageId);
			await removeGalleryImage(userId, imageId);
			return textResult({ ok: true, imageId });
		}
		case 'roamarr_gallery_reorder': {
			if (!hasScope(scopes, 'gallery:write')) return scopeError('gallery:write');
			const ownerType = String(args.ownerType ?? '');
			if (ownerType !== 'place' && ownerType !== 'trip') {
				return { content: [{ type: 'text' as const, text: 'ownerType must be place or trip' }], isError: true };
			}
			if (!Array.isArray(args.imageIds)) {
				return { content: [{ type: 'text' as const, text: 'imageIds must be an array of image ids' }], isError: true };
			}
			const { reorderGallery, projectGalleryImage } = await import('./gallery');
			const items = reorderGallery(
				userId,
				ownerType,
				Number(args.ownerId),
				args.imageIds.map((id) => Number(id))
			);
			return textResult({ items: items.map(projectGalleryImage) });
		}
		case 'roamarr_gallery_set_caption': {
			if (!hasScope(scopes, 'gallery:write')) return scopeError('gallery:write');
			const { setGalleryCaption, projectGalleryImage } = await import('./gallery');
			const image = setGalleryCaption(userId, Number(args.imageId), String(args.caption ?? ''));
			return textResult(projectGalleryImage(image));
		}
			case 'roamarr_attachment_upload': {
				if (!hasScope(scopes, 'trips:write')) return scopeError('trips:write');
				const target = resolveAttachmentTarget(args as Record<string, unknown>);
				const filename = attachmentFilename(args.filename);
				const mimeType = attachmentMimeType(args.mimeType);
				if (typeof args.contentBase64 !== 'string') throw error(400, 'contentBase64 is required');
				const file = fileFromAttachmentBase64({
					filename,
					mimeType,
					contentBase64: args.contentBase64
				});
				const { addTripDocument } = await import('./tripDocuments');
				const { link, attachment } = await addTripDocument(userId, target.tripId, {
					file,
					segmentId: target.segmentId,
					label: boundedOptional(args.label, 'label', 200),
					notes: boundedOptional(args.notes, 'notes', 2000)
				});
				logAudit(userId, 'mcp_attachment_upload', 'trip_document', link.id, {
					tripId: target.tripId,
					segmentId: target.segmentId,
					filename
				});
				// The caller just supplied these notes; addTripDocument already enforced edit access.
				return textResult(
					projectTripDocument(
						{
							id: link.id,
							tripId: link.tripId,
							segmentId: link.segmentId,
							label: link.label,
							notes: link.notes,
							filename: attachment.filename,
							contentType: attachment.contentType,
							sizeBytes: attachment.sizeBytes,
							createdAt: link.createdAt
						},
						true
					)
				);
			}
			case 'roamarr_attachment_list': {
				if (!hasScope(scopes, 'trips:read')) return scopeError('trips:read');
				const target = resolveAttachmentTarget(args as Record<string, unknown>);
				const trip = requireViewableTrip(userId, target.tripId);
				if (target.segmentId != null) {
					const seg = segmentsRepo.getSegmentById(target.segmentId);
					if (!seg || seg.tripId !== target.tripId) throw error(400, 'Segment not found on this trip');
				}
				const { listTripDocuments, listSegmentDocuments } = await import('./tripDocuments');
				const rows =
					target.segmentId != null
						? listSegmentDocuments(target.segmentId)
						: listTripDocuments(target.tripId);
				const page = paginateList(rows, args as { limit?: unknown; cursor?: unknown }, (row) => row.id);
				const includeNotes = canReadPrivateDetails(scopes) && canViewDetails(userId, trip);
				return textResult({
					tripId: target.tripId,
					segmentId: target.segmentId,
					items: page.items.map((row) => projectTripDocument(row, includeNotes)),
					nextCursor: page.nextCursor
				});
			}
			case 'roamarr_attachment_get': {
				if (!hasScope(scopes, 'trips:read')) return scopeError('trips:read');
				const loaded = await loadTripDocumentForView(userId, args as Record<string, unknown>);
				const includeNotes = canReadPrivateDetails(scopes) && canViewDetails(userId, loaded.trip);
				const document = projectTripDocument(loaded.row, includeNotes);
				if (args.includeContent !== true) return textResult({ document });
				const { readTripDocument } = await import('./tripDocuments');
				const range = parseAttachmentByteRange(args as Record<string, unknown>);
				const { stream, record } = await readTripDocument(userId, loaded.row.id);
				const totalBytes = record.sizeBytes;
				if (range.offset > totalBytes) {
					await stream.cancel();
					throw error(400, `offset ${range.offset} is past the end of the file (${totalBytes} bytes)`);
				}
				const { contentBase64, bytes } = await streamToBase64(stream, range);
				const nextByte = range.offset + bytes;
				const complete = nextByte >= totalBytes;
				return textResult({
					document,
					contentIncluded: true,
					contentBase64,
					totalBytes,
					contentOffset: range.offset,
					contentBytes: bytes,
					complete,
					nextOffset: complete ? null : nextByte
				});
			}
			case 'roamarr_attachment_delete': {
				if (!hasScope(scopes, 'trips:write')) return scopeError('trips:write');
				const confirmErr = requireConfirm(args as Record<string, unknown>, 'roamarr_attachment_delete');
				if (confirmErr) return confirmErr;
				const loaded = await loadTripDocumentForView(userId, args as Record<string, unknown>);
				const { deleteTripDocument } = await import('./tripDocuments');
				await deleteTripDocument(userId, loaded.row.id);
				logAudit(userId, 'mcp_attachment_delete', 'trip_document', loaded.row.id, {
					tripId: loaded.row.tripId,
					segmentId: loaded.row.segmentId,
					filename: loaded.row.filename
				});
				return textResult({ ok: true, documentId: loaded.row.id });
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
			const body = (e as { body?: { message?: unknown } })?.body;
			const message =
				typeof body?.message === 'string' && body.message.length > 0
					? body.message
					: ((e as Error)?.message ?? String(e));
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
				trip = safeTripProjection(tripId, userId, scopes) as Record<string, unknown>;
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

	return server;
}
