import { eq, desc, lt } from 'drizzle-orm';
import { runDueReminders } from './reminders';
import { runFareChecks } from './fareproviders';
import { purgeExpiredSessions } from './auth';
import { db } from './db';
import { schedulerRuns } from './db/schema';

const SCHEDULER_FLAG = '__roamarr_scheduler';
const KEEP_RUNS = 100;

/**
 * Execute one scheduler tick, recording the result in `scheduler_runs`.
 * Exported so tests can invoke it directly.
 */
export async function runTick(now: Date) {
	const startedAt = now.toISOString();
	let runId: number | undefined;
	try {
		runId = db.insert(schedulerRuns).values({ startedAt }).returning({ id: schedulerRuns.id }).get().id;
		await runDueReminders(now);
		await runFareChecks(now);
		purgeExpiredSessions();
		db.update(schedulerRuns)
			.set({ finishedAt: new Date().toISOString(), success: true })
			.where(eq(schedulerRuns.id, runId))
			.run();
	} catch (e) {
		console.error('[scheduler]', e);
		if (runId) {
			db.update(schedulerRuns)
				.set({
					finishedAt: new Date().toISOString(),
					success: false,
					errorMessage: e instanceof Error ? e.message : String(e)
				})
				.where(eq(schedulerRuns.id, runId))
				.run();
		}
	}

	// Keep the most recent runs to avoid unbounded growth.
	try {
		const cutoff = db
			.select({ id: schedulerRuns.id })
			.from(schedulerRuns)
			.orderBy(desc(schedulerRuns.id))
			.limit(1)
			.offset(KEEP_RUNS - 1)
			.get();
		if (cutoff) {
			db.delete(schedulerRuns).where(lt(schedulerRuns.id, cutoff.id)).run();
		}
	} catch (e) {
		console.error('[scheduler] prune failed', e);
	}
}

export function startScheduler() {
	const g = globalThis as { [SCHEDULER_FLAG]?: boolean };
	if (g[SCHEDULER_FLAG]) return;
	g[SCHEDULER_FLAG] = true;
	let running = false;
	setInterval(async () => {
		if (running) return;
		running = true;
		try {
			await runTick(new Date());
		} finally {
			running = false;
		}
	}, 60_000);
}

export function isSchedulerRunning(): boolean {
	return (globalThis as { [SCHEDULER_FLAG]?: boolean })[SCHEDULER_FLAG] === true;
}
