<script lang="ts">
	import { html } from 'gridjs';
	import GridTable, { type FetchOpts, type GridFilter } from '$lib/components/GridTable.svelte';
	import { useDateFormat } from '$lib/dateFormatContext.svelte';
	import { buildTableQuery } from '$lib/tableParams';
	import { escapeHtml } from '$lib/escapeHtml';

	const { formatDateTime } = useDateFormat();

	function durationMs(startedAt: string, finishedAt: string | null | undefined) {
		if (!finishedAt) return '';
		const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
		if (ms < 1000) return `${ms}ms`;
		return `${(ms / 1000).toFixed(1)}s`;
	}

	function formatSummary(summary: unknown): string {
		if (!summary || typeof summary !== 'object') return '—';
		const s = summary as {
			reminders?: { processed: number; sent: number };
			fareChecks?: { checked: number };
			weatherCache?: { refreshed: number };
			purges?: { sessions: number; challenges: number; oauth: { codes: number; tokens: number } };
		};
		const parts: string[] = [];
		if (s.reminders) {
			parts.push(`Reminders ${s.reminders.processed}/${s.reminders.sent}`);
		}
		if (s.fareChecks?.checked) {
			parts.push(`Fare checks ${s.fareChecks.checked}`);
		}
		if (s.weatherCache?.refreshed) {
			parts.push(`Weather ${s.weatherCache.refreshed}`);
		}
		if (s.purges) {
			const { sessions, challenges, oauth } = s.purges;
			const purgeParts: string[] = [];
			if (sessions) purgeParts.push(`${sessions} sessions`);
			if (challenges) purgeParts.push(`${challenges} challenges`);
			if (oauth?.codes || oauth?.tokens) {
				purgeParts.push(`${oauth.codes + oauth.tokens} OAuth`);
			}
			if (purgeParts.length) parts.push(`Purged ${purgeParts.join(', ')}`);
		}
		return parts.length ? parts.join(' · ') : '—';
	}

	const dateFilters: GridFilter[] = [
		{ id: 'from', label: 'From', type: 'date' },
		{ id: 'to', label: 'To', type: 'date' }
	];

	const columns = [
		{
			id: 'startedAt',
			name: 'Started',
			sort: true,
			formatter: (_cell: unknown, row: Record<string, unknown>) =>
				html(
					`<span class="whitespace-nowrap" style="color: var(--theme-readable-muted)">${escapeHtml(
						formatDateTime(String(row.startedAt), { timeStyle: 'medium' })
					)}</span>`
				)
		},
		{
			id: 'summary',
			name: 'Summary',
			sort: false,
			formatter: (_cell: unknown, row: Record<string, unknown>) =>
				html(
					`<span style="color: var(--theme-readable-muted)">${escapeHtml(
						formatSummary(row.summary)
					)}</span>`
				)
		},
		{
			id: 'duration',
			name: 'Duration',
			sort: false,
			formatter: (_cell: unknown, row: Record<string, unknown>) =>
				html(
					`<span class="whitespace-nowrap" style="color: var(--theme-readable-muted)">${escapeHtml(
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
						return html('<span class="whitespace-nowrap" style="color: var(--theme-success, #15803d)">OK</span>');
					}
					return html('<span class="whitespace-nowrap" style="color: var(--theme-danger, #b91c1c)">Failed</span>');
				}
				return html('<span class="whitespace-nowrap" style="color: var(--theme-warn, #b45309)">Running</span>');
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
						`<code class="code-chip px-2 py-1" style="color: var(--theme-danger-text)">${escapeHtml(String(message))}</code>`
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
	<GridTable {columns} {fetchData} filters={dateFilters} emptyMessage="No scheduler runs recorded yet." />
</section>
