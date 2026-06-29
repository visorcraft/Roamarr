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

import { buildTripDetail } from './tripDetail';
import { weatherCache } from './db/mongrelSchema';
import { makeUser, makeTrip } from '../../../tests/helpers';

describe('buildTripDetail', () => {
	beforeEach(() => {
		ctx.kit.deleteFrom(weatherCache).executeSync();
		fetchMock.mockReset();
	});

	test('includes weather in the trip detail payload', async () => {
		const u = makeUser(ctx.kit);
		const today = new Date().toISOString().slice(0, 10);
		fetchMock.mockResolvedValue({
			ok: true,
			json: async () => ({
				daily: {
					time: [today],
					temperature_2m_max: [18],
					temperature_2m_min: [8],
					precipitation_probability_max: [10],
					wind_speed_10m_max: [12],
					weather_code: [1]
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

		const detail = await buildTripDetail(u, t.id, new URL(`http://example.com/trips/${t.id}`));

		expect(detail.weather).not.toBeNull();
		expect(detail.weather?.days.length).toBeGreaterThanOrEqual(1);
		expect(detail.weather?.days[0].code).not.toBeNull();
		expect(detail.weather?.headline).toContain('forecast available');
	});
});
