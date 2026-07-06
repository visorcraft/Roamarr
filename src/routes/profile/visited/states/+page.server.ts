import { loadVisitedPage, makeVisitedActions } from '../shared.server';
import type { PageServerLoad } from './$types';

const fallback = '/profile/visited/states';

export const load: PageServerLoad = ({ url, locals }) => loadVisitedPage('state', url, locals);

export const actions = makeVisitedActions('state', fallback);
