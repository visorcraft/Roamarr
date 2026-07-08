import { fail, redirect, type Actions } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { setFlash } from '$lib/server/flash';
import { _updateTheme } from '$lib/server/profileActions';
import { THEMES, normalizeThemeId } from '$lib/themes';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	const u = requireUser(locals);
	return {
		themeId: normalizeThemeId(u.themeId),
		themes: THEMES
	};
};

export const actions: Actions = {
	updateTheme: async ({ cookies, request, locals }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const themeId = String(f.get('themeId') ?? u.themeId);
		try {
			_updateTheme(u.id, themeId);
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Update failed' });
		}
		setFlash(cookies, 'Theme updated.');
		throw redirect(303, '/profile/theme');
	}
};
