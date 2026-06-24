import { redirect, type Actions } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { pauseWatch, resumeWatch, deleteWatch, toggleWatch } from '$lib/server/fareproviders';

export const actions: Actions = {
	enable: async ({ request, locals, params }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		toggleWatch(
			u.id,
			Number(params.id),
			Number(f.get('providerId')),
			f.get('segmentId') ? Number(f.get('segmentId')) : undefined
		);
		throw redirect(303, `/trips/${params.id}`);
	},
	pause: async ({ request, locals, params }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		pauseWatch(u.id, Number(f.get('watchId')));
		throw redirect(303, `/trips/${params.id}`);
	},
	resume: async ({ request, locals, params }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		resumeWatch(u.id, Number(f.get('watchId')));
		throw redirect(303, `/trips/${params.id}`);
	},
	delete: async ({ request, locals, params }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		deleteWatch(u.id, Number(f.get('watchId')));
		throw redirect(303, `/trips/${params.id}`);
	}
};
