import { fail, redirect, type Actions } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { Validator } from '$lib/server/validation';
import { deleteSegment, updateSegment } from '$lib/server/segments';

export const actions: Actions = {
	delete: async ({ request, locals, params }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const v = new Validator();
		const segmentId = v.positiveId(f.get('segmentId'), 'segmentId');
		if (!v.ok()) return fail(400, { error: v.failMessage(), errors: v.errors });
		deleteSegment(u.id, Number(params.id), segmentId!);
		throw redirect(303, `/trips/${params.id}`);
	},
	update: async ({ request, locals, params }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		let details: object | undefined;
		const detailsRaw = String(f.get('detailsJson') || '');
		const v = new Validator();
		if (detailsRaw) {
			try {
				details = JSON.parse(detailsRaw);
			} catch {
				v.addError('detailsJson', 'Invalid details JSON');
			}
		}
		const segmentId = v.positiveId(f.get('segmentId'), 'segmentId');
		const title = v.requiredString(f.get('title'), 'title', { max: 200 });
		const localStart = v.requiredDateTime(f.get('localStart'), 'localStart');
		const startTz = v.timezone(f.get('startTz') || u.timezone, 'startTz');
		const endAt = v.dateTime(f.get('endAt'), 'endAt');
		const endTz = v.timezone(f.get('endTz') || startTz, 'endTz');
		const location = v.optionalString(f.get('location'), 'location', { max: 200 });
		const confirmationNumber = v.optionalString(
			f.get('confirmationNumber'),
			'confirmationNumber',
			{ max: 100 }
		);
		const cardId = f.get('cardId') ? v.positiveId(f.get('cardId'), 'cardId') : undefined;

		if (!v.ok()) return fail(400, { error: v.failMessage(), errors: v.errors });

		updateSegment(u.id, Number(params.id), segmentId!, {
			title: title!,
			localStart: localStart!,
			startTz: startTz!,
			endAt: endAt ?? undefined,
			endTz: endTz ?? undefined,
			location,
			confirmationNumber,
			cardId,
			details
		});
		throw redirect(303, `/trips/${params.id}`);
	}
};
