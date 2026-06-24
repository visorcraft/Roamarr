import { requireUser } from '$lib/server/auth';
import { exportTripsJson, exportTripsCsv } from '$lib/server/export';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ url, locals }) => {
	const u = requireUser(locals);
	const format = url.searchParams.get('format') ?? 'json';
	if (format === 'csv') {
		const csv = exportTripsCsv(u.id);
		return new Response(csv, {
			headers: {
				'Content-Type': 'text/csv; charset=utf-8',
				'Content-Disposition': 'attachment; filename="roamarr-trips.csv"'
			}
		});
	}
	const json = exportTripsJson(u.id);
	return new Response(json, {
		headers: {
			'Content-Type': 'application/json; charset=utf-8',
			'Content-Disposition': 'attachment; filename="roamarr-trips.json"'
		}
	});
};
