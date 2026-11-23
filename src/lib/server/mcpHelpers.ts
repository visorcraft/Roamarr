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
 * and an `args` bag with optional `limit` and `cursor` strings. Returns the
 * slice plus the next cursor (or null when the page exhausts the list).
 *
 * `getKey(item)` should return the primary key used as the cursor token.
 *
 * The cursor is the key of the last row on the page; the next call resumes after it.
 */
export function paginateList<T>(
	rows: readonly T[],
	args: { limit?: unknown; cursor?: unknown },
	getKey: (item: T) => string | number
): { items: T[]; nextCursor: string | null } {
	const limit = clampLimit(args.limit);
	const cursorKey = decodeCursor((args.cursor as string | null | undefined) ?? null);
	let start = 0;
	if (cursorKey != null) {
		const idx = rows.findIndex((r) => String(getKey(r)) === cursorKey);
		start = idx >= 0 ? idx + 1 : 0;
	}
	const slice = rows.slice(start, start + limit);
	const hasMoreInWindow = start + limit < rows.length;
	const nextKey = hasMoreInWindow ? getKey(rows[start + limit - 1]) : null;
	return {
		items: slice,
		nextCursor: nextKey != null ? encodeCursor(String(nextKey)) : null
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

const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * Decode standard or URL-safe base64 (padding optional) into a File for the
 * attachment service. There is no size cap: attachments of any size are
 * accepted, bounded only by the deployment's request-body limit.
 */
export function fileFromAttachmentBase64(input: {
	filename: string;
	mimeType: string;
	contentBase64: string;
}): File {
	const compact = input.contentBase64.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
	if (compact.length === 0) throw error(400, 'contentBase64 is required');
	const padLength = compact.length % 4 === 0 ? 0 : 4 - (compact.length % 4);
	const padded = padLength === 0 ? compact : compact + '='.repeat(padLength);
	if (!BASE64_RE.test(padded)) throw error(400, 'contentBase64 is not valid base64');
	const bytes = Buffer.from(padded, 'base64');
	if (bytes.length === 0) throw error(400, 'File is required');
	return new File([new Uint8Array(bytes)], input.filename, { type: input.mimeType });
}

export interface AttachmentByteRange {
	/** First byte to return (0-based). */
	offset: number;
	/** Maximum number of bytes to return; null reads through the end of the file. */
	length: number | null;
}

/**
 * Parse optional `offset` / `length` tool arguments for a ranged attachment
 * read. Both default to the whole file, so a plain call returns every byte.
 */
export function parseAttachmentByteRange(args: Record<string, unknown>): AttachmentByteRange {
	const offset = args.offset == null ? 0 : Number(args.offset);
	if (!Number.isSafeInteger(offset) || offset < 0) throw error(400, 'offset must be a non-negative integer');
	const length = args.length == null ? null : Number(args.length);
	if (length !== null && (!Number.isSafeInteger(length) || length < 1)) {
		throw error(400, 'length must be a positive integer');
	}
	return { offset, length };
}

/**
 * Read a decrypt stream into base64. With no range the whole file is returned;
 * with a range only bytes [offset, offset + length) are kept, and the rest of
 * the stream is cancelled once the range is filled.
 */
export async function streamToBase64(
	stream: ReadableStream<Uint8Array>,
	range: AttachmentByteRange = { offset: 0, length: null }
): Promise<{ contentBase64: string; bytes: number }> {
	const reader = stream.getReader();
	const chunks: Uint8Array[] = [];
	const start = range.offset;
	const end = range.length === null ? Number.POSITIVE_INFINITY : start + range.length;
	let position = 0;
	let kept = 0;
	try {
		while (position < end) {
			const { done, value } = await reader.read();
			if (done) break;
			if (!value?.byteLength) continue;
			const chunkStart = position;
			position += value.byteLength;
			if (position <= start) continue;
			const from = Math.max(0, start - chunkStart);
			const to = Math.min(value.byteLength, end - chunkStart);
			const piece = from === 0 && to === value.byteLength ? value : value.subarray(from, to);
			chunks.push(piece);
			kept += piece.byteLength;
		}
		if (position >= end) await reader.cancel().catch(() => {});
	} catch (e) {
		await reader.cancel().catch(() => {});
		throw e;
	}
	reader.releaseLock();
	return { contentBase64: Buffer.concat(chunks, kept).toString('base64'), bytes: kept };
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
