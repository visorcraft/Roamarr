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

	function lastGridInstance() {
		return renderFn.mock.lastCall![1] as any;
	}

	function lastConfig() {
		return lastGridInstance().config as any;
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
		expect(lastConfig().pagination.limit).toBe(10);
		expect(document.body.innerHTML).toContain('href="/add"');
		expect(document.body.textContent).toContain('New item');
		expect([...document.body.querySelector('.grid-table-toolbar')!.children].map((el) => el.tagName)).toEqual([
			'LABEL',
			'A'
		]);
	});

	it('returns an html object from the action column formatter', async () => {
		mountTable({
			columns: [{ id: 'name', name: 'Name' }],
			fetchData: async () => ({ rows: [{ id: 1, name: 'A' }], total: 1 }),
			actions: [{ id: 'edit', label: 'Edit' }]
		});
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(renderFn).toHaveBeenCalledOnce();
		const config = lastConfig();
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

		const config = lastConfig();
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
		const config = lastConfig();
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
		const config = lastConfig();
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

	it('exposes a reload method that updates and force-renders the grid', async () => {
		const app = mountTable({
			columns: [{ id: 'name', name: 'Name' }],
			fetchData: async () => ({ rows: [{ id: 1, name: 'A' }], total: 1 })
		});
		await new Promise((resolve) => setTimeout(resolve, 0));

		const grid = lastGridInstance();
		const updateConfig = vi.spyOn(grid, 'updateConfig').mockReturnValue(grid);
		const forceRender = vi.spyOn(grid, 'forceRender').mockReturnValue(grid);

		(app as any).reload();

		expect(updateConfig).toHaveBeenCalledOnce();
		expect(forceRender).toHaveBeenCalledOnce();
	});

	it('passes the selected page size to Grid.js and updates it from the selector', async () => {
		mountTable({
			columns: [{ id: 'name', name: 'Name' }],
			fetchData: async () => ({ rows: [{ id: 1, name: 'A' }], total: 1 }),
			pageSize: 50
		});
		await new Promise((resolve) => setTimeout(resolve, 0));

		const config = lastConfig();
		expect(config.pagination.limit).toBe(50);
		expect(config.pagination.server.url({}, 2, 50)).toEqual({ page: 2, limit: 50 });

		const grid = lastGridInstance();
		const updateConfig = vi.spyOn(grid, 'updateConfig').mockReturnValue(grid);
		const forceRender = vi.spyOn(grid, 'forceRender').mockReturnValue(grid);
		const select = document.body.querySelector('select') as HTMLSelectElement | null;
		expect(select).toBeTruthy();
		expect(select!.closest('.gridjs-pagination')).toBeTruthy();
		expect(document.body.querySelector('.gridjs-pagination')?.textContent).toContain('Rows');
		expect(document.body.querySelector('.gridjs-summary')?.textContent).toBe('Showing 1-4 of 4');

		select!.value = '10';
		select!.dispatchEvent(new Event('change', { bubbles: true }));

		expect(updateConfig).toHaveBeenCalledWith({
			pagination: expect.objectContaining({ limit: 10 })
		});
		expect(forceRender).toHaveBeenCalledOnce();
	});

	it('keeps only explicitly sortable columns sortable', async () => {
		mountTable({
			columns: [
				{ id: 'name', name: 'Name', sort: true },
				{ id: 'notes', name: 'Notes' }
			],
			fetchData: async () => ({ rows: [{ id: 1, name: 'A', notes: 'B' }], total: 1 }),
			actions: [{ id: 'edit', label: 'Edit' }]
		});
		await new Promise((resolve) => setTimeout(resolve, 0));

		const config = lastConfig();
		expect(config.columns.map((col: { sort?: unknown }) => col.sort)).toEqual([{}, false, false]);
	});

	it('passes toolbar search to Grid.js server config and clears it', async () => {
		mountTable({
			columns: [{ id: 'name', name: 'Name' }],
			fetchData: async () => ({ rows: [{ id: 1, name: 'A' }], total: 1 })
		});
		await new Promise((resolve) => setTimeout(resolve, 0));

		const config = lastConfig();
		expect(config.server.url).toEqual({});

		const grid = lastGridInstance();
		const updateConfig = vi.spyOn(grid, 'updateConfig').mockReturnValue(grid);
		const forceRender = vi.spyOn(grid, 'forceRender').mockReturnValue(grid);
		const input = document.body.querySelector('input[type="search"]') as HTMLInputElement | null;
		expect(input).toBeTruthy();

		input!.value = 'live';
		input!.dispatchEvent(new Event('input', { bubbles: true }));
		await new Promise((resolve) => setTimeout(resolve, 275));
		let nextConfig = updateConfig.mock.calls.at(-1)?.[0] as any;
		expect(nextConfig.server.url).toEqual({ search: 'live' });
		expect(forceRender).toHaveBeenCalledOnce();

		input!.value = '';
		input!.dispatchEvent(new Event('input', { bubbles: true }));
		nextConfig = updateConfig.mock.calls.at(-1)?.[0] as any;
		expect(nextConfig.server.url).toEqual({});
		expect(forceRender).toHaveBeenCalledTimes(2);
	});

	it('passes configured toolbar filters to Grid.js server config', async () => {
		const onquerychange = vi.fn();
		mountTable({
			columns: [{ id: 'name', name: 'Name' }],
			fetchData: async () => ({ rows: [{ id: 1, name: 'A' }], total: 1 }),
			filters: [
				{ id: 'from', label: 'From', type: 'date' },
				{ id: 'entityType', label: 'Entity type', placeholder: 'e.g. trip', value: 'trip' }
			],
			onquerychange
		});
		await new Promise((resolve) => setTimeout(resolve, 0));

		const grid = lastGridInstance();
		const updateConfig = vi.spyOn(grid, 'updateConfig').mockReturnValue(grid);
		const forceRender = vi.spyOn(grid, 'forceRender').mockReturnValue(grid);
		const from = document.body.querySelector('input[aria-label="From"]') as HTMLInputElement | null;
		expect(from).toBeTruthy();
		expect((document.body.querySelector('input[aria-label="Entity type"]') as HTMLInputElement).value).toBe('trip');

		from!.value = '2024-01-01';
		from!.dispatchEvent(new Event('input', { bubbles: true }));
		await new Promise((resolve) => setTimeout(resolve, 0));

		const nextConfig = updateConfig.mock.calls.at(-1)?.[0] as any;
		expect(nextConfig.server.url).toEqual({ from: '2024-01-01', entityType: 'trip' });
		expect(onquerychange.mock.calls.at(-1)?.[0].detail).toEqual({ from: '2024-01-01', entityType: 'trip' });
		expect(forceRender).toHaveBeenCalledOnce();
	});

	it('translates Grid.js sort indexes to table query keys', async () => {
		mountTable({
			columns: [
				{ id: 'displayName', name: 'User', sort: true },
				{ id: 'status', name: 'Status', sort: false },
				{ id: 'createdAt', name: 'Joined', sort: true }
			],
			fetchData: async () => ({ rows: [{ id: 1, displayName: 'A' }], total: 1 }),
			actions: [{ id: 'edit', label: 'Edit' }]
		});
		await new Promise((resolve) => setTimeout(resolve, 0));

		const config = lastConfig();
		expect(config.sort.server.url({ page: 2 }, [{ index: 0, direction: 1 }])).toEqual({
			page: 2,
			sort: 'displayName',
			dir: 'asc'
		});
		expect(config.sort.server.url({ page: 2 }, [{ index: 2, direction: -1 }])).toEqual({
			page: 2,
			sort: 'createdAt',
			dir: 'desc'
		});
		expect(config.sort.server.url({ sort: 'displayName', dir: 'asc' }, [{ index: 1, direction: 1 }])).toEqual({});
		expect(config.sort.server.url({ sort: 'displayName', dir: 'asc' }, [{ index: 3, direction: 1 }])).toEqual({});
	});

	it('configures gridjs with theme-safe classNames', async () => {
		mountTable({
			columns: [{ id: 'name', name: 'Name' }],
			fetchData: async () => ({ rows: [{ id: 1, name: 'A' }], total: 1 })
		});
		await new Promise((resolve) => setTimeout(resolve, 0));

		const config = lastConfig();
		expect(config.className.container).toBe('gridjs-container grid-host');
		expect(config.className.thead).toBe('gridjs-thead');
		expect(config.className.th).toBe('gridjs-th');
		expect(config.className.tr).toBe('gridjs-tr');
		expect(config.className.td).toBe('gridjs-td');
		expect(config.className.tbody).toBe('gridjs-tbody');
		expect(config.className.table).toBe('gridjs-table');
		expect(config.className.header).toBe('gridjs-header');
		expect(config.className.footer).toBe('gridjs-footer');
		expect(config.className.search).toBe('gridjs-search');
		expect(config.className.sort).toBe('gridjs-sort');
		expect(config.className.pagination).toBe('gridjs-pagination');
		expect(config.className.paginationSummary).toBe('gridjs-summary');
		expect(config.className.paginationButton).toBe('gridjs-pages-button');
		expect(config.className.paginationButtonCurrent).toBe('gridjs-currentPage');
		expect(config.className.paginationButtonNext).toBe('gridjs-pages-button-next');
		expect(config.className.paginationButtonPrev).toBe('gridjs-pages-button-prev');
		expect(config.className.loading).toBe('gridjs-loading');
		expect(config.className.notfound).toBe('gridjs-notfound');
		expect(config.className.error).toBe('gridjs-error');
		expect(config.language.pagination).toMatchObject({
			previous: '‹',
			next: '›',
			showing: 'Showing',
			to: '-',
			results: '\u00a0'
		});
	});
});
