import { isRedirect, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { GET as download } from '../../../backup/+server';
import { actions } from '../../../backup/+page.server';

export const GET: RequestHandler = (event) => download(event as never);

export const POST: RequestHandler = async (event) => {
	try {
		const result = await actions.restore!(event as never);
		if (result && 'status' in result) return json(result.data, { status: result.status });
		return json({ ok: true, restartRequired: true });
	} catch (cause) {
		if (isRedirect(cause)) return json({ ok: true, restartRequired: true });
		throw cause;
	}
};
