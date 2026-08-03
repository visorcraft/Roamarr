import { DateTime } from 'luxon';
import { eq as kitEq, and as kitAnd, gte as kitGte, lte as kitLte } from '@visorcraft/mongreldb-kit';
import { kit } from './db';
import { weatherCache, trips, segments } from './db/mongrelSchema';
import { getUserById } from './repositories/usersRepo';
import { loadTripFor } from '../../routes/trips/shared';
import { weatherCodeSummary } from '$lib/weatherCodes';
import { checkRateLimit } from './rateLimit';
import { nowIso } from './tz';

const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';
const OPEN_METEO_ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive';
const FORECAST_DAYS = 14;
export const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
/** Climate (typical-weather) rows are stable; cache them far longer. */
export const CLIMATE_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Years of archive samples averaged for a typical-weather day. */
const CLIMATE_YEARS = 5;
/** How many days past the forecast horizon get typical-weather estimates. */
export const CLIMATE_MAX_DAYS = 14;

export type WeatherUnits = 'metric' | 'imperial';

// The forecast is always fetched + cached in metric (so the cache and the
// advisory thresholds stay uniform across users) and converted for display
// only, based on the per-user `temperature_unit` preference.
export function unitsForUser(temperatureUnit: string | null | undefined): WeatherUnits {
	return temperatureUnit === 'f' ? 'imperial' : 'metric';
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
	/** True when the day is a climatological average, not a live forecast. */
	typical?: boolean;
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
	const res = await fetch(`${OPEN_METEO_URL}?${params}`, { signal: AbortSignal.timeout(10_000) });
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

function getFreshPayload(
	locationKeyStr: string,
	forDate: string,
	ttlMs: number = CACHE_TTL_MS
): OpenMeteoResponse | null {
	const row = getCachedRow(locationKeyStr, forDate);
	if (!row) return null;
	const fetchedAt = row.fetched_at as string;
	if (Date.now() - new Date(fetchedAt).getTime() > ttlMs) return null;
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
	const now = nowIso();
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

function singleDayPayload(daily: OpenMeteoDaily, i: number): string {
	return JSON.stringify({
		daily: {
			time: [daily.time[i]],
			temperature_2m_max: [daily.temperature_2m_max[i]],
			temperature_2m_min: [daily.temperature_2m_min[i]],
			precipitation_probability_max: [daily.precipitation_probability_max[i]],
			wind_speed_10m_max: [daily.wind_speed_10m_max[i]],
			weather_code: [daily.weather_code[i]]
		}
	});
}

/**
 * Prefetch and cache forecasts for trips starting within the forecast horizon.
 * Each unique destination coordinate is fetched once; failures for one location
 * do not block other locations and are logged without throwing.
 */
export async function refreshWeatherCache(now: Date = new Date()): Promise<{ refreshed: number }> {
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
				upsertCache(key, daily.time[i], singleDayPayload(daily, i));
			}
		} catch (e) {
			console.error('[weather] refresh cache failed for', key, e);
		}
	}
	return { refreshed: seen.size };
}

/**
 * Delete cached forecast rows for dates that have already passed. The cache is
 * append-only otherwise (each trip/location/forecast-day upserts rows that are
 * never removed), so without this it grows without bound over the process
 * lifetime. Keeps today and all future days. Returns the number of rows removed.
 */
export function purgeExpiredWeatherCache(now: Date = new Date()): { deleted: number } {
	const todayStart = DateTime.fromJSDate(now).startOf('day');
	const yesterday = todayStart.minus({ days: 1 }).toISODate()!;
	const deleted = kit
		.deleteFrom(weatherCache)
		.where(kitLte(weatherCache.for_date, yesterday))
		.executeSync();
	return { deleted: Number(deleted) };
}

interface OpenMeteoArchiveDaily {
	time: string[];
	temperature_2m_max: Array<number | null>;
	temperature_2m_min: Array<number | null>;
}

interface OpenMeteoArchiveResponse {
	daily?: OpenMeteoArchiveDaily;
	error?: string;
}

/**
 * Fetch the Open-Meteo archive for the CLIMATE_YEARS-year window ending one
 * year before `date` and average the samples matching the target month-day.
 * Keyless like the forecast API; used for trip days beyond the forecast
 * horizon, where the result is a climatological "typical" day, not a forecast.
 */
export async function fetchClimateAverage(
	lat: number,
	lng: number,
	date: string
): Promise<{ tempMin: number; tempMax: number } | null> {
	const target = DateTime.fromISO(date);
	if (!target.isValid) return null;
	const monthDay = target.toFormat('MM-dd');
	const params = new URLSearchParams({
		latitude: String(lat),
		longitude: String(lng),
		start_date: target.minus({ years: CLIMATE_YEARS }).toISODate()!,
		end_date: target.minus({ years: 1 }).toISODate()!,
		daily: ['temperature_2m_max', 'temperature_2m_min'].join(','),
		temperature_unit: 'celsius',
		timezone: 'auto'
	});
	const res = await fetch(`${OPEN_METEO_ARCHIVE_URL}?${params}`, {
		signal: AbortSignal.timeout(10_000)
	});
	if (!res.ok) throw new Error(`Open-Meteo archive returned ${res.status}`);
	const body = (await res.json()) as OpenMeteoArchiveResponse;
	const daily = body.daily;
	if (!daily) return null;
	const highs: number[] = [];
	const lows: number[] = [];
	for (let i = 0; i < daily.time.length; i++) {
		if (daily.time[i].slice(5) !== monthDay) continue;
		const hi = daily.temperature_2m_max[i];
		const lo = daily.temperature_2m_min[i];
		if (hi != null) highs.push(hi);
		if (lo != null) lows.push(lo);
	}
	if (highs.length === 0 || lows.length === 0) return null;
	const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
	return { tempMin: avg(lows), tempMax: avg(highs) };
}

