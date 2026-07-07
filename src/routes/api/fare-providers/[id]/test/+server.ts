import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/auth';
import { testProvider } from '$lib/server/fareproviders';

export const POST: RequestHandler = async ({ params, locals }) => {
	const u = requireUser(locals);
	const id = Number(params.id);
	if (!Number.isInteger(id) || id < 1) throw error(400, 'Invalid id');
	const { ok, summary } = await testProvider(u.id, id);
	return json({ ok, summary });
};
