<script lang="ts">
	import { html } from 'gridjs';
	import { goto } from '$app/navigation';
	import GridTable, { type FetchOpts } from '$lib/components/GridTable.svelte';
	import { buildTableQuery } from '$lib/tableParams';

	let grid: any = $state();
	let deleteError: string | null = $state(null);

	function escapeHtml(value: unknown): string {
		return String(value)
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#39;');
	}

	const networkLabel: Record<string, string> = {
		visa: 'Visa',
		mc: 'Mastercard',
		amex: 'Amex',
		disc: 'Discover',
		other: 'Other'
	};

	const columns = [
		{
			id: 'nickname',
			name: 'Nickname',
			sort: true,
			formatter: (_cell: unknown, row: Record<string, unknown>) => escapeHtml(row.nickname)
		},
		{
			id: 'network',
			name: 'Network',
			sort: true,
			formatter: (_cell: unknown, row: Record<string, unknown>) =>
				html(`<span class="badge badge-slate">${escapeHtml(networkLabel[String(row.network)] ?? row.network)}</span>`)
		},
		{
			id: 'last4',
			name: 'Last 4',
			sort: true,
			formatter: (_cell: unknown, row: Record<string, unknown>) =>
				row.last4 ? escapeHtml(`…${row.last4}`) : '—'
		},
		{
			id: 'benefits',
			name: 'Benefits',
			sort: false,
			formatter: (_cell: unknown, row: Record<string, unknown>) => {
				const count = Number(row.benefitCount ?? 0);
				return count === 0 ? 'No benefits' : `${count} benefit${count === 1 ? '' : 's'}`;
			}
		}
	];

	const actions = [
		{ id: 'edit', label: 'Edit' },
		{
			id: 'delete',
			label: 'Delete',
			variant: 'danger' as const,
			confirm: true,
			confirmTitle: 'Delete card',
			confirmMessage: (row: Record<string, unknown>) => `Delete ${row.nickname}? This will also remove all its benefits.`,
			confirmLabel: 'Delete'
		}
	];

	async function fetchData(opts: FetchOpts) {
		const res = await fetch(`/api/cards?${buildTableQuery(opts.url)}`);
		if (!res.ok) throw new Error(`Failed to load cards: ${res.status}`);
		return res.json() as Promise<{ rows: Record<string, unknown>[]; total: number }>;
	}

	async function handleAction(e: Event) {
		deleteError = null;
		const { action, row } = (e as CustomEvent<{ action: string; row: Record<string, unknown> }>).detail;
		if (action === 'edit') {
			goto(`/cards/${row.id}/edit`);
		} else if (action === 'delete') {
			const res = await fetch(`/api/cards/${row.id}`, { method: 'DELETE' });
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
		<h1 class="page-title">Cards</h1>
		<p class="page-subtitle">Payment cards and their travel benefits.</p>
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
		addHref="/cards/new"
		addLabel="Add card"
		emptyMessage="No cards saved yet."
		onaction={handleAction}
	/>
</section>
