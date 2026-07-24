// SPDX-FileCopyrightText: 2026 VisorCraft LLC
// SPDX-License-Identifier: GPL-3.0-only
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/** Legacy URL; Database Ops moved to /database-maintenance. */
export const load: PageServerLoad = () => {
	throw redirect(308, '/database-maintenance');
};
