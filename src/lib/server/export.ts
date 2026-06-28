import * as tripsRepo from './repositories/tripsRepo';
import { listSegmentsForTrip } from './repositories/segmentsRepo';
import { utcToLocal } from './tz';
import { tripTags } from './sharing';
import type { SegmentType } from './db/mongrelSchema';

interface ExportedSegment {
	type: SegmentType;
	title: string;
	localStart: string;
	startTz: string;
	endAt?: string;
	location?: string;
	confirmationNumber?: string;
	details?: Record<string, unknown>;
}

interface ExportedTrip {
	name: string;
	destinationCountryCode?: string;
	destinationCityName?: string;
	destinationCityLat?: number;
	destinationCityLng?: number;
	startDate?: string;
	endDate?: string;
	notes?: string;
	tags?: string[];
	defaultVisibility?: string;
	segments?: ExportedSegment[];
}

export function exportTrips(userId: number): ExportedTrip[] {
	const owned = tripsRepo.listTripsForUser(userId);
	return owned.map((t) => {
		const segs = listSegmentsForTrip(t.id);
		return {
			name: t.name,
			destinationCountryCode: t.destinationCountryCode ?? undefined,
			destinationCityName: t.destinationCityName ?? undefined,
			destinationCityLat: t.destinationCityLat ?? undefined,
			destinationCityLng: t.destinationCityLng ?? undefined,
			startDate: t.startDate ?? undefined,
			endDate: t.endDate ?? undefined,
			notes: t.notes ?? undefined,
			tags: tripTags(t),
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
		'destinationCountryCode',
		'destinationCityName',
		'startDate',
		'endDate',
		'notes',
		'tags',
		'defaultVisibility',
		'segmentType',
		'segmentTitle',
		'segmentLocalStart',
		'segmentStartTz',
		'segmentEndAt',
		'segmentLocation',
		'segmentConfirmationNumber'
	];
	const lines: string[][] = [headers];
	for (const t of rows) {
		const segs = t.segments?.length ? t.segments : [undefined];
		for (const s of segs) {
			lines.push([
				csvEscape(t.name),
				csvEscape(t.destinationCountryCode),
				csvEscape(t.destinationCityName),
				csvEscape(t.startDate),
				csvEscape(t.endDate),
				csvEscape(t.notes),
				csvEscape((t.tags ?? []).join(',')),
				csvEscape(t.defaultVisibility),
				csvEscape(s?.type),
				csvEscape(s?.title),
				csvEscape(s?.localStart),
				csvEscape(s?.startTz),
				csvEscape(s?.endAt),
				csvEscape(s?.location),
				csvEscape(s?.confirmationNumber)
			]);
		}
	}
	return lines.map((r) => r.join(',')).join('\n') + '\n';
}
