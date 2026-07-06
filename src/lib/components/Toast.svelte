<script lang="ts">
	import type { ToastVariant } from '$lib/toast';
	import { type IconName } from '$lib/icons';
	import Icon from './Icon.svelte';

	interface Props {
		message: string;
		duration?: number;
		variant?: ToastVariant;
		dismissible?: boolean;
	}

	let { message, duration = 4000, variant = 'success', dismissible = true }: Props = $props();
	let visible = $state(true);

	$effect(() => {
		if (!message) {
			visible = false;
			return;
		}
		visible = true;
		const timer = setTimeout(() => (visible = false), duration);
		return () => clearTimeout(timer);
	});

	const variantIcon: Record<ToastVariant, IconName> = {
		success: 'check',
		error: 'close',
		info: 'info',
		warning: 'warning'
	};
</script>

{#if visible && message}
	<div
		class="toast toast-{variant}"
		role="status"
		aria-live="polite"
	>
		<span class="toast-icon toast-icon-{variant}">
			<Icon name={variantIcon[variant]} class="h-3.5 w-3.5" />
		</span>
		<span class="font-medium">{message}</span>
		{#if dismissible}
			<button
				type="button"
				class="icon-button -mr-1 ml-auto h-7 w-7 shrink-0"
				aria-label="Dismiss"
				onclick={() => (visible = false)}
			>
				<Icon name="close" class="h-4 w-4" />
			</button>
		{/if}
	</div>
{/if}
