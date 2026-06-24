import { newSegmentPage } from '$lib/server/segmentNewPage';

const page = newSegmentPage('rental_car');
export const load = page.load;
export const actions = page.actions;
