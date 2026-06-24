<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		message: string;
		icon?: Snippet;
		actionHref?: string;
		actionLabel?: string;
	}

	let { message, icon, actionHref, actionLabel }: Props = $props();
</script>

<div class="card mt-6 grid place-items-center gap-3 p-12 text-center">
	<div
		class="grid h-12 w-12 place-items-center rounded-full bg-indigo-500/10 text-indigo-300 ring-1 ring-indigo-400/20"
	>
		{#if icon}
			{@render icon()}
		{:else}
			<svg
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				class="h-6 w-6"
			>
				<circle cx="12" cy="12" r="10" />
				<path d="M12 8v8M8 12h8" />
			</svg>
		{/if}
	</div>
	<p class="text-slate-300">{message}</p>
	{#if actionHref && actionLabel}
		<a href={actionHref} class="btn btn-primary mt-1">{actionLabel}</a>
	{/if}
</div>
