<script lang="ts">
	import type { HTMLButtonAttributes } from 'svelte/elements';
	import { onDestroy } from 'svelte';
	import { copyToClipboard } from '$lib/copy';
	import Icon from './Icon.svelte';
	import type { IconName } from '$lib/icons';

	interface Props extends HTMLButtonAttributes {
		text: string;
		label?: string;
		copiedLabel?: string;
		icon?: IconName;
	}

	let {
		text,
		label = 'Copy',
		copiedLabel = 'Copied!',
		icon,
		class: className = 'btn btn-ghost',
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
	{#if icon}
		<Icon name={icon} class="h-4.5 w-4.5" />
	{/if}
	<span>{#if copied}{copiedLabel}{:else}{label}{/if}</span>
</button>
