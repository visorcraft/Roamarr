<script lang="ts">
	let { form }: { form?: { error?: string } } = $props();
	let confirmed = $state(false);
</script>

<h1 class="text-2xl font-extrabold text-white">Seed demo data</h1>
<p class="mt-2 text-slate-400">
	This replaces all non-admin sample data with a small demo dataset: trips, segments, cards, insurance, and loyalty programs. It is useful for first-time evaluation and screenshots.
</p>

{#if form?.error}<p class="notice notice-error mt-4">{form.error}</p>{/if}

<form method="POST" class="mt-6">
	<label class="flex items-start gap-3 text-sm text-slate-300">
		<input type="checkbox" bind:checked={confirmed} class="mt-0.5 h-4 w-4 rounded border-white/20 bg-white/5 accent-indigo-500" />
		<span>I understand this will remove existing trips, segments, cards, insurance, and loyalty data owned by other users.</span>
	</label>
	<div class="mt-4">
		<button type="submit" class="btn btn-danger" disabled={!confirmed}>Seed demo data</button>
	</div>
</form>
