import type { RequestEvent } from '@sveltejs/kit';

export function makeLocals(user: { id: number; email: string }) {
	return { user };
}

function paramsToFormData(params: URLSearchParams) {
	const form = new FormData();
	for (const [k, v] of params.entries()) form.append(k, v);
	return form;
}

export function makePostEvent(
	user: { id: number; email: string },
	params: Record<string, string>,
	body: URLSearchParams | FormData,
	url = 'http://localhost/'
): RequestEvent {
	return {
		locals: makeLocals(user),
		params,
		request: {
			formData: async () => (body instanceof URLSearchParams ? paramsToFormData(body) : body),
			method: 'POST'
		},
		url: new URL(url),
		cookies: {}
	} as unknown as RequestEvent;
}

export function makeFormEvent(
	user: { id: number; email: string },
	params: Record<string, string>,
	record: Record<string, string>,
	url = 'http://localhost/'
): RequestEvent {
	const form = new FormData();
	for (const [k, v] of Object.entries(record)) form.append(k, v);
	return makePostEvent(user, params, form, url);
}
