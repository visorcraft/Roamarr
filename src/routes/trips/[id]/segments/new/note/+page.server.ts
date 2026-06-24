import { newSegmentPage } from '$lib/server/segmentNewPage';

const page = newSegmentPage('note');
export const load = page.load;
export const actions = page.actions;
