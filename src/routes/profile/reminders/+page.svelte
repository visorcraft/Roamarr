<script lang="ts">
	import { html } from 'gridjs';
	import { goto } from '$app/navigation';
	import GridTable, { type FetchOpts, type GridFilter } from '$lib/components/GridTable.svelte';
	import { buildTableQuery } from '$lib/tableParams';
	import { formatDateTime } from '$lib/dateFormat';
	import { escapeHtml } from '$lib/escapeHtml';

	let grid: any = $state();
	let deleteError: string | null = $state(null);
	const dateFilters: GridFilter[] = [
		{ id: 'from', label: 'From', type: 'date' },
		{ id: 'to', label: 'To', type: 'date' }
	];

	const kindBadge: Record<string, string> = {
		flight_checkin: '<span class="badge badge-brand">Flight check-in</span>',
		document_expiry: '<span class="badge badge-amber">Document expiry</span>',
		custom: '<span class="badge badge-slate">Custom</span>'
	};

	const refTypeLabel: Record<string, string> = {
		trip: 'Trip',
		segment: 'Segment',
		document: 'Document'
	};

	function statusBadge(status: string, sentAt: string | null): string {
		if (status === 'sent') {
			const stamp = sentAt ? ` · ${escapeHtml(formatDateTime(sentAt))}` : '';
			return `<span class="badge badge-green">Sent${stamp}</span>`;
		}
		if (status === 'sending') return '<span class="badge badge-amber">Sending</span>';
		return '<span class="badge badge-slate">Pending</span>';
	}

	const columns = [
		{
			id: 'name',
			name: 'Reminder',
			sort: true,
			formatter: (_cell: unknown, row: Record<string, unknown>) => {
				const name = row.name
					? `<div class="font-medium" style="color: var(--theme-strong)">${escapeHtml(row.name)}</div>`
					: '<div class="font-medium" style="color: var(--theme-readable-muted)">(unnamed)</div>';
				const desc = row.description
					? `<div class="text-xs" style="color: var(--theme-readable-muted)">${escapeHtml(row.description)}</div>`
					: '';
				return html(name + desc);
			}
		},
		{
			id: 'kind',
			name: 'Type',
			sort: true,
			formatter: (_cell: unknown, row: Record<string, unknown>) => {
				const kind = String(row.kind ?? '');
				const refLabel = refTypeLabel[String(row.refType ?? '')] ?? String(row.refType ?? '');
				return html(
					(kindBadge[kind] ?? `<span class="badge badge-slate">${escapeHtml(kind)}</span>`) +
						`<div class="text-xs mt-0.5" style="color: var(--theme-readable-faint)">${escapeHtml(refLabel)}</div>`
				);
			}
		},
		{
			id: 'fireAt',
			name: 'When',
			sort: true,
			formatter: (_cell: unknown, row: Record<string, unknown>) =>
				html(
					`<span class="font-mono text-sm" style="color: var(--theme-readable-muted)">${escapeHtml(formatDateTime(String(row.fireAt)))}</span>`
				)
		},
		{
			id: 'status',
			name: 'Status',
			sort: true,
			formatter: (_cell: unknown, row: Record<string, unknown>) =>
				html(statusBadge(String(row.status), (row.sentAt as string | null) ?? null))
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
