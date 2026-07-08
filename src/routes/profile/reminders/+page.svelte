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

	const { formatDateTime } = useDateFormat();

	const kindLabel: Record<string, string> = {
		flight_checkin: 'Flight check-in',
		document_expiry: 'Document expiry',
		custom: 'Custom'
	};

	const refTypeLabel: Record<string, string> = {
		trip: 'Trip',
		segment: 'Segment',
		document: 'Document'
	};

	function statusText(status: string): string {
		if (status === 'sent') return '<span style="color: var(--theme-readable)">Sent</span>';
		if (status === 'sending') return '<span style="color: var(--theme-warn, #b45309)">Sending</span>';
		return '<span style="color: var(--theme-readable-muted)">Pending</span>';
	}

	const columns = [
		{
			id: 'name',
			name: 'Reminder',
			sort: true,
			formatter: (_cell: unknown, row: Record<string, unknown>) => {
				const raw = row.name ? String(row.name) : '';
				const isDate = raw && Number.isFinite(Date.parse(raw));
				const primary = raw
					? (isDate
							? `<span class="font-mono text-sm" style="color: var(--theme-readable)">${escapeHtml(formatDateTime(raw))}</span>`
							: escapeHtml(raw))
					: '<span style="color: var(--theme-readable-faint)">(unnamed)</span>';
				const sub = row.description ? escapeHtml(String(row.description)) : '';
				return html(
					`<div class="font-medium" style="color: var(--theme-strong)">${primary}</div>` +
						(sub
							? `<div class="text-xs" style="color: var(--theme-readable-faint)">${sub}</div>`
							: '')
				);
			}
		},
		{
			id: 'refType',
			name: 'For',
			sort: true,
			formatter: (_cell: unknown, row: Record<string, unknown>) => {
				const refLabel = refTypeLabel[String(row.refType ?? '')] ?? String(row.refType ?? '');
				return html(`<span style="color: var(--theme-readable)">${escapeHtml(refLabel)}</span>`);
			}
		},
		{
			id: 'kind',
			name: 'Type',
			sort: true,
			formatter: (_cell: unknown, row: Record<string, unknown>) => {
				const kind = String(row.kind ?? '');
				return html(
					`<div style="color: var(--theme-readable)">${escapeHtml(kindLabel[kind] ?? 'Custom')}</div>`
				);
			}
		},
		{
			id: 'status',
			name: 'Status',
			sort: true,
			formatter: (_cell: unknown, row: Record<string, unknown>) =>
				html(statusText(String(row.status)))
		},
		{
			id: 'fireAt',
			name: 'When',
			sort: true,
			formatter: (_cell: unknown, row: Record<string, unknown>) =>
				html(
					`<span class="font-mono text-sm" style="color: var(--theme-readable-muted)">${escapeHtml(formatDateTime(String(row.fireAt)))}</span>`
				)
		}
	];

	const actions = [
		{ id: 'edit', label: 'Edit' },
		{
			id: 'delete',
			label: 'Delete',
			variant: 'danger' as const,
			confirm: true,
			confirmTitle: 'Delete reminder',
			confirmMessage: (row: Record<string, unknown>) =>
				`Delete ${row.name ? `"${row.name}"` : 'this reminder'}? This cannot be undone.`,
			confirmLabel: 'Delete'
		}
	];

	async function fetchData(opts: FetchOpts) {
		const res = await fetch(`/api/reminders?${buildTableQuery(opts.url)}`);
		if (!res.ok) throw new Error(`Failed to load reminders: ${res.status}`);
		return res.json() as Promise<{ rows: Record<string, unknown>[]; total: number }>;
	}

	async function handleAction(e: Event) {
		deleteError = null;
		const { action, row } = (e as CustomEvent<{ action: string; row: Record<string, unknown> }>).detail;
		if (action === 'edit') {
			goto(`/profile/reminders/${row.id}/edit`);
		} else if (action === 'delete') {
			const res = await fetch(`/api/reminders/${row.id}`, { method: 'DELETE' });
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
		<h1 class="page-title">Reminders</h1>
		<p class="page-subtitle">Scheduled alerts for trips, flights, and travel documents.</p>
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
		addHref="/profile/reminders/new"
		addLabel="Add reminder"
		emptyMessage="No reminders scheduled."
		onaction={handleAction}
	/>
</section>
