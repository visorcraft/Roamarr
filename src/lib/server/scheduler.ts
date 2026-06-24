import { runDueReminders } from './reminders';
import { runFareChecks } from './fareproviders';
import { purgeExpiredSessions } from './auth';

const SCHEDULER_FLAG = '__roamarr_scheduler';

export function startScheduler() {
	const g = globalThis as { [SCHEDULER_FLAG]?: boolean };
	if (g[SCHEDULER_FLAG]) return;
	g[SCHEDULER_FLAG] = true;
	let running = false;
	setInterval(async () => {
		if (running) return;
		running = true;
		try {
			const now = new Date();
			await runDueReminders(now);
			await runFareChecks(now);
			purgeExpiredSessions();
		} catch (e) {
			console.error('[scheduler]', e);
		} finally {
			running = false;
		}
	}, 60_000);
}

export function isSchedulerRunning(): boolean {
	return (globalThis as { [SCHEDULER_FLAG]?: boolean })[SCHEDULER_FLAG] === true;
}
