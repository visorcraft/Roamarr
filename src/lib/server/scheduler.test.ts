import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
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
import { schedulerRuns } from './db/schema';
import { beforeEach } from 'vitest';

beforeEach(() => {
	(ctx as any).sqlite.exec('delete from scheduler_runs;');
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
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	expect(db.select().from(schedulerRuns).all()).toHaveLength(0);

	await runTick(new Date('2026-06-24T12:00:00.000Z'));

	const run = db.select().from(schedulerRuns).get();
	expect(run).not.toBeUndefined();
	expect(run!.success).toBe(true);
	expect(run!.errorMessage).toBeNull();
	expect(run!.finishedAt).not.toBeNull();
});

test('runTick records a failed run', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
	(runDueReminders as any).mockImplementationOnce(async () => {
		throw new Error('reminder boom');
	});

	await runTick(new Date('2026-06-24T12:00:00.000Z'));

	const run = db.select().from(schedulerRuns).get();
	expect(run).not.toBeUndefined();
	expect(run!.success).toBe(false);
	expect(run!.errorMessage).toBe('reminder boom');
	expect(run!.finishedAt).not.toBeNull();
	errorSpy.mockRestore();
});

test('runTick prunes old runs keeping the most recent 100', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	// Seed 110 existing finished runs.
	const base = new Date('2026-06-01T00:00:00.000Z').getTime();
	const values = Array.from({ length: 110 }, (_, i) => ({
		startedAt: new Date(base + i * 1000).toISOString(),
		finishedAt: new Date(base + i * 1000 + 1).toISOString(),
		success: true
	}));
	db.insert(schedulerRuns).values(values).run();

	await runTick(new Date('2026-06-24T12:00:00.000Z'));

	expect(db.select().from(schedulerRuns).all()).toHaveLength(100);
	const oldest = db.select().from(schedulerRuns).orderBy(schedulerRuns.id).get();
	expect(oldest!.startedAt).toBe('2026-06-01T00:00:11.000Z');
});
