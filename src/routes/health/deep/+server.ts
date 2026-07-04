import { json, type RequestHandler } from '@sveltejs/kit';
import { KitDatabase } from '@visorcraft/mongreldb-kit';
import { schema } from '$lib/server/db/mongrelSchema';
import { getDatabasePath } from '$lib/server/db/paths';
import { isSchedulerRunning } from '$lib/server/scheduler';
import { getExistingDb } from '$lib/server/db/index';
import { runReadOnlyDiagnosticQuery } from '$lib/server/db/sqlDiagnostics';

export const GET: RequestHandler = async () => {
	let dbOk = false;
	let details: Record<string, unknown> | undefined;

	try {
		const secret = process.env.ROAMARR_SECRET;
		if (!secret) {
			throw new Error('ROAMARR_SECRET is not set');
		}
		const kitDb = KitDatabase.openEncryptedSync(getDatabasePath(), schema, secret);
		try {
			const checkReport = kitDb.check() as { ok: boolean };
			dbOk = checkReport.ok === true;
			details = { check: { ok: checkReport.ok } };
		} finally {
			kitDb.close();
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
