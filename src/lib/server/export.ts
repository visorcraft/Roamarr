import { eq } from 'drizzle-orm';
import { db } from './db';
import { trips, segments } from './db/schema';
import { utcToLocal } from './tz';
import type { SegmentType } from './db/schema';

export interface ExportedSegment {
	type: SegmentType;
	title: string;
	localStart: string;
	startTz: string;
	endAt?: string;
	location?: string;
	confirmationNumber?: string;
	details?: Record<string, unknown>;
}

export interface ExportedTrip {
	name: string;
	destination?: string;
	startDate?: string;
	endDate?: string;
	notes?: string;
	tags?: string[];
	defaultVisibility?: string;
	segments?: ExportedSegment[];
}

function tripTags(raw: string): string[] {
	try {
		const parsed = JSON.parse(raw);
		if (Array.isArray(parsed)) return parsed.filter((t) => typeof t === 'string');
	} catch {
		// ignore
	}
	return [];
}

export function exportTrips(userId: number): ExportedTrip[] {
	const owned = db.select().from(trips).where(eq(trips.ownerId, userId)).all();
	return owned.map((t) => {
		const segs = db.select().from(segments).where(eq(segments.tripId, t.id)).all();
		return {
			name: t.name,
			destination: t.destination ?? undefined,
			startDate: t.startDate ?? undefined,
			endDate: t.endDate ?? undefined,
			notes: t.notes ?? undefined,
			tags: tripTags(t.tags),
			defaultVisibility: t.defaultVisibility,
			segments: segs.map((s) => ({
				type: s.type as SegmentType,
				title: s.title,
				localStart: utcToLocal(s.startAt, s.startTz || 'UTC'),
				startTz: s.startTz || 'UTC',
				endAt: s.endAt ?? undefined,
				location: s.location ?? undefined,
				confirmationNumber: s.confirmationNumber ?? undefined,
				details: s.detailsJson ? (JSON.parse(s.detailsJson) as Record<string, unknown>) : undefined
			}))
		};
	});
}

export function exportTripsJson(userId: number): string {
	return JSON.stringify({ trips: exportTrips(userId) }, null, 2);
}

function csvEscape(value: string | number | undefined): string {
	if (value == null) return '';
	const s = String(value);
	if (s.includes(',') || s.includes('"') || s.includes('\n')) {
		return '"' + s.replace(/"/g, '""') + '"';
	}
	return s;
}

export function exportTripsCsv(userId: number): string {
	const rows = exportTrips(userId);
	const headers = [
		'name',
		'destination',
		'startDate',
		'endDate',
		'notes',
		'tags',
		'segmentCount',
		'segmentType',
		'segmentTitle',
		'segmentLocalStart',
		'segmentEndAt',
		'segmentLocation'
	];
	const lines: string[][] = [headers];
	for (const t of rows) {
		const first = t.segments?.[0];
		lines.push([
			csvEscape(t.name),
			csvEscape(t.destination),
			csvEscape(t.startDate),
			csvEscape(t.endDate),
			csvEscape(t.notes),
			csvEscape((t.tags ?? []).join(',')),
			csvEscape(t.segments?.length ?? 0),
			csvEscape(first?.type),
			csvEscape(first?.title),
			csvEscape(first?.localStart),
			csvEscape(first?.endAt),
			csvEscape(first?.location)
		]);
	}
	return lines.map((r) => r.join(',')).join('\n') + '\n';
}
