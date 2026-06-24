<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		trip,
		label,
		form,
		children
	}: {
		trip: { id: number; name: string };
		label: string;
		form?: { error?: string; errors?: Record<string, string> } | null;
		children: Snippet;
	} = $props();
</script>

<header class="flex flex-wrap items-end justify-between gap-4">
	<div>
		<a href={`/trips/${trip.id}`} class="mb-2 inline-flex items-center gap-1.5 text-sm text-slate-400 transition hover:text-white">
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
			Back to {trip.name}
		</a>
		<h1 class="text-3xl font-extrabold text-white">Add {label.toLowerCase()}</h1>
		<p class="mt-1 text-sm text-muted">Fill in the details below.</p>
	</div>
	<a href={`/trips/${trip.id}/segments/new`} class="btn btn-ghost">Back</a>
</header>

<section class="card mt-6 p-5 sm:p-6">
	<form method="POST" class="grid gap-4 sm:grid-cols-2">
		{#if form?.error}<p class="notice notice-error sm:col-span-2">{form.error}</p>{/if}

		{@render children()}

		<div class="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4 sm:col-span-2">
			<a href={`/trips/${trip.id}/segments/new`} class="btn btn-ghost">Back</a>
			<div class="flex flex-wrap gap-2">
				<a href={`/trips/${trip.id}`} class="btn btn-ghost">Cancel</a>
				<button class="btn btn-primary">Save</button>
			</div>
		</div>
	</form>
</section>
