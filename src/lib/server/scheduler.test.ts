import { test, expect, vi } from 'vitest';
import { asc } from '@visorcraft/mongreldb-kit';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('./db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

vi.mock('./reminders', () => ({ runDueReminders: vi.fn(async () => {}) }));
vi.mock('./fareproviders', () => ({ runFareChecks: vi.fn(async () => {}) }));
vi.mock('./auth', () => ({ purgeExpiredSessions: vi.fn() }));

import { runDueReminders } from './reminders';
import { startScheduler, runTick } from './scheduler';
import { schedulerRuns } from './db/mongrelSchema';
import { beforeEach } from 'vitest';

function getKit() {
	return (ctx as { kit: import('@visorcraft/mongreldb-kit').KitDatabase }).kit;
}

beforeEach(() => {
	getKit().deleteFrom(schedulerRuns).executeSync();
	(runDueReminders as any).mockReset?.();
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
