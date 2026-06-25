<script lang="ts">
	import { formatDateTime } from '$lib/dateFormat';

	let { data } = $props();

	function durationMs(startedAt: string, finishedAt: string | null | undefined) {
		if (!finishedAt) return '';
		const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
		if (ms < 1000) return `${ms}ms`;
		return `${(ms / 1000).toFixed(1)}s`;
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
	<div class="overflow-x-auto">
		<table class="table">
			<thead>
				<tr>
					<th>Started</th>
					<th>Duration</th>
					<th>Status</th>
					<th class="w-full">Error</th>
				</tr>
			</thead>
			<tbody>
				{#each data.runs as run (run.id)}
					<tr>
						<td class="whitespace-nowrap text-slate-400">{formatDateTime(run.startedAt, { timeStyle: 'medium' })}</td>
						<td class="whitespace-nowrap text-slate-400">{durationMs(run.startedAt, run.finishedAt)}</td>
						<td class="whitespace-nowrap">
							{#if run.finishedAt}
								{#if run.success}
									<span class="badge badge-green">OK</span>
								{:else}
									<span class="badge badge-red">Failed</span>
								{/if}
							{:else}
								<span class="badge badge-amber">Running</span>
							{/if}
						</td>
						<td>
							{#if run.errorMessage}
								<code class="code-chip px-2 py-1 text-red-300">{run.errorMessage}</code>
							{/if}
						</td>
					</tr>
				{:else}
					<tr>
						<td colspan="4" class="py-8 text-center text-slate-500">No scheduler runs recorded yet.</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</section>
