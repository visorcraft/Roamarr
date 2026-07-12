import { error, isRedirect, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAdmin } from '$lib/server/auth';
import { getMapSettings } from '$lib/server/settings';
import { hasMapTexture } from '$lib/server/mapsAssets';
import { actions } from '../../../general/+page.server';

export const GET: RequestHandler = ({ locals }) => { requireAdmin(locals); return json({ ...getMapSettings(), textureReady: hasMapTexture() }); };

export const POST: RequestHandler = async (event) => {
	const action = event.url.searchParams.get('action') ?? '';
	if (!['enableMaps', 'disableMaps', 'reimportCities', 'reimportTexture', 'importGeonames'].includes(action)) throw error(400, 'Unknown map action');
	try {
		const result = await actions[action]!(event as never);
		if (result && 'status' in result) return json(result.data, { status: result.status });
		return json({ ok: true });
	} catch (cause) {
		if (isRedirect(cause)) return json({ ok: true });
		throw cause;
	}
};
