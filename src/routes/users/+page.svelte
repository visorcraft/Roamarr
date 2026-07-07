<script lang="ts">
	import { html } from 'gridjs';
	import { goto } from '$app/navigation';
	import GridTable, { type FetchOpts } from '$lib/components/GridTable.svelte';
	import { buildTableQuery } from '$lib/tableParams';
	import { formatDateTime } from '$lib/dateFormat';

	let { form }: { form: { error?: string; success?: boolean; email?: string; generatedPassword?: string } | null } = $props();
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

	const columns = [
		{
			id: 'displayName',
			name: 'User',
			sort: true,
			formatter: (_cell: unknown, row: Record<string, unknown>) =>
				html(
					`<div class="font-medium text-white">${escapeHtml(row.displayName)}</div>` +
						`<div class="text-xs text-slate-500">${escapeHtml(row.email)}</div>`
				)
		},
		{
			id: 'role',
			name: 'Role',
			sort: true,
			formatter: (_cell: unknown, row: Record<string, unknown>) =>
				row.role === 'admin'
					? html('<span class="badge badge-brand">Admin</span>')
					: html('<span class="badge badge-slate">User</span>')
		},
		{
			id: 'status',
			name: 'Status',
			sort: false,
			formatter: (_cell: unknown, row: Record<string, unknown>) => {
				const badges: string[] = [];
				if (row.disabled) {
					badges.push('<span class="badge badge-red">Disabled</span>');
				} else {
					badges.push('<span class="badge badge-green">Active</span>');
				}
				if (row.mustResetPassword) {
					badges.push('<span class="badge badge-amber">Password reset required</span>');
				}
				if (row.twoFactorEnabled) {
					badges.push('<span class="badge badge-brand">2FA enabled</span>');
				}
				return html(badges.join(' '));
			}
		},
		{
			id: 'createdAt',
			name: 'Joined',
			sort: true,
			formatter: (_cell: unknown, row: Record<string, unknown>) =>
				html(`<span class="text-slate-400">${escapeHtml(formatDateTime(String(row.createdAt)))}</span>`)
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
		addHref="/users/new"
		addLabel="Create user"
		emptyMessage="No users found."
		onaction={handleAction}
	/>
</section>
