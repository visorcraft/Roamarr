import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	// If there's no actual boot problem, /boot-error has no business being
	// shown. Redirect away (to /login if unauthenticated, or / otherwise).
	if (!locals.missingSecret && !locals.bootError) {
		throw redirect(302, '/');
	}
	return {
		missingSecret: locals.missingSecret ?? false,
		bootError: locals.bootError
	};
};
