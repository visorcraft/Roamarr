<script lang="ts">
	import EmptyState from '$lib/components/EmptyState.svelte';
	import { formatDateTime } from '$lib/dateFormat';

	let { data } = $props();

	const kindLabel: Record<string, string> = {
		flight_checkin: 'Flight check-in',
		document_expiry: 'Document expiry',
		custom: 'Custom'
	};
</script>

<header class="page-header">
	<div>
		<h1 class="page-title">Reminders</h1>
		<p class="page-subtitle">Scheduled alerts for trips and documents.</p>
	</div>
</header>

{#if data.reminders.length}
	<ul class="mt-6 space-y-3">
		{#each data.reminders as r (r.id)}
			<li class="card flex flex-wrap items-center justify-between gap-3 p-4">
				<div class="min-w-0">
					<div class="flex flex-wrap items-center gap-2">
						<span class="badge badge-slate">{kindLabel[r.kind] ?? r.kind}</span>
						<span class="badge {r.status === 'pending' ? 'badge-brand' : 'badge-slate'}">{r.status}</span>
					</div>
					<p class="mt-1 font-mono text-xs text-slate-400">{formatDateTime(r.fireAt)}</p>
				</div>
				{#if r.status === 'pending'}
					<form method="POST" action="?/cancel">
						<input type="hidden" name="id" value={r.id} />
						<button class="btn btn-ghost btn-ghost-danger">Cancel</button>
					</form>
				{/if}
			</li>
		{/each}
	</ul>
{:else}
	<EmptyState message="No reminders scheduled." />
{/if}
