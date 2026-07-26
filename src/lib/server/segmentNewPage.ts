import { error, type Actions, type RequestEvent } from '@sveltejs/kit';
import { ADD_SEGMENT_WIZARD_TYPES, SEG, type SegmentType } from '$lib/segmentLabels';
import { requireUser } from '$lib/server/auth';
import { requireEditableTrip } from '$lib/server/ownership';
import { submitAddSegment } from '$lib/server/segmentAdd';
import * as profileRepo from '$lib/server/repositories/profileRepo';

const WIZARD_TYPES = new Set<SegmentType>(ADD_SEGMENT_WIZARD_TYPES.map((entry) => entry.type));

function isWizardSegmentType(type: string): type is SegmentType {
	return WIZARD_TYPES.has(type as SegmentType);
}

export type SegmentFormTrip = {
	id: number;
	name: string;
	/** Prefill city fields on new-segment forms from the trip destination. */
	destinationCountryCode: string | null;
	destinationAdmin1Code: string | null;
	destinationCityName: string | null;
	destinationCityLat: number | null;
	destinationCityLng: number | null;
};

export function loadNewSegmentPicker(event: RequestEvent) {
	const u = requireUser(event.locals);
	const tripId = Number(event.params.id);
	if (!Number.isFinite(tripId)) throw error(404, 'Not found');
	const trip = requireEditableTrip(u.id, tripId);
	const formTrip: SegmentFormTrip = {
		id: trip.id,
		name: trip.name,
		destinationCountryCode: trip.destinationCountryCode ?? null,
		destinationAdmin1Code: trip.destinationAdmin1Code ?? null,
		destinationCityName: trip.destinationCityName ?? null,
		destinationCityLat: trip.destinationCityLat ?? null,
		destinationCityLng: trip.destinationCityLng ?? null
	};
	return { trip: formTrip };
}

function loadNewSegmentForm(event: RequestEvent, type: SegmentType) {
	const { trip } = loadNewSegmentPicker(event);
	if (!isWizardSegmentType(type)) throw error(404, 'Not found');
	const u = requireUser(event.locals);
	const userCards = profileRepo.listCards(u.id);
	return { trip, type, label: SEG[type].label, cards: userCards };
}

export function newSegmentPage(type: SegmentType) {
	return {
		load: (event: RequestEvent) => loadNewSegmentForm(event, type),
		actions: {
			default: (event: RequestEvent) => submitAddSegment(event, type)
		} satisfies Actions
	};
}
