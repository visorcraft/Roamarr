import { json } from '@sveltejs/kit';
import { revokeToken } from '$lib/server/oauth';
import type { RequestHandler } from '@sveltejs/kit';

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.formData();
	const token = String(body.get('token') ?? '');
	if (token) revokeToken(token);
	return json({});
};
