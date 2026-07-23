import { runDueReminders } from './reminders';
import { runFareChecks } from './fareproviders';
import { purgeExpiredSessions } from './auth';
import { purgeExpiredChallenges } from './passkeys';
import { purgeExpiredOauth } from './oauth';
import { refreshWeatherCache, purgeExpiredWeatherCache } from './weather';
import { purgeExpiredTripInvitations } from './tripSharing';
import { pruneExpiredRateLimit } from './rateLimit';
import { pruneExpiredShareWindow } from './emergencyContacts';
import { pollDueInboxes } from './emailProcessing';
import { kit } from './db';
import {
	startSchedulerRun,
	finishSchedulerRun,
	listRecentSchedulerRuns,
	pruneOldSchedulerRuns
} from './repositories/remindersRepo';

const SCHEDULER_FLAG = '__roamarr_scheduler';
const KEEP_RUNS = 100;

/**
 * Wall-clock bound for a single scheduler tick. Combined with per-send SMTP
 * deadlines and the fare-check AbortSignal, nothing in a tick should approach
 * this; it is the final backstop so a stalled job can never freeze the loop
 * (and all scheduled work) until the process is restarted.
 */
export const SCHEDULER_TICK_DEADLINE_MS = 55_000;

/** Compact every table at most this often. Clean tables skip themselves. */
const COMPACT_INTERVAL_MS = 60 * 60_000;
let lastCompactAt = 0;

/** Race a promise against a deadline; clears its timer once settled (no leaks). */
function withDeadline<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_resolve, reject) => {
		timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
	});
	return Promise.race([promise, timeout]).finally(() => {
		if (timer) clearTimeout(timer);
	}) as Promise<T>;
}

/**
 * Execute one scheduler tick, recording the result in `scheduler_runs`.
 * Exported so tests can invoke it directly.
 *
 * The job pipeline runs under `deadlineMs` (default {@link SCHEDULER_TICK_DEADLINE_MS})
 * so a slow external dependency cannot stall the loop. Maintenance that keeps
 * the engine healthy over a long uptime — reclaiming in-memory rate-limit
 * buckets, dropping stale weather rows, flushing memtables and (hourly)
 * compacting sorted runs — runs after the jobs and never fails the tick.
 */
export async function runTick(now: Date, opts: { deadlineMs?: number } = {}) {
	const deadlineMs = opts.deadlineMs ?? SCHEDULER_TICK_DEADLINE_MS;
	const run = startSchedulerRun();
	try {
		const jobs = (async () => {
			const reminders = await runDueReminders(now);
			const fareChecks = await runFareChecks(now);
			const weatherCache = await refreshWeatherCache(now);
			const emailProcessing = await pollDueInboxes(now);
			const sessions = purgeExpiredSessions();
			const challenges = purgeExpiredChallenges();
			const oauth = purgeExpiredOauth();
			const tripInvitations = purgeExpiredTripInvitations();
			return {
				reminders,
				fareChecks,
				weatherCache,
				emailProcessing,
				purges: { sessions, challenges, oauth, tripInvitations }
			};
		})();
		const summary = await withDeadline(jobs, deadlineMs, 'scheduler tick');
		finishSchedulerRun(run.id, { success: true, summary });
	} catch (e) {
		console.error('[scheduler]', e);
		finishSchedulerRun(run.id, {
			success: false,
			errorMessage: e instanceof Error ? e.message : String(e)
		});
	}

	// Reclaim in-memory rate-limit state and stale weather rows every tick.
	try {
		pruneExpiredRateLimit();
	} catch (e) {
		console.error('[scheduler] rate-limit prune failed', e);
	}
	try {
		pruneExpiredShareWindow();
	} catch (e) {
		console.error('[scheduler] share prune failed', e);
	}
	try {
		purgeExpiredWeatherCache(now);
	} catch (e) {
		console.error('[scheduler] weather prune failed', e);
	}

	// Flush memtables each tick (cheap; enables the incremental-aggregate fast
	// path) and compact hourly so query latency stays flat over a long uptime.
	// flushAsync uses per-table native async so the Node event loop can keep
	// serving requests while memtables spill; compactAll still blocks (no native
	// async compact), so it stays on the hourly cadence only.
	try {
		await kit.flushAsync();
	} catch (e) {
		console.error('[scheduler] flush failed', e);
	}
	if (now.getTime() - lastCompactAt >= COMPACT_INTERVAL_MS) {
		lastCompactAt = now.getTime();
		try {
			kit.compactAll();
		} catch (e) {
			console.error('[scheduler] compact failed', e);
		}
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
