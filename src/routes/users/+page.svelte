<script lang="ts">
	import { html } from 'gridjs';
	import { goto } from '$app/navigation';
	import GridTable, { type FetchOpts, type GridFilter } from '$lib/components/GridTable.svelte';
	import { buildTableQuery } from '$lib/tableParams';
	import { escapeHtml } from '$lib/escapeHtml';
	import { useDateFormat } from '$lib/dateFormatContext.svelte';

	let { form }: { form: { error?: string; success?: boolean; email?: string; generatedPassword?: string } | null } = $props();
	let grid: any = $state();
	let deleteError: string | null = $state(null);
	const dateFilters: GridFilter[] = [
		{ id: 'from', label: 'From', type: 'date' },
		{ id: 'to', label: 'To', type: 'date' }
	];

	const { formatDateTime } = useDateFormat();

	const columns = [
		{
			id: 'displayName',
			name: 'User',
			sort: true,
			formatter: (_cell: unknown, row: Record<string, unknown>) =>
				html(
					`<div class="font-medium" style="color: var(--theme-strong)">${escapeHtml(row.displayName)}</div>` +
						`<div class="text-xs" style="color: var(--theme-readable-faint)">${escapeHtml(row.email)}</div>`
				)
		},
		{
			id: 'role',
			name: 'Role',
			sort: true,
			formatter: (_cell: unknown, row: Record<string, unknown>) =>
				row.role === 'admin'
					? html('<span style="color: var(--theme-readable)">Admin</span>')
					: html('<span style="color: var(--theme-readable-muted)">User</span>')
		},
		{
			id: 'status',
			name: 'Status',
			sort: false,
			formatter: (_cell: unknown, row: Record<string, unknown>) => {
				const parts: string[] = [];
				if (row.disabled) {
					parts.push('<span style="color: var(--theme-danger, #b91c1c)">Disabled</span>');
				} else {
					parts.push('<span style="color: var(--theme-readable)">Active</span>');
				}
				if (row.mustResetPassword) {
					parts.push('<span style="color: var(--theme-warn, #b45309)">Password reset required</span>');
				}
				if (row.twoFactorEnabled) {
					parts.push('<span style="color: var(--theme-readable)">2FA enabled</span>');
				}
				return html(parts.join(', '));
			}
		},
		{
			id: 'createdAt',
			name: 'Joined',
			sort: true,
			formatter: (_cell: unknown, row: Record<string, unknown>) =>
				html(`<span style="color: var(--theme-readable-muted)">${escapeHtml(formatDateTime(String(row.createdAt)))}</span>`)
		}
	];

	const actions = [
		{ id: 'edit', label: 'Edit' },
		{
			id: 'delete',
			label: 'Delete',
			variant: 'danger' as const,
			confirm: true,
			confirmTitle: 'Delete user',
			confirmMessage: (row: Record<string, unknown>) =>
				`Delete ${row.displayName} (${row.email})? This cannot be undone.`
		}
	];

	async function fetchData(opts: FetchOpts) {
		const res = await fetch(`/api/users?${buildTableQuery(opts.url)}`);
		if (!res.ok) throw new Error(`Failed to load users: ${res.status}`);
		return res.json() as Promise<{ rows: Record<string, unknown>[]; total: number }>;
	}

	async function handleAction(e: Event) {
		deleteError = null;
		const { action, row } = (e as CustomEvent<{ action: string; row: Record<string, unknown> }>).detail;
		if (action === 'edit') {
			goto(`/users/${row.id}/edit`);
		} else if (action === 'delete') {
			const res = await fetch(`/api/users/${row.id}`, { method: 'DELETE' });
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
		<h1 class="page-title">Users</h1>
		<p class="page-subtitle">Manage accounts, roles, and access.</p>
	</div>
</header>

<section class="card mt-8 p-5 sm:p-6">
	{#if form?.error}
		<div class="notice notice-error mb-4">
			{form.error}
		</div>
	{/if}

	{#if form?.success && form?.generatedPassword}
		<div class="notice notice-success mb-4">
			<p>Created account for <strong>{form.email}</strong>.</p>
			<p class="mt-1">
				Temporary password: <code class="code-chip">{form.generatedPassword}</code>
			</p>
			<p class="field-help mt-1">The user must change this password on first sign-in.</p>
		</div>
	{/if}

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
		addHref="/users/new"
		addLabel="Create user"
		emptyMessage="No users found."
		onaction={handleAction}
	/>
</section>
