import { fail, type Actions } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { importTrips, parseCsv, parseJson } from '$lib/server/import';

export const actions: Actions = {
	default: async ({ request, locals }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const file = f.get('file');
		const format = String(f.get('format') || 'json');

		if (!file || !(file instanceof File)) {
			return fail(400, { error: 'Please select a file.' });
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

		const result = importTrips(u.id, parsed);
		if (result.imported === 0 && result.errors.length > 0) {
			return fail(400, { error: 'Import completed with errors.', result });
		}

		return { success: true, result };
	}
};
