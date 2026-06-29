import { redirect, type Actions } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { setFlash } from '$lib/server/flash';
import {
	listVisited,
	markVisited,
	unmarkVisited,
	clearVisited,
	autoMarkCountriesFromAllTrips
} from '$lib/server/visitedPlaces';
import type { PlaceKind } from '$lib/server/visitedPlaces';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	const u = requireUser(locals);
	return listVisited(u.id);
};

function parseKind(value: string | null): PlaceKind {
	return value === 'state' ? 'state' : 'country';
}

export const actions: Actions = {
	mark: async ({ request, locals, cookies }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const kind = parseKind(String(f.get('kind') ?? 'country'));
		const code = String(f.get('code') ?? '');
		const { created } = markVisited(u.id, kind, code);
		setFlash(
			cookies,
			created
				? `Marked ${code.toUpperCase()} as visited.`
				: `${code.toUpperCase()} was already marked.`
		);
		throw redirect(303, '/profile/visited');
	},
	unmark: async ({ request, locals, cookies }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const kind = parseKind(String(f.get('kind') ?? 'country'));
		const code = String(f.get('code') ?? '');
		unmarkVisited(u.id, kind, code);
		setFlash(cookies, `Removed ${code.toUpperCase()}.`);
		throw redirect(303, '/profile/visited');
	},
	autoMark: async ({ locals, cookies }) => {
		const u = requireUser(locals);
		const added = autoMarkCountriesFromAllTrips(u.id);
		setFlash(
			cookies,
			added.length > 0
				? `Marked ${added.length} countr${added.length === 1 ? 'y' : 'ies'} from past trips.`
				: 'No new countries found from past trips.'
		);
		throw redirect(303, '/profile/visited');
	},
	clear: async ({ request, locals, cookies }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const kind = parseKind(String(f.get('kind') ?? 'country'));
		const n = clearVisited(u.id, kind);
		setFlash(
			cookies,
			`Cleared ${n} ${kind === 'state' ? 'state' : 'countr'}${n === 1 ? 'y' : 'ies'}.`
		);
		throw redirect(303, '/profile/visited');
	}
};
