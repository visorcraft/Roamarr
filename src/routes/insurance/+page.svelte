<script lang="ts">
	import { html } from 'gridjs';
	import { goto } from '$app/navigation';
	import GridTable, { type FetchOpts, type GridFilter } from '$lib/components/GridTable.svelte';
	import { buildTableQuery } from '$lib/tableParams';
	import { escapeHtml } from '$lib/escapeHtml';
	import { useDateFormat } from '$lib/dateFormatContext.svelte';

	let grid: any = $state();
	let deleteError: string | null = $state(null);
	const dateFilters: GridFilter[] = [
		{ id: 'from', label: 'From', type: 'date' },
		{ id: 'to', label: 'To', type: 'date' }
	];

	const { formatDate } = useDateFormat();

	const columns = [
		{
			id: 'provider',
			name: 'Provider',
			sort: true,
			formatter: (_cell: unknown, row: Record<string, unknown>) =>
				html(
					`<div class="font-medium" style="color: var(--theme-strong)">${escapeHtml(row.provider)}</div>` +
						(row.policyNumber
							? `<div class="text-xs" style="color: var(--theme-readable-faint)">${escapeHtml(row.policyNumber)}</div>`
							: '')
				)
		},
		{
			id: 'coverage',
			name: 'Coverage',
			sort: false,
			formatter: (_cell: unknown, row: Record<string, unknown>) => {
				const parts: string[] = [];
				if (row.coverageAmount != null) {
					parts.push(
						`<span class="font-mono text-sm">${escapeHtml(row.coverageAmount)} ${escapeHtml(row.currency)}</span>`
					);
				}
				if (row.coverageSummary) {
					parts.push(
						`<div class="text-xs" style="color: var(--theme-readable-muted)">${escapeHtml(row.coverageSummary)}</div>`
					);
				}
				return html(parts.length ? parts.join('') : '<span style="color: var(--theme-readable-faint)">—</span>');
			}
		},
		{
			id: 'tripName',
			name: 'Trip',
			sort: false,
			formatter: (_cell: unknown, row: Record<string, unknown>) =>
				row.tripName
					? html(`<span style="color: var(--theme-readable)">${escapeHtml(String(row.tripName))}</span>`)
					: html('<span style="color: var(--theme-readable-faint)">—</span>')
		},
		{
			id: 'startDate',
			name: 'Start',
			sort: true,
			formatter: (_cell: unknown, row: Record<string, unknown>) =>
				row.startDate
					? html(`<span style="color: var(--theme-readable-muted)">${escapeHtml(formatDate(String(row.startDate)))}</span>`)
					: html('<span style="color: var(--theme-readable-faint)">—</span>')
		},
		{
			id: 'endDate',
			name: 'End',
			sort: true,
			formatter: (_cell: unknown, row: Record<string, unknown>) =>
				row.endDate
					? html(`<span style="color: var(--theme-readable-muted)">${escapeHtml(formatDate(String(row.endDate)))}</span>`)
					: html('<span style="color: var(--theme-readable-faint)">—</span>')
		}
	];

	const actions = [
		{ id: 'edit', label: 'Edit' },
		{
			id: 'delete',
			label: 'Delete',
			variant: 'danger' as const,
			confirm: true,
			confirmTitle: 'Delete policy',
			confirmMessage: (row: Record<string, unknown>) =>
				`Delete ${row.provider}? This cannot be undone.`,
			confirmLabel: 'Delete'
		}
	];

	async function fetchData(opts: FetchOpts) {
		const res = await fetch(`/api/insurance?${buildTableQuery(opts.url)}`);
		if (!res.ok) throw new Error(`Failed to load policies: ${res.status}`);
		return res.json() as Promise<{ rows: Record<string, unknown>[]; total: number }>;
	}

	async function handleAction(e: Event) {
		deleteError = null;
		const { action, row } = (e as CustomEvent<{ action: string; row: Record<string, unknown> }>).detail;
		if (action === 'edit') {
			goto(`/insurance/${row.id}/edit`);
		} else if (action === 'delete') {
			const res = await fetch(`/api/insurance/${row.id}`, { method: 'DELETE' });
			if (res.ok) {
				grid?.reload();
			} else {
				const body = await res.json().catch(() => ({ error: 'Delete failed.' }));
				deleteError = body.error ?? 'Delete failed.';
			}
		}
	}
</script>

<header class="page-header">
	<div>
		<h1 class="page-title">Insurance policies</h1>
		<p class="page-subtitle">Travel insurance providers, coverage, and linked trips.</p>
	</div>
</header>

<section class="card mt-8 p-5 sm:p-6">
	{#if deleteError}
		<div class="notice notice-error mb-4">
			{deleteError}
		</div>
	{/if}
	<GridTable
		bind:this={grid}
		{columns}
		{fetchData}
		{actions}
		filters={dateFilters}
		addHref="/insurance/new"
		addLabel="Add policy"
		emptyMessage="No insurance policies saved yet."
		onaction={handleAction}
	/>
</section>
