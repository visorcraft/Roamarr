import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/auth';
import { exportTripsCsv, exportTripsJson } from '$lib/server/export';
import { importTrips, parseCsv, parseJson } from '$lib/server/import';
import { checkRateLimit } from '$lib/server/rateLimit';

export const GET: RequestHandler = ({ url, locals }) => {
	const user = requireUser(locals), format = url.searchParams.get('format') === 'csv' ? 'csv' : 'json';
	return new Response(format === 'csv' ? exportTripsCsv(user.id) : exportTripsJson(user.id), { headers: { 'content-type': format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8' } });
};

export const POST: RequestHandler = async ({ request, locals, getClientAddress }) => {
	const user = requireUser(locals), limit = checkRateLimit(getClientAddress(), 'trips:import', { maxAttempts: 5, windowMs: 60_000 });
	if (!limit.allowed) throw error(429, 'Too many requests');
	const form = await request.formData(), file = form.get('file'), format = String(form.get('format') ?? 'json'), dryRun = form.get('dryRun') === 'true';
	if (!(file instanceof File)) throw error(400, 'File required');
	if (file.size > 5 * 1024 * 1024) throw error(400, 'Import file must be 5 MB or smaller');
	if (format !== 'json' && format !== 'csv') throw error(400, 'Format must be json or csv');
	const parsed = format === 'csv' ? parseCsv(await file.text()) : parseJson(await file.text());
	return json(importTrips(user.id, parsed, dryRun));
};
