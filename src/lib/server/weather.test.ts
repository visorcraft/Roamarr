import { describe, test, expect, beforeEach, vi } from 'vitest';
import type { KitDatabase } from '@visorcraft/mongreldb-kit';

const ctx = vi.hoisted(() => ({ kit: null as unknown as KitDatabase }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

const fetchMock = vi.hoisted(() => vi.fn());
vi.stubGlobal('fetch', fetchMock);

import { weatherCache } from './db/mongrelSchema';
import { locationKey, fetchForecast, getCachedForecast, tripWeatherOverview, CACHE_TTL_MS } from './weather';
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

	test('tripWeatherOverview caps at 14 days', async () => {
		const u = makeUser(ctx.kit);
		const future = DateTime.now().plus({ days: 20 }).toISODate()!;
		fetchMock.mockResolvedValue({
			ok: true,
			json: async () => mockForecastResponse([future])
		});
		const t = makeTrip(ctx.kit, u.id, {
			destinationCityLat: 48.86,
			destinationCityLng: 2.35,
			startDate: future,
			endDate: DateTime.now().plus({ days: 25 }).toISODate()!,
			status: 'booked'
		});
		const w = await tripWeatherOverview(t.id, u.id);
		expect(w).not.toBeNull();
		expect(w!.days.length).toBe(0);
		expect(w!.headline).toBe('No forecastable dates in range.');
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
});
