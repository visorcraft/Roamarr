import { loadVisitedPage, makeVisitedActions } from '../shared.server';
import type { PageServerLoad } from './$types';

const fallback = '/profile/visited/countries';

export const load: PageServerLoad = ({ url, locals }) => loadVisitedPage('country', url, locals);

export const actions = makeVisitedActions('country', fallback);
