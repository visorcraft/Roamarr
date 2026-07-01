import { json, type RequestHandler } from '@sveltejs/kit';
import mongreldb from '@visorcraft/mongreldb';
import type { Database as NativeDatabase } from '@visorcraft/mongreldb/native.js';
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
		// Native addon / filesystem exceptions can include absolute paths or
		// engine internals; /health/deep is unauthenticated, so do not surface
		// raw error text. Return a stable opaque marker instead.
		if (e instanceof Error) console.error('deep health check failed:', e.message);
		details = { error: 'deep-health-check-failed' };
	}

	const schedulerOk = isSchedulerRunning();
	const healthy = dbOk && schedulerOk;

	return json({ db: dbOk, scheduler: schedulerOk, ...details }, { status: healthy ? 200 : 503 });
};
