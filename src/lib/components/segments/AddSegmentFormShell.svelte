<script lang="ts">
	import type { Snippet } from 'svelte';
	import CardSelect from '$lib/components/CardSelect.svelte';

	let {
		trip,
		label,
		form,
		cards,
		children
	}: {
		trip: { id: number; name: string };
		label: string;
		form?: { error?: string; errors?: Record<string, string> } | null;
		cards?: { id: number; nickname: string; network: string; last4: string | null }[];
		children: Snippet;
	} = $props();
</script>

<header class="page-header">
	<div>
		<a href={`/trips/${trip.id}`} class="mb-2 inline-flex items-center gap-1.5 text-sm text-slate-400 transition hover:text-white">
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
			Back to {trip.name}
		</a>
		<h1 class="page-title">Add {label.toLowerCase()}</h1>
		<p class="page-subtitle">Fill in the details below.</p>
	</div>
	<a href={`/trips/${trip.id}/segments/new`} class="btn btn-ghost">Back</a>
</header>

<section class="card mt-6 p-5 sm:p-6">
	<form method="POST" class="grid gap-4 sm:grid-cols-2">
		{#if form?.error}<p class="notice notice-error sm:col-span-2">{form.error}</p>{/if}

		{@render children()}

		{#if cards?.length}
			<CardSelect {cards} name="cardId" errors={form?.errors} />
		{/if}

		<div class="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4 sm:col-span-2">
			<a href={`/trips/${trip.id}/segments/new`} class="btn btn-ghost">Back</a>
			<div class="flex flex-wrap gap-2">
				<a href={`/trips/${trip.id}`} class="btn btn-ghost">Cancel</a>
				<button class="btn btn-primary">Save</button>
			</div>
		</div>
	</form>
</section>
