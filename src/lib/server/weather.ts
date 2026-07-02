import { DateTime } from 'luxon';
import { eq as kitEq, and as kitAnd, gte as kitGte, lte as kitLte } from '@visorcraft/mongreldb-kit';
import { kit } from './db';
import { weatherCache, trips, segments } from './db/mongrelSchema';
import { getUserById } from './repositories/usersRepo';
import { loadTripFor } from '../../routes/trips/shared';
import { weatherCodeSummary } from '$lib/weatherCodes';

const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';
const FORECAST_DAYS = 14;
export const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export type WeatherUnits = 'metric' | 'imperial';

// IANA zones that default to imperial. The forecast is always fetched + cached in
// metric (so the cache and the advisory thresholds stay uniform across users) and
// converted for display only.
// ponytail: timezone heuristic, not a real locale — swap in an explicit per-user
// units setting if users outside these zones want imperial.
const IMPERIAL_TZONES = new Set<string>([
	'America/New_York', 'America/Detroit', 'America/Kentucky/Louisville', 'America/Kentucky/Monticello',
	'America/Indiana/Indianapolis', 'America/Indiana/Vincennes', 'America/Indiana/Winamac',
	'America/Indiana/Marengo', 'America/Indiana/Petersburg', 'America/Indiana/Vevay',
	'America/Chicago', 'America/Indiana/Tell_City', 'America/Indiana/Knox', 'America/Menominee',
	'America/North_Dakota/Center', 'America/North_Dakota/New_Salem', 'America/North_Dakota/Beulah',
	'America/Denver', 'America/Boise', 'America/Phoenix', 'America/Los_Angeles', 'America/Anchorage',
	'America/Juneau', 'America/Sitka', 'America/Metlakatla', 'America/Yakutat', 'America/Nome', 'America/Adak',
	'Pacific/Honolulu', 'Pacific/Guam', 'Pacific/Saipan', 'America/Puerto_Rico'
]);

export function unitsForTimezone(tz: string | null | undefined): WeatherUnits {
	return tz && IMPERIAL_TZONES.has(tz) ? 'imperial' : 'metric';
}

const cToF = (c: number) => (c * 9) / 5 + 32;
const kmhToMph = (k: number) => k * 0.621371;

export interface DayForecast {
	date: string;
	locationLabel: string;
	tempMin: number | null;
	tempMax: number | null;
	precipProb: number | null;
	windMax: number | null;
	code: number | null;
	summary: string;
	degraded?: boolean;
}

export interface TripWeatherOverview {
	headline: string;
	days: DayForecast[];
	advisory: string | null;
	tempUnit: '°C' | '°F';
	windUnit: 'km/h' | 'mph';
	degraded: boolean;
}

interface OpenMeteoDaily {
	time: string[];
	temperature_2m_max: number[];
	temperature_2m_min: number[];
	precipitation_probability_max: number[];
	wind_speed_10m_max: number[];
	weather_code: number[];
}

interface OpenMeteoResponse {
	daily?: OpenMeteoDaily;
	error?: string;
}

export function locationKey(lat: number, lng: number): string {
	return `${Math.round(lat * 100) / 100}|${Math.round(lng * 100) / 100}`;
}

export async function fetchForecast(lat: number, lng: number): Promise<OpenMeteoResponse> {
	const params = new URLSearchParams({
		latitude: String(lat),
		longitude: String(lng),
		daily: [
			'temperature_2m_max',
			'temperature_2m_min',
			'precipitation_probability_max',
			'wind_speed_10m_max',
			'weather_code'
		].join(','),
		hourly: 'temperature_2m,weather_code',
		temperature_unit: 'celsius',
		forecast_days: String(FORECAST_DAYS),
		timezone: 'auto'
	});
	const res = await fetch(`${OPEN_METEO_URL}?${params}`);
	if (!res.ok) throw new Error(`Open-Meteo returned ${res.status}`);
	return (await res.json()) as OpenMeteoResponse;
}

