<script lang="ts">
	import { html } from 'gridjs';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import GridTable, { type FetchOpts } from '$lib/components/GridTable.svelte';
	import { buildTableQuery } from '$lib/tableParams';
	import { formatDateTime } from '$lib/dateFormat';
	import { escapeHtml } from '$lib/escapeHtml';
	import type { AuditLogFilters } from './+page.server';

	let { data } = $props<{ data: { filters: AuditLogFilters } }>();

	let grid: any = $state();
	let users: { id: number; email: string; displayName: string }[] = $state([]);
	let userId = $state('');
	let action = $state('');
	let entityType = $state('');
	let from = $state('');
	let to = $state('');

	$effect(() => {
		userId = data.filters?.userId ?? '';
		action = data.filters?.action ?? '';
		entityType = data.filters?.entityType ?? '';
		from = data.filters?.from ?? '';
		to = data.filters?.to ?? '';
	});

	$effect(() => {
		fetch('/api/users/all')
			.then((res) => (res.ok ? res.json() : { users: [] }))
			.then((body) => {
				users = body.users ?? [];
			})
			.catch(() => {
				users = [];
			});
	});

	function truncateMeta(value: unknown): string {
		const text = JSON.stringify(value);
		if (text.length <= 200) return text;
		return text.slice(0, 200) + '…';
	}

	function buildFilterParams(): URLSearchParams {
		const params = new URLSearchParams();
		if (userId) params.set('userId', userId);
		if (action) params.set('action', action);
		if (entityType) params.set('entityType', entityType);
		if (from) params.set('from', from);
		if (to) params.set('to', to);
		return params;
	}

	function exportQuery(): string {
		const params = buildFilterParams();
		params.set('export', 'csv');
		return '?' + params.toString();
	}

	async function fetchData(opts: FetchOpts) {
		const params = new URLSearchParams(buildTableQuery(opts.url));
		for (const [key, value] of buildFilterParams()) {
			params.set(key, value);
		}
		const res = await fetch(`/api/audit-logs?${params.toString()}`);
		if (!res.ok) throw new Error(`Failed to load audit logs: ${res.status}`);
		return res.json() as Promise<{ rows: Record<string, unknown>[]; total: number }>;
	}

	function applyFilters(e?: Event) {
		e?.preventDefault();
		const params = new URLSearchParams($page.url.searchParams);
		params.delete('page');
		const filters = buildFilterParams();
		for (const key of ['userId', 'action', 'entityType', 'from', 'to'] as const) {
			const value = filters.get(key);
			if (value) {
				params.set(key, value);
			} else {
				params.delete(key);
			}
		}
		goto('?' + params.toString(), { replaceState: true, keepFocus: true });
		grid?.reload();
	}

	function resetFilters() {
		userId = '';
		action = '';
		entityType = '';
		from = '';
		to = '';
		const params = new URLSearchParams($page.url.searchParams);
		params.delete('page');
		for (const key of ['userId', 'action', 'entityType', 'from', 'to'] as const) {
			params.delete(key);
		}
		goto(params.toString() ? '?' + params.toString() : '/audit-logs', { replaceState: true, keepFocus: true });
		grid?.reload();
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
	<form class="flex flex-wrap items-end gap-3" onsubmit={applyFilters}>
		<label class="field min-w-[10rem]">
			<span class="label">User</span>
			<select bind:value={userId} class="input">
				<option value="">All users</option>
				{#each users as u (u.id)}
					<option value={u.id}>{u.displayName} ({u.email})</option>
				{/each}
			</select>
		</label>
		<label class="field min-w-[8rem]">
			<span class="label">Action</span>
			<input type="text" bind:value={action} placeholder="e.g. login" class="input" />
		</label>
		<label class="field min-w-[8rem]">
			<span class="label">Entity type</span>
			<input type="text" bind:value={entityType} placeholder="e.g. trip" class="input" />
		</label>
		<label class="field min-w-[8rem]">
			<span class="label">From</span>
			<input type="date" bind:value={from} class="input" />
		</label>
		<label class="field min-w-[8rem]">
			<span class="label">To</span>
			<input type="date" bind:value={to} class="input" />
		</label>
		<button type="submit" class="btn btn-primary">Filter</button>
		<button type="button" class="btn btn-ghost" onclick={resetFilters}>Reset</button>
	</form>
</section>

<section class="card mt-6 p-5 sm:p-6">
	<div class="mb-3 flex flex-wrap items-center justify-between gap-3">
		<span></span>
		<a href={exportQuery()} class="btn btn-sm btn-ghost">Export CSV</a>
	</div>
	<GridTable bind:this={grid} {columns} {fetchData} pageSize={50} emptyMessage="No audit events match." />
</section>
