import { runDueReminders } from './reminders';
import { runFareChecks } from './fareproviders';
import { purgeExpiredSessions } from './auth';

export function startScheduler() {
	const g = globalThis as { __roamarr_scheduler?: boolean };
	if (g.__roamarr_scheduler) return;
	g.__roamarr_scheduler = true;
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
