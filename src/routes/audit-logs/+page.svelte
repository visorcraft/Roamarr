<script lang="ts">
	import { html } from 'gridjs';
	import { goto } from '$app/navigation';
	import GridTable, { type FetchOpts, type GridFilter } from '$lib/components/GridTable.svelte';
	import { buildTableQuery } from '$lib/tableParams';
	import { useDateFormat } from '$lib/dateFormatContext.svelte';
	import { escapeHtml } from '$lib/escapeHtml';
	import type { AuditLogFilters } from './+page.server';

	let { data } = $props<{ data: { filters: AuditLogFilters } }>();
	const { formatDate, formatDateTime } = useDateFormat();

	let grid: any = $state();
	let tableQuery = $state<Record<string, string>>({});
	let queryTouched = $state(false);
	const initialQuery = $derived({
		action: data.filters?.action ?? '',
		entityType: data.filters?.entityType ?? '',
		from: data.filters?.from ?? '',
		to: data.filters?.to ?? ''
	} as Record<string, string>);
	const filters = $derived([
		{ id: 'action', label: 'Action', placeholder: 'e.g. login', value: data.filters?.action ?? '' },
		{ id: 'entityType', label: 'Entity type', placeholder: 'e.g. trip', value: data.filters?.entityType ?? '' },
		{ id: 'from', label: 'From', type: 'date', value: data.filters?.from ?? '' },
		{ id: 'to', label: 'To', type: 'date', value: data.filters?.to ?? '' }
	] as GridFilter[]);

	function exportQuery(): string {
		const params = new URLSearchParams();
		const source: Record<string, string> = queryTouched ? tableQuery : initialQuery;
		for (const key of ['search', 'action', 'entityType', 'from', 'to']) {
			const value = source[key];
			if (value) params.set(key, value);
		}
		params.set('export', 'csv');
		return '?' + params.toString();
	}

	async function fetchData(opts: FetchOpts) {
		const res = await fetch(`/api/audit-logs?${buildTableQuery(opts.url)}`);
		if (!res.ok) throw new Error(`Failed to load audit logs: ${res.status}`);
		return res.json() as Promise<{ rows: Record<string, unknown>[]; total: number }>;
	}

	function handleQueryChange(e: Event) {
		queryTouched = true;
		tableQuery = (e as CustomEvent<Record<string, string>>).detail;
	}

	const columns = [
		{
			id: 'time',
			name: 'Time',
			sort: false,
			formatter: (_cell: unknown, row: Record<string, unknown>) =>
				html(
					`<span class="whitespace-nowrap" style="color: var(--theme-readable-muted)">${escapeHtml(
						formatDateTime(String(row.createdAt))
					)}</span>`
				)
		},
		{
			id: 'user',
			name: 'User',
			sort: false,
			formatter: (_cell: unknown, row: Record<string, unknown>) => {
				const u = row.user as Record<string, unknown> | undefined;
				return html(
					`<div class="font-medium" style="color: var(--theme-strong)">${escapeHtml(u?.displayName)}</div>` +
						`<div class="text-xs" style="color: var(--theme-readable-faint)">${escapeHtml(u?.email)}</div>`
				);
			}
		},
		{
			id: 'action',
			name: 'Action',
			sort: false,
			formatter: (_cell: unknown, row: Record<string, unknown>) =>
				html(`<span class="font-mono text-xs" style="color: var(--theme-readable)">${escapeHtml(row.action)}</span>`)
		}
	];

	const actions = [{ id: 'view', label: 'View' }];

	async function handleAction(e: Event) {
		const { action, row } = (e as CustomEvent<{ action: string; row: Record<string, unknown> }>).detail;
		if (action === 'view') {
			goto(`/audit-logs/${row.id}`);
		}
	}
</script>

<header class="page-header">
	<div>
		<h1 class="page-title">Audit Logs</h1>
		<p class="page-subtitle">Security-relevant events across the instance.</p>
	</div>
</header>

<section class="card mt-6 p-5 sm:p-6">
	<div class="mb-3 flex flex-wrap items-center justify-between gap-3">
		<span></span>
		<a href={exportQuery()} class="btn btn-primary">Export CSV</a>
	</div>
	<GridTable bind:this={grid} {columns} {fetchData} {filters} {actions} emptyMessage="No audit events match." onaction={handleAction} onquerychange={handleQueryChange} />
</section>
