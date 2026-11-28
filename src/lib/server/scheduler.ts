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
import { runAutoBackupIfDue } from './autoBackup';
import { kit } from './db';
import {
	startSchedulerRun,
	finishSchedulerRun,
	listRecentSchedulerRuns,
	pruneOldSchedulerRuns,
	type SchedulerRunSummary
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

/** Per-job default cap: a single slow or hung job cannot starve the others. */
export const SCHEDULER_JOB_DEADLINE_MS = 20_000;

/** Compact every table at most this often. Clean tables skip themselves. */
const COMPACT_INTERVAL_MS = 60 * 60_000;
let lastCompactAt = 0;

/** Test hook: reset module-level scheduler state between tests. */
export function resetSchedulerStateForTests() {
	lastCompactAt = 0;
}

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

function toError(e: unknown): Error {
	return e instanceof Error ? e : new Error(String(e));
}

/**
 * Compact every table one at a time, yielding to the event loop between
 * tables so hourly compaction does not block the loop in one giant stall.
 * A failing table is logged and skipped; the rest still compact. Falls back
 * to a single blocking compactAll() when tableNames() is unavailable.
 */
async function compactTablesYielding(): Promise<void> {
	const tableNames = typeof kit.tableNames === 'function' ? kit.tableNames() : null;
	if (!tableNames) {
		kit.compactAll();
		return;
	}
	for (let i = 0; i < tableNames.length; i++) {
		try {
			kit.compactTable(tableNames[i]);
		} catch (e) {
			console.error('[scheduler] compact table failed', tableNames[i], e);
		}
		if (i < tableNames.length - 1) {
			await new Promise<void>((resolve) => setImmediate(resolve));
		}
	}
}

/**
 * Execute one scheduler tick, recording the result in `scheduler_runs`.
 * Exported so tests can invoke it directly.
 *
 * Each async job runs under its own deadline (bounded by `deadlineMs`) via
 * Promise.allSettled, so a slow, hung, or throwing job (e.g. a wedged IMAP
 * server, an SMTP timeout, a slow fare provider) cannot starve or cancel the
 * other jobs. The fast synchronous purges always run, individually guarded,
 * so an async failure never prevents expired sessions/OAuth tokens/invitations
 * from being purged. Maintenance that keeps the engine healthy over a long
 * uptime — reclaiming in-memory rate-limit buckets, dropping stale weather
 * rows, flushing memtables and (hourly) compacting sorted runs — runs after
 * the jobs and never fails the tick. Never rejects: run bookkeeping is
 * best-effort, and the scheduled loop has no caller that could observe a
 * rejection.
 */
export async function runTick(
	now: Date,
	opts: { deadlineMs?: number; jobDeadlineMs?: number } = {}
) {
	const deadlineMs = opts.deadlineMs ?? SCHEDULER_TICK_DEADLINE_MS;
	const jobDeadlineMs = Math.min(opts.jobDeadlineMs ?? SCHEDULER_JOB_DEADLINE_MS, deadlineMs);
	// Recording the run is best-effort. A failing write (full disk, transient
	// I/O error) must not skip the scheduled work, and runTick must never
	// reject: the interval loop in startScheduler has no caller that could
	// observe it, and Node exits on an unhandled rejection.
	let runId: number | null = null;
	try {
		runId = startSchedulerRun().id;
	} catch (e) {
		console.error('[scheduler] failed to record run start', e);
	}
	const record = (result: Parameters<typeof finishSchedulerRun>[1]) => {
		if (runId === null) return;
		try {
			finishSchedulerRun(runId, result);
		} catch (e) {
			console.error('[scheduler] failed to record run result', e);
		}
	};
	try {
		const jobSpecs: Array<{ name: string; run: () => Promise<unknown> }> = [
			{ name: 'reminders', run: () => runDueReminders(now) },
			{ name: 'fareChecks', run: () => runFareChecks(now) },
			{ name: 'weatherCache', run: () => refreshWeatherCache(now) },
			{ name: 'emailProcessing', run: () => pollDueInboxes(now) }
		];
		const settled = await Promise.allSettled(
			jobSpecs.map(({ name, run }) =>
				withDeadline(Promise.resolve().then(run), jobDeadlineMs, name)
			)
		);
		const failures: Array<{ label: string; error: Error }> = [];
		const outputs: Record<string, unknown> = {};
		settled.forEach((outcome, i) => {
			const name = jobSpecs[i].name;
			if (outcome.status === 'fulfilled') outputs[name] = outcome.value;
			else failures.push({ label: name, error: toError(outcome.reason) });
		});

		// The 4 fast sync purges always run, each guarded individually so a
		// failing purge never prevents the others (or the async jobs) from running.
		const purgeSpecs = [
			{ name: 'sessions', run: purgeExpiredSessions },
			{ name: 'challenges', run: purgeExpiredChallenges },
			{ name: 'oauth', run: purgeExpiredOauth },
			{ name: 'tripInvitations', run: purgeExpiredTripInvitations }
		];
		const purges: Record<string, unknown> = {};
		for (const spec of purgeSpecs) {
			try {
				const value = spec.run();
				if (value !== undefined) purges[spec.name] = value;
			} catch (e) {
				failures.push({ label: `purges.${spec.name}`, error: toError(e) });
			}
		}

		const summary: SchedulerRunSummary & Record<string, unknown> = {};
		if (outputs.reminders !== undefined)
			summary.reminders = outputs.reminders as SchedulerRunSummary['reminders'];
		if (outputs.fareChecks !== undefined)
			summary.fareChecks = outputs.fareChecks as SchedulerRunSummary['fareChecks'];
		if (outputs.weatherCache !== undefined)
			summary.weatherCache = outputs.weatherCache as SchedulerRunSummary['weatherCache'];
		if (outputs.emailProcessing !== undefined) summary.emailProcessing = outputs.emailProcessing;
		if (Object.keys(purges).length > 0)
			summary.purges = purges as SchedulerRunSummary['purges'];
		if (failures.length > 0) {
			const errors: Record<string, string> = {};
			for (const f of failures) errors[f.label] = f.error.message;
			summary.errors = errors;
		}

		if (failures.length === 0) {
			record({ success: true, summary });
		} else {
			console.error('[scheduler]', failures[0].error);
			record({
				success: false,
				errorMessage: failures.map((f) => f.error.message).join('; '),
				summary
			});
		}
	} catch (e) {
		console.error('[scheduler]', e);
		record({ success: false, errorMessage: e instanceof Error ? e.message : String(e) });
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
	// Scheduled admin auto-backup: no-op unless enabled and due. Runs in the
	// post-jobs maintenance section (outside the tick deadline) because packing
	// a large database can legitimately take a while; a failure is logged and
	// never fails the tick.
	try {
		const autoBackup = await runAutoBackupIfDue(now);
		if (autoBackup.ran) console.info('[scheduler] auto-backup written:', autoBackup.file);
	} catch (e) {
		console.error('[scheduler] auto-backup failed', e);
	}

	// Flush memtables each tick (cheap; enables the incremental-aggregate fast
	// path) and compact hourly so query latency stays flat over a long uptime.
	// flushAsync uses per-table native async so the Node event loop can keep
	// serving requests while memtables spill; compactTablesYielding compacts
	// table-by-table with setImmediate yields between tables so hourly
	// compaction does not block the loop in one giant stall.
	try {
		await kit.flushAsync();
	} catch (e) {
		console.error('[scheduler] flush failed', e);
	}
	if (now.getTime() - lastCompactAt >= COMPACT_INTERVAL_MS) {
		lastCompactAt = now.getTime();
		try {
			await compactTablesYielding();
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
		} catch (e) {
			// Backstop: an unobserved rejection here would exit the process.
			console.error('[scheduler] tick crashed', e);
		} finally {
			running = false;
		}
	}, 60_000);
}

export function isSchedulerRunning(): boolean {
	return (globalThis as { [SCHEDULER_FLAG]?: boolean })[SCHEDULER_FLAG] === true;
}
