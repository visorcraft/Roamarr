import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/auth';
import { deleteProvider } from '$lib/server/fareproviders';

export const DELETE: RequestHandler = async ({ params, locals }) => {
	const u = requireUser(locals);
	const id = Number(params.id);
	if (!Number.isInteger(id) || id < 1) throw error(400, 'Invalid id');
	deleteProvider(u.id, id);
	return new Response(null, { status: 204 });
};
