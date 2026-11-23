// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, it, expect, vi, afterEach } from 'vitest';
// @ts-ignore — internal Svelte client runtime, used by the inline DOM test helper
import { mount, unmount } from '../../../node_modules/svelte/src/internal/client/render.js';
// @ts-ignore — internal Svelte client runtime
import { flushSync } from '../../../node_modules/svelte/src/internal/client/reactivity/batch.js';
import { m } from '$lib/paraglide/messages';
import TripDocumentsTable from './TripDocumentsTable.svelte';

const renderFn = vi.fn();

vi.mock('gridjs', () => ({
	html: vi.fn((s: string) => ({ __html: s })),
	Grid: class {
		config: Record<string, unknown>;
		constructor(config: unknown) {
			this.config = { ...(config as Record<string, unknown>), store: { dispatch: vi.fn() } };
		}
		render(el: HTMLElement) {
			el.innerHTML =
				'<div class="gridjs-footer"><div class="gridjs-pagination"><div class="gridjs-summary">Showing <b>1</b> to <b>4</b> of <b>4</b> results</div><div class="gridjs-pages"><button class="gridjs-pages-button-prev">‹</button><button class="gridjs-pages-button-next">›</button></div></div></div>';
			renderFn(el, this);
			return this;
		}
		updateConfig() {
			return this;
		}
		forceRender() {
			return this;
		}
		destroy() {}
	}
}));

