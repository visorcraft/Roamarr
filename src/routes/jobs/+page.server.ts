// SPDX-FileCopyrightText: 2026 VisorCraft LLC
// SPDX-License-Identifier: GPL-3.0-only
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/** Legacy URL; Scheduled Jobs moved to /job-history. */
export const load: PageServerLoad = () => {
	throw redirect(308, '/job-history');
};