function getCachedRow(locationKeyStr: string, forDate: string) {
	return kit
		.selectFrom(weatherCache)
		.where(
			kitAnd(
				kitEq(weatherCache.location_key, locationKeyStr),
				kitEq(weatherCache.for_date, forDate)
			)
		)
		.executeSync()[0];
}

function parsePayload(value: unknown): OpenMeteoResponse | null {
	// `payload_json` is a `json()` column (migration 0010 converted any legacy
	// text rows in place). MongrelDB Kit stores json columns as UTF-8 bytes and
	// reads them back as strings, so the value is parsed here. The object branch
	// is kept so a future Kit that returns parsed json values needs no change.
	if (value == null) return null;
	if (typeof value === 'string') {
		try {
			return JSON.parse(value) as OpenMeteoResponse;
		} catch {
			return null;
		}
	}
	if (typeof value === 'object') return value as OpenMeteoResponse;
	return null;
}

function getFreshPayload(locationKeyStr: string, forDate: string): OpenMeteoResponse | null {
	const row = getCachedRow(locationKeyStr, forDate);
	if (!row) return null;
	const fetchedAt = row.fetched_at as string;
	if (Date.now() - new Date(fetchedAt).getTime() > CACHE_TTL_MS) return null;
	return parsePayload(row.payload_json);
}

function getStalePayload(locationKeyStr: string, forDate: string): OpenMeteoResponse | null {
	const row = getCachedRow(locationKeyStr, forDate);
	return parsePayload(row?.payload_json);
}

function upsertCache(locationKeyStr: string, forDate: string, payload: string): void {
	const existing = kit
		.selectFrom(weatherCache)
		.where(
			kitAnd(
				kitEq(weatherCache.location_key, locationKeyStr),
				kitEq(weatherCache.for_date, forDate)
			)
		)
		.executeSync();
	const now = new Date().toISOString();
	if (existing.length > 0) {
		kit
			.updateTable(weatherCache)
			.set({ fetched_at: now, payload_json: payload })
			.where(kitEq(weatherCache.id, existing[0].id))
			.executeSync();
	} else {
		kit.insertInto(weatherCache).values({
			location_key: locationKeyStr,
			for_date: forDate,
			fetched_at: now,
			payload_json: payload
		} as any).executeSync();
	}
}

/**
 * Prefetch and cache forecasts for trips starting within the forecast horizon.
 * Each unique destination coordinate is fetched once; failures for one location
 * do not block other locations and are logged without throwing.
 */
export async function refreshWeatherCache(now: Date = new Date()): Promise<void> {
	const today = DateTime.fromJSDate(now).startOf('day');
	const horizonEnd = today.plus({ days: FORECAST_DAYS - 1 });

	const upcoming = kit
		.selectFrom(trips)
		.where(
			kitAnd(
				kitGte(trips.start_date, today.toISODate()!),
				kitLte(trips.start_date, horizonEnd.toISODate()!)
			)
		)
		.executeSync();

	const seen = new Set<string>();
	for (const row of upcoming) {
		const lat = row.destination_city_lat;
		const lng = row.destination_city_lng;
		if (lat == null || lng == null) continue;

		const key = locationKey(Number(lat), Number(lng));
		if (seen.has(key)) continue;
		seen.add(key);

		try {
			const response = await fetchForecast(Number(lat), Number(lng));
			if (!response.daily) continue;
			const daily = response.daily;
			for (let i = 0; i < daily.time.length; i++) {
				const dayPayload = JSON.stringify({
					daily: {
						time: [daily.time[i]],
						temperature_2m_max: [daily.temperature_2m_max[i]],
						temperature_2m_min: [daily.temperature_2m_min[i]],
						precipitation_probability_max: [daily.precipitation_probability_max[i]],
						wind_speed_10m_max: [daily.wind_speed_10m_max[i]],
						weather_code: [daily.weather_code[i]]
					}
				});
				upsertCache(key, daily.time[i], dayPayload);
			}
		} catch (e) {
			console.error('[weather] refresh cache failed for', key, e);
		}
	}
}