describe('TripDocumentsTable', () => {
	const mounted: unknown[] = [];

	afterEach(() => {
		for (const app of mounted) {
			unmount(app);
		}
		mounted.length = 0;
		document.body.innerHTML = '';
		renderFn.mockClear();
		vi.restoreAllMocks();
		localStorage.clear();
		window.history.replaceState(null, '', '/');
	});

	function tick() {
		return new Promise((resolve) => setTimeout(resolve, 0));
	}

	function mountTable(props: Record<string, unknown>) {
		const app = mount(TripDocumentsTable, { target: document.body, props });
		flushSync();
		mounted.push(app);
		return app;
	}

	function lastGridInstance() {
		return renderFn.mock.lastCall![1] as any;
	}

	function lastConfig() {
		return lastGridInstance().config as any;
	}

	it('pins the English trip document strings', () => {
		expect(m.trip_documents_empty()).toBe('No files uploaded yet.');
		expect(m.trip_documents_whole_trip()).toBe('Whole trip');
		expect(m.trip_documents_segment_fallback({ id: 12 })).toBe('Segment #12');
		expect(m.trip_documents_file_fallback()).toBe('File');
		expect(m.trip_documents_col_name()).toBe('Name');
		expect(m.trip_documents_col_scope()).toBe('Scope');
		expect(m.trip_documents_col_type()).toBe('Type');
		expect(m.trip_documents_col_size()).toBe('Size');
		expect(m.trip_documents_action_open()).toBe('Open');
		expect(m.trip_documents_action_delete()).toBe('Delete');
		expect(m.trip_documents_delete_title()).toBe('Delete file');
		expect(m.trip_documents_delete_confirm({ name: 'Boarding pass' })).toBe(
			'Delete “Boarding pass”? This cannot be undone.'
		);
		expect(m.trip_documents_delete_confirm({ name: 'this file' })).toBe(
			'Delete “this file”? This cannot be undone.'
		);
		expect(m.trip_documents_unnamed_file()).toBe('this file');
	});

	it('headers come from the catalog', async () => {
		mountTable({ tripId: 7 });
		await tick();
		const names = lastConfig().columns.map((c: { name: string }) => c.name);
		expect(names).toEqual([
			m.trip_documents_col_name(),
			m.trip_documents_col_scope(),
			m.trip_documents_col_type(),
			m.trip_documents_col_size(),
			'Actions'
		]);

		mountTable({ tripId: 7, compact: true });
		await tick();
		expect(lastConfig().columns.map((c: { name: string }) => c.name)).toEqual([
			m.trip_documents_col_name(),
			m.trip_documents_col_size()
		]);

		mountTable({ tripId: 7, showScope: false });
		await tick();
		const scopedNames = lastConfig().columns.map((c: { name: string }) => c.name);
		expect(scopedNames).not.toContain(m.trip_documents_col_scope());
		expect(scopedNames).toEqual([
			m.trip_documents_col_name(),
			m.trip_documents_col_type(),
			m.trip_documents_col_size(),
			'Actions'
		]);
	});

	it('renders scope labels for known, unknown, and whole-trip rows', async () => {
		mountTable({
			tripId: 7,
			segmentTitles: { 3: 'Tokyo' },
			documents: [
				{ id: 1, label: 'A', filename: 'a.pdf', sizeBytes: 100, segmentId: 3 },
				{ id: 2, label: 'B', filename: 'b.pdf', sizeBytes: 100, segmentId: 9 },
				{ id: 3, label: 'C', filename: 'c.pdf', sizeBytes: 100, segmentId: null }
			]
		});
		await tick();

		const scopeCol = lastConfig().columns.find((c: { id: string }) => c.id === 'scope');
		const known = scopeCol.formatter(null, { id: 1, segmentId: 3 });
		expect(known.__html).toContain('Tokyo');
		const unknown = scopeCol.formatter(null, { id: 2, segmentId: 9 });
		expect(unknown.__html).toContain('Segment #9');
		const whole = scopeCol.formatter(null, { id: 3, segmentId: null });
		expect(whole.__html).toContain('Whole trip');
	});

	it('falls back to the catalog File label when a row has no label or filename', async () => {
		mountTable({ tripId: 7 });
		await tick();

		const nameCol = lastConfig().columns.find((c: { id: string }) => c.id === 'name');
		const result = nameCol.formatter(null, { id: 1, label: '', filename: '', sizeBytes: 0 });
		expect(result.__html).toContain('>File</a>');
	});

	it('uses the catalog empty message by default and the caller string when provided', async () => {
		mountTable({ tripId: 7 });
		await tick();
		expect(lastConfig().language.noRecordsFound).toBe(m.trip_documents_empty());

		mountTable({ tripId: 7, emptyMessage: 'Nothing attached.' });
		await tick();
		expect(lastConfig().language.noRecordsFound).toBe('Nothing attached.');
	});

	it('shows the catalog delete confirmation and renders only Open when read-only', async () => {
		const row = { id: 7, label: 'Boarding pass', filename: 'boarding.pdf', sizeBytes: 100 };
		mountTable({ tripId: 7, canEdit: true, documents: [row] });
		await tick();

		const config = lastConfig();
		await config.server.data({ url: {} });

		const container = renderFn.mock.lastCall![0] as HTMLDivElement;
		const actionColumn = config.columns[config.columns.length - 1];
		const htmlResult = actionColumn.formatter(null, row) as { __html: string };
		container.innerHTML = htmlResult.__html;

		const select = container.querySelector('[data-grid-action-select]') as HTMLSelectElement;
		select.value = 'delete';
		select.dispatchEvent(new Event('change', { bubbles: true }));
		flushSync();

		expect(document.body.textContent).toContain(m.trip_documents_delete_title());
		expect(document.body.textContent).toContain(
			'Delete “Boarding pass”? This cannot be undone.'
		);
		const confirmBtn = document.body.querySelector('.btn-danger') as HTMLButtonElement;
		expect(confirmBtn.textContent).toBe('Delete');

		unmount(mounted.pop()!);
		document.body.innerHTML = '';
		renderFn.mockClear();

		const unnamedRow = { id: 8, label: null, filename: '', sizeBytes: 100 };
		mountTable({ tripId: 7, canEdit: true, documents: [unnamedRow] });
		await tick();

		const unnamedConfig = lastConfig();
		await unnamedConfig.server.data({ url: {} });

		const unnamedContainer = renderFn.mock.lastCall![0] as HTMLDivElement;
		const unnamedActionColumn = unnamedConfig.columns[unnamedConfig.columns.length - 1];
		const unnamedHtml = unnamedActionColumn.formatter(null, unnamedRow) as { __html: string };
		unnamedContainer.innerHTML = unnamedHtml.__html;

		const unnamedSelect = unnamedContainer.querySelector('[data-grid-action-select]') as HTMLSelectElement;
		unnamedSelect.value = 'delete';
		unnamedSelect.dispatchEvent(new Event('change', { bubbles: true }));
		flushSync();

		expect(document.body.textContent).toContain('Delete “this file”? This cannot be undone.');

		unmount(mounted.pop()!);
		document.body.innerHTML = '';
		renderFn.mockClear();

		mountTable({ tripId: 7, canEdit: false, documents: [row] });
		await tick();

		const readOnlyConfig = lastConfig();
		const readOnlyActionColumn = readOnlyConfig.columns[readOnlyConfig.columns.length - 1];
		const readOnlyHtml = readOnlyActionColumn.formatter(null, row) as { __html: string };
		expect(readOnlyHtml.__html).toContain(m.trip_documents_action_open());
		expect(readOnlyHtml.__html).not.toContain(m.trip_documents_action_delete());
	});

	it('keeps UI strings out of the component source', () => {
		const source = readFileSync(
			path.join(path.dirname(fileURLToPath(import.meta.url)), 'TripDocumentsTable.svelte'),
			'utf8'
		);
		expect(source).toContain("from '$lib/paraglide/messages'");
		for (const literal of [
			"'No files uploaded yet.'",
			"'Whole trip'",
			'Segment #',
			"|| 'File'",
			"'Name'",
			"'Scope'",
			"'Type'",
			"'Size'",
			"'Open'",
			"'Delete file'",
			"'Delete'",
			"'this file'",
			'This cannot be undone.'
		]) {
			expect(source).not.toContain(literal);
		}
	});
});
