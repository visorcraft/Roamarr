// Shared helpers for MCP tools. Centralized so each tool handler stays a
// thin switch case. Anything in this file is server-only.

import { error } from '@sveltejs/kit';

// Money: amount values are integer cents (per expensesRepo / tripBudgets
// schema). Accept only non-negative integers; reject floats, NaN, Infinity.
export function toCents(value: unknown, fieldName: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		throw error(400, `${fieldName} must be a finite number`);
	}
	if (!Number.isInteger(value)) {
		throw error(400, `${fieldName} must be an integer (cents); got ${value}`);
	}
	if (value < 0) {
		throw error(400, `${fieldName} must be non-negative`);
	}
	return value;
}

// Build an opaque pagination cursor. Encodes just the last seen primary key
// in a base64url string. Caller decides the key (id, createdAt+id, etc.).
export function encodeCursor(value: string | number): string {
	return Buffer.from(String(value)).toString('base64url');
}

export function decodeCursor(cursor: string | null | undefined): string | null {
	if (!cursor) return null;
	try {
		return Buffer.from(cursor, 'base64url').toString('utf8');
	} catch {
		return null;
	}
}

// Cap page size to a sane range so AI clients can't ask for 100k items.
export function clampLimit(value: unknown, fallback = 50, max = 200): number {
	if (value == null) return fallback;
	if (typeof value !== 'number' || !Number.isInteger(value)) return fallback;
	if (value < 1) return 1;
	if (value > max) return max;
	return value;
}

/**
 * Cursor pagination for MCP list tools. The caller supplies the full list
 * (already capped upstream by `KIT_EXECUTE_SYNC_CAP`) and an `args` bag with
 * optional `limit` and `cursor` strings. Returns the slice, the next cursor
 * (or null when the page exhausts the list), and a `truncated` flag that
 * is true when the upstream list hit the engine cap and may be missing rows
 * older than the cursor window.
 *
 * `getKey(item)` should return the primary key used as the cursor token.
 */
export function paginateList<T>(
	rows: readonly T[],
	args: { limit?: unknown; cursor?: unknown },
	getKey: (item: T) => string | number
): { items: T[]; nextCursor: string | null; truncated: boolean } {
	const limit = clampLimit(args.limit);
	const cursorKey = decodeCursor((args.cursor as string | null | undefined) ?? null);
	let start = 0;
	if (cursorKey != null) {
		const idx = rows.findIndex((r) => String(getKey(r)) === cursorKey);
		start = idx >= 0 ? idx + 1 : 0;
	}
	const slice = rows.slice(start, start + limit);
	const hasMoreInWindow = start + limit < rows.length;
	const nextKey = hasMoreInWindow ? getKey(rows[start + limit]) : null;
	return {
		items: slice,
		nextCursor: nextKey != null ? encodeCursor(String(nextKey)) : null,
		// ponytail: `rows.length === 9500` is the engine-cap sentinel; the
		// caller cannot tell whether the underlying table actually ends here
		// or whether older rows were silently truncated. Surface the
		// uncertainty to the client so they don't assume completeness.
		truncated: rows.length >= 9500
	};
}

// Privacy projections. All return a NEW object; never mutate the input.
// Card numbers are never stored as full PAN, only network + last4. This
// helper is a defensive layer: if a future code path accidentally returns
// more, the projection still strips the secret fields.

export function projectCard<T extends { number?: string | null; last4?: string | null; notes?: string | null }>(card: T) {
	// Defensive: drop any full PAN that may have been included by mistake.
	// Notes may contain freeform PII; drop by default. Callers that need
	// the plain `last4` keep it.
	const { number: _drop, notes: _notes, ...rest } = card;
	void _drop;
	void _notes;
	return rest;
}

export function projectLoyalty<T extends { membershipNumber?: string | null; notes?: string | null }>(row: T) {
	// Redact member numbers and notes by default. Tools that need the raw
	// number must opt in via an explicit `includeSecrets: true` argument.
	const { membershipNumber, notes: _n, ...rest } = row;
	void _n;
	return { ...rest, membershipNumberRedacted: true, notesRedacted: true };
}

export function projectInsurance<T extends { policyNumber?: string | null; notes?: string | null }>(row: T) {
	const { policyNumber, notes, ...rest } = row;
	void policyNumber;
	void notes;
	return { ...rest, policyNumberRedacted: true, notesRedacted: true };
}

export function projectTravelDocument<T extends { number?: string | null; notes?: string | null }>(row: T) {
	const { number, notes: _n, ...rest } = row;
	void _n;
	return { ...rest, numberRedacted: true, notesRedacted: true };
}

// Convert any input value to a clean string for a tool argument, with a
// maximum length. Returns null for null/undefined/empty so callers can
// distinguish "not provided" from "empty string".
export function optString(value: unknown, max = 1000): string | null {
	if (value == null) return null;
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	if (trimmed === '') return null;
	if (trimmed.length > max) throw error(400, `String exceeds max length ${max}`);
	return trimmed;
}

// Required string with length cap. Empty values throw.
export function reqString(value: unknown, fieldName: string, max = 1000): string {
	const s = optString(value, max);
	if (s == null) throw error(400, `${fieldName} is required`);
	return s;
}

// Wrap a body that may throw SvelteKit `error(...)` and convert to an MCP
// `isError: true` result. Use for any tool body that calls ownership /
// validation helpers (requireOwnedTrip, requireEditableTrip, etc.) so a
// missing row returns a 4xx-style error content instead of an unhandled
// 500 from the MCP route.
export async function tryTool(fn: () => Promise<unknown> | unknown) {
	try {
		return await fn();
	} catch (e) {
		const status = (e as { status?: number })?.status;
		const message = (e as Error)?.message ?? String(e);
		return {
			content: [{ type: 'text' as const, text: status ? `Error ${status}: ${message}` : `Error: ${message}` }],
			isError: true
		};
	}
}

// Confirmation guard for destructive tools. Every delete-style tool
// must require `confirm: true` so an AI agent can't accidentally drop a
// row on a misread. Returns an isError response if the guard fails;
// returns null on success.
export function requireConfirm(args: Record<string, unknown>, toolName: string) {
	if (args.confirm === true) return null;
	return {
		content: [{
			type: 'text' as const,
			text: `Destructive action '${toolName}' requires confirm: true. Pass { "confirm": true } to proceed.`
		}],
		isError: true
	};
}
