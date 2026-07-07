<script lang="ts">
	import { html } from 'gridjs';
	import { goto } from '$app/navigation';
	import GridTable, { type FetchOpts } from '$lib/components/GridTable.svelte';
	import { buildTableQuery } from '$lib/tableParams';
	import { escapeHtml } from '$lib/escapeHtml';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let grid: any = $state();
	let testResult: { message: string; success: boolean } | null = $state(null);

	const providerLabel = $derived(new Map(data.providers.map((p) => [p.key, p.label])));

	const columns = [
		{
			id: 'label',
			name: 'Label',
			sort: true,
			formatter: (_cell: unknown, row: Record<string, unknown>) =>
				escapeHtml(row.label || providerLabel.get(String(row.providerKey)) || row.providerKey)
		},
		{
			id: 'providerKey',
			name: 'Provider',
			sort: true,
			formatter: (_cell: unknown, row: Record<string, unknown>) =>
				html(
					`<span class="badge badge-slate">${escapeHtml(providerLabel.get(String(row.providerKey)) || row.providerKey)}</span>`
				)
		},
		{
			id: 'enabled',
			name: 'Status',
			sort: true,
			formatter: (_cell: unknown, row: Record<string, unknown>) =>
				row.enabled
					? html('<span class="badge badge-green">Enabled</span>')
					: html('<span class="badge badge-slate">Disabled</span>')
		}
	];

	const actions = [
		{ id: 'test', label: 'Test' },
		{ id: 'edit', label: 'Edit' },
		{
			id: 'delete',
			label: 'Delete',
			variant: 'danger' as const,
			confirm: true,
			confirmTitle: 'Delete provider',
			confirmMessage: (row: Record<string, unknown>) =>
				`Delete ${row.label || providerLabel.get(String(row.providerKey)) || row.providerKey}?`
		}
	];

	async function fetchData(opts: FetchOpts) {
		const res = await fetch(`/api/fare-providers?${buildTableQuery(opts.url)}`);
		if (!res.ok) throw new Error(`Failed to load providers: ${res.status}`);
		return res.json() as Promise<{ rows: Record<string, unknown>[]; total: number }>;
	}

	async function handleAction(e: Event) {
		const { action, row } = (e as CustomEvent<{ action: string; row: Record<string, unknown> }>).detail;
		if (action === 'test') {
			const res = await fetch(`/api/fare-providers/${row.id}/test`, { method: 'POST' });
			if (res.ok) {
				const body = await res.json();
				testResult = { message: body.ok ? `OK: ${body.summary}` : `Failed: ${body.summary}`, success: body.ok };
			} else {
				testResult = { message: 'Test request failed', success: false };
			}
		} else if (action === 'edit') {
			goto(`/fare-providers/${row.id}/edit`);
		} else if (action === 'delete') {
			const res = await fetch(`/api/fare-providers/${row.id}`, { method: 'DELETE' });
			if (res.ok) {
				testResult = null;
				grid?.reload();
			} else {
				testResult = { message: 'Delete failed', success: false };
			}
		}
	}
</script>

<header class="page-header">
	<div>
		<h1 class="page-title">Fare-watch providers</h1>
		<p class="page-subtitle">Connect named provider accounts to power fare watching on your trips.</p>
	</div>
</header>

<section class="card mt-8 p-5 sm:p-6">
	{#if testResult}
		<p class="notice {testResult.success ? 'notice-success' : 'notice-error'} mb-4 text-sm">
			{testResult.message}
		</p>
	{/if}
	<GridTable
		bind:this={grid}
		{columns}
		{fetchData}
		{actions}
		addHref="/fare-providers/new"
		addLabel="Add account"
		emptyMessage="No provider accounts saved yet."
		onaction={handleAction}
	/>
</section>
