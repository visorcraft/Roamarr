<script lang="ts">
	import { html } from 'gridjs';
	import { goto } from '$app/navigation';
	import GridTable, { type FetchOpts } from '$lib/components/GridTable.svelte';
	import { buildTableQuery } from '$lib/tableParams';
	import { escapeHtml } from '$lib/escapeHtml';
	import { useDateFormat } from '$lib/dateFormatContext.svelte';

	let grid: any = $state();
	let deleteError: string | null = $state(null);

	const { formatDateTime } = useDateFormat();

	function formatBalance(value: unknown): string {
		if (value == null) return '—';
		const n = Number(value);
		if (!Number.isFinite(n)) return '—';
		return n.toLocaleString();
	}

	const columns = [
		{
			id: 'programName',
			name: 'Program',
			sort: true,
			formatter: (_cell: unknown, row: Record<string, unknown>) =>
				html(
					`<div class="font-medium" style="color: var(--theme-strong)">${escapeHtml(row.programName)}</div>` +
						(row.membershipNumber
							? `<div class="text-xs font-mono" style="color: var(--theme-readable-faint)">${escapeHtml(row.membershipNumber)}</div>`
							: '')
				)
		},
		{
			id: 'balance',
			name: 'Balance',
			sort: true,
			formatter: (_cell: unknown, row: Record<string, unknown>) =>
				row.balance == null
					? html('<span style="color: var(--theme-readable-faint)">—</span>')
					: html(`<span class="font-mono text-sm" style="color: var(--theme-readable-muted)">${escapeHtml(formatBalance(row.balance))}</span>`)
		},
		{
			id: 'balanceUpdatedAt',
			name: 'Last Updated',
			sort: true,
			formatter: (_cell: unknown, row: Record<string, unknown>) =>
				row.balanceUpdatedAt
					? html(
							`<div style="color: var(--theme-readable-muted)">${escapeHtml(formatDateTime(String(row.balanceUpdatedAt)))}</div>` +
								`<div class="text-xs" style="color: var(--theme-readable-faint)">${escapeHtml(timeAgo(String(row.balanceUpdatedAt)))}</div>`
						)
					: html('<span style="color: var(--theme-readable-faint)">Never</span>')
		},
		{
			id: 'notes',
			name: 'Notes',
			sort: false,
			formatter: (_cell: unknown, row: Record<string, unknown>) =>
				row.notes
					? html(`<span class="text-sm" style="color: var(--theme-readable-muted)">${escapeHtml(row.notes)}</span>`)
					: html('<span style="color: var(--theme-readable-faint)">—</span>')
		}
	];

	function timeAgo(iso: string): string {
		const then = Date.parse(iso);
		if (!Number.isFinite(then)) return '';
		const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
		if (seconds < 60) return 'just now';
		const minutes = Math.floor(seconds / 60);
		if (minutes < 60) return `${minutes}m ago`;
		const hours = Math.floor(minutes / 60);
		if (hours < 48) return `${hours}h ago`;
		const days = Math.floor(hours / 24);
		if (days < 30) return `${days}d ago`;
		const months = Math.floor(days / 30);
		if (months < 12) return `${months}mo ago`;
		return `${Math.floor(months / 12)}y ago`;
	}

	const actions = [
		{ id: 'edit', label: 'Edit' },
		{
			id: 'delete',
			label: 'Delete',
			variant: 'danger' as const,
			confirm: true,
			confirmTitle: 'Delete program',
			confirmMessage: (row: Record<string, unknown>) =>
				`Delete ${row.programName}? This cannot be undone.`,
			confirmLabel: 'Delete'
		}
	];

	async function fetchData(opts: FetchOpts) {
		const res = await fetch(`/api/loyalty?${buildTableQuery(opts.url)}`);
		if (!res.ok) throw new Error(`Failed to load programs: ${res.status}`);
		return res.json() as Promise<{ rows: Record<string, unknown>[]; total: number }>;
	}

	async function handleAction(e: Event) {
		deleteError = null;
		const { action, row } = (e as CustomEvent<{ action: string; row: Record<string, unknown> }>).detail;
		if (action === 'edit') {
			goto(`/profile/loyalty/${row.id}/edit`);
		} else if (action === 'delete') {
			const res = await fetch(`/api/loyalty/${row.id}`, { method: 'DELETE' });
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
		<h1 class="page-title">Loyalty programs</h1>
		<p class="page-subtitle">Frequent-flyer and rewards balances. Update the balance to track when you last checked.</p>
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
		addHref="/profile/loyalty/new"
		addLabel="Add program"
		emptyMessage="No loyalty programs saved yet."
		onaction={handleAction}
	/>
</section>
