<script lang="ts">
	import type { HTMLButtonAttributes } from 'svelte/elements';
	import { onDestroy } from 'svelte';
	import { copyToClipboard } from '$lib/copy';

	interface Props extends HTMLButtonAttributes {
		text: string;
		label?: string;
		copiedLabel?: string;
	}

	let {
		text,
		label = 'Copy',
		copiedLabel = 'Copied!',
		class: className = '',
		...rest
	}: Props = $props();

	let copied = $state(false);
	let timeoutId: ReturnType<typeof setTimeout> | null = null;

	onDestroy(() => {
		if (timeoutId) clearTimeout(timeoutId);
	});

	async function copy() {
		const ok = await copyToClipboard(text);
		if (!ok) return;
		copied = true;
		timeoutId = setTimeout(() => {
			copied = false;
			timeoutId = null;
		}, 2000);
	}
</script>

<button {...rest} type="button" class={className} onclick={copy} aria-live="polite">
	{#if copied}{copiedLabel}{:else}{label}{/if}
</button>
