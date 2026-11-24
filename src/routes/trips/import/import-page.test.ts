import { render } from 'svelte/server';
import { test, expect, vi } from 'vitest';
import ImportPage from './+page.svelte';

vi.mock('$app/forms', () => ({ enhance: () => {} }));

test('import form is enhanced, idle, and describes its file hint', () => {
	const { body } = render(ImportPage, { props: {} as any });
	expect(body).toContain('enctype="multipart/form-data"');
	expect(body).toContain('aria-busy="false"');
	expect(body).toContain('id="file-hint"');
	expect(body).toContain('aria-describedby="file-hint"');
	expect(body).toContain('Preview checks the file without saving');

	const previewButton = body.match(/<button[^>]*name="dryRun" value="true"[^>]*>/);
	const importButton = body.match(/<button[^>]*name="dryRun" value="false"[^>]*>/);
	expect(previewButton).toBeTruthy();
	expect(importButton).toBeTruthy();
	expect(previewButton![0]).not.toContain('disabled');
	expect(previewButton![0]).not.toContain('btn-loading');
	expect(importButton![0]).not.toContain('disabled');
	expect(importButton![0]).not.toContain('btn-loading');

	expect(body).not.toContain('Importing…');
	expect(body).not.toContain('Previewing…');
	expect(body).not.toContain('role="alert"');
	expect(body).not.toContain('role="status"');
});

test('an action failure renders an alert with no status', () => {
	const { body } = render(ImportPage, {
		props: { form: { error: 'Please select a file.' } } as any
	});
	expect(body).toContain('class="notice notice-error mt-4" role="alert"');
	expect(body).toContain('Please select a file.');
	expect(body).not.toContain('role="status"');
});

test('a preview result is a polite status announcement', () => {
	const { body } = render(ImportPage, {
		props: {
			form: {
				success: true,
				dryRun: true,
				result: {
					imported: 2,
					segmentCount: 3,
					preview: [{ name: 'A', startDate: '2026-01-01', segments: [] }],
					errors: [{ row: 3, field: 'name', message: 'Missing name' }]
				}
			}
		} as any
	});
	expect(body).toContain('class="notice mt-4 notice-info"');
	expect(body).toContain('Would import');
	expect(body).toContain('role="status"');
	expect(body).toContain('row(s) had errors');
	expect(body).toContain('Row 3');
	expect(body).toContain('field name');
	expect(body).not.toContain('role="alert"');
});

test('an import result uses the success notice', () => {
	const { body } = render(ImportPage, {
		props: {
			form: {
				success: true,
				dryRun: false,
				result: { imported: 1, segmentCount: 1, preview: [], errors: [] }
			}
		} as any
	});
	expect(body).toContain('class="notice mt-4 notice-success"');
	expect(body).toContain('Imported');
	expect(body).toContain('role="status"');
	expect(body).not.toContain('Would import');
	expect(body).not.toContain('row(s) had errors');
});

test('a partial failure renders both the alert and the status', () => {
	const { body } = render(ImportPage, {
		props: {
			form: {
				error: 'Import completed with errors.',
				result: {
					imported: 0,
					segmentCount: 0,
					preview: [],
					errors: [{ row: 2, field: 'startDate', message: 'Invalid date' }]
				}
			}
		} as any
	});
	expect(body).toContain('role="alert"');
	expect(body).toContain('role="status"');
});
