import { fail, redirect, type Actions } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { setFlash } from '$lib/server/flash';
import { logAudit } from '$lib/server/audit';
import {
	autoMarkFromAllTrips,
	clearVisited,
	listVisited,
	listVisitedCountries,
	listVisitedUsStates,
	markVisited,
	unmarkVisited,
	updateVisitedDates,
	type PlaceKind,
} from '$lib/server/visitedPlaces';
import * as usersRepo from '$lib/server/repositories/usersRepo';
import { COUNTRIES } from '$lib/countries';
import { US_STATES, usStateDisplayCode } from '$lib/usStates';

const PAGE_SIZE = 20;

type PlaceOption = { code: string; name: string; displayCode: string };

const countryOptions = COUNTRIES.map((c) => ({ code: c.code, name: c.name, displayCode: c.code }));
const stateOptions = US_STATES.map((s) => ({ code: s.code, name: s.name, displayCode: usStateDisplayCode(s.code) }));

function optionsFor(kind: PlaceKind): PlaceOption[] {
	return kind === 'country' ? countryOptions : stateOptions;
}

function optionMap(kind: PlaceKind): Map<string, PlaceOption> {
	return new Map(optionsFor(kind).map((option) => [option.code, option]));
}

function todayIso(): string {
	return new Date().toISOString().slice(0, 10);
}

function isIsoDate(value: string) {
	return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function parseDate(value: FormDataEntryValue | null, label: string): string | null {
	const date = String(value ?? '').trim();
	if (!date) return null;
	if (!isIsoDate(date)) throw new Error(`${label} must be a valid date.`);
	return date;
}

function parseDateRange(f: FormData) {
	const firstVisitedOn = parseDate(f.get('firstVisitedOn'), 'First visited');
	const lastVisitedOn = parseDate(f.get('lastVisitedOn'), 'Last visited');
	if (firstVisitedOn && lastVisitedOn && lastVisitedOn < firstVisitedOn) {
		throw new Error('Last visited must be on or after first visited.');
	}
	return { firstVisitedOn, lastVisitedOn };
}

function returnTo(f: FormData, fallback: string) {
	const value = String(f.get('returnTo') ?? '').trim();
	return value.startsWith('/profile/visited/') ? value : fallback;
}

export function loadVisitedPage(kind: PlaceKind, url: URL, locals: App.Locals) {
	const u = requireUser(locals);
	const places = kind === 'country' ? listVisitedCountries(u.id) : listVisitedUsStates(u.id);
	const byCode = optionMap(kind);
	const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
	const page = Math.max(1, Number(url.searchParams.get('page') ?? '1') || 1);
	const rows = places
		.map((place) => {
			const option = byCode.get(place.code);
			return {
				...place,
				name: option?.name ?? place.code,
				displayCode: option?.displayCode ?? place.code
			};
		})
		.filter((place) => {
			if (!q) return true;
			return (
				place.name.toLowerCase().includes(q) ||
				place.code.toLowerCase().includes(q) ||
				place.displayCode.toLowerCase().includes(q)
			);
		});
	const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
	const safePage = Math.min(page, totalPages);
	const start = (safePage - 1) * PAGE_SIZE;
	const visited = listVisited(u.id);
	return {
		kind,
		rows: rows.slice(start, start + PAGE_SIZE),
		tableRows: rows,
		page: safePage,
		totalPages,
		totalRows: rows.length,
		q: url.searchParams.get('q') ?? '',
		tab: url.searchParams.get('tab') === 'list' ? 'list' : 'visits',
		options: optionsFor(kind),
		visitedCodes: places.map((place) => place.code),
		today: todayIso(),
		currentPath: `${url.pathname}${url.search}`,
		autoMarkVisited: u.autoMarkVisited,
		countryCount: visited.countries.length,
		stateCount: visited.usStates.length
	};
}

export function makeVisitedActions(kind: PlaceKind, fallback: string): Actions {
	return {
		mark: async ({ request, locals, cookies }) => {
			const u = requireUser(locals);
			const f = await request.formData();
			const code = String(f.get('code') ?? '');
			let dates: { firstVisitedOn: string | null; lastVisitedOn: string | null };
			try {
				dates = parseDateRange(f);
			} catch (e) {
				return fail(400, { error: e instanceof Error ? e.message : 'Invalid visit dates.' });
			}
			const visitedOn = dates.firstVisitedOn ?? dates.lastVisitedOn ?? todayIso();
			const { created } = markVisited(u.id, kind, code, { visitedOn });
			if (created) updateVisitedDates(u.id, kind, code, dates.firstVisitedOn || dates.lastVisitedOn ? dates : { firstVisitedOn: visitedOn, lastVisitedOn: visitedOn });
			setFlash(cookies, created ? `Marked ${code.toUpperCase()} as visited.` : `${code.toUpperCase()} was already marked.`);
			throw redirect(303, returnTo(f, fallback));
		},
		update: async ({ request, locals, cookies }) => {
			const u = requireUser(locals);
			const f = await request.formData();
			const code = String(f.get('code') ?? '');
			try {
				updateVisitedDates(u.id, kind, code, parseDateRange(f));
			} catch (e) {
				return fail(400, { error: e instanceof Error ? e.message : 'Update failed.' });
			}
			setFlash(cookies, 'Visit dates updated.');
			throw redirect(303, returnTo(f, fallback));
		},
		unmark: async ({ request, locals, cookies }) => {
			const u = requireUser(locals);
			const f = await request.formData();
			const code = String(f.get('code') ?? '');
			unmarkVisited(u.id, kind, code);
			setFlash(cookies, `Removed ${code.toUpperCase()}.`);
			throw redirect(303, returnTo(f, fallback));
		},
		clear: async ({ request, locals, cookies }) => {
			const u = requireUser(locals);
			const f = await request.formData();
			const n = clearVisited(u.id, kind);
			const label =
				kind === 'state' ? (n === 1 ? 'state' : 'states') : n === 1 ? 'country' : 'countries';
			setFlash(cookies, `Cleared ${n} ${label}.`);
			throw redirect(303, returnTo(f, fallback));
		},
		autoMark: async ({ request, locals, cookies }) => {
			const u = requireUser(locals);
			const f = await request.formData();
			const added = autoMarkFromAllTrips(u.id);
			const parts: string[] = [];
			if (added.countries.length > 0) {
				parts.push(`${added.countries.length} countr${added.countries.length === 1 ? 'y' : 'ies'}`);
			}
			if (added.states.length > 0) {
				parts.push(`${added.states.length} U.S. state${added.states.length === 1 ? '' : 's'}`);
			}
			setFlash(cookies, parts.length > 0 ? `Marked ${parts.join(' and ')} from past trips.` : 'No new places found from past trips.');
			throw redirect(303, returnTo(f, fallback));
		},
		toggleAutoMark: async ({ request, locals, cookies }) => {
			const u = requireUser(locals);
			const f = await request.formData();
			const newValue = !u.autoMarkVisited;
			usersRepo.updateUser(u.id, { auto_mark_visited: newValue });
			logAudit(u.id, 'places_auto_mark_toggle', 'user', u.id, { enabled: newValue });
			setFlash(cookies, newValue ? 'Auto-mark enabled.' : 'Auto-mark disabled.');
			throw redirect(303, returnTo(f, fallback));
		}
	};
}
