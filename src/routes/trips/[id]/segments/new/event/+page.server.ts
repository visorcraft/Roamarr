import { newSegmentPage } from '$lib/server/segmentNewPage';

const page = newSegmentPage('event');
export const load = page.load;
export const actions = page.actions;
