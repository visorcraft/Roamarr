import type { RequestEvent } from '@sveltejs/kit';
import type { KitDatabase } from '@mongreldb/kit';
import { makeUser, makeAdmin } from './helpers';

// Email is optional because many tests only need a user id for authorization checks.
export function makeLocals(user: { id: number; email?: string }) {
	return { user } as App.Locals;
}

export function makeFormData(record: Record<string, string>): FormData {
	const form = new FormData();
	for (const [k, v] of Object.entries(record)) form.set(k, v);
	return form;
}

export function makeActionEvent(
	user: { id: number },
	tripId: number,
	body: Record<string, string | string[]>
): RequestEvent {
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(body)) {
		if (Array.isArray(value)) {
			for (const v of value) params.append(key, v);
		} else {
			params.append(key, value);
		}
	}
	return {
		locals: makeLocals(user),
		params: { id: String(tripId) },
		request: new Request('http://localhost/trips/' + tripId, { method: 'POST', body: params })
	} as unknown as RequestEvent;
}

export function makeAdminLocals(kit: KitDatabase) {
	return { user: makeAdmin(kit, { email: 'admin@x.c', displayName: 'Admin' }) };
}

export function makeUserLocals(kit: KitDatabase) {
	return { user: makeUser(kit, { email: 'user@x.c', displayName: 'User' }) };
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

export function makeFormEvent(
	user: { id: number; email: string },
	params: Record<string, string>,
	record: Record<string, string>,
	url = 'http://localhost/'
): RequestEvent {
	const form = makeFormData(record);
	return {
		...baseEvent(user, params, url),
		request: {
			formData: async () => form,
			method: 'POST'
		}
	} as unknown as RequestEvent;
}
