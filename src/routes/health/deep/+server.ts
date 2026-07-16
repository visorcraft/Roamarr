import { json, type RequestHandler } from '@sveltejs/kit';
import { KitDatabase } from '@visorcraft/mongreldb-kit';
import { schema } from '$lib/server/db/mongrelSchema';
import { getDatabasePath } from '$lib/server/db/paths';
import { isSchedulerRunning } from '$lib/server/scheduler';
import { getExistingDb } from '$lib/server/db/index';
import { runReadOnlyDiagnosticQuery } from '$lib/server/db/sqlDiagnostics';
import { checkRateLimit } from '$lib/server/rateLimit';

const DEEP_HEALTH_RATE_LIMIT = { maxAttempts: 30, windowMs: 60_000 };

export const GET: RequestHandler = async ({ getClientAddress }) => {
	const limit = checkRateLimit(getClientAddress(), 'health:deep', DEEP_HEALTH_RATE_LIMIT);
	if (!limit.allowed) {
		return json(
			{ error: 'Too many requests' },
			{ status: 429, headers: { 'Retry-After': String(limit.retryAfter ?? 60) } }
		);
	}

	let dbOk = false;
	let details: Record<string, unknown> | undefined;

	try {
		// MongrelDB allows a single handle per database per process
		// ("reuse the existing Arc<Database>"), so when the app singleton is
		// open the integrity check must run through it. A fresh independent
		// handle is only possible before the singleton exists (early boot).
		const existing = getExistingDb();
		if (existing) {
			const checkReport = existing.check() as { ok: boolean };
			dbOk = checkReport.ok === true;
			details = { check: { ok: checkReport.ok } };
		} else {
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
