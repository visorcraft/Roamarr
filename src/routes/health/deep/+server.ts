import { json, type RequestHandler } from '@sveltejs/kit';
import mongreldb from 'mongreldb';
import type { Database as NativeDatabase } from 'mongreldb/native.js';
import { getDatabasePath } from '$lib/server/db/paths';
import { isSchedulerRunning } from '$lib/server/scheduler';

const NativeDatabaseClass = (mongreldb as unknown as { Database: typeof NativeDatabase }).Database;

export const GET: RequestHandler = () => {
	let dbOk = false;
	let details: Record<string, unknown> | undefined;

	try {
		// Open directly with the native addon rather than the kit singleton so a
		// missing or corrupt database is reported instead of auto-created.
		const nativeDb = NativeDatabaseClass.open(getDatabasePath());
		try {
			const checkReport = JSON.parse(nativeDb.check()) as { ok: boolean };
			// A minimal read proves the catalog and internal tables are reachable.
			nativeDb.table('__kit_schema_migrations').count();
			dbOk = checkReport.ok === true;
			details = { check: checkReport };
		} finally {
			nativeDb.close();
		}
	} catch (e) {
		dbOk = false;
		details = { error: e instanceof Error ? e.message : String(e) };
	}

	const schedulerOk = isSchedulerRunning();
	const healthy = dbOk && schedulerOk;

	return json({ db: dbOk, scheduler: schedulerOk, ...details }, { status: healthy ? 200 : 503 });
};
