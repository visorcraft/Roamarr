import { fail, type Actions } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { importTrips, parseCsv, parseJson } from '$lib/server/import';
import { checkRateLimit } from '$lib/server/rateLimit';

const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
const IMPORT_RATE_LIMIT = { maxAttempts: 5, windowMs: 60_000 };

export const actions: Actions = {
	default: async ({ request, locals, getClientAddress }) => {
		const u = requireUser(locals);
		const limit = checkRateLimit(getClientAddress(), 'trips:import', IMPORT_RATE_LIMIT);
		if (!limit.allowed) {
			return fail(429, { error: 'Too many attempts. Try again later.', retryAfter: limit.retryAfter });
		}
		const f = await request.formData();
		const file = f.get('file');
		const format = String(f.get('format') || 'json');
		const dryRun = f.get('dryRun') === 'true';

		if (!file || !(file instanceof File)) {
			return fail(400, { error: 'Please select a file.' });
		}
		if (file.size > MAX_IMPORT_BYTES) {
			return fail(400, { error: 'Import file must be 5 MB or smaller.' });
		}
		if (format !== 'json' && format !== 'csv') {
			return fail(400, { error: 'Format must be json or csv.' });
		}

		let parsed;
		try {
			const text = await file.text();
			parsed = format === 'csv' ? parseCsv(text) : parseJson(text);
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Invalid file.' });
		}

		const result = importTrips(u.id, parsed, dryRun);
		if (result.imported === 0 && result.errors.length > 0) {
			return fail(400, { error: 'Import completed with errors.', result });
		}

		return { success: true, result, dryRun };
	}
};
