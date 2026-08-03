import { fail, type Actions } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { checkRateLimit } from '$lib/server/rateLimit';
import { Validator } from '$lib/server/validation';
import { listPlaceCategories } from '$lib/server/places';
import {
	parseGeoImport,
	parseMapsUrlList,
	previewGeoImport,
	executeGeoImport,
	GEO_IMPORT_MAX_BYTES,
	GEO_IMPORT_MAX_ROWS,
	type GeoImportCandidate
} from '$lib/server/geoImport';
import type { PageServerLoad } from './$types';

const IMPORT_RATE_LIMIT = { maxAttempts: 10, windowMs: 60_000 };

export const load: PageServerLoad = ({ locals }) => {
	const u = requireUser(locals);
	return { categories: listPlaceCategories(u.id) };
};

function parseRowsJson(v: Validator, raw: FormDataEntryValue | null): GeoImportCandidate[] | null {
	if (typeof raw !== 'string' || !raw.trim()) {
		v.addError('rows', 'No import rows were submitted');
		return null;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		v.addError('rows', 'Import rows were not valid JSON');
		return null;
	}
	if (!Array.isArray(parsed)) {
		v.addError('rows', 'Import rows must be an array');
		return null;
	}
	if (parsed.length > GEO_IMPORT_MAX_ROWS) {
		v.addError('rows', `Imports are limited to ${GEO_IMPORT_MAX_ROWS.toLocaleString()} rows`);
		return null;
	}
	const rows: GeoImportCandidate[] = [];
	for (const item of parsed) {
		const r = item as Record<string, unknown>;
		if (!r || typeof r.name !== 'string' || !r.name.trim()) {
			v.addError('rows', 'Every import row needs a name');
			return null;
		}
		const lat = r.lat == null ? null : Number(r.lat);
		const lng = r.lng == null ? null : Number(r.lng);
		rows.push({
			name: r.name,
			lat: lat != null && Number.isFinite(lat) ? lat : null,
			lng: lng != null && Number.isFinite(lng) ? lng : null,
			address: typeof r.address === 'string' ? r.address : null,
			description: typeof r.description === 'string' ? r.description : null,
			sourceUrl: typeof r.sourceUrl === 'string' ? r.sourceUrl : null,
			categoryGuess: typeof r.categoryGuess === 'string' ? r.categoryGuess : null
		});
	}
	return rows;
}

export const actions: Actions = {
	preview: async ({ request, locals, getClientAddress }) => {
		const u = requireUser(locals);
		const limit = checkRateLimit(getClientAddress(), 'places:import', IMPORT_RATE_LIMIT);
		if (!limit.allowed) {
			return fail(429, { error: 'Too many attempts. Try again later.', retryAfter: limit.retryAfter });
		}
		const f = await request.formData();
		const file = f.get('file');
		const urlList = typeof f.get('urlList') === 'string' ? String(f.get('urlList')).trim() : '';

		try {
			if (file instanceof File && file.size > 0) {
				if (file.size > GEO_IMPORT_MAX_BYTES) {
					return fail(400, { error: 'Import file must be 20 MB or smaller.' });
				}
				const buffer = Buffer.from(await file.arrayBuffer());
				const parsed = await parseGeoImport(file.name, buffer);
				return {
					preview: previewGeoImport(u.id, parsed.candidates),
					format: parsed.format,
					parseWarnings: parsed.warnings,
					sourceName: file.name
				};
			}
			if (urlList) {
				const parsed = parseMapsUrlList(urlList);
				return {
					preview: previewGeoImport(u.id, parsed.candidates),
					format: parsed.format,
					parseWarnings: parsed.warnings,
					sourceName: 'Pasted links'
				};
			}
			return fail(400, { error: 'Choose a file or paste Google Maps links.' });
		} catch (e) {
			const message =
				(e as { body?: { message?: string } })?.body?.message ??
				(e as Error)?.message ??
				'Could not parse the import.';
			return fail(400, { error: message });
		}
	},

	confirm: async ({ request, locals }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const v = new Validator();
		const rows = parseRowsJson(v, f.get('rows'));
		const categoryId = f.get('categoryId') ? v.positiveId(f.get('categoryId'), 'categoryId') : null;
		const skipDuplicates = f.get('skipDuplicates') !== 'false';
		if (!v.ok() || !rows) {
			return fail(400, { error: v.failMessage(), errors: v.errors });
		}
		const result = executeGeoImport(u.id, rows, {
			categoryId: categoryId ?? null,
			skipDuplicates
		});
		return { imported: result };
	}
};
