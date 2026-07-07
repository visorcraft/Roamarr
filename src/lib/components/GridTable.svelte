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
		};
	}

	interface Props {
		columns: GridColumn[];
		fetchData: (opts: FetchOpts) => Promise<{ rows: Record<string, unknown>[]; total: number }>;
		actions?: GridAction[];
		pageSize?: number;
		addHref?: string;
		addLabel?: string;
		emptyMessage?: string;
	}

	let {
		columns,
		fetchData,
		actions = [],
		pageSize = 25,
		addHref,
		addLabel = 'Add',
		emptyMessage = 'No records found'
	}: Props = $props();

	let wrapper: HTMLDivElement | undefined = $state();
	let pendingAction: { action: string; row: Record<string, unknown> } | null = $state(null);
	const rowById = new Map<string, Record<string, unknown>>();

	const actionColumn = $derived(
		actions.length
			? {
					id: '__actions',
					name: '',
					sort: false,
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

	const gridColumns = $derived(actionColumn ? [...columns, actionColumn] : columns);

	let grid: any;

	$effect(() => {
		const container = wrapper;
		if (!container) return;
		let cancelled = false;
		let gridInstance: any;
		container.addEventListener('click', handleClick);

		(async () => {
			const [{ Grid }] = await Promise.all([
				import('gridjs'),
				import('gridjs/dist/theme/mermaid.css')
			]);
			if (cancelled) return;

			gridInstance = new Grid({
				columns: gridColumns,
				language: {
					noRecordsFound: emptyMessage
				},
				server: {
					data: async (opts: FetchOpts) => {
						const res = await fetchData(opts);
						rowById.clear();
						for (const r of res.rows) {
							if (r.id != null) rowById.set(String(r.id), r);
						}
						return { data: res.rows, total: res.total };
					}
				},
				search: {
					server: {
						url: (prev: Record<string, unknown>, keyword: string) => {
							prev.search = keyword;
							return prev;
						}
					}
				},
				sort: {
					multiColumn: false,
					server: {
						url: (
							prev: Record<string, unknown>,
							cols: { id: string; direction: 'asc' | 'desc' }[]
						) => {
							const c = cols[0];
							if (c && c.id !== '__actions') {
								prev.sort = c.id;
								prev.dir = c.direction;
							} else {
								delete prev.sort;
								delete prev.dir;
							}
							return prev;
						}
					}
				},
				pagination: {
					limit: pageSize,
					server: {
						url: (prev: Record<string, unknown>, page: number, limit: number) => {
							prev.page = page;
							prev.limit = limit;
							return prev;
						}
					}
				}
			} as any).render(container);
			grid = gridInstance;
		})();

		return () => {
			cancelled = true;
			gridInstance?.destroy();
			grid = undefined;
			container.removeEventListener('click', handleClick);
		};
	});

	function dispatchAction(detail: { action: string; row: Record<string, unknown> }) {
		wrapper?.dispatchEvent(new CustomEvent('action', { detail, bubbles: true }));
	}

	function handleClick(e: MouseEvent) {
		const target = e.target as HTMLElement;
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
	<div class="flex items-center justify-between gap-4">
		{#if addHref}
			<a href={addHref} class="btn btn-primary">{addLabel}</a>
		{:else}
			<span></span>
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
