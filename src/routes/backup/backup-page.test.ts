import { render } from 'svelte/server';
import { test, expect } from 'vitest';
import BackupPage from './+page.svelte';

test('renders helper copy with theme-driven text', () => {
	const { body } = render(BackupPage, {
		props: {
			data: {
				autoBackup: {
					enabled: true,
					directory: '/data/backups',
					intervalHours: 24,
					retentionCount: 7,
					storedCount: 2,
					lastRunAt: '2026-11-22T02:00:00Z',
					nextDueAt: '2026-11-23T02:00:00Z'
				}
			},
			form: null
		} as any
	});
	expect(body.match(/<p class="mt-[12] text-sm text-\[var\(--theme-readable-muted\)\]">/g)).toHaveLength(4);
	expect(body).toContain('The current database directory will be replaced and the app must be restarted.');
	expect(body).toContain('auto-*.mongreldb.tar.gz');
});

test('keeps restore gated until confirmed', () => {
	const { body } = render(BackupPage, {
		props: {
			data: {
				autoBackup: {
					enabled: true,
					directory: '/data/backups',
					intervalHours: 24,
					retentionCount: 7,
					storedCount: 2,
					lastRunAt: '2026-11-22T02:00:00Z',
					nextDueAt: '2026-11-23T02:00:00Z'
				}
			},
			form: null
		} as any
	});
	expect(body).toMatch(/<button[^>]*class="btn btn-danger"[^>]*disabled/);
	expect(body).toContain('Restore backup');
});

test('uses no fixed palette utilities inside themed cards', () => {
	const { body } = render(BackupPage, {
		props: {
			data: {
				autoBackup: {
					enabled: true,
					directory: '/data/backups',
					intervalHours: 24,
					retentionCount: 7,
					storedCount: 2,
					lastRunAt: '2026-11-22T02:00:00Z',
					nextDueAt: '2026-11-23T02:00:00Z'
				}
			},
			form: null
		} as any
	});
	expect(body).not.toMatch(/\b(?:text|bg|border|ring)-(?:white|slate-\d{2,3}|indigo-\d{2,3}|gray-\d{2,3})\b/);
});
