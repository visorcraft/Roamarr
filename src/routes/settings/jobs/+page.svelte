<script lang="ts">
	let { data } = $props();

	function fmt(iso: string | null | undefined) {
		if (!iso) return '';
		try {
			return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'medium' }).format(
				new Date(iso)
			);
		} catch {
			return iso;
		}
	}

	function durationMs(startedAt: string, finishedAt: string | null | undefined) {
		if (!finishedAt) return '';
		const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
		if (ms < 1000) return `${ms}ms`;
		return `${(ms / 1000).toFixed(1)}s`;
	}
</script>

<header class="flex flex-wrap items-end justify-between gap-4">
	<div>
		<h1 class="text-3xl font-extrabold text-white">Scheduled job runs</h1>
		<p class="mt-1 text-sm text-muted">Recent scheduler ticks for reminders, fare checks and session cleanup.</p>
	</div>
	<a href="/settings" class="btn btn-ghost btn-sm">← Back to settings</a>
</header>

{#if data.runs.length}
	<section class="card mt-8 overflow-hidden p-0">
		<table class="table">
			<thead>
				<tr>
					<th>Started</th>
					<th>Duration</th>
					<th>Status</th>
					<th>Error</th>
				</tr>
			</thead>
			<tbody>
				{#each data.runs as run (run.id)}
					<tr>
						<td class="font-mono text-xs">{fmt(run.startedAt)}</td>
						<td class="font-mono text-xs">{durationMs(run.startedAt, run.finishedAt)}</td>
						<td>
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
						<td class="max-w-xs truncate text-xs text-red-300">{run.errorMessage ?? ''}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</section>
{:else}
	<div class="card mt-6 grid place-items-center gap-3 p-12 text-center">
		<div
			class="grid h-12 w-12 place-items-center rounded-full bg-indigo-500/10 text-indigo-300 ring-1 ring-indigo-400/20"
		>
			<svg
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				class="h-6 w-6"
			>
				<path d="M12 8v4l3 3" />
				<circle cx="12" cy="12" r="10" />
			</svg>
		</div>
		<p class="text-slate-300">No scheduler runs recorded yet.</p>
		<p class="text-xs text-slate-500">The scheduler records a row every 60 seconds once the app is running.</p>
	</div>
{/if}
