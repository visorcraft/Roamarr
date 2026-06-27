import { fail, redirect, type Actions } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { requireUser } from '$lib/server/auth';
import { parseTripId } from '$lib/server/params';
import { pauseWatch, resumeWatch, deleteWatch, toggleWatch, checkWatch } from '$lib/server/fareproviders';
import { positiveIdFromForm } from '$lib/server/validation';

export const load: PageServerLoad = ({ params }) => {
	throw redirect(308, `/trips/${params.id}`);
};

export const actions: Actions = {
	enable: async ({ request, locals, params }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const providerResult = positiveIdFromForm(f.get('providerId'), 'providerId');
		if (!providerResult.ok) return fail(400, { error: providerResult.error });
		let segmentId: number | undefined;
		const segmentIdRaw = f.get('segmentId');
		if (segmentIdRaw) {
			const segmentResult = positiveIdFromForm(segmentIdRaw, 'segmentId');
			if (!segmentResult.ok) return fail(400, { error: segmentResult.error });
			segmentId = segmentResult.value;
		}
		toggleWatch(u.id, parseTripId(params), providerResult.value, segmentId);
		throw redirect(303, `/trips/${params.id}`);
	},
	pause: async ({ request, locals, params }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const watchResult = positiveIdFromForm(f.get('watchId'), 'watchId');
		if (!watchResult.ok) return fail(400, { error: watchResult.error });
		pauseWatch(u.id, watchResult.value);
		throw redirect(303, `/trips/${params.id}`);
	},
	resume: async ({ request, locals, params }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const watchResult = positiveIdFromForm(f.get('watchId'), 'watchId');
		if (!watchResult.ok) return fail(400, { error: watchResult.error });
		resumeWatch(u.id, watchResult.value);
		throw redirect(303, `/trips/${params.id}`);
	},
	delete: async ({ request, locals, params }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const watchResult = positiveIdFromForm(f.get('watchId'), 'watchId');
		if (!watchResult.ok) return fail(400, { error: watchResult.error });
		deleteWatch(u.id, watchResult.value);
		throw redirect(303, `/trips/${params.id}`);
	},
	check: async ({ request, locals, params }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const watchResult = positiveIdFromForm(f.get('watchId'), 'watchId');
		if (!watchResult.ok) return fail(400, { error: watchResult.error });
		try {
			await checkWatch(u.id, watchResult.value);
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Check failed' });
		}
		throw redirect(303, `/trips/${params.id}`);
	}
};
