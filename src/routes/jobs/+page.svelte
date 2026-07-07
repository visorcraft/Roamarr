<script lang="ts">
	import { html } from 'gridjs';
	import GridTable, { type FetchOpts } from '$lib/components/GridTable.svelte';
	import { formatDateTime } from '$lib/dateFormat';
	import { buildTableQuery } from '$lib/tableParams';

	function escapeHtml(value: unknown): string {
		return String(value)
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#39;');
	}

	function durationMs(startedAt: string, finishedAt: string | null | undefined) {
		if (!finishedAt) return '';
		const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
		if (ms < 1000) return `${ms}ms`;
		return `${(ms / 1000).toFixed(1)}s`;
	}

	const columns = [
		{
			id: 'startedAt',
			name: 'Started',
			formatter: (_cell: unknown, row: Record<string, unknown>) =>
				html(
					`<span class="whitespace-nowrap text-slate-400">${escapeHtml(
						formatDateTime(String(row.startedAt), { timeStyle: 'medium' })
					)}</span>`
				)
		},
		{
			id: 'duration',
			name: 'Duration',
			sort: false,
			formatter: (_cell: unknown, row: Record<string, unknown>) =>
				html(
					`<span class="whitespace-nowrap text-slate-400">${escapeHtml(
						durationMs(String(row.startedAt), row.finishedAt as string | null | undefined)
					)}</span>`
				)
		},
		{
			id: 'status',
			name: 'Status',
			sort: false,
			formatter: (_cell: unknown, row: Record<string, unknown>) => {
				if (row.finishedAt) {
					if (row.success) {
						return html('<span class="badge badge-green whitespace-nowrap">OK</span>');
					}
					return html('<span class="badge badge-red whitespace-nowrap">Failed</span>');
				}
				return html('<span class="badge badge-amber whitespace-nowrap">Running</span>');
			}
		},
		{
			id: 'errorMessage',
			name: 'Error',
			sort: false,
			formatter: (_cell: unknown, row: Record<string, unknown>) => {
				const message = row.errorMessage;
				if (message) {
					return html(
						`<code class="code-chip px-2 py-1 text-red-300">${escapeHtml(String(message))}</code>`
					);
				}
				return '';
			}
		}
	];

	async function fetchData(opts: FetchOpts) {
		const res = await fetch(`/api/jobs?${buildTableQuery(opts.url)}`);
		if (!res.ok) throw new Error(`Failed to load jobs: ${res.status}`);
		return res.json() as Promise<{ rows: Record<string, unknown>[]; total: number }>;
	}
</script>

<header class="page-header">
	<div>
		<h1 class="page-title">Scheduled job runs</h1>
		<p class="page-subtitle">Recent scheduler ticks for reminders, fare checks and session cleanup.</p>
	</div>
	<form method="POST" action="?/runNow">
		<button class="btn btn-primary">Run scheduler now</button>
	</form>
</header>

<section class="card mt-8 p-5 sm:p-6">
	<GridTable {columns} {fetchData} pageSize={50} emptyMessage="No scheduler runs recorded yet." />
</section>