function climateCacheKey(lat: number, lng: number): string {
	return `${locationKey(lat, lng)}|climate`;
}

function climatePayload(date: string, temps: { tempMin: number; tempMax: number }): string {
	return JSON.stringify({
		daily: {
			time: [date],
			temperature_2m_max: [temps.tempMax],
			temperature_2m_min: [temps.tempMin],
			precipitation_probability_max: [null],
			wind_speed_10m_max: [null],
			weather_code: [null]
		}
	});
}

/**
 * Typical-weather estimate for a trip day beyond the forecast horizon.
 * Cached per rounded location + exact date for CLIMATE_CACHE_TTL_MS; on fetch
 * failure any stale row is used and the result is marked degraded.
 */
export async function getCachedClimate(
	lat: number,
	lng: number,
	date: string
): Promise<DayForecast | null> {
	const key = climateCacheKey(lat, lng);
	const fresh = getFreshPayload(key, date, CLIMATE_CACHE_TTL_MS);
	let temps: { tempMin: number; tempMax: number } | null = null;
	let degraded = false;
	if (fresh?.daily) {
		temps = {
			tempMin: fresh.daily.temperature_2m_min[0],
			tempMax: fresh.daily.temperature_2m_max[0]
		};
	} else {
		const stale = getStalePayload(key, date);
		try {
			temps = await fetchClimateAverage(lat, lng, date);
			if (!temps) return null;
			upsertCache(key, date, climatePayload(date, temps));
		} catch {
			if (!stale?.daily) return null;
			temps = {
				tempMin: stale.daily.temperature_2m_min[0],
				tempMax: stale.daily.temperature_2m_max[0]
			};
			degraded = true;
		}
	}
	return {
		date,
		locationLabel: '',
		tempMax: temps.tempMax,
		tempMin: temps.tempMin,
		precipProb: null,
		windMax: null,
		code: null,
		summary: 'Typical',
		degraded,
		typical: true
	};
}

export async function getCachedForecast(
	lat: number,
	lng: number,
	date: string
): Promise<DayForecast | null> {	const key = locationKey(lat, lng);
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
				upsertCache(key, daily.time[i], singleDayPayload(daily, i));
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
	// Prefer indexed PK lookup; fall back to fullscan when the HOT/PK index is desynced.
	const row =
		kit.selectFrom(trips).where(kitEq(trips.id, BigInt(tripId))).executeSync()[0] ??
		kit
			.selectFrom(trips)
			.executeSync()
			.find((t) => Number(t.id) === tripId);
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
// Typical (climatological) days are averages, not predictions, so they never
// raise advisories.
function buildAdvisory(days: DayForecast[], units: WeatherUnits): string | null {
	const warnings: string[] = [];
	for (const d of days) {
		if (d.typical) continue;
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
	const limit = checkRateLimit(String(userId), 'weather:overview', {
		maxAttempts: 30,
		windowMs: 60_000
	});
	// Weather is optional trip chrome. Exhausting the overview budget must not
	// 429 the entire trip page (segment save redirects, itinerary load, etc.).
	if (!limit.allowed) return null;

	// Authorize before touching destination coordinates/dates for an arbitrary id.
	loadTripFor(userId, tripId);

	const trip = loadTripRow(tripId);
	if (!trip || trip.destinationCityLat == null || trip.destinationCityLng == null) return null;
	if (!trip.startDate) return null;

	const units = unitsForUser(getUserById(userId)?.temperature_unit);
	const tempUnit = units === 'imperial' ? '°F' : '°C';
	const windUnit = units === 'imperial' ? 'mph' : 'km/h';

	const segs = loadSegmentLocations(tripId);
	const today = DateTime.now().startOf('day');
	const maxDate = today.plus({ days: FORECAST_DAYS - 1 });
	// Days past the forecast horizon fall back to typical (climatological)
	// weather, capped so long trips don't fan out unbounded archive requests.
	const climateEnd = maxDate.plus({ days: CLIMATE_MAX_DAYS });
	const tripEnd = trip.endDate ? DateTime.fromISO(trip.endDate).endOf('day') : maxDate;
	const lastDay = tripEnd < climateEnd ? tripEnd : climateEnd;

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

		if (cursor > maxDate) {
			// Beyond the forecast horizon: climatological average, labeled
			// "typical" so it is never mistaken for a live forecast.
			const climate = await getCachedClimate(lat, lng, dateStr);
			if (climate?.degraded) anyDegraded = true;
			days.push({
				date: dateStr,
				locationLabel: label,
				tempMin: climate?.tempMin ?? null,
				tempMax: climate?.tempMax ?? null,
				precipProb: null,
				windMax: null,
				code: null,
				summary: climate?.summary ?? 'Unavailable',
				degraded: climate?.degraded,
				typical: true
			});
			cursor = cursor.plus({ days: 1 });
			continue;
		}

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

	const available = days.filter((d) => d.code != null || (d.typical && d.tempMax != null));
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

	const forecastCount = days.filter((d) => d.code != null).length;
	const headline =
		forecastCount > 0
			? `${forecastCount}-day forecast available`
			: 'Typical weather shown (outside the forecast window).';

	return {
		headline,
		days: displayDays,
		advisory,
		tempUnit,
		windUnit,
		degraded: anyDegraded
	};
}
