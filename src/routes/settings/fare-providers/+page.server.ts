import { fail, redirect, type Actions } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { requireUser } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { fareProviders } from '$lib/server/db/schema';
import {
	createProvider,
	updateProvider,
	deleteProvider,
	testProvider,
	registry
} from '$lib/server/fareproviders';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	const u = requireUser(locals);
	const saved = db
		.select({
			id: fareProviders.id,
			providerKey: fareProviders.providerKey,
			label: fareProviders.label,
			enabled: fareProviders.enabled,
			apiKey: fareProviders.apiKey
		})
		.from(fareProviders)
		.where(eq(fareProviders.userId, u.id))
		.all();
	return {
		providers: Object.values(registry).map((p) => ({ key: p.key, label: p.label })),
		// Expose only whether a key is set — never ship the ciphertext to the client.
		saved: saved.map((s) => ({
			id: s.id,
			providerKey: s.providerKey,
			label: s.label,
			enabled: s.enabled,
			hasKey: !!s.apiKey
		}))
	};
};

export const actions: Actions = {
	add: async ({ request, locals }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		createProvider(
			u.id,
			String(f.get('providerKey')),
			String(f.get('label') || ''),
			String(f.get('apiKey') || ''),
			f.get('enabled') === 'on'
		);
		throw redirect(303, '/settings/fare-providers');
	},
	update: async ({ request, locals }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		updateProvider(
			u.id,
			Number(f.get('id')),
			String(f.get('label') || ''),
			String(f.get('apiKey') || ''),
			f.get('enabled') === 'on'
		);
		throw redirect(303, '/settings/fare-providers');
	},
	delete: async ({ request, locals }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		deleteProvider(u.id, Number(f.get('id')));
		throw redirect(303, '/settings/fare-providers');
	},
	test: async ({ request, locals }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		try {
			const result = await testProvider(u.id, Number(f.get('id')));
			return { testResult: result.ok ? `OK: ${result.summary}` : `Failed: ${result.summary}` };
		} catch (e) {
			return fail(400, {
				testResult: e instanceof Error ? e.message : 'Test failed'
			});
		}
	}
};
