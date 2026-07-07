import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { parseTableParams } from '$lib/tableParams';
import { requireUser } from '$lib/server/auth';
import {
	listFareProvidersForUserPaginated,
	countFareProvidersForUser
} from '$lib/server/repositories/travelDataRepo';

export const GET: RequestHandler = async ({ url, locals }) => {
	const u = requireUser(locals);
	const { page, limit, search, sort, dir } = parseTableParams(url, [
		'providerKey',
		'label',
		'enabled'
	]);
	const offset = (page - 1) * limit;
	const providers = listFareProvidersForUserPaginated(u.id, {
		search,
		sortBy: sort as 'providerKey' | 'label' | 'enabled' | undefined,
		sortDir: dir,
		limit,
		offset
	});
	const rows = providers.map((p) => ({
		id: p.id,
		providerKey: p.providerKey,
		label: p.label,
		enabled: p.enabled,
		hasKey: !!p.apiKey
	}));
	const total = countFareProvidersForUser(u.id, search);
	return json({ rows, total });
};
