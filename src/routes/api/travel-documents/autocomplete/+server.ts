import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/auth';
import { checkRateLimit } from '$lib/server/rateLimit';
import { listTravelDocuments } from '$lib/server/repositories/profileRepo';

const TYPE_LABELS: Record<string, string> = {
	passport: 'Passport',
	drivers_license: "Driver's license",
	global_entry: 'Global Entry',
	visa: 'Visa'
};

export const GET: RequestHandler = async ({ url, locals, getClientAddress }) => {
	const u = requireUser(locals);
	const limit = checkRateLimit(getClientAddress(), 'api:travel-documents:autocomplete');
	if (!limit.allowed) throw error(429, 'Too many requests');

	const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
	const all = listTravelDocuments(u.id);
	const filtered = q
		? all.filter(
				(d) =>
					(TYPE_LABELS[d.type] ?? d.type).toLowerCase().includes(q) ||
					(d.issuingAuthority ?? '').toLowerCase().includes(q) ||
					(d.notes ?? '').toLowerCase().includes(q)
			)
		: all;
	const documents = filtered.slice(0, 20).map((d) => ({
		id: d.id,
		label: TYPE_LABELS[d.type] ?? d.type,
		secondary: [d.issuingAuthority, d.expiresOn ? `expires ${d.expiresOn}` : null]
			.filter(Boolean)
			.join(' · ')
	}));
	return json({ documents });
};
