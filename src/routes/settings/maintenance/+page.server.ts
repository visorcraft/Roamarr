import { fail, type Actions } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/auth';
import { checkRateLimit } from '$lib/server/rateLimit';
import { logAudit } from '$lib/server/audit';
import { kit } from '$lib/server/db';
import type { PageServerLoad } from './$types';

const RATE_LIMITS = {
	check: { maxAttempts: 10, windowMs: 60_000 },
	gc: { maxAttempts: 5, windowMs: 60_000 },
	flush: { maxAttempts: 5, windowMs: 60_000 },
	doctor: { maxAttempts: 3, windowMs: 60_000 }
} as const;

function jsonSafe(value: unknown): unknown {
	try {
		return JSON.parse(
			JSON.stringify(value, (_key, v) => {
				if (typeof v === 'bigint') return String(v);
				return v;
			})
		);
	} catch (e) {
		return { serializationError: e instanceof Error ? e.message : 'Unknown serialization error' };
	}
}

function normalizeCheckReport(report: unknown): { ok: boolean; tableCount: number; report: unknown } {
	if (report && typeof report === 'object' && 'ok' in report) {
		const ok = (report as { ok: unknown }).ok === true;
		const tables = (report as { tables?: unknown }).tables;
		return { ok, tableCount: Array.isArray(tables) ? tables.length : 0, report: jsonSafe(report) };
	}
	return { ok: false, tableCount: 0, report: jsonSafe(report) };
}

function normalizeDoctorReport(report: unknown): { ok: boolean; quarantinedCount: number; report: unknown } {
	if (report && typeof report === 'object' && 'ok' in report) {
		const ok = (report as { ok: unknown }).ok === true;
		const quarantined = (report as { quarantined?: unknown[] }).quarantined;
		return {
			ok,
			quarantinedCount: Array.isArray(quarantined) ? quarantined.length : 0,
			report: jsonSafe(report)
		};
	}
	return { ok: false, quarantinedCount: 0, report: jsonSafe(report) };
}

export const load: PageServerLoad = ({ locals }) => {
	requireAdmin(locals);
	return {};
};

export const actions: Actions = {
	check: async ({ locals, getClientAddress }) => {
		const u = requireAdmin(locals);
		const limit = checkRateLimit(getClientAddress(), 'maintenance_check', RATE_LIMITS.check);
		if (!limit.allowed) {
			return fail(429, {
				action: 'check',
				error: 'Too many attempts. Try again later.',
				retryAfter: limit.retryAfter
			});
		}
		try {
			const result = normalizeCheckReport(kit.check());
			logAudit(u.id, 'db_check', 'settings', 1, { ok: result.ok, tableCount: result.tableCount });
			return { action: 'check', success: true, result };
		} catch (e) {
			return fail(400, { action: 'check', error: e instanceof Error ? e.message : 'Check failed' });
		}
	},

	gc: async ({ request, locals, getClientAddress }) => {
		const u = requireAdmin(locals);
		const limit = checkRateLimit(getClientAddress(), 'maintenance_gc', RATE_LIMITS.gc);
		if (!limit.allowed) {
			return fail(429, {
				action: 'gc',
				error: 'Too many attempts. Try again later.',
				retryAfter: limit.retryAfter
			});
		}
		const f = await request.formData();
		if (f.get('confirmMaintenance') !== 'gc') {
			return fail(400, { action: 'gc', error: 'Confirm garbage collection before running.' });
		}
		try {
			const compactResult = kit.compactAll();
			const result = {
				compacted: Number(compactResult.compacted ?? 0),
				skipped: Number(compactResult.skipped ?? 0)
			};
			logAudit(u.id, 'db_gc', 'settings', 1, result);
			return { action: 'gc', success: true, result };
		} catch (e) {
			return fail(400, {
				action: 'gc',
				error: e instanceof Error ? e.message : 'Garbage collection failed'
			});
		}
	},

	flush: async ({ request, locals, getClientAddress }) => {
		const u = requireAdmin(locals);
		const limit = checkRateLimit(getClientAddress(), 'maintenance_flush', RATE_LIMITS.flush);
		if (!limit.allowed) {
			return fail(429, {
				action: 'flush',
				error: 'Too many attempts. Try again later.',
				retryAfter: limit.retryAfter
			});
		}
		const f = await request.formData();
		if (f.get('confirmMaintenance') !== 'flush') {
			return fail(400, { action: 'flush', error: 'Confirm flush before running.' });
		}
		try {
			const tableCount = kit.tableNames().length;
			kit.flush();
			const result = { tableCount };
			logAudit(u.id, 'db_flush', 'settings', 1, result);
			return { action: 'flush', success: true, result };
		} catch (e) {
			return fail(400, { action: 'flush', error: e instanceof Error ? e.message : 'Flush failed' });
		}
	},

	doctor: async ({ request, locals, getClientAddress }) => {
		const u = requireAdmin(locals);
		const limit = checkRateLimit(getClientAddress(), 'maintenance_doctor', RATE_LIMITS.doctor);
		if (!limit.allowed) {
			return fail(429, {
				action: 'doctor',
				error: 'Too many attempts. Try again later.',
				retryAfter: limit.retryAfter
			});
		}
		const f = await request.formData();
		if (f.get('confirmMaintenance') !== 'doctor') {
			return fail(400, { action: 'doctor', error: 'Confirm doctor before running.' });
		}
		try {
			const result = normalizeDoctorReport(kit.doctor());
			logAudit(u.id, 'db_doctor', 'settings', 1, {
				ok: result.ok,
				quarantinedCount: result.quarantinedCount
			});
			return { action: 'doctor', success: true, result };
		} catch (e) {
			return fail(400, { action: 'doctor', error: e instanceof Error ? e.message : 'Doctor failed' });
		}
	}
};
