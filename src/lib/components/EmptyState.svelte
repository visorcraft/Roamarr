<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from './Icon.svelte';

	interface Props {
		message: string;
		icon?: Snippet;
		actionHref?: string;
		actionLabel?: string;
	}

	let { message, icon, actionHref, actionLabel }: Props = $props();
</script>

<div class="empty-state">
	<div class="empty-icon">
		{#if icon}
			{@render icon()}
		{:else}
			<Icon name="empty" class="h-6 w-6" />
		{/if}
	</div>
	<p class="text-slate-300">{message}</p>
	{#if actionHref && actionLabel}
		<a href={actionHref} class="btn btn-primary mt-1">{actionLabel}</a>
	{/if}
</div>
