<script lang="ts">
	import { html } from 'gridjs';
	import GridTable, { type FetchOpts, type GridFilter } from '$lib/components/GridTable.svelte';
	import { buildTableQuery } from '$lib/tableParams';
	import { formatDateTime } from '$lib/dateFormat';
	import { escapeHtml } from '$lib/escapeHtml';
	import type { AuditLogFilters } from './+page.server';

	let { data } = $props<{ data: { filters: AuditLogFilters } }>();

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

	function truncateMeta(value: unknown): string {
		const text = JSON.stringify(value);
		if (text.length <= 200) return text;
		return text.slice(0, 200) + '…';
	}

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
						formatDateTime(String(row.createdAt), { dateStyle: 'short', timeStyle: 'medium' })
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
				html(`<span class="badge badge-slate">${escapeHtml(row.action)}</span>`)
		},
		{
			id: 'entity',
			name: 'Entity',
			sort: false,
			formatter: (_cell: unknown, row: Record<string, unknown>) =>
				html(
					`<span class="whitespace-nowrap" style="color: var(--theme-readable-muted)">${escapeHtml(row.entityType)}:${escapeHtml(
						row.entityId
					)}</span>`
				)
		},
		{
			id: 'details',
			name: 'Details',
			sort: false,
			formatter: (_cell: unknown, row: Record<string, unknown>) =>
				html(`<code class="code-chip px-2 py-1">${escapeHtml(truncateMeta(row.meta))}</code>`)
		}
	];
</script>

<header class="page-header">
	<div>
		<h1 class="page-title">Audit log</h1>
		<p class="page-subtitle">Security-relevant events across the instance.</p>
	</div>
</header>

<section class="card mt-6 p-5 sm:p-6">
	<div class="mb-3 flex flex-wrap items-center justify-between gap-3">
		<span></span>
		<a href={exportQuery()} class="btn btn-primary">Export CSV</a>
	</div>
	<GridTable bind:this={grid} {columns} {fetchData} {filters} emptyMessage="No audit events match." onquerychange={handleQueryChange} />
</section>
