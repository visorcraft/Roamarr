<script lang="ts">
	import { html } from 'gridjs';
	import ConfirmModal from './ConfirmModal.svelte';

	export interface GridColumn {
		id: string;
		name: string;
		formatter?: (cell: unknown, row: Record<string, unknown>) => string | ReturnType<typeof html>;
		sort?: boolean;
	}

	export interface GridAction {
		id: string;
		label: string;
		confirmLabel?: string;
		variant?: 'primary' | 'danger' | 'ghost';
		confirm?: boolean;
		confirmTitle?: string;
		confirmMessage?: (row: Record<string, unknown>) => string;
	}

	export interface GridFilter {
		id: string;
		label: string;
		type?: 'text' | 'date';
		placeholder?: string;
		value?: string;
	}

	function escapeHtml(value: unknown): string {
		return String(value)
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#39;');
	}

	export interface FetchOpts {
		url: {
			page?: number;
			limit?: number;
			search?: string;
			sort?: string;
			dir?: 'asc' | 'desc';
			from?: string;
			to?: string;
			[key: string]: string | number | undefined;
		};
	}

	interface Props {
		columns: GridColumn[];
		fetchData: (opts: FetchOpts) => Promise<{ rows: Record<string, unknown>[]; total: number }>;
		actions?: GridAction[];
		pageSize?: number;
		filters?: GridFilter[];
		addHref?: string;
		addLabel?: string;
		emptyMessage?: string;
		onadd?: () => void;
		onaction?: (e: CustomEvent<{ action: string; row: Record<string, unknown> }>) => void;
		onquerychange?: (e: CustomEvent<Record<string, string>>) => void;
	}

	let {
		columns,
		fetchData,
		actions = [],
		pageSize = 10,
		filters = [],
		addHref,
		addLabel = 'Add',
		emptyMessage = 'No records found',
		onadd,
		onaction,
		onquerychange
	}: Props = $props();

	let wrapper: HTMLDivElement | undefined = $state();
	let pendingAction: { action: string; row: Record<string, unknown> } | null = $state(null);
	let selectedPageSize = $state(10);
	let searchInput = $state('');
	let searchTerm = '';
	let filterValues = $state<Record<string, string>>({});
	let searchTimer: ReturnType<typeof setTimeout> | undefined;
	const rowById = new Map<string, Record<string, unknown>>();
	const pageSizeOptions = $derived([...new Set([10, 25, 50, 100, pageSize])].sort((a, b) => a - b));

	const actionColumn = $derived(
		actions.length
			? {
					id: '__actions',
					name: '',
					sort: false,
					data: (row: Record<string, unknown>) => row,
					formatter: (_cell: unknown, row: Record<string, unknown>) => {
						const buttons = actions
							.map(
								(a) =>
									`<button type="button" class="btn btn-sm ${a.variant ? `btn-${escapeHtml(a.variant)}` : 'btn-primary'}" data-action="${escapeHtml(a.id)}" data-row-id="${escapeHtml(row.id)}">${escapeHtml(a.label)}</button>`
							)
							.join(' ');
						return html(buttons);
					}
				}
			: null
	);

	function wrapFormatter<T extends GridColumn>(col: T): T {
		if (!col.formatter) return col;
		const original = col.formatter;
		return {
			...col,
			data: (row: Record<string, unknown>) => row,
			formatter: (cell: unknown, _row: unknown) => {
				const row = (cell ?? _row) as Record<string, unknown>;
				return original(row, row);
			}
		} as T;
	}

	const gridColumns = $derived(
		(actionColumn ? [...columns, actionColumn] : columns).map((col) => {
			const next: any = { ...col, sort: col.sort === true ? {} : false };
			return wrapFormatter(next);
		})
	);

	let grid: any;

	export function reload() {
		grid?.updateConfig({ server: serverConfig() }).forceRender();
		schedulePageSizeControlInstall();
	}

	async function loadData(opts: FetchOpts) {
		const res = await fetchData(opts);
		rowById.clear();
		for (const r of res.rows) {
			if (r.id != null) rowById.set(String(r.id), r);
		}
		schedulePageSizeControlInstall();
		return { data: res.rows, total: res.total };
	}

	function serverConfig() {
		return {
			url: queryParams(),
			data: loadData
		};
	}

	function queryParams() {
		const params: Record<string, string> = {};
		if (searchTerm) params.search = searchTerm;
		for (const filter of filters) {
			const value = filterValues[filter.id]?.trim();
			if (value) params[filter.id] = value;
		}
		return params;
	}

	function notifyQueryChange() {
		const detail = queryParams();
		const event = new CustomEvent('querychange', { detail, bubbles: true });
		wrapper?.dispatchEvent(event);
		onquerychange?.(event);
	}

	function paginationConfig() {
		return {
			limit: selectedPageSize,
			server: {
				url: (prev: Record<string, unknown>, page: number, limit: number) => {
					prev.page = page;
					prev.limit = limit;
					return prev;
				}
			}
		};
	}

	function setPageSize(value: number) {
		selectedPageSize = value;
		grid?.updateConfig({ pagination: paginationConfig() }).forceRender();
		schedulePageSizeControlInstall();
	}

	function applyTableQuery() {
		searchTerm = searchInput.trim();
		grid?.updateConfig({ server: serverConfig(), pagination: paginationConfig() }).forceRender();
		notifyQueryChange();
		schedulePageSizeControlInstall();
	}

	function handleSearchInput(e: Event) {
		searchInput = (e.currentTarget as HTMLInputElement).value;
		if (searchTimer) clearTimeout(searchTimer);
		if (!searchInput.trim()) {
			applyTableQuery();
			return;
		}
		searchTimer = setTimeout(applyTableQuery, 250);
	}

	function handleFilterInput(e: Event, filter: GridFilter) {
		filterValues = { ...filterValues, [filter.id]: (e.currentTarget as HTMLInputElement).value };
		if (searchTimer) clearTimeout(searchTimer);
		searchTimer = setTimeout(applyTableQuery, filter.type === 'date' ? 0 : 250);
	}

	function schedulePageSizeControlInstall() {
		queueMicrotask(installPageSizeControl);
		setTimeout(installPageSizeControl, 0);
		setTimeout(installPageSizeControl, 50);
		setTimeout(installPageSizeControl, 150);
	}

	function installPageSizeControl() {
		const pagination = wrapper?.querySelector('.gridjs-pagination');
		if (!pagination) return;
		formatPaginationSummary(pagination);
		let control = pagination.querySelector('.grid-table-page-size');
		if (!control) {
			control = document.createElement('label');
			control.className = 'grid-table-page-size';
			const label = document.createElement('span');
			label.textContent = 'Rows';
			const select = document.createElement('select');
			select.className = 'select select-compact grid-table-page-size-select';
			select.dataset.gridPageSize = 'true';
			control.append(label, select);
		}
		const select = control.querySelector('select') as HTMLSelectElement;
		select.replaceChildren(
			...pageSizeOptions.map((option) => {
				const el = document.createElement('option');
				el.value = String(option);
				el.textContent = String(option);
				return el;
			})
		);
		select.value = String(selectedPageSize);
		const summary = pagination.querySelector('.gridjs-summary');
		const pages = pagination.querySelector('.gridjs-pages');
		pagination.insertBefore(control, summary?.nextSibling ?? pages);

		const prev = pagination.querySelector('.gridjs-pages-button-prev');
		const next = pagination.querySelector('.gridjs-pages-button-next');
		prev?.setAttribute('aria-label', 'Previous page');
		prev?.setAttribute('title', 'Previous page');
		next?.setAttribute('aria-label', 'Next page');
		next?.setAttribute('title', 'Next page');
	}

	function formatPaginationSummary(pagination: Element) {
		const summary = pagination.querySelector('.gridjs-summary');
		const text = summary?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
		const match = text.match(/^Showing\s+(\d+)(?:\s+to\s+|\s*-\s*)(\d+)\s+of\s+(\d+)/i);
		if (!summary || !match) return;
		const [, from, to, total] = match;
		summary.replaceChildren(
			document.createTextNode('Showing '),
			Object.assign(document.createElement('b'), { textContent: `${from}-${to}` }),
			document.createTextNode(' of '),
			Object.assign(document.createElement('b'), { textContent: total })
		);
	}

	$effect(() => {
		selectedPageSize = pageSize;
	});

	$effect(() => {
		filterValues = Object.fromEntries(filters.map((filter) => [filter.id, filter.value ?? '']));
	});

	$effect(() => {
		const container = wrapper;
		if (!container) return;
		let cancelled = false;
		let gridInstance: any;
		container.addEventListener('click', handleClick);
		container.addEventListener('change', handleChange);

		(async () => {
			const { Grid } = await import('gridjs');
			if (cancelled) return;

			gridInstance = new Grid({
				columns: gridColumns,
				className: {
					container: 'gridjs-container grid-host',
					thead: 'gridjs-thead',
					th: 'gridjs-th',
					tr: 'gridjs-tr',
					td: 'gridjs-td',
					tbody: 'gridjs-tbody',
					table: 'gridjs-table',
					header: 'gridjs-header',
					footer: 'gridjs-footer',
					search: 'gridjs-search',
					sort: 'gridjs-sort',
					pagination: 'gridjs-pagination',
					paginationSummary: 'gridjs-summary',
					paginationButton: 'gridjs-pages-button',
					paginationButtonCurrent: 'gridjs-currentPage',
					paginationButtonNext: 'gridjs-pages-button-next',
					paginationButtonPrev: 'gridjs-pages-button-prev',
					loading: 'gridjs-loading',
					notfound: 'gridjs-notfound',
					error: 'gridjs-error'
				},
				language: {
					noRecordsFound: emptyMessage,
					pagination: {
						previous: '‹',
						next: '›',
						showing: 'Showing',
						to: '-',
						results: '\u00a0'
					}
				},
				server: serverConfig(),
				sort: {
					multiColumn: false,
					server: {
						url: (
							prev: Record<string, unknown>,
							cols: { index: number; direction: 1 | -1 }[]
						) => {
							const c = cols[0];
							const col = c ? gridColumns[c.index] : undefined;
							if (c && col?.sort && col.id !== '__actions') {
								prev.sort = col.id;
								prev.dir = c.direction === 1 ? 'asc' : 'desc';
							} else {
								delete prev.sort;
								delete prev.dir;
							}
							return prev;
						}
					}
				},
				pagination: paginationConfig()
			} as any).render(container);
			grid = gridInstance;
			schedulePageSizeControlInstall();
		})();

		return () => {
			cancelled = true;
			gridInstance?.destroy();
			grid = undefined;
			if (searchTimer) clearTimeout(searchTimer);
			container.removeEventListener('click', handleClick);
			container.removeEventListener('change', handleChange);
		};
	});

	function dispatchAction(detail: { action: string; row: Record<string, unknown> }) {
		const event = new CustomEvent('action', { detail, bubbles: true });
		wrapper?.dispatchEvent(event);
		onaction?.(event);
	}

	function handleClick(e: MouseEvent) {
		const target = e.target as HTMLElement;
		if (target.closest('.gridjs-pages-button, .gridjs-th-sort')) schedulePageSizeControlInstall();
		const button = target.closest('[data-action]') as HTMLElement | null;
		if (!button) return;
		const actionId = button.dataset.action;
		const rowIdRaw = button.dataset.rowId;
		if (!actionId || rowIdRaw == null) return;
		const row = rowById.get(String(rowIdRaw));
		if (!row) return;
		const action = actions.find((a) => a.id === actionId);
		if (!action) return;

		if (action.confirm) {
			pendingAction = { action: actionId, row };
		} else {
			dispatchAction({ action: actionId, row });
		}
	}

	function handleChange(e: Event) {
		const select = (e.target as HTMLElement).closest('[data-grid-page-size]') as HTMLSelectElement | null;
		if (select) setPageSize(Number(select.value));
	}

	function confirmAction() {
		if (pendingAction) {
			dispatchAction(pendingAction);
			pendingAction = null;
		}
	}

	function getPendingAction() {
		return pendingAction as { action: string; row: Record<string, unknown> } | null;
	}

	const pendingConfirmTitle = $derived(
		(() => {
			const pa = getPendingAction();
			if (!pa) return '';
			const action = actions.find((a) => a.id === pa.action);
			return action?.confirmTitle ?? 'Confirm';
		})()
	);

	const pendingConfirmMessage = $derived(
		(() => {
			const pa = getPendingAction();
			if (!pa) return '';
			const action = actions.find((a) => a.id === pa.action);
			return action?.confirmMessage?.(pa.row) ?? 'Are you sure?';
		})()
	);

	const pendingConfirmLabel = $derived(
		(() => {
			const pa = getPendingAction();
			if (!pa) return 'Confirm';
			const action = actions.find((a) => a.id === pa.action);
			return action?.confirmLabel ?? action?.label ?? 'Confirm';
		})()
	);
