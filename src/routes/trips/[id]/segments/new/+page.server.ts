import { loadNewSegmentPicker } from '$lib/server/segmentNewPage';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = loadNewSegmentPicker;
