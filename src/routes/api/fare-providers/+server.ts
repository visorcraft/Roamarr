import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { parseTableParams } from '$lib/tableParams';
import { requireAdmin } from '$lib/server/auth';
import { checkRateLimit } from '$lib/server/rateLimit';
import {
	listFareProvidersForUserPaginated,
	countFareProvidersForUser
} from '$lib/server/repositories/travelDataRepo';

export const GET: RequestHandler = async ({ url, locals, getClientAddress }) => {
	const admin = requireAdmin(locals);
	const limit = checkRateLimit(getClientAddress(), 'api:fare-providers:list');
	if (!limit.allowed) throw error(429, 'Too many requests');
	const { page, limit: pageSize, search, sort, dir } = parseTableParams(url, [
		'providerKey',
		'label',
		'enabled'
	]);
	const offset = (page - 1) * pageSize;
	const providers = listFareProvidersForUserPaginated(admin.id, {
		search,
		sortBy: sort as 'providerKey' | 'label' | 'enabled' | undefined,
		sortDir: dir,
		limit: pageSize,
		offset
	});
	const rows = providers.map((p) => ({
		id: p.id,
		providerKey: p.providerKey,
		label: p.label,
		enabled: p.enabled,
		hasKey: !!p.apiKey
	}));
	const total = countFareProvidersForUser(admin.id, search);
	return json({ rows, total });
};