export async function getCachedForecast(
	lat: number,
	lng: number,
	date: string
): Promise<DayForecast | null> {
	const key = locationKey(lat, lng);
	const fresh = getFreshPayload(key, date);
	let daily: OpenMeteoDaily | undefined;
	let degraded = false;
	if (fresh) {
		daily = fresh.daily;
	} else {
		const stale = getStalePayload(key, date);
		try {
			const response = await fetchForecast(lat, lng);
			if (!response.daily) return null;
			daily = response.daily;
			for (let i = 0; i < daily.time.length; i++) {
				const dayPayload = JSON.stringify({
					daily: {
						time: [daily.time[i]],
						temperature_2m_max: [daily.temperature_2m_max[i]],
						temperature_2m_min: [daily.temperature_2m_min[i]],
						precipitation_probability_max: [daily.precipitation_probability_max[i]],
						wind_speed_10m_max: [daily.wind_speed_10m_max[i]],
						weather_code: [daily.weather_code[i]]
					}
				});
				upsertCache(key, daily.time[i], dayPayload);
			}
		} catch {
			if (!stale) return null;
			daily = stale.daily;
			degraded = true;
		}
	}
	if (!daily) return null;
	const idx = daily.time.indexOf(date);
	if (idx === -1) return null;
	return {
		date,
		locationLabel: '',
		tempMax: daily.temperature_2m_max[idx],
		tempMin: daily.temperature_2m_min[idx],
		precipProb: daily.precipitation_probability_max[idx],
		windMax: daily.wind_speed_10m_max[idx],
		code: daily.weather_code[idx],
		summary: weatherCodeSummary(daily.weather_code[idx]),
		degraded
	};
}

interface TripLocationRow {
	destinationCityLat: number | null;
	destinationCityLng: number | null;
	destinationCityName: string | null;
	startDate: string | null;
	endDate: string | null;
}

function loadTripRow(tripId: number): TripLocationRow | null {
	const row = kit.selectFrom(trips).where(kitEq(trips.id, BigInt(tripId))).executeSync()[0];
	if (!row) return null;
	return {
		destinationCityLat: row.destination_city_lat == null ? null : Number(row.destination_city_lat),
		destinationCityLng: row.destination_city_lng == null ? null : Number(row.destination_city_lng),
		destinationCityName: (row.destination_city_name as string) || null,
		startDate: (row.start_date as string) || null,
		endDate: (row.end_date as string) || null
	};
}

interface SegmentLocation {
	lat: number | null;
	lng: number | null;
	cityName: string | null;
	startAt: string | null;
	endAt: string | null;
}

function loadSegmentLocations(tripId: number): SegmentLocation[] {
	const rows = kit.selectFrom(segments).where(kitEq(segments.trip_id, BigInt(tripId))).executeSync();
	return rows.map((s) => ({
		lat: s.city_lat == null ? null : Number(s.city_lat),
		lng: s.city_lng == null ? null : Number(s.city_lng),
		cityName: (s.city_name as string) || null,
		startAt: (s.start_at as string) || null,
		endAt: (s.end_at as string) || null
	}));
}

function findSegmentForDate(segments: SegmentLocation[], dateStr: string): SegmentLocation | null {
	const target = DateTime.fromISO(dateStr).toMillis();
	let best: SegmentLocation | null = null;
	for (const s of segments) {
		if (s.lat == null || s.lng == null) continue;
		const start = s.startAt ? DateTime.fromISO(s.startAt).toMillis() : null;
		const end = s.endAt ? DateTime.fromISO(s.endAt).toMillis() : null;
		if (start != null && end != null && target >= start && target <= end) return s;
		if (start != null && end == null && target >= start) {
			if (!best) best = s;
		}
	}
	return best;
}

