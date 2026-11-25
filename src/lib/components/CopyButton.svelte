<script lang="ts">
	import type { HTMLButtonAttributes } from 'svelte/elements';
	import { onDestroy } from 'svelte';
	import { m } from '$lib/paraglide/messages';
	import { copyToClipboard, createCopyFeedback, type CopyStatus } from '$lib/copy';
	import Icon from './Icon.svelte';
	import type { IconName } from '$lib/icons';

	interface Props extends HTMLButtonAttributes {
		text: string;
		label?: string;
		copiedLabel?: string;
		failedLabel?: string;
		icon?: IconName;
	}

	let {
		text,
		label = m.common_copy(),
		copiedLabel = m.common_copied(),
		failedLabel = m.common_copy_failed(),
		icon,
		class: className = 'btn btn-ghost',
		...rest
	}: Props = $props();

	let status = $state<CopyStatus>('idle');
	const feedback = createCopyFeedback((next) => (status = next));

	onDestroy(() => {
		feedback.dispose();
	});

	async function copy() {
		feedback.report(await copyToClipboard(text));
	}
</script>

<button {...rest} type="button" class={className} onclick={copy} aria-live="polite">
	{#if icon}
		<Icon name={icon} class="h-4.5 w-4.5" />
	{/if}
	<span>{status === 'copied' ? copiedLabel : status === 'failed' ? failedLabel : label}</span>
</button>
