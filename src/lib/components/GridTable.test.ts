// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
// @ts-ignore — internal Svelte client runtime, used by the inline DOM test helper
import { mount, unmount } from '../../../node_modules/svelte/src/internal/client/render.js';
// @ts-ignore — internal Svelte client runtime
import { flushSync } from '../../../node_modules/svelte/src/internal/client/reactivity/batch.js';
import GridTable from './GridTable.svelte';

const renderFn = vi.fn();

vi.mock('gridjs', () => ({
	html: vi.fn((s: string) => ({ __html: s })),
	Grid: class {
		config: unknown;
		constructor(config: unknown) {
			this.config = config;
		}
		render(el: HTMLElement) {
			renderFn(el, this.config);
			return this;
		}
		destroy() {}
	}
}));

vi.mock('gridjs/dist/theme/mermaid.css', () => ({}));

describe('GridTable', () => {
	const mounted: unknown[] = [];

	afterEach(() => {
		for (const app of mounted) {
			unmount(app);
		}
		mounted.length = 0;
		document.body.innerHTML = '';
		renderFn.mockClear();
	});

	function mountTable(props: Record<string, unknown>) {
		const app = mount(GridTable, { target: document.body, props });
		flushSync();
		mounted.push(app);
		return app;
	}

	it('renders the wrapper div for Grid.js and an add link', async () => {
		mountTable({
			columns: [{ id: 'name', name: 'Name' }],
			fetchData: async () => ({ rows: [{ id: 1, name: 'A' }], total: 1 }),
			addHref: '/add',
			addLabel: 'New item'
		});
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(document.body.querySelector('.grid-table-wrapper')).toBeTruthy();
		expect(document.body.innerHTML).toContain('href="/add"');
		expect(document.body.textContent).toContain('New item');
	});

	it('returns an html object from the action column formatter', async () => {
		mountTable({
			columns: [{ id: 'name', name: 'Name' }],
			fetchData: async () => ({ rows: [{ id: 1, name: 'A' }], total: 1 }),
			actions: [{ id: 'edit', label: 'Edit' }]
		});
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(renderFn).toHaveBeenCalledOnce();
		const config = renderFn.mock.lastCall![1] as any;
		const actionColumn = config.columns[config.columns.length - 1];
		expect(actionColumn.id).toBe('__actions');

		const result = actionColumn.formatter(null, { id: 1, name: 'A' });
		expect(result).toEqual({ __html: expect.stringContaining('data-action="edit"') });
	});

	it('escapes action and row values when building action buttons', async () => {
		mountTable({
			columns: [{ id: 'name', name: 'Name' }],
			fetchData: async () => ({ rows: [{ id: 1, name: 'A' }], total: 1 }),
			actions: [{ id: 'edit"x', label: 'Edit <script>' }]
		});
		await new Promise((resolve) => setTimeout(resolve, 0));

		const config = renderFn.mock.lastCall![1] as any;
		const actionColumn = config.columns[config.columns.length - 1];
		const result = actionColumn.formatter(null, { id: '2\'&3', name: 'A' }) as { __html: string };

		expect(result.__html).toContain('data-action="edit&quot;x"');
		expect(result.__html).toContain('>Edit &lt;script&gt;<');
		expect(result.__html).toContain('data-row-id="2&#39;&amp;3"');
	});

	it('dispatches an action event when a delegated action button is clicked', async () => {
		const fetchData = vi.fn(async () => ({ rows: [{ id: 1, name: 'A' }], total: 1 }));
		mountTable({
			columns: [{ id: 'name', name: 'Name' }],
			fetchData,
			actions: [{ id: 'edit', label: 'Edit' }]
		});
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(renderFn).toHaveBeenCalledOnce();
		const config = renderFn.mock.lastCall![1] as any;
		await config.server.data({ url: {} });
		expect(fetchData).toHaveBeenCalledOnce();

		const container = renderFn.mock.lastCall![0] as HTMLDivElement;
		const actionColumn = config.columns[config.columns.length - 1];
		const htmlResult = actionColumn.formatter(null, { id: 1, name: 'A' }) as { __html: string };
		container.innerHTML = htmlResult.__html;

		let fired: CustomEvent | null = null;
		container.addEventListener('action', (e) => {
			fired = e as CustomEvent;
		});

		const button = container.querySelector('button[data-action="edit"]') as HTMLElement | null;
		expect(button).toBeTruthy();
		button!.click();

		expect(fired).toBeTruthy();
		expect(fired!.detail).toEqual({ action: 'edit', row: { id: 1, name: 'A' } });
	});

	it('dispatches the action event exactly once when Enter is pressed on an action button', async () => {
		const fetchData = vi.fn(async () => ({ rows: [{ id: 1, name: 'A' }], total: 1 }));
		mountTable({
			columns: [{ id: 'name', name: 'Name' }],
			fetchData,
			actions: [{ id: 'edit', label: 'Edit' }]
		});
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(renderFn).toHaveBeenCalledOnce();
		const config = renderFn.mock.lastCall![1] as any;
		await config.server.data({ url: {} });

		const container = renderFn.mock.lastCall![0] as HTMLDivElement;
		const actionColumn = config.columns[config.columns.length - 1];
		const htmlResult = actionColumn.formatter(null, { id: 1, name: 'A' }) as { __html: string };
		container.innerHTML = htmlResult.__html;

		const fired: CustomEvent[] = [];
		container.addEventListener('action', (e) => {
			fired.push(e as CustomEvent);
		});

		const button = container.querySelector('button[data-action="edit"]') as HTMLElement | null;
		expect(button).toBeTruthy();
		button!.focus();
		// Real buttons fire a native click on Enter/Space; jsdom does not, so we fire
		// the resulting click explicitly and verify the wrapper keydown handler no
		// longer adds a second dispatch.
		button!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		button!.click();

		expect(fired).toHaveLength(1);
		expect(fired[0].detail).toEqual({ action: 'edit', row: { id: 1, name: 'A' } });
	});
});
