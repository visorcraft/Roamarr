import { describe, test, expect, beforeEach, vi } from 'vitest';
import type { KitDatabase } from '@visorcraft/mongreldb-kit';
import { eq } from '@visorcraft/mongreldb-kit';

const ctx = vi.hoisted(() => ({ kit: null as unknown as KitDatabase }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

const fetchMock = vi.hoisted(() => vi.fn());
vi.stubGlobal('fetch', fetchMock);

import { weatherCache, users } from './db/mongrelSchema';
import {
	locationKey,
	fetchForecast,
	fetchClimateAverage,
	getCachedForecast,
	getCachedClimate,
	tripWeatherOverview,
	purgeExpiredWeatherCache,
	unitsForUser,
	CACHE_TTL_MS,
	CLIMATE_CACHE_TTL_MS
} from './weather';
import { checkRateLimit, resetRateLimit } from './rateLimit';
import { weatherCodeSummary, weatherIconForCode } from '$lib/weatherCodes';
import { makeTrip, makeSegment, makeUser } from '../../../tests/helpers';
import { DateTime } from 'luxon';

function mockForecastResponse(dates: string[]): unknown {
	return {
		daily: {
			time: dates,
			temperature_2m_max: dates.map((_, i) => 20 + i),
			temperature_2m_min: dates.map((_, i) => 10 + i),
			precipitation_probability_max: dates.map((_, i) => (i % 3) * 30),
			wind_speed_10m_max: dates.map(() => 15),
			weather_code: dates.map(() => 1)
		}
	};
}

describe('weather', () => {
	beforeEach(() => {
		ctx.kit.deleteFrom(weatherCache).executeSync();
		fetchMock.mockReset();
	});

	test('weatherCodeSummary maps known codes', () => {
		expect(weatherCodeSummary(0)).toBe('Clear sky');
		expect(weatherCodeSummary(95)).toBe('Thunderstorm');
		expect(weatherCodeSummary(999)).toBe('Unknown');
	});

	test('weatherIconForCode maps WMO codes to icon names', () => {
		expect(weatherIconForCode(0)).toBe('sun');
		expect(weatherIconForCode(1)).toBe('cloud-sun');
		expect(weatherIconForCode(3)).toBe('cloud-sun');
		expect(weatherIconForCode(45)).toBe('fog');
		expect(weatherIconForCode(51)).toBe('cloud-drizzle');
		expect(weatherIconForCode(61)).toBe('cloud-rain');
		expect(weatherIconForCode(71)).toBe('cloud-snow');
		expect(weatherIconForCode(80)).toBe('cloud-rain');
		expect(weatherIconForCode(85)).toBe('cloud-snow');
		expect(weatherIconForCode(95)).toBe('cloud-lightning');
		expect(weatherIconForCode(null)).toBeNull();
	});

	test('locationKey rounds to 2 decimals', () => {
		expect(locationKey(48.8566, 2.3522)).toBe('48.86|2.35');
		expect(locationKey(-33.8688, 151.2093)).toBe('-33.87|151.21');
	});

	test('fetchForecast URL includes daily, hourly, temperature_unit, and forecast_days', async () => {
		fetchMock.mockResolvedValue({
			ok: true,
			json: async () => mockForecastResponse(['2026-01-01'])
		});
		await fetchForecast(48.86, 2.35);
		const url = new URL(fetchMock.mock.calls[0][0]);
		expect(url.searchParams.get('daily')).toContain('temperature_2m_max');
		expect(url.searchParams.get('hourly')).toBe('temperature_2m,weather_code');
		expect(url.searchParams.get('temperature_unit')).toBe('celsius');
		expect(url.searchParams.get('forecast_days')).toBe('14');
		expect(url.searchParams.get('timezone')).toBe('auto');
	});

	test('getCachedForecast fetches on first call, uses cache after', async () => {
		const today = new Date().toISOString().slice(0, 10);
		fetchMock.mockResolvedValue({
			ok: true,
			json: async () => mockForecastResponse([today])
		});
		const d1 = await getCachedForecast(48.86, 2.35, today);
		expect(d1).not.toBeNull();
		expect(d1!.tempMax).toBe(20);
		expect(d1!.summary).toBe('Mainly clear');
		expect(fetchMock).toHaveBeenCalledTimes(1);

		const d2 = await getCachedForecast(48.86, 2.35, today);
		expect(d2!.tempMax).toBe(20);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	test('getCachedForecast returns null on fetch failure with no cache', async () => {
		fetchMock.mockRejectedValue(new Error('network error'));
		const today = new Date().toISOString().slice(0, 10);
		const d = await getCachedForecast(48.86, 2.35, today);
		expect(d).toBeNull();
	});

	test('getCachedForecast falls back to stale cache when fetch fails', async () => {
		const today = new Date().toISOString().slice(0, 10);
		const key = locationKey(48.86, 2.35);
		const stalePayload = JSON.stringify({
			daily: {
				time: [today],
				temperature_2m_max: [25],
				temperature_2m_min: [15],
				precipitation_probability_max: [10],
				wind_speed_10m_max: [12],
				weather_code: [0]
			}
		});
		const oldFetchedAt = new Date(Date.now() - CACHE_TTL_MS - 1).toISOString();
		ctx.kit.insertInto(weatherCache).values({
			location_key: key,
			for_date: today,
			fetched_at: oldFetchedAt,
			payload_json: stalePayload
		} as any).executeSync();

		fetchMock.mockRejectedValue(new Error('network error'));
		const d = await getCachedForecast(48.86, 2.35, today);
		expect(d).not.toBeNull();
		expect(d!.tempMax).toBe(25);
		expect(d!.summary).toBe('Clear sky');
		expect(d!.degraded).toBe(true);
	});

	test('tripWeatherOverview requires userId and authorizes', async () => {
		const u = makeUser(ctx.kit);
		const t = makeTrip(ctx.kit, u.id, { destinationCityLat: 48.86, destinationCityLng: 2.35 });
		const other = makeUser(ctx.kit);
		await expect(tripWeatherOverview(t.id, other.id)).rejects.toThrow();
	});

	test('tripWeatherOverview returns null for trip without coordinates', async () => {
		const u = makeUser(ctx.kit);
		const t = makeTrip(ctx.kit, u.id, { destinationCityLat: null, destinationCityLng: null });
		expect(await tripWeatherOverview(t.id, u.id)).toBeNull();
	});

	test('tripWeatherOverview returns forecast for a current/future trip', async () => {
		const u = makeUser(ctx.kit);
		const today = new Date().toISOString().slice(0, 10);
		fetchMock.mockResolvedValue({
			ok: true,
			json: async () => mockForecastResponse([today, today])
		});
		const t = makeTrip(ctx.kit, u.id, {
			destinationCityLat: 48.86,
			destinationCityLng: 2.35,
			destinationCityName: 'Paris',
			startDate: today,
			status: 'booked'
		});
		const w = await tripWeatherOverview(t.id, u.id);
		expect(w).not.toBeNull();
		expect(w!.days.length).toBeGreaterThanOrEqual(1);
		expect(w!.days[0].code).not.toBeNull();
		expect(w!.degraded).toBe(false);
	});

	test('tripWeatherOverview uses segment location when available', async () => {
		const u = makeUser(ctx.kit);
		const today = new Date().toISOString().slice(0, 10);
		fetchMock.mockResolvedValue({
			ok: true,
			json: async () => mockForecastResponse([today])
		});
		const t = makeTrip(ctx.kit, u.id, {
			destinationCityLat: 48.86,
			destinationCityLng: 2.35,
			destinationCityName: 'Paris',
			startDate: today,
			status: 'booked'
		});
		makeSegment(ctx.kit, t.id, {
			cityLat: 40.71,
			cityLng: -74.01,
			cityName: 'New York',
			startAt: `${today}T00:00:00.000Z`
		});
		const w = await tripWeatherOverview(t.id, u.id);
		expect(w).not.toBeNull();
		expect(w!.days[0].locationLabel).toBe('New York');
	});

	test('tripWeatherOverview labels days beyond the forecast horizon as typical', async () => {
		const u = makeUser(ctx.kit);
		const start = DateTime.now().plus({ days: 20 });
		const end = DateTime.now().plus({ days: 22 });
		// Archive samples for each trip day's month-day across the 5-year window.
		const times: string[] = [];
		for (let d = 0; d <= 2; d++) {
			const day = start.plus({ days: d });
			for (let y = 1; y <= 5; y++) times.push(day.minus({ years: y }).toISODate()!);
		}
		fetchMock.mockImplementation(async (url: string) => {
			if (String(url).includes('archive')) {
				return {
					ok: true,
					json: async () => ({
						daily: {
							time: times,
							temperature_2m_max: times.map(() => 25),
							temperature_2m_min: times.map(() => 15)
						}
					})
				};
			}
			return { ok: true, json: async () => mockForecastResponse([]) };
		});
		const t = makeTrip(ctx.kit, u.id, {
			destinationCityLat: 48.86,
			destinationCityLng: 2.35,
			startDate: start.toISODate()!,
			endDate: end.toISODate()!,
			status: 'booked'
		});
		const w = await tripWeatherOverview(t.id, u.id);
		expect(w).not.toBeNull();
		expect(w!.days.length).toBe(3);
		expect(w!.days.every((d) => d.typical)).toBe(true);
		expect(w!.days[0].tempMax).toBe(25);
		expect(w!.days[0].summary).toBe('Typical');
		expect(w!.headline).toContain('Typical');
	});

	test('tripWeatherOverview mixes forecast and typical days across the horizon', async () => {
		const u = makeUser(ctx.kit);
		const start = DateTime.now().plus({ days: 12 });
		const end = DateTime.now().plus({ days: 15 });
		const forecastDates = [12, 13].map((d) => DateTime.now().plus({ days: d }).toISODate()!);
		fetchMock.mockImplementation(async (url: string) => {
			if (String(url).includes('archive')) {
				const times: string[] = [];
				for (const d of [14, 15]) {
					const day = DateTime.now().plus({ days: d });
					for (let y = 1; y <= 5; y++) times.push(day.minus({ years: y }).toISODate()!);
				}
				return {
					ok: true,
					json: async () => ({
						daily: {
							time: times,
							temperature_2m_max: times.map(() => 30),
							temperature_2m_min: times.map(() => 20)
						}
					})
				};
			}
			return { ok: true, json: async () => mockForecastResponse(forecastDates) };
		});
		const t = makeTrip(ctx.kit, u.id, {
			destinationCityLat: 48.86,
			destinationCityLng: 2.35,
			startDate: start.toISODate()!,
			endDate: end.toISODate()!,
			status: 'booked'
		});
		const w = await tripWeatherOverview(t.id, u.id);
		expect(w).not.toBeNull();
		expect(w!.days.length).toBe(4);
		expect(w!.days.slice(0, 2).every((d) => !d.typical)).toBe(true);
		expect(w!.days.slice(2).every((d) => d.typical)).toBe(true);
		expect(w!.days[2].tempMax).toBe(30);
	});

	test('tripWeatherOverview returns empty forecast for past trips', async () => {
		const u = makeUser(ctx.kit);
		const pastStart = DateTime.now().minus({ days: 30 }).toISODate()!;
		const pastEnd = DateTime.now().minus({ days: 20 }).toISODate()!;
		fetchMock.mockResolvedValue({
			ok: true,
			json: async () => mockForecastResponse([pastStart])
		});
		const t = makeTrip(ctx.kit, u.id, {
			destinationCityLat: 48.86,
			destinationCityLng: 2.35,
			startDate: pastStart,
			endDate: pastEnd,
			status: 'completed'
		});
		const w = await tripWeatherOverview(t.id, u.id);
		expect(w).not.toBeNull();
		expect(w!.days.length).toBe(0);
		expect(w!.headline).toBe('No forecastable dates in range.');
	});

	test('tripWeatherOverview marks degraded when stale cache is used', async () => {
		const u = makeUser(ctx.kit);
		const today = new Date().toISOString().slice(0, 10);
		const t = makeTrip(ctx.kit, u.id, {
			destinationCityLat: 48.86,
			destinationCityLng: 2.35,
			destinationCityName: 'Paris',
			startDate: today,
			status: 'booked'
		});
		const key = locationKey(48.86, 2.35);
		const stalePayload = JSON.stringify({
			daily: {
				time: [today],
				temperature_2m_max: [22],
				temperature_2m_min: [12],
				precipitation_probability_max: [5],
				wind_speed_10m_max: [10],
				weather_code: [0]
			}
		});
		const oldFetchedAt = new Date(Date.now() - CACHE_TTL_MS - 1).toISOString();
		ctx.kit.insertInto(weatherCache).values({
			location_key: key,
			for_date: today,
			fetched_at: oldFetchedAt,
			payload_json: stalePayload
		} as any).executeSync();

		fetchMock.mockRejectedValue(new Error('network error'));
		const w = await tripWeatherOverview(t.id, u.id);
		expect(w).not.toBeNull();
		expect(w!.degraded).toBe(true);
		expect(w!.days[0].tempMax).toBe(22);
	});

	test('tripWeatherOverview flags freezing when tempMin <= 0', async () => {
		const u = makeUser(ctx.kit);
		const today = new Date().toISOString().slice(0, 10);
		fetchMock.mockResolvedValue({
			ok: true,
			json: async () => ({
				daily: {
					time: [today],
					temperature_2m_max: [5],
					temperature_2m_min: [-2],
					precipitation_probability_max: [0],
					wind_speed_10m_max: [10],
					weather_code: [0]
				}
			})
		});
		const t = makeTrip(ctx.kit, u.id, {
			destinationCityLat: 48.86,
			destinationCityLng: 2.35,
			destinationCityName: 'Paris',
			startDate: today,
			status: 'booked'
		});
		const w = await tripWeatherOverview(t.id, u.id);
		expect(w).not.toBeNull();
		expect(w!.advisory).toContain('Freezing temperatures');
		expect(w!.advisory).toContain(today);
	});

	test('tripWeatherOverview does not flag freeze when tempMin > 0', async () => {
		const u = makeUser(ctx.kit);
		const today = new Date().toISOString().slice(0, 10);
		fetchMock.mockResolvedValue({
			ok: true,
			json: async () => ({
				daily: {
					time: [today],
					temperature_2m_max: [0],
					temperature_2m_min: [2],
					precipitation_probability_max: [0],
					wind_speed_10m_max: [10],
					weather_code: [0]
				}
			})
		});
		const t = makeTrip(ctx.kit, u.id, {
			destinationCityLat: 48.86,
			destinationCityLng: 2.35,
			destinationCityName: 'Paris',
			startDate: today,
			status: 'booked'
		});
		const w = await tripWeatherOverview(t.id, u.id);
		expect(w).not.toBeNull();
		expect(w!.advisory).toBeNull();
	});

	test('tripWeatherOverview soft-fails with null when rate limited', async () => {
		resetRateLimit();
		const u = makeUser(ctx.kit);
		for (let i = 0; i < 30; i++) {
			checkRateLimit(String(u.id), 'weather:overview', { maxAttempts: 30, windowMs: 60_000 });
		}
		// Must not throw 429 — trip detail load embeds this and should still render.
		await expect(tripWeatherOverview(9999, u.id)).resolves.toBeNull();
	});

	test('unitsForUser maps the temperature preference to display units', () => {
		expect(unitsForUser('f')).toBe('imperial');
		expect(unitsForUser('c')).toBe('metric');
		expect(unitsForUser(null)).toBe('metric');
		expect(unitsForUser(undefined)).toBe('metric');
	});

	test('fetchClimateAverage averages matching month-day archive samples', async () => {
		const target = DateTime.now().plus({ days: 40 });
		const times: string[] = [];
		for (let y = 1; y <= 5; y++) times.push(target.minus({ years: y }).toISODate()!);
		// Noise rows from other month-days must be ignored.
		times.push(target.minus({ years: 2, days: 3 }).toISODate()!);
		fetchMock.mockResolvedValue({
			ok: true,
			json: async () => ({
				daily: {
					time: times,
					temperature_2m_max: [10, 20, 30, 40, 50, 99],
					temperature_2m_min: [0, 10, 20, 30, 40, 9]
				}
			})
		});
		const avg = await fetchClimateAverage(48.86, 2.35, target.toISODate()!);
		expect(avg).not.toBeNull();
		expect(avg!.tempMax).toBe(30);
		expect(avg!.tempMin).toBe(20);
		const url = new URL(fetchMock.mock.calls[0][0]);
		expect(url.hostname).toBe('archive-api.open-meteo.com');
		expect(url.searchParams.get('temperature_unit')).toBe('celsius');
		expect(url.searchParams.get('start_date')).toBe(target.minus({ years: 5 }).toISODate()!);
		expect(url.searchParams.get('end_date')).toBe(target.minus({ years: 1 }).toISODate()!);
	});

	test('getCachedClimate fetches once and serves from cache after', async () => {
		const target = DateTime.now().plus({ days: 40 });
		const times: string[] = [];
		for (let y = 1; y <= 5; y++) times.push(target.minus({ years: y }).toISODate()!);
		fetchMock.mockResolvedValue({
			ok: true,
			json: async () => ({
				daily: {
					time: times,
					temperature_2m_max: times.map(() => 22),
					temperature_2m_min: times.map(() => 12)
				}
			})
		});
		const date = target.toISODate()!;
		const d1 = await getCachedClimate(48.86, 2.35, date);
		expect(d1).not.toBeNull();
		expect(d1!.typical).toBe(true);
		expect(d1!.tempMax).toBe(22);
		expect(d1!.summary).toBe('Typical');
		expect(fetchMock).toHaveBeenCalledTimes(1);

		const d2 = await getCachedClimate(48.86, 2.35, date);
		expect(d2!.tempMax).toBe(22);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	test('getCachedClimate falls back to stale cache and marks degraded', async () => {
		const target = DateTime.now().plus({ days: 41 });
		const date = target.toISODate()!;
		const key = `${locationKey(48.86, 2.35)}|climate`;
		const oldFetchedAt = new Date(Date.now() - CLIMATE_CACHE_TTL_MS - 1).toISOString();
		ctx.kit.insertInto(weatherCache).values({
			location_key: key,
			for_date: date,
			fetched_at: oldFetchedAt,
			payload_json: JSON.stringify({
				daily: {
					time: [date],
					temperature_2m_max: [18],
					temperature_2m_min: [8],
					precipitation_probability_max: [null],
					wind_speed_10m_max: [null],
					weather_code: [null]
				}
			})
		} as any).executeSync();

		fetchMock.mockRejectedValue(new Error('network error'));
		const d = await getCachedClimate(48.86, 2.35, date);
		expect(d).not.toBeNull();
		expect(d!.typical).toBe(true);
		expect(d!.tempMax).toBe(18);
		expect(d!.degraded).toBe(true);
	});

	test('getCachedClimate returns null on fetch failure with no cache', async () => {
		fetchMock.mockRejectedValue(new Error('network error'));
		const date = DateTime.now().plus({ days: 42 }).toISODate()!;
		expect(await getCachedClimate(48.86, 2.35, date)).toBeNull();
	});

	test('typical days never raise advisories', async () => {
		const u = makeUser(ctx.kit);
		const start = DateTime.now().plus({ days: 20 });
		const times: string[] = [];
		for (let y = 1; y <= 5; y++) times.push(start.minus({ years: y }).toISODate()!);
		fetchMock.mockImplementation(async (url: string) => {
			if (String(url).includes('archive')) {
				return {
					ok: true,
					json: async () => ({
						daily: {
							time: times,
							// Below freezing: a forecast day would raise an advisory.
							temperature_2m_max: times.map(() => -3),
							temperature_2m_min: times.map(() => -10)
						}
					})
				};
			}
			return { ok: true, json: async () => mockForecastResponse([]) };
		});
		const t = makeTrip(ctx.kit, u.id, {
			destinationCityLat: 48.86,
			destinationCityLng: 2.35,
			startDate: start.toISODate()!,
			endDate: start.toISODate()!,
			status: 'booked'
		});
		const w = await tripWeatherOverview(t.id, u.id);
		expect(w).not.toBeNull();
		expect(w!.days[0].typical).toBe(true);
		expect(w!.advisory).toBeNull();
	});

	test('tripWeatherOverview converts to Fahrenheit when the user prefers it', async () => {
		const u = makeUser(ctx.kit);
		ctx.kit.updateTable(users).set({ temperature_unit: 'f' }).where(eq(users.id, BigInt(u.id))).executeSync();
		const today = new Date().toISOString().slice(0, 10);
		fetchMock.mockResolvedValue({
			ok: true,
			json: async () => mockForecastResponse([today])
		});
		const t = makeTrip(ctx.kit, u.id, {
			destinationCityLat: 48.86,
			destinationCityLng: 2.35,
			startDate: today,
			status: 'booked'
		});
		const w = await tripWeatherOverview(t.id, u.id);
		expect(w).not.toBeNull();
		expect(w!.tempUnit).toBe('°F');
		expect(w!.windUnit).toBe('mph');
		// 20 °C → 68 °F, 15 km/h → ~9.3 mph.
		expect(w!.days[0].tempMax).toBeCloseTo(68, 5);
		expect(w!.days[0].windMax).toBeCloseTo(9.32, 1);
	});

	test('purgeExpiredWeatherCache deletes past-dated rows and keeps today/future', () => {		const today = DateTime.now().startOf('day');
		const todayIso = today.toISODate()!;
		const lastWeekIso = today.minus({ days: 7 }).toISODate()!;
		const yesterdayIso = today.minus({ days: 1 }).toISODate()!;
		const tomorrowIso = today.plus({ days: 1 }).toISODate()!;
		const now = today.plus({ hours: 12 }).toJSDate();
		for (const d of [lastWeekIso, yesterdayIso, todayIso, tomorrowIso]) {
			ctx.kit.insertInto(weatherCache).values({
				location_key: locationKey(48.86, 2.35),
				for_date: d,
				fetched_at: now.toISOString(),
				payload_json: '{}'
			} as any).executeSync();
		}
		expect(purgeExpiredWeatherCache(now).deleted).toBe(2);
		const remaining = ctx.kit
			.selectFrom(weatherCache)
			.executeSync()
			.map((r) => r.for_date)
			.sort();
		expect(remaining).toEqual([todayIso, tomorrowIso]);
	});
});
