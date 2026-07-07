<script lang="ts">
	import { goto } from '$app/navigation';
	import GridTable, { type FetchOpts } from '$lib/components/GridTable.svelte';
	import { buildTableQuery } from '$lib/tableParams';
	import { formatDate } from '$lib/dateFormat';

	let grid: any = $state();
	let deleteError: string | null = $state(null);

	const columns = [
		{
			id: 'name',
			name: 'Name',
			sort: true,
			formatter: (_cell: unknown, row: Record<string, unknown>) => String(row.name ?? '')
		},
		{
			id: 'members',
			name: 'Members',
			sort: false,
			formatter: (_cell: unknown, row: Record<string, unknown>) => {
				const count = Number(row.memberCount ?? 0);
				return `${count} member${count === 1 ? '' : 's'}`;
			}
		},
		{
			id: 'createdAt',
			name: 'Created',
			sort: true,
			formatter: (_cell: unknown, row: Record<string, unknown>) => formatDate(String(row.createdAt))
		}
	];

	const actions = [
		{ id: 'edit', label: 'Edit' },
		{
			id: 'delete',
			label: 'Delete',
			variant: 'danger' as const,
			confirm: true,
			confirmTitle: 'Delete group',
			confirmMessage: (row: Record<string, unknown>) => `Delete ${row.name}? This cannot be undone.`,
			confirmLabel: 'Delete'
		}
	];

	async function fetchData(opts: FetchOpts) {
		const res = await fetch(`/api/groups?${buildTableQuery(opts.url)}`);
		if (!res.ok) throw new Error(`Failed to load groups: ${res.status}`);
		return res.json() as Promise<{ rows: Record<string, unknown>[]; total: number }>;
	}

	async function handleAction(e: Event) {
		deleteError = null;
		const { action, row } = (e as CustomEvent<{ action: string; row: Record<string, unknown> }>).detail;
		if (action === 'edit') {
			goto(`/groups/${row.id}/edit`);
		} else if (action === 'delete') {
			const res = await fetch(`/api/groups/${row.id}`, { method: 'DELETE' });
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
		<h1 class="page-title">Groups</h1>
		<p class="page-subtitle">Share trips with friends, family, or coworkers.</p>
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
		addHref="/groups/new"
		addLabel="Create group"
		emptyMessage="No groups found."
		onaction={handleAction}
	/>
</section>
