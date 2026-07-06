<script lang="ts">
	let { form }: { form?: { error?: string } } = $props();
	let confirmed = $state(false);
</script>

<h1 class="page-title">Seed demo data</h1>
<p class="page-subtitle max-w-3xl">
	This replaces all non-admin sample data with a small demo dataset: trips, segments, cards, insurance, and loyalty programs. It is useful for first-time evaluation and screenshots.
</p>

{#if form?.error}<p class="notice notice-error mt-4">{form.error}</p>{/if}

<form method="POST" class="mt-6">
	<label class="checkbox-label items-start gap-3">
		<input type="checkbox" bind:checked={confirmed} class="checkbox mt-0.5" />
		<span>I understand this will remove existing trips, segments, cards, insurance, and loyalty data owned by other users.</span>
	</label>
	<div class="mt-4">
		<button type="submit" class="btn btn-danger" disabled={!confirmed}>Seed demo data</button>
	</div>
</form>
