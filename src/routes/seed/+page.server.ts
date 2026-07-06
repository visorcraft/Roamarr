import { redirect, type Actions } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/auth';
import { logAudit } from '$lib/server/audit';
import { seedDemoData } from '$lib/server/seed';
import { setFlash } from '$lib/server/flash';

export const actions: Actions = {
	default: async ({ locals, cookies }) => {
		const u = requireAdmin(locals);
		seedDemoData(u.id);
		logAudit(u.id, 'demo_seed', 'settings', 1);
		setFlash(cookies, 'Demo data seeded.');
		throw redirect(303, '/trips');
	}
};
