import { describe, test, expect, beforeEach, vi } from 'vitest';
import type { KitDatabase } from '@mongreldb/kit';

const ctx = vi.hoisted(() => ({ kit: null as unknown as KitDatabase }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

const fetchMock = vi.hoisted(() => vi.fn());
vi.stubGlobal('fetch', fetchMock);

import { weatherCache } from './db/mongrelSchema';
import { weatherCodeSummary, locationKey, getCachedForecast, tripWeatherOverview } from './weather';
import { makeTrip, makeSegment, makeUser } from '../../../tests/helpers';

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

	test('locationKey rounds to 2 decimals', () => {
		expect(locationKey(48.8566, 2.3522)).toBe('48.86|2.35');
		expect(locationKey(-33.8688, 151.2093)).toBe('-33.87|151.21');
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

	test('getCachedForecast returns null on fetch failure', async () => {
		fetchMock.mockRejectedValue(new Error('network error'));
		const today = new Date().toISOString().slice(0, 10);
		const d = await getCachedForecast(48.86, 2.35, today);
		expect(d).toBeNull();
	});

	test('tripWeatherOverview returns null for trip without coordinates', async () => {
		const u = makeUser(ctx.kit);
		const t = makeTrip(ctx.kit, u.id, { destinationCityLat: null, destinationCityLng: null });
		expect(await tripWeatherOverview(t.id)).toBeNull();
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
		const w = await tripWeatherOverview(t.id);
		expect(w).not.toBeNull();
		expect(w!.days.length).toBeGreaterThanOrEqual(1);
		expect(w!.days[0].code).not.toBeNull();
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
		const w = await tripWeatherOverview(t.id);
		expect(w).not.toBeNull();
		expect(w!.days[0].locationLabel).toBe('New York');
	});
});
