import { redirect, type Actions } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { requireUser } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { fareProviders } from '$lib/server/db/schema';
import { registry, saveProvider } from '$lib/server/fareproviders';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	const u = requireUser(locals);
	const saved = db
		.select({ id: fareProviders.id, providerKey: fareProviders.providerKey, enabled: fareProviders.enabled })
		.from(fareProviders)
		.where(eq(fareProviders.userId, u.id))
		.all();
	return {
		providers: Object.values(registry).map((p) => ({ key: p.key, label: p.label })),
		saved
	};
};

export const actions: Actions = {
	save: async ({ request, locals }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		saveProvider(
			u.id,
			String(f.get('providerKey')),
			String(f.get('apiKey') || ''),
			f.get('enabled') === 'on'
		);
		throw redirect(303, '/settings/fare-providers');
	}
};
