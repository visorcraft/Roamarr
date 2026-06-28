import { error } from '@sveltejs/kit';
import * as templatesRepo from './repositories/templatesRepo';
import * as tripsRepo from './repositories/tripsRepo';
import { listSegmentsForTrip, createSegment } from './repositories/segmentsRepo';
import { requireOwnedTrip } from './ownership';
import { logAudit } from './audit';
import { nowIso } from './tz';
import { serializeTags, parseTags } from '$lib/tags';

export type { TripTemplate } from './repositories/templatesRepo';

interface TripTemplateSnapshot {
	name: string;
	destinationCountryCode: string | null;
	destinationCityName: string | null;
	destinationCityLat: number | null;
	destinationCityLng: number | null;
	notes: string | null;
	tags: string[];
	segmentTemplates: Array<{ type: string; title: string; location: string | null }>;
}

export function listTripTemplates(userId: number) {
	return templatesRepo.listTripTemplates(userId);
}

export function saveTripTemplate(userId: number, sourceTripId: number, name: string) {
	requireOwnedTrip(userId, sourceTripId);
	const trip = tripsRepo.getTripById(sourceTripId);
	if (!trip) throw error(404, 'Trip not found');
	const segs = listSegmentsForTrip(sourceTripId).map((s) => ({
		type: s.type,
		title: s.title,
		location: s.location
	}));
	const snapshot: TripTemplateSnapshot = {
		name: trip.name,
		destinationCountryCode: trip.destinationCountryCode ?? null,
		destinationCityName: trip.destinationCityName ?? null,
		destinationCityLat: trip.destinationCityLat ?? null,
		destinationCityLng: trip.destinationCityLng ?? null,
		notes: trip.notes,
		tags: parseTags(trip.tags),
		segmentTemplates: segs.map((s) => ({ type: s.type, title: s.title, location: s.location }))
	};
	const inserted = templatesRepo.createTripTemplate({
		userId,
		sourceTripId,
		name: name.trim(),
		snapshot: snapshot as Record<string, unknown>
	});
	logAudit(userId, 'create', 'trip_template', inserted.id, { sourceTripId, name: inserted.name });
	return inserted;
}

export function createTripFromTemplate(
	userId: number,
	templateId: number,
	overrides: {
		name?: string;
		destinationCountryCode?: string | null;
		destinationCityName?: string | null;
		destinationCityLat?: number | null;
		destinationCityLng?: number | null;
		startDate?: string | null;
		endDate?: string | null;
	}
) {
	const template = templatesRepo.getTripTemplateById(templateId);
	if (!template || template.userId !== userId) throw error(404, 'Template not found');

	const snapshot: TripTemplateSnapshot = {
		name: template.name,
		destinationCountryCode: null,
		destinationCityName: null,
		destinationCityLat: null,
		destinationCityLng: null,
		notes: null,
		tags: [],
		segmentTemplates: []
	};
	Object.assign(snapshot, template.snapshot);

	const name = overrides.name?.trim() || snapshot.name;
	const destinationCountryCode =
		overrides.destinationCountryCode !== undefined
			? overrides.destinationCountryCode
			: snapshot.destinationCountryCode;
	const destinationCityName =
		overrides.destinationCityName !== undefined
			? overrides.destinationCityName
			: snapshot.destinationCityName;
	const destinationCityLat =
		overrides.destinationCityLat !== undefined
			? overrides.destinationCityLat
			: snapshot.destinationCityLat;
	const destinationCityLng =
		overrides.destinationCityLng !== undefined
			? overrides.destinationCityLng
			: snapshot.destinationCityLng;
	const startDate = overrides.startDate ?? null;
	const endDate = overrides.endDate ?? null;

	const trip = tripsRepo.createTrip(userId, {
		name,
		destinationCountryCode,
		destinationCityName,
		destinationCityLat,
		destinationCityLng,
		startDate,
		endDate,
		notes: snapshot.notes,
		tags: serializeTags(snapshot.tags.join(', '))
	});

	for (const s of snapshot.segmentTemplates) {
		createSegment({
			trip_id: BigInt(trip.id),
			type: s.type,
			title: s.title,
			start_at: nowIso(),
			start_tz: 'UTC',
			location: s.location
		});
	}

	logAudit(userId, 'create_from_template', 'trip', trip.id, { templateId });
	return trip;
}
