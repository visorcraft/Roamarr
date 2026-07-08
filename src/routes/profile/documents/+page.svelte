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

	const typeLabel: Record<string, string> = {
		passport: 'Passport',
		drivers_license: 'Driver\u2019s license',
		global_entry: 'Global Entry',
		visa: 'Visa'
	};

	const EXPIRY_WARN_DAYS = 30;

	function expiryTone(expiresOn: string | null): 'danger' | 'warn' | null {
		if (!expiresOn) return null;
		const days = Math.floor((Date.parse(expiresOn + 'T12:00:00Z') - Date.now()) / 86_400_000);
		if (!Number.isFinite(days)) return null;
		if (days < 0) return 'danger';
		if (days <= EXPIRY_WARN_DAYS) return 'warn';
		return null;
	}

	function expiryText(expiresOn: string | null): string {
		if (!expiresOn) return '<span style="color: var(--theme-readable-faint)">—</span>';
		const tone = expiryTone(expiresOn);
		const label = escapeHtml(formatDate(expiresOn));
		const days = Math.floor((Date.parse(expiresOn + 'T12:00:00Z') - Date.now()) / 86_400_000);
		let suffix = '';
		if (Number.isFinite(days)) {
			if (days < 0) suffix = ' · expired';
			else if (days <= EXPIRY_WARN_DAYS) suffix = ` · ${days}d`;
		}
		const color =
			tone === 'danger'
				? 'var(--theme-danger, #b91c1c)'
				: tone === 'warn'
					? 'var(--theme-warn, #b45309)'
					: 'var(--theme-readable-muted)';
		return `<span style="color: ${color}">${label}${escapeHtml(suffix)}</span>`;
	}

	const columns = [
		{
			id: 'type',
			name: 'Type',
			sort: true,
			formatter: (_cell: unknown, row: Record<string, unknown>) =>
				html(
					`<span style="color: var(--theme-readable)">${escapeHtml(typeLabel[String(row.type)] ?? String(row.type))}</span>`
				)
		},
		{
			id: 'number',
			name: 'Number',
			sort: false,
			formatter: (_cell: unknown, row: Record<string, unknown>) =>
				row.number
					? html(`<span class="font-mono text-sm" style="color: var(--theme-readable-muted)">${escapeHtml(row.number)}</span>`)
					: html('<span style="color: var(--theme-readable-faint)">—</span>')
		},
		{
			id: 'issuingAuthority',
			name: 'Issuing authority',
			sort: true,
			formatter: (_cell: unknown, row: Record<string, unknown>) =>
				row.issuingAuthority
					? html(`<span style="color: var(--theme-readable-muted)">${escapeHtml(row.issuingAuthority)}</span>`)
					: html('<span style="color: var(--theme-readable-faint)">—</span>')
		},
		{
			id: 'companionName',
			name: 'Owner',
			sort: false,
			formatter: (_cell: unknown, row: Record<string, unknown>) =>
				row.companionName
					? html(`<span style="color: var(--theme-readable-muted)">${escapeHtml(row.companionName)}</span>`)
					: html('<span style="color: var(--theme-readable-faint)">Me</span>')
		},
		{
			id: 'expiresOn',
			name: 'Expires',
			sort: true,
			formatter: (_cell: unknown, row: Record<string, unknown>) => html(expiryText((row.expiresOn as string | null) ?? null))
		}
	];

	const actions = [
		{ id: 'edit', label: 'Edit' },
		{
			id: 'delete',
			label: 'Delete',
			variant: 'danger' as const,
			confirm: true,
			confirmTitle: 'Delete document',
			confirmMessage: (row: Record<string, unknown>) =>
				`Delete this ${row.type}? This cannot be undone.`,
			confirmLabel: 'Delete'
		}
	];

	async function fetchData(opts: FetchOpts) {
		const res = await fetch(`/api/travel-documents?${buildTableQuery(opts.url)}`);
		if (!res.ok) throw new Error(`Failed to load documents: ${res.status}`);
		return res.json() as Promise<{ rows: Record<string, unknown>[]; total: number }>;
	}

	async function handleAction(e: Event) {
		deleteError = null;
		const { action, row } = (e as CustomEvent<{ action: string; row: Record<string, unknown> }>).detail;
		if (action === 'edit') {
			goto(`/profile/documents/${row.id}/edit`);
		} else if (action === 'delete') {
			const res = await fetch(`/api/travel-documents/${row.id}`, { method: 'DELETE' });
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
		<h1 class="page-title">Travel documents</h1>
		<p class="page-subtitle">Passports, licenses, visas, and trusted-traveler cards. Expiry highlighted when within 30 days.</p>
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
		addHref="/profile/documents/new"
		addLabel="Add document"
		emptyMessage="No travel documents saved yet."
		onaction={handleAction}
	/>
</section>
