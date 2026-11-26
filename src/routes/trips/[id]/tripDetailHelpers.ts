/**
 * Pure trip-detail helpers extracted from +page.svelte.
 *
 * These functions are deliberately free of Svelte runes, $state and $derived
 * so they can be unit-tested directly. Segment-shaped inputs use minimal
 * structural interfaces so the page's SegmentRow satisfies them without a
 * circular import.
 */
import { DateTime } from 'luxon';
import { compareSegmentsWithinDay, isUntimedSegment } from '$lib/segmentDay';
import { buildGoogleMapsDirectionsUrl } from '$lib/googleMaps';

export function tripDays(start: string | null | undefined, end: string | null | undefined): number | null {
	if (!start || !end) return null;
	const s = DateTime.fromISO(start);
	const e = DateTime.fromISO(end);
	if (!s.isValid || !e.isValid) return null;
	return Math.max(1, Math.ceil(e.diff(s, 'days').days) + 1);
}

export function buildExpensesCsv(
	expenses: ReadonlyArray<{
		description: string;
		amount: number;
		currency: string;
		category: string | null;
		paidBy: 'owner' | number;
		createdAt?: string | null;
	}>,
	companionNameMap: ReadonlyMap<number, string>
): string {
	const headers = ['Description', 'Amount', 'Currency', 'Category', 'Paid by', 'Date'];
	const rows = expenses.map((e) => [
		e.description,
		(e.amount / 100).toFixed(2),
		e.currency,
		e.category,
		e.paidBy === 'owner' ? 'You' : companionNameMap.get(e.paidBy) ?? 'Unknown',
		e.createdAt ?? ''
	]);
	return [headers, ...rows]
		.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
		.join('\n');
}

export function formatSegmentDuration(start: string | null | undefined, end: string | null | undefined): string | null {
	if (!start || !end) return null;
	const s = DateTime.fromISO(start, { zone: 'utc' });
	const e = DateTime.fromISO(end, { zone: 'utc' });
	if (!s.isValid || !e.isValid) return null;
	const mins = Math.max(0, Math.round(e.diff(s, 'minutes').minutes));
	if (mins < 60) return `${mins}m`;
	const hours = Math.floor(mins / 60);
	const remMins = mins % 60;
	if (hours < 24) return remMins ? `${hours}h ${remMins}m` : `${hours}h`;
	const days = Math.floor(hours / 24);
	const remHours = hours % 24;
	return remHours ? `${days}d ${remHours}h` : `${days}d`;
}

export function daysUntilStart(start: string | null | undefined, now: DateTime = DateTime.now()): number | null {
	if (!start) return null;
	const s = DateTime.fromISO(start).startOf('day');
	const nowStart = now.startOf('day');
	if (!s.isValid || s <= nowStart) return null;
	return Math.ceil(s.diff(nowStart, 'days').days);
}

export function posterInitials(name: string, cityName: string | null | undefined): string {
	const src = cityName?.trim() || name;
	return src
		.split(/[\s,]+/)
		.filter(Boolean)
		.slice(0, 2)
		.map((w) => w[0]?.toUpperCase() ?? '')
		.join('');
}

export function segmentLocalDateTime<T extends { startAt?: string | null; startTz?: string | null }>(
	segment: T
): DateTime | null {
	if (!segment.startAt) return null;
	const dt = DateTime.fromISO(segment.startAt, { zone: 'utc' }).setZone(segment.startTz ?? 'UTC');
	return dt.isValid ? dt : null;
}

export function groupSegmentsByDay<T extends { startAt?: string | null; startTz?: string | null; daySortOrder?: number | null }>(
	segments: readonly T[],
	ascending = true
): { key: string; label: string; segments: T[] }[] {
	const sorted = [...segments].sort((a, b) => {
		const aLocal = segmentLocalDateTime(a);
		const bLocal = segmentLocalDateTime(b);
		const aKey = aLocal?.toFormat("yyyy-MM-dd'T'HH:mm:ss.SSS") ?? (a.startAt ?? '');
		const bKey = bLocal?.toFormat("yyyy-MM-dd'T'HH:mm:ss.SSS") ?? (b.startAt ?? '');
		return ascending ? aKey.localeCompare(bKey) : bKey.localeCompare(aKey);
	});
	const groups: { key: string; label: string; segments: T[] }[] = [];
	const index = new Map<string, number>();
	for (const s of sorted) {
		let key = 'unscheduled';
		let label = 'Unscheduled';
		const dt = segmentLocalDateTime(s);
		if (dt) {
			key = dt.toISODate()!;
			label = dt.toFormat('LLLL d, yyyy');
		}
		const existing = index.get(key);
		if (existing != null) groups[existing].segments.push(s);
		else {
			index.set(key, groups.length);
			groups.push({ key, label, segments: [s] });
		}
	}
	// Within a day: untimed (local-midnight) segments first, ordered by
	// daySortOrder (set by "Optimize order"; nulls keep natural order),
	// then timed segments in local-time order. See $lib/segmentDay.ts.
	for (const group of groups) {
		if (group.key === 'unscheduled') continue;
		const ordered = group.segments
			.slice()
			.sort((a, b) =>
				compareSegmentsWithinDay({ ...a, startAt: a.startAt ?? null }, { ...b, startAt: b.startAt ?? null })
			);
		if (!ascending) ordered.reverse();
		group.segments = ordered;
	}
	return groups;
}

export function untimedCoordSegments<T extends { startAt?: string | null; startTz?: string | null; cityLat?: number | null; cityLng?: number | null }>(
	group: { key: string; segments: readonly T[] }
): T[] {
	if (group.key === 'unscheduled') return [];
	return group.segments.filter(
		(s) =>
			s.cityLat != null &&
			s.cityLng != null &&
			isUntimedSegment(s.startAt ?? null, s.startTz)
	);
}

export function dayCanOptimize<T extends { startAt?: string | null; startTz?: string | null; cityLat?: number | null; cityLng?: number | null }>(
	group: { key: string; segments: readonly T[] }
): boolean {
	return untimedCoordSegments(group).length >= 2;
}

export function dayDirectionsUrl<T extends { cityLat?: number | null; cityLng?: number | null }>(
	group: { key: string; segments: readonly T[] }
): string | null {
	if (group.key === 'unscheduled') return null;
	return buildGoogleMapsDirectionsUrl(
		group.segments
			.filter((s) => s.cityLat != null && s.cityLng != null)
			.map((s) => ({ lat: s.cityLat!, lng: s.cityLng! }))
	);
}
