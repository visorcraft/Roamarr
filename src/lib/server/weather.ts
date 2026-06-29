import { DateTime } from 'luxon';
import { eq as kitEq, and as kitAnd } from '@mongreldb/kit';
import { kit } from './db';
import { weatherCache, trips, segments } from './db/mongrelSchema';

const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';
const FORECAST_DAYS = 14;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export interface DayForecast {
	date: string;
	locationLabel: string;
	tempMin: number | null;
	tempMax: number | null;
	precipProb: number | null;
	windMax: number | null;
	code: number | null;
	summary: string;
}

export interface TripWeatherOverview {
	headline: string;
	days: DayForecast[];
	advisory: string | null;
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

const WMO_CODES: Record<number, string> = {
	0: 'Clear sky',
	1: 'Mainly clear',
	2: 'Partly cloudy',
	3: 'Overcast',
	45: 'Fog',
	48: 'Depositing rime fog',
	51: 'Light drizzle',
	53: 'Moderate drizzle',
	55: 'Dense drizzle',
	56: 'Light freezing drizzle',
	57: 'Dense freezing drizzle',
	61: 'Slight rain',
	63: 'Moderate rain',
	65: 'Heavy rain',
	66: 'Light freezing rain',
	67: 'Heavy freezing rain',
	71: 'Slight snow',
	73: 'Moderate snow',
	75: 'Heavy snow',
	77: 'Snow grains',
	80: 'Slight rain showers',
	81: 'Moderate rain showers',
	82: 'Violent rain showers',
	85: 'Slight snow showers',
	86: 'Heavy snow showers',
	95: 'Thunderstorm',
	96: 'Thunderstorm with slight hail',
	99: 'Thunderstorm with heavy hail'
};

export function weatherCodeSummary(code: number): string {
	return WMO_CODES[code] ?? 'Unknown';
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
		forecast_days: String(FORECAST_DAYS),
		timezone: 'auto'
	});
	const res = await fetch(`${OPEN_METEO_URL}?${params}`);
	if (!res.ok) throw new Error(`Open-Meteo returned ${res.status}`);
	return (await res.json()) as OpenMeteoResponse;
}

function getCachedPayload(locationKeyStr: string, forDate: string): string | null {
	const rows = kit
		.selectFrom(weatherCache)
		.where(
			kitAnd(
				kitEq(weatherCache.location_key, locationKeyStr),
				kitEq(weatherCache.for_date, forDate)
			)
		)
		.executeSync();
	if (rows.length === 0) return null;
	const fetchedAt = rows[0].fetched_at as string;
	if (Date.now() - new Date(fetchedAt).getTime() > CACHE_TTL_MS) return null;
	return rows[0].payload_json as string;
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

export async function getCachedForecast(
	lat: number,
	lng: number,
	date: string
): Promise<DayForecast | null> {
	const key = locationKey(lat, lng);
	const cached = getCachedPayload(key, date);
	let daily: OpenMeteoDaily | undefined;
	if (cached) {
		const parsed = JSON.parse(cached) as OpenMeteoResponse;
		daily = parsed.daily;
	} else {
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
			return null;
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
		summary: weatherCodeSummary(daily.weather_code[idx])
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

function buildAdvisory(days: DayForecast[]): string | null {
	const warnings: string[] = [];
	for (const d of days) {
		if (d.windMax != null && d.windMax >= 50) warnings.push(`High wind (${d.windMax.toFixed(0)} km/h) on ${d.date}`);
		if (d.precipProb != null && d.precipProb >= 80 && [65, 67, 82, 95, 96, 99].includes(d.code ?? -1))
			warnings.push(`Heavy precipitation on ${d.date}`);
		if (d.tempMax != null && d.tempMax <= 0) warnings.push(`Freezing temperatures on ${d.date}`);
	}
	return warnings.length > 0 ? warnings.join('; ') : null;
}

export async function tripWeatherOverview(tripId: number): Promise<TripWeatherOverview | null> {
	const trip = loadTripRow(tripId);
	if (!trip || trip.destinationCityLat == null || trip.destinationCityLng == null) return null;
	if (!trip.startDate) return null;

	const segs = loadSegmentLocations(tripId);
	const today = DateTime.now().startOf('day');
	const maxDate = today.plus({ days: FORECAST_DAYS - 1 });
	const tripEnd = trip.endDate ? DateTime.fromISO(trip.endDate).endOf('day') : maxDate;
	const lastDay = tripEnd < maxDate ? tripEnd : maxDate;

	let cursor = DateTime.fromISO(trip.startDate).startOf('day');
	if (cursor < today) cursor = today;
	if (cursor > lastDay) return { headline: 'No forecastable dates in range.', days: [], advisory: null };

	const days: DayForecast[] = [];
	while (cursor <= lastDay) {
		const dateStr = cursor.toISODate()!;
		const seg = findSegmentForDate(segs, dateStr);
		const lat = seg?.lat ?? trip.destinationCityLat;
		const lng = seg?.lng ?? trip.destinationCityLng;
		const label = seg?.cityName ?? trip.destinationCityName ?? '';

		if (cursor > maxDate) {
			days.push({
				date: dateStr,
				locationLabel: label,
				tempMin: null,
				tempMax: null,
				precipProb: null,
				windMax: null,
				code: null,
				summary: 'Forecast unavailable'
			});
		} else {
			const forecast = await getCachedForecast(lat, lng, dateStr);
			days.push({
				date: dateStr,
				locationLabel: label,
				tempMin: forecast?.tempMin ?? null,
				tempMax: forecast?.tempMax ?? null,
				precipProb: forecast?.precipProb ?? null,
				windMax: forecast?.windMax ?? null,
				code: forecast?.code ?? null,
				summary: forecast?.summary ?? 'Unavailable'
			});
		}
		cursor = cursor.plus({ days: 1 });
	}

	const available = days.filter((d) => d.code != null);
	if (available.length === 0) {
		return { headline: 'Forecast unavailable for this destination.', days, advisory: null };
	}

	const headline = `${available.length}-day forecast available`;
	return {
		headline,
		days,
		advisory: buildAdvisory(days)
	};
}