// `days` are metric here; thresholds stay metric and the wind value is formatted
// in the display unit so the text matches the converted forecast cards.
function buildAdvisory(days: DayForecast[], units: WeatherUnits): string | null {
	const warnings: string[] = [];
	for (const d of days) {
		if (d.windMax != null && d.windMax >= 50) {
			const w = units === 'imperial' ? `${kmhToMph(d.windMax).toFixed(0)} mph` : `${d.windMax.toFixed(0)} km/h`;
			warnings.push(`High wind (${w}) on ${d.date}`);
		}
		if (d.precipProb != null && d.precipProb >= 80 && [65, 67, 82, 95, 96, 99].includes(d.code ?? -1))
			warnings.push(`Heavy precipitation on ${d.date}`);
		if (d.tempMin != null && d.tempMin <= 0) warnings.push(`Freezing temperatures on ${d.date}`);
	}
	return warnings.length > 0 ? warnings.join('; ') : null;
}

export async function tripWeatherOverview(
	tripId: number,
	userId: number
): Promise<TripWeatherOverview | null> {
	// Authorize before touching destination coordinates/dates for an arbitrary id.
	loadTripFor(userId, tripId);

	const trip = loadTripRow(tripId);
	if (!trip || trip.destinationCityLat == null || trip.destinationCityLng == null) return null;
	if (!trip.startDate) return null;

	const units = unitsForTimezone(getUserById(userId)?.timezone);
	const tempUnit = units === 'imperial' ? '°F' : '°C';
	const windUnit = units === 'imperial' ? 'mph' : 'km/h';

	const segs = loadSegmentLocations(tripId);
	const today = DateTime.now().startOf('day');
	const maxDate = today.plus({ days: FORECAST_DAYS - 1 });
	const tripEnd = trip.endDate ? DateTime.fromISO(trip.endDate).endOf('day') : maxDate;
	const lastDay = tripEnd < maxDate ? tripEnd : maxDate;

	let cursor = DateTime.fromISO(trip.startDate).startOf('day');
	if (cursor < today) cursor = today;
	if (cursor > lastDay)
		return {
			headline: 'No forecastable dates in range.',
			days: [],
			advisory: null,
			tempUnit,
			windUnit,
			degraded: false
		};

	const days: DayForecast[] = [];
	let anyDegraded = false;
	while (cursor <= lastDay) {
		const dateStr = cursor.toISODate()!;
		const seg = findSegmentForDate(segs, dateStr);
		const lat = seg?.lat ?? trip.destinationCityLat;
		const lng = seg?.lng ?? trip.destinationCityLng;
		const label = seg?.cityName ?? trip.destinationCityName ?? '';

		// cursor never exceeds maxDate (lastDay = min(tripEnd, maxDate)), so every
		// day in range is within the forecast horizon. Days past it are surfaced as
		// "unavailable" by the trip page, not fabricated here.
		const forecast = await getCachedForecast(lat, lng, dateStr);
		if (forecast?.degraded) anyDegraded = true;
		days.push({
			date: dateStr,
			locationLabel: label,
			tempMin: forecast?.tempMin ?? null,
			tempMax: forecast?.tempMax ?? null,
			precipProb: forecast?.precipProb ?? null,
			windMax: forecast?.windMax ?? null,
			code: forecast?.code ?? null,
			summary: forecast?.summary ?? 'Unavailable',
			degraded: forecast?.degraded
		});
		cursor = cursor.plus({ days: 1 });
	}

	const available = days.filter((d) => d.code != null);
	if (available.length === 0) {
		return {
			headline: 'Forecast unavailable for this destination.',
			days,
			advisory: null,
			tempUnit,
			windUnit,
			degraded: anyDegraded
		};
	}

	// Advisory is computed on the metric values (thresholds are metric); the cards
	// are then converted to the user's display units.
	const advisory = buildAdvisory(days, units);
	const displayDays =
		units === 'imperial'
			? days.map((d) => ({
					...d,
					tempMin: d.tempMin == null ? null : cToF(d.tempMin),
					tempMax: d.tempMax == null ? null : cToF(d.tempMax),
					windMax: d.windMax == null ? null : kmhToMph(d.windMax)
				}))
			: days;

	return {
		headline: `${available.length}-day forecast available`,
		days: displayDays,
		advisory,
		tempUnit,
		windUnit,
		degraded: anyDegraded
	};
}
