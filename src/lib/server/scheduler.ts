import { runDueReminders } from './reminders';
import { runFareChecks } from './fareproviders';
import { purgeExpiredSessions } from './auth';
import { purgeExpiredChallenges } from './passkeys';
import {
	startSchedulerRun,
	finishSchedulerRun,
	listRecentSchedulerRuns,
	pruneOldSchedulerRuns
} from './repositories/remindersRepo';

const SCHEDULER_FLAG = '__roamarr_scheduler';
const KEEP_RUNS = 100;

/**
 * Execute one scheduler tick, recording the result in `scheduler_runs`.
 * Exported so tests can invoke it directly.
 */
export async function runTick(now: Date) {
	const run = startSchedulerRun();
	try {
		await runDueReminders(now);
		await runFareChecks(now);
		purgeExpiredSessions();
		purgeExpiredChallenges();
		finishSchedulerRun(run.id, { success: true });
	} catch (e) {
		console.error('[scheduler]', e);
		finishSchedulerRun(run.id, {
			success: false,
			errorMessage: e instanceof Error ? e.message : String(e)
		});
	}

	// Keep the most recent runs to avoid unbounded growth.
	try {
		const recent = listRecentSchedulerRuns(KEEP_RUNS);
		const cutoff = recent[recent.length - 1];
		if (cutoff) {
			pruneOldSchedulerRuns(cutoff.startedAt);
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
