import { error, fail, redirect, type Actions } from '@sveltejs/kit';
import { writeFileSync, copyFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { requireAdmin } from '$lib/server/auth';
import { logAudit } from '$lib/server/audit';
import { setFlash } from '$lib/server/flash';

export const actions: Actions = {
	restore: async ({ locals, request, cookies }) => {
		const u = requireAdmin(locals);
		const f = await request.formData();
		const file = f.get('file');
		if (!(file instanceof File)) return fail(400, { error: 'Upload a file' });
		if (!file.name.endsWith('.db') && !file.name.endsWith('.sqlite') && !file.name.endsWith('.sqlite3')) {
			return fail(400, { error: 'Upload a SQLite database file' });
		}

		const dbPath = process.env.DATABASE_PATH ?? '/data/roamarr.db';
		const tmpPath = join(tmpdir(), `roamarr-restore-${Date.now()}.db`);
		try {
			const buffer = Buffer.from(await file.arrayBuffer());
			writeFileSync(tmpPath, buffer);
			const check = new Database(tmpPath);
			check.pragma('quick_check');
			const hasUsers = check.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get();
			check.close();
			if (!hasUsers) {
				unlinkSync(tmpPath);
				return fail(400, { error: 'Invalid Roamarr database' });
			}
			copyFileSync(tmpPath, dbPath);
			unlinkSync(tmpPath);
			logAudit(u.id, 'db_restore', 'settings', 1);
			setFlash(cookies, 'Database restored. Restart the app to complete.');
			throw redirect(303, '/settings/backup');
		} catch (e) {
			try { unlinkSync(tmpPath); } catch {}
			if (e && typeof e === 'object' && 'status' in e) throw e;
			return fail(400, { error: e instanceof Error ? e.message : 'Restore failed' });
		}
	}
};
