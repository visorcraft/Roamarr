import { fail, redirect, type Actions } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import {
	listFareProvidersForUser,
	createFareProvider,
	updateFareProvider,
	deleteFareProvider
} from '$lib/server/repositories/travelDataRepo';
import { testProvider, registry } from '$lib/server/fareproviders';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	const u = requireUser(locals);
	const saved = listFareProvidersForUser(u.id).map((p) => ({
		id: p.id,
		providerKey: p.providerKey,
		label: p.label,
		enabled: p.enabled,
		// Expose only whether a key is set — never ship the ciphertext to the client.
		hasKey: !!p.apiKey
	}));
	return {
		providers: Object.values(registry).map((p) => ({ key: p.key, label: p.label })),
		saved
	};
};

export const actions: Actions = {
	add: async ({ request, locals }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		createFareProvider({
			userId: u.id,
			providerKey: String(f.get('providerKey')),
			label: String(f.get('label') || ''),
			apiKey: String(f.get('apiKey') || ''),
			enabled: f.get('enabled') === 'on'
		});
		throw redirect(303, '/settings/fare-providers');
	},
	update: async ({ request, locals }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		updateFareProvider(Number(f.get('id')), {
			label: String(f.get('label') || ''),
			apiKey: String(f.get('apiKey') || ''),
			enabled: f.get('enabled') === 'on'
		});
		throw redirect(303, '/settings/fare-providers');
	},
	delete: async ({ request, locals }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		deleteFareProvider(Number(f.get('id')));
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