</script>

<div class="space-y-4">
	<div class="grid-table-toolbar flex flex-wrap items-center justify-start gap-3">
		<label class="gridjs-search grid-table-search">
			<span class="label">Search</span>
			<input
				type="search"
				value={searchInput}
				placeholder="Search"
				aria-label="Search table"
				class="gridjs-search-input"
				oninput={handleSearchInput}
			/>
		</label>
		{#each filters as filter (filter.id)}
			<label class="grid-table-filter">
				<span class="label">{filter.label}</span>
				<input
					type={filter.type ?? 'text'}
					value={filterValues[filter.id] ?? ''}
					placeholder={filter.placeholder ?? ''}
					aria-label={filter.label}
					class="gridjs-search-input grid-table-filter-input"
					oninput={(e) => handleFilterInput(e, filter)}
					onchange={(e) => handleFilterInput(e, filter)}
				/>
			</label>
		{/each}
		{#if addHref}
			<a href={addHref} class="btn btn-primary">{addLabel}</a>
		{:else if onadd}
			<button type="button" class="btn btn-primary" onclick={onadd}>{addLabel}</button>
		{/if}
	</div>
	<div bind:this={wrapper} class="grid-table-wrapper"></div>
</div>

<ConfirmModal
	open={pendingAction !== null}
	title={pendingConfirmTitle}
	message={pendingConfirmMessage}
	confirmLabel={pendingConfirmLabel}
	onconfirm={confirmAction}
	oncancel={() => (pendingAction = null)}
/>
