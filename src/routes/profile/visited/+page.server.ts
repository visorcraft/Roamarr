import { redirect, type Actions } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { setFlash } from '$lib/server/flash';
import { logAudit } from '$lib/server/audit';
import {
	listVisited,
	markVisited,
	unmarkVisited,
	clearVisited,
	autoMarkFromAllTrips,
	countryVisitSummaries
} from '$lib/server/visitedPlaces';
import type { PlaceKind } from '$lib/server/visitedPlaces';
import * as usersRepo from '$lib/server/repositories/usersRepo';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	const u = requireUser(locals);
	return {
		...listVisited(u.id),
		summaries: countryVisitSummaries(u.id),
		autoMarkVisited: u.autoMarkVisited
	};
};

function parseKind(value: string | null): PlaceKind {
	return value === 'state' ? 'state' : 'country';
}

function todayIso(): string {
	return new Date().toISOString().slice(0, 10);
}

export const actions: Actions = {
	mark: async ({ request, locals, cookies }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const kind = parseKind(String(f.get('kind') ?? 'country'));
		const code = String(f.get('code') ?? '');
		const visitedOnInput = String(f.get('visited_on') ?? '').trim();
		const { created } = markVisited(u.id, kind, code, {
			visitedOn: visitedOnInput || todayIso()
		});
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
		const added = autoMarkFromAllTrips(u.id);
		const parts: string[] = [];
		if (added.countries.length > 0) {
			parts.push(
				`${added.countries.length} countr${added.countries.length === 1 ? 'y' : 'ies'}`
			);
		}
		if (added.states.length > 0) {
			parts.push(`${added.states.length} U.S. state${added.states.length === 1 ? '' : 's'}`);
		}
		setFlash(
			cookies,
			parts.length > 0 ? `Marked ${parts.join(' and ')} from past trips.` : 'No new places found from past trips.'
		);
		throw redirect(303, '/profile/visited');
	},
	clear: async ({ request, locals, cookies }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const kind = parseKind(String(f.get('kind') ?? 'country'));
		const n = clearVisited(u.id, kind);
		const label = kind === 'state' ? (n === 1 ? 'state' : 'states') : n === 1 ? 'country' : 'countries';
		setFlash(cookies, `Cleared ${n} ${label}.`);
		throw redirect(303, '/profile/visited');
	},
	toggleAutoMark: async ({ locals, cookies }) => {
		const u = requireUser(locals);
		const newValue = !u.autoMarkVisited;
		usersRepo.updateUser(u.id, { auto_mark_visited: newValue });
		logAudit(u.id, 'places_auto_mark_toggle', 'user', u.id, { enabled: newValue });
		setFlash(cookies, newValue ? 'Auto-mark enabled.' : 'Auto-mark disabled.');
		throw redirect(303, '/profile/visited');
	}
};
