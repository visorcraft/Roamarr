import { test, expect, vi } from 'vitest';
import { asc, eq as kitEq, and as kitAnd } from '@visorcraft/mongreldb-kit';
import { DateTime } from 'luxon';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('./db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

const fetchMock = vi.hoisted(() => vi.fn());
vi.stubGlobal('fetch', fetchMock);

vi.mock('./reminders', () => ({ runDueReminders: vi.fn(async () => {}) }));
vi.mock('./fareproviders', () => ({ runFareChecks: vi.fn(async () => {}) }));
vi.mock('./auth', () => ({ purgeExpiredSessions: vi.fn() }));
vi.mock('./repositories/remindersRepo', async (importOriginal) => {
	const actual = await importOriginal<typeof import('./repositories/remindersRepo')>();
	return {
		...actual,
		startSchedulerRun: vi.fn(actual.startSchedulerRun),
		finishSchedulerRun: vi.fn(actual.finishSchedulerRun)
	};
});

import { runDueReminders } from './reminders';
import { startSchedulerRun, finishSchedulerRun } from './repositories/remindersRepo';
import { startScheduler, runTick } from './scheduler';
import { schedulerRuns, weatherCache } from './db/mongrelSchema';
import { makeUser, makeTrip } from '../../../tests/helpers';
import { locationKey } from './weather';
import { beforeEach } from 'vitest';

function getKit() {
	return (ctx as { kit: import('@visorcraft/mongreldb-kit').KitDatabase }).kit;
}

beforeEach(() => {
	getKit().deleteFrom(schedulerRuns).executeSync();
	getKit().deleteFrom(weatherCache).executeSync();
	(runDueReminders as any).mockReset?.();
	fetchMock.mockReset();
});

test('starts only once', () => {
	const spy = vi.spyOn(globalThis, 'setInterval');
	startScheduler();
	startScheduler();
	expect(spy).toHaveBeenCalledTimes(1);
	spy.mockRestore();
});

test('runTick records a successful run', async () => {
	const kit = getKit();
	expect(kit.selectFrom(schedulerRuns).executeSync()).toHaveLength(0);

	await runTick(new Date('2026-06-24T12:00:00.000Z'));

	const run = kit.selectFrom(schedulerRuns).executeSync()[0];
	expect(run).not.toBeUndefined();
	expect(run!.success).toBe(true);
	expect(run!.error_message).toBeNull();
	expect(run!.finished_at).not.toBeNull();
});

test('runTick records a failed run', async () => {
	const kit = getKit();
	const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
	(runDueReminders as any).mockImplementationOnce(async () => {
		throw new Error('reminder boom');
	});

	await runTick(new Date('2026-06-24T12:00:00.000Z'));

	const run = kit.selectFrom(schedulerRuns).executeSync()[0];
	expect(run).not.toBeUndefined();
	expect(run!.success).toBe(false);
	expect(run!.error_message).toBe('reminder boom');
	expect(run!.finished_at).not.toBeNull();
	errorSpy.mockRestore();
});

test('runTick bounds a stalled job with a deadline and records a failed run', async () => {
	const kit = getKit();
	const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
	// A job that never settles must not hang the tick.
	(runDueReminders as any).mockImplementationOnce(() => new Promise(() => {}));

	await runTick(new Date('2026-06-24T12:00:00.000Z'), { deadlineMs: 25 });

	const run = kit.selectFrom(schedulerRuns).executeSync()[0];
	expect(run).not.toBeUndefined();
	expect(run!.success).toBe(false);
	expect(run!.error_message).toMatch(/timed out/);
	expect(run!.finished_at).not.toBeNull();
	errorSpy.mockRestore();
});

test('runTick prunes old runs keeping the most recent 100', async () => {
	const kit = getKit();
	// Seed 110 existing finished runs.
	const base = new Date('2026-06-01T00:00:00.000Z').getTime();
	for (let i = 0; i < 110; i++) {
		kit
			.insertInto(schedulerRuns)
			.values({
				started_at: new Date(base + i * 1000).toISOString(),
				finished_at: new Date(base + i * 1000 + 1).toISOString(),
				success: true
			} as never)
			.executeSync();
	}

	await runTick(new Date('2026-06-24T12:00:00.000Z'));

	expect(kit.selectFrom(schedulerRuns).executeSync()).toHaveLength(100);
	const oldest = kit.selectFrom(schedulerRuns).orderBy(asc(schedulerRuns.started_at)).executeSync()[0];
	expect(oldest!.started_at).toBe('2026-06-01T00:00:11.000Z');
});

test('runTick prefetches weather for upcoming trips with coordinates', async () => {
	const kit = getKit();
	const today = new Date().toISOString().slice(0, 10);
	const farFuture = DateTime.now().plus({ days: 20 }).toISODate()!;
	const u = makeUser(kit);

	// Upcoming trip with coordinates -- should be prefetched.
	makeTrip(kit, u.id, {
		name: 'Upcoming Paris',
		destinationCityLat: 48.86,
		destinationCityLng: 2.35,
		startDate: today
	});

	// Upcoming trip without coordinates -- should be skipped.
	makeTrip(kit, u.id, {
		name: 'No coordinates',
		destinationCityLat: null,
		destinationCityLng: null,
		startDate: today
	});

	// Far-future trip -- should be skipped.
	makeTrip(kit, u.id, {
		name: 'Far future',
		destinationCityLat: 40.71,
		destinationCityLng: -74.01,
		startDate: farFuture
	});

	fetchMock.mockResolvedValue({
		ok: true,
		json: async () => ({
			daily: {
				time: [today],
				temperature_2m_max: [22],
				temperature_2m_min: [12],
				precipitation_probability_max: [5],
				wind_speed_10m_max: [10],
				weather_code: [0]
			}
		})
	});

	await runTick(new Date());

	const parisKey = locationKey(48.86, 2.35);
	const nyKey = locationKey(40.71, -74.01);

	const parisCached = kit
		.selectFrom(weatherCache)
		.where(
			kitAnd(
				kitEq(weatherCache.location_key, parisKey),
				kitEq(weatherCache.for_date, today)
			)
		)
		.executeSync();
	expect(parisCached).toHaveLength(1);

	const nyCached = kit
		.selectFrom(weatherCache)
		.where(
			kitAnd(
				kitEq(weatherCache.location_key, nyKey),
				kitEq(weatherCache.for_date, farFuture)
			)
		)
		.executeSync();
	expect(nyCached).toHaveLength(0);

	// Only one unique coordinate pair should have been fetched.
	expect(fetchMock).toHaveBeenCalledTimes(1);
});
test('runTick still runs the jobs and resolves when the run row cannot be recorded', async () => {
	const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
	vi.mocked(startSchedulerRun).mockImplementationOnce(() => {
		throw new Error('disk full');
	});

	await expect(runTick(new Date('2026-06-24T12:00:00.000Z'))).resolves.toBeUndefined();

	expect(runDueReminders).toHaveBeenCalledTimes(1);
	expect(vi.mocked(finishSchedulerRun)).not.toHaveBeenCalled();
	expect(getKit().selectFrom(schedulerRuns).executeSync()).toHaveLength(0);
	expect(errorSpy).toHaveBeenCalledWith('[scheduler] failed to record run start', expect.any(Error));
	errorSpy.mockRestore();
});

test('runTick resolves and keeps the original error when recording a failure fails', async () => {
	const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
	(runDueReminders as any).mockImplementationOnce(async () => {
		throw new Error('reminder boom');
	});
	vi.mocked(finishSchedulerRun).mockImplementationOnce(() => {
		throw new Error('disk full');
	});

	await expect(runTick(new Date('2026-06-24T12:00:00.000Z'))).resolves.toBeUndefined();

	expect(errorSpy).toHaveBeenCalledWith('[scheduler]', expect.any(Error));
	expect(errorSpy).toHaveBeenCalledWith('[scheduler] failed to record run result', expect.any(Error));
	const runs = getKit().selectFrom(schedulerRuns).executeSync();
	expect(runs).toHaveLength(1);
	expect(runs[0]!.finished_at).toBeNull();
	errorSpy.mockRestore();
});

test('the scheduler interval loop keeps ticking when run bookkeeping fails', async () => {
	const g = globalThis as { __roamarr_scheduler?: boolean };
	const previous = g.__roamarr_scheduler;
	delete g.__roamarr_scheduler;
	const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
	// Stub the timer: nothing is scheduled, but the callback is captured.
	const intervalSpy = vi.spyOn(globalThis, 'setInterval').mockImplementation((() => 0) as never);
	try {
		startScheduler();
		expect(intervalSpy).toHaveBeenCalledTimes(1);
		const tick = intervalSpy.mock.calls[0]![0] as unknown as () => Promise<void>;
		vi.mocked(startSchedulerRun).mockImplementationOnce(() => {
			throw new Error('disk full');
		});

		// First tick: the run row cannot be written, the tick still completes.
		await expect(tick()).resolves.toBeUndefined();
		expect(runDueReminders).toHaveBeenCalledTimes(1);

		// Second tick: the loop is still alive and records normally.
		await expect(tick()).resolves.toBeUndefined();
		expect(runDueReminders).toHaveBeenCalledTimes(2);
		const runs = getKit().selectFrom(schedulerRuns).executeSync();
		expect(runs).toHaveLength(1);
		expect(runs[0]!.success).toBe(true);
	} finally {
		intervalSpy.mockRestore();
		errorSpy.mockRestore();
		if (previous === undefined) delete g.__roamarr_scheduler;
		else g.__roamarr_scheduler = previous;
	}
});
