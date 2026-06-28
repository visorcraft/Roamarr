import { DateTime } from 'luxon';
import { nowIso } from './tz';
import * as tripsRepo from './repositories/tripsRepo';
import { listSegmentsForTrip } from './repositories/segmentsRepo';

export interface NextCity {
	segmentId: number | null;
	cityName: string;
	countryCode: string;
	lat: number;
	lng: number;
	startAt: string | null;
	startTz: string | null;
}

export function selectNextSegmentCity(tripId: number): NextCity | null {
	const rows = listSegmentsForTrip(tripId);

	const now = DateTime.fromISO(nowIso(), { zone: 'utc' });
	for (const row of rows) {
		if (!row.cityName || row.cityLat == null || row.cityLng == null || !row.countryCode) continue;
		const localStart = DateTime.fromISO(row.startAt, { zone: row.startTz || 'UTC' });
		if (!localStart.isValid) continue;
		if (localStart.toUTC() >= now) {
			return {
				segmentId: row.id,
				cityName: row.cityName,
				countryCode: row.countryCode,
				lat: row.cityLat,
				lng: row.cityLng,
				startAt: row.startAt,
				startTz: row.startTz
			};
		}
	}
	return null;
}

// City to focus the trip map/globe on: the next upcoming segment's city, or — when no
// upcoming segment has a city — the trip's own destination city (so trips whose segments
// lack coordinates still get a map centered on where they're going).
export function tripMapCity(tripId: number): NextCity | null {
	const segmentCity = selectNextSegmentCity(tripId);
	if (segmentCity) return segmentCity;

	const trip = tripsRepo.getTripById(tripId);

	if (trip?.destinationCityName && trip.destinationCityLat != null && trip.destinationCityLng != null) {
		return {
			segmentId: null,
			cityName: trip.destinationCityName,
			countryCode: trip.destinationCountryCode ?? '',
			lat: trip.destinationCityLat,
			lng: trip.destinationCityLng,
			startAt: null,
			startTz: null
		};
	}
	return null;
}
