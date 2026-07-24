// SPDX-FileCopyrightText: 2026 VisorCraft LLC
// SPDX-License-Identifier: GPL-3.0-only
import { DateTime, type DurationLike } from 'luxon';

export const nowIso = () => DateTime.utc().toISO()!;
export const utcIsoAfter = (duration: DurationLike) => DateTime.utc().plus(duration).toISO()!;

/**
 * Strip a trailing Z / numeric offset so only calendar + clock fields remain.
 * MCP clients and JSON serializers often emit `…Z` even when the digits are a
 * local wall time meant to be interpreted in `startTz` / `endTz`.
 */
export function wallClockFields(localIso: string): string {
	const trimmed = localIso.trim();
	// Capture YYYY-MM-DD[T ]HH:mm[:ss[.fraction]] and drop any trailing zone designator.
	const m = trimmed.match(
		/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?)/
	);
	if (m) return `${m[1]}T${m[2]}`;
	// Date-only or other shapes: strip common zone suffixes and let Luxon parse.
	return trimmed.replace(/(?:[Zz]|[+-]\d{2}(?::?\d{2})?(?::\d{2})?)$/, '');
}

/**
 * Convert a local wall-clock datetime + IANA zone to a UTC ISO instant.
 *
 * Contract: `localIso` digits are always the clock face in `tz`, never an
 * absolute UTC instant. A trailing `Z` or `±HH:MM` is ignored so agents that
 * always emit ISO-with-Z still store the intended local time.
 *
 * Example: localToUtc('2026-12-01T22:50:00.000Z', 'America/Chicago') →
 * '2026-12-02T04:50:00.000Z' (10:50 PM CST), NOT 22:50 UTC.
 */
export const localToUtc = (localIso: string, tz: string) => {
	const wall = wallClockFields(localIso);
	const dt = DateTime.fromISO(wall, { zone: tz });
	if (!dt.isValid) {
		throw new Error(`Invalid local datetime "${localIso}" in zone "${tz}": ${dt.invalidReason}`);
	}
	return dt.toUTC().toISO()!;
};

export const utcToLocal = (utcIso: string, tz: string) =>
	DateTime.fromISO(utcIso, { zone: 'utc' }).setZone(tz).toISO()!;
