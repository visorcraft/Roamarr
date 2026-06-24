import { json, type RequestHandler } from '@sveltejs/kit';
import { sqlite } from '$lib/server/db';
import { isSchedulerRunning } from '$lib/server/scheduler';

export const GET: RequestHandler = () => {
	let dbOk = false;
	try {
		const result = sqlite.pragma('quick_check', { simple: true });
		dbOk = result === 'ok';
	} catch {
		dbOk = false;
	}

	const schedulerOk = isSchedulerRunning();

	return json({ ok: dbOk && schedulerOk, db: dbOk, scheduler: schedulerOk });
};
