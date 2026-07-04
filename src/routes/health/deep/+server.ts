import { json, type RequestHandler } from '@sveltejs/kit';
import mongreldb from '@visorcraft/mongreldb';
import type { Database as NativeDatabase } from '@visorcraft/mongreldb/native.js';
import { getDatabasePath } from '$lib/server/db/paths';
import { isSchedulerRunning } from '$lib/server/scheduler';
import { getExistingDb } from '$lib/server/db/index';
import { runReadOnlyDiagnosticQuery } from '$lib/server/db/sqlDiagnostics';

const NativeDatabaseClass = (mongreldb as unknown as { Database: typeof NativeDatabase }).Database;

export const GET: RequestHandler = async () => {
	let dbOk = false;
	let details: Record<string, unknown> | undefined;

	try {
		const secret = process.env.ROAMARR_SECRET;
		if (!secret) {
			throw new Error('ROAMARR_SECRET is not set');
		}
		const nativeDb = NativeDatabaseClass.openEncrypted(getDatabasePath(), secret);
		try {
			const checkReport = JSON.parse(nativeDb.check()) as { ok: boolean };
			nativeDb.table('__kit_schema_migrations').count();
			dbOk = checkReport.ok === true;
			details = { check: { ok: checkReport.ok } };
		} finally {
			nativeDb.close();
		}
	} catch (e) {
		dbOk = false;
		if (e instanceof Error) console.error('deep health check failed:', e.message);
		details = { error: 'deep-health-check-failed' };
	}

	let sqlDiagnostic: Record<string, unknown> = { ok: false };
	if (dbOk) {
		const kitDb = getExistingDb();
		if (kitDb) {
			try {
				const { rowCount } = await runReadOnlyDiagnosticQuery(kitDb);
				sqlDiagnostic = { ok: true, rowCount };
			} catch (e) {
				if (e instanceof Error) console.error('sql diagnostic failed:', e.message);
				sqlDiagnostic = { ok: false };
			}
		}
	}

	const schedulerOk = isSchedulerRunning();
	const healthy = dbOk && schedulerOk;

	return json(
		{ db: dbOk, scheduler: schedulerOk, sqlDiagnostic, ...details },
		{ status: healthy ? 200 : 503 }
	);
};
