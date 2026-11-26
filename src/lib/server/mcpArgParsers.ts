// Pure, DB-free MCP tool argument parsers and validators.

import { error } from '@sveltejs/kit';
import { parsePositiveId } from './params';
import { Validator } from './validation';
import { reqString } from './mcpHelpers';
import {
	TRIP_STATUSES,
	VISIBILITIES,
	SEGMENT_TYPES,
	EXPENSE_CATEGORIES
} from './db/mongrelSchema';
import type { SharePermission } from './repositories/tripsRepo';
import type { PlaceLinkPatch } from './placeLinks';

const BUDGET_CATEGORIES = EXPENSE_CATEGORIES;

export function toPositiveIdArg(value: unknown): number | null {
	return typeof value === 'number' || typeof value === 'string' ? parsePositiveId(String(value)) : null;
}

export function validateToolInput(args: Record<string, unknown>): { ok: true } | { ok: false; error: string } {
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
export function parseReminderOffsetMinutes(raw: unknown): number | null {
	if (raw == null) return null;
	if (typeof raw !== 'number' && typeof raw !== 'string') return null;
	if (typeof raw === 'string' && raw.trim() === '') return null;
	const n = Number(raw);
	if (!Number.isInteger(n) || n < -10080 || n > 10080) return null;
	return n;
}

export type BudgetSetArgsResult =
	| { ok: true; tripId: number; category: (typeof BUDGET_CATEGORIES)[number]; amount: number; currency: string }
	| { ok: false; error: string };

// Strict parser for roamarr_budget_set. The tool schema declares amount as a
// number, but clients sometimes send strings, booleans, or floats, which would
// otherwise be coerced into a misleading budget.
export function parseBudgetSetArgs(args: Record<string, unknown>): BudgetSetArgsResult {
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

export type ShareArgsResult =
	| { ok: true; permission: SharePermission | undefined; showDetails: boolean | undefined }
	| { ok: false; error: string };

// Strict parsers for the share tools. MCP clients sometimes send "false" or 0
// for booleans, and Boolean("false") is true, which would silently turn on
// private-detail visibility for a share. Only real booleans are accepted.
export function parseShareArgs(args: Record<string, unknown>): ShareArgsResult {
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
export const SEGMENT_UPDATE_NULLABLE_FIELDS = new Set([
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

export const SEGMENT_UPDATE_FIELD_ORDER = [
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

export const SEGMENT_UPDATE_STRING_FIELDS = new Set([
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

export type SegmentUpdateArgsResult =
	| { ok: true; patch: Record<string, unknown> }
	| { ok: false; error: string };

export function parseSegmentUpdateArgs(args: Record<string, unknown>): SegmentUpdateArgsResult {
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
export type TripFieldPatch = {
	name?: string;
	notes?: string | null;
	startDate?: string | null;
	endDate?: string | null;
	baseCurrency?: string;
	defaultVisibility?: (typeof VISIBILITIES)[number];
	status?: (typeof TRIP_STATUSES)[number];
};

export type TripFieldsResult = { ok: true; fields: TripFieldPatch } | { ok: false; error: string };

// `existing` is the stored trip for an update and null for a create.
export function parseTripFieldsArgs(
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

export type PlaceLinkPatchResult =
	| { ok: true; linkId: number; patch: PlaceLinkPatch; empty: boolean }
	| { ok: false; error: string };

// Strict parser for roamarr_place_links_update. Only real strings are accepted:
// String(null) === 'null' and String({}) === '[object Object]' would otherwise be
// persisted as the label or notes. Trimming, length caps, and URL format stay in
// placeLinks.ts (validateLabel/validateUrl/validateNotes) and are not duplicated.
export function parsePlaceLinkArgs(args: Record<string, unknown>): PlaceLinkPatchResult {
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

export function positiveId(value: unknown, field: string): number {
	const n =
		typeof value === 'number'
			? value
			: typeof value === 'string' && value.trim() !== ''
				? Number(value)
				: Number.NaN;
	if (!Number.isSafeInteger(n) || n < 1) throw error(400, `${field} must be a positive integer`);
	return n;
}

export function optionalPositiveId(value: unknown, field: string): number | null {
	if (value == null || value === '') return null;
	return positiveId(value, field);
}

export function attachmentFilename(value: unknown): string {
	const filename = reqString(value, 'filename', 255);
	if (filename === '.' || filename === '..' || /[\\/\0]/.test(filename)) {
		throw error(400, 'filename must not contain path separators');
	}
	return filename;
}
