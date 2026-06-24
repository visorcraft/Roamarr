import { json, type RequestHandler } from '@sveltejs/kit';
import { sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { isSchedulerRunning } from '$lib/server/scheduler';

export const GET: RequestHandler = () => {
	let dbOk = false;
	try {
		db.run(sql`PRAGMA quick_check`);
		db.run(sql`SELECT 1`);
		dbOk = true;
	} catch {
		dbOk = false;
	}

	const schedulerOk = isSchedulerRunning();
	const healthy = dbOk && schedulerOk;

	return json({ db: dbOk, scheduler: schedulerOk }, { status: healthy ? 200 : 503 });
};
