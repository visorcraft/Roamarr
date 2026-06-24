<script lang="ts">
	let { data } = $props();

	const kindLabel: Record<string, string> = {
		flight_checkin: 'Flight check-in',
		document_expiry: 'Document expiry',
		custom: 'Custom'
	};

	function fmt(iso: string | null | undefined) {
		if (!iso) return '';
		try {
			return new Intl.DateTimeFormat('en-US', {
				dateStyle: 'medium',
				timeStyle: 'short'
			}).format(new Date(iso));
		} catch {
			return iso;
		}
	}
</script>

<header class="flex flex-wrap items-end justify-between gap-4">
	<div>
		<h1 class="text-3xl font-extrabold text-white">Reminders</h1>
		<p class="mt-1 text-sm text-muted">Scheduled alerts for trips and documents.</p>
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
					<p class="mt-1 font-mono text-xs text-slate-400">{fmt(r.fireAt)}</p>
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
	<div class="card mt-6 grid place-items-center gap-3 p-12 text-center">
		<p class="text-slate-300">No reminders scheduled.</p>
	</div>
{/if}
