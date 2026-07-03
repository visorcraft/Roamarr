<script module lang="ts">
	let sectionSeq = 0;
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		title,
		open = $bindable(false),
		children
	}: { title: string; open?: boolean; children: Snippet } = $props();

	let panelId = `segment-section-${sectionSeq++}`;
</script>

<section class="segment-form-section sm:col-span-2">
	<button
		type="button"
		class="segment-form-section-toggle"
		aria-expanded={open}
		aria-controls={panelId}
		onclick={() => (open = !open)}
	>
		<span class="font-medium text-slate-200">{title}</span>
		<span class="link text-sm no-underline">{open ? 'Show less' : 'Show more'}</span>
	</button>
	{#if open}
		<div id={panelId} class="segment-form-section-body grid gap-4 sm:grid-cols-2">
			{@render children()}
		</div>
	{/if}
</section>
