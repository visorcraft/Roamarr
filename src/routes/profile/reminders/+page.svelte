<script lang="ts">
	import CancelButton from '$lib/components/CancelButton.svelte';
	import ConfirmButton from '$lib/components/ConfirmButton.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import { formatDateTime } from '$lib/dateFormat';
	import { toDatetimeLocal } from '$lib/segments/datetimeLocal';

	let { data } = $props();
	let editingId = $state<number | null>(null);
	let dirtyIds = $state<Record<number, boolean>>({});

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
			<li class="card p-4">
				{#if editingId === r.id}
					<form method="POST" action="?/update" class="min-w-0" oninput={() => (dirtyIds[r.id] = true)}>
						<input type="hidden" name="id" value={r.id} />
						<div class="field">
							<label class="label" for={`fireAt-${r.id}`}>Fire at</label>
							<input
								id={`fireAt-${r.id}`}
								name="fireAt"
								type="datetime-local"
								value={toDatetimeLocal(r.fireAt, data.timezone)}
								class="input"
								required
							/>
						</div>
						<div class="mt-3 flex gap-2">
							<CancelButton dirty={dirtyIds[r.id] ?? false} onConfirm={() => (editingId = null)}>Cancel</CancelButton>
							<button class="btn btn-primary">Update</button>
						</div>
					</form>
				{:else}
					<div class="flex flex-wrap items-start justify-between gap-3">
						<div class="min-w-0">
							<div class="flex flex-wrap items-center gap-2">
								<span class="badge badge-slate">{kindLabel[r.kind] ?? r.kind}</span>
								<span class="badge {r.status === 'pending' ? 'badge-brand' : 'badge-slate'}">{r.status}</span>
							</div>
							<p class="mt-1 font-mono text-sm text-muted">{formatDateTime(r.fireAt)}</p>
						</div>
						<div class="action-row gap-1">
							<button
								type="button"
								class="btn btn-primary"
								onclick={() => { editingId = r.id; dirtyIds[r.id] = false; }}
							>
								Edit
							</button>
							{#if r.status === 'pending'}
								<form method="POST" action="?/cancel">
									<input type="hidden" name="id" value={r.id} />
									<ConfirmButton class="btn btn-danger" message="Delete this reminder?">Delete</ConfirmButton>
								</form>
							{/if}
						</div>
					</div>
				{/if}
			</li>
		{/each}
	</ul>
{:else}
	<EmptyState message="No reminders scheduled." />
{/if}
