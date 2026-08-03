import { error, type Actions, type RequestEvent } from '@sveltejs/kit';
import { ADD_SEGMENT_WIZARD_TYPES, SEG, type SegmentType } from '$lib/segmentLabels';
import { requireUser } from '$lib/server/auth';
import { requireEditableTrip } from '$lib/server/ownership';
import { submitAddSegment } from '$lib/server/segmentAdd';
import * as profileRepo from '$lib/server/repositories/profileRepo';
import { listPlaces, getPlaceById } from '$lib/server/places';
import { getCityByGeoNameId } from '$lib/server/repositories/travelDataRepo';

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

export interface PlacePrefill {
	placeId: number;
	title: string;
	venue: string;
	countryCode: string;
	admin1Code: string;
	cityName: string;
	cityLat: number | null;
	cityLng: number | null;
}

function poiExtras(event: RequestEvent, userId: number) {
	const places = listPlaces(userId).map((p) => ({ id: p.id, name: p.name }));
	const placeIdRaw = event.url?.searchParams.get('placeId');
	const placeId = placeIdRaw && Number.isFinite(Number(placeIdRaw)) ? Number(placeIdRaw) : null;
	let placePrefill: PlacePrefill | null = null;
	if (placeId != null) {
		const place = getPlaceById(placeId, userId);
		if (place) {
			const city = place.cityId != null ? getCityByGeoNameId(place.cityId) : null;
			placePrefill = {
				placeId: place.id,
				title: place.name,
				venue: place.address ?? '',
				countryCode: city?.countryCode ?? '',
				admin1Code: city?.admin1Code ?? '',
				cityName: city?.name ?? '',
				cityLat: place.lat ?? city?.lat ?? null,
				cityLng: place.lng ?? city?.lng ?? null
			};
		}
	}
	return { places, placePrefill };
}

function loadNewSegmentForm(event: RequestEvent, type: SegmentType) {
	const { trip } = loadNewSegmentPicker(event);
	if (!isWizardSegmentType(type)) throw error(404, 'Not found');
	const u = requireUser(event.locals);
	const userCards = profileRepo.listCards(u.id);
	// Uniform shape so per-type pages can rely on the poi picker fields.
	const extras = type === 'poi' ? poiExtras(event, u.id) : { places: [], placePrefill: null };
	return { trip, type, label: SEG[type].label, cards: userCards, ...extras };
}

export function newSegmentPage(type: SegmentType) {
	return {
		load: (event: RequestEvent) => loadNewSegmentForm(event, type),
		actions: {
			default: (event: RequestEvent) => submitAddSegment(event, type)
		} satisfies Actions
	};
}
