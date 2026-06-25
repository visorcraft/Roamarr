import type { RequestEvent } from '@sveltejs/kit';

export function makeLocals(user: { id: number; email: string }) {
	return { user } as App.Locals;
}

function paramsToFormData(params: URLSearchParams) {
	const form = new FormData();
	for (const [k, v] of params.entries()) form.append(k, v);
	return form;
}

function baseEvent(
	user: { id: number; email: string },
	params: Record<string, string>,
	url = 'http://localhost/'
): Partial<RequestEvent> {
	return {
		locals: makeLocals(user),
		params,
		url: new URL(url),
		cookies: {
			get: () => undefined,
			getAll: () => [],
			set: () => {},
			delete: () => {},
			serialize: () => ''
		}
	};
}

export function makeGetEvent(
	user: { id: number; email: string },
	params: Record<string, string> = {},
	search: Record<string, string> = {},
	url = 'http://localhost/'
): RequestEvent {
	const u = new URL(url);
	for (const [k, v] of Object.entries(search)) u.searchParams.set(k, v);
	return {
		...baseEvent(user, params, u.toString()),
		request: { method: 'GET', formData: async () => new FormData() }
	} as unknown as RequestEvent;
}

export function makePostEvent(
	user: { id: number; email: string },
	params: Record<string, string>,
	body: URLSearchParams | FormData,
	url = 'http://localhost/'
): RequestEvent {
	return {
		...baseEvent(user, params, url),
		request: {
			formData: async () => (body instanceof URLSearchParams ? paramsToFormData(body) : body),
			method: 'POST'
		}
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

export function makeActionEvent(
	user: { id: number; email: string },
	params: Record<string, string>,
	formData: FormData,
	url = 'http://localhost/'
): RequestEvent {
	return {
		...baseEvent(user, params, url),
		request: {
			formData: async () => formData,
			method: 'POST'
		}
	} as unknown as RequestEvent;
}
