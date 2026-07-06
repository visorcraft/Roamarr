<script lang="ts">
	import type { Snippet } from 'svelte';
	import CardSelect from '$lib/components/CardSelect.svelte';
	import Icon from '$lib/components/Icon.svelte';

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
		<a href={`/trips/${trip.id}`} class="back-link">
			<Icon name="back" class="h-4 w-4" />
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

		<div class="form-actions sm:col-span-2">
			<a href={`/trips/${trip.id}/segments/new`} class="btn btn-ghost">Back</a>
			<div class="flex flex-wrap gap-2">
				<a href={`/trips/${trip.id}`} class="btn btn-ghost">Cancel</a>
				<button class="btn btn-primary">Save</button>
			</div>
		</div>
	</form>
</section>
