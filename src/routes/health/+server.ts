import { json, type RequestHandler } from '@sveltejs/kit';
import { existsSync, statSync } from 'node:fs';
import { getDatabasePath } from '$lib/server/db/paths';
import { isSchedulerRunning } from '$lib/server/scheduler';

export const GET: RequestHandler = () => {
	let dbOk = false;
	try {
		const path = getDatabasePath();
		dbOk = existsSync(path) && statSync(path).isDirectory();
	} catch {
		dbOk = false;
	}

	const schedulerOk = isSchedulerRunning();

	return json({ ok: dbOk && schedulerOk, db: dbOk, scheduler: schedulerOk });
};
