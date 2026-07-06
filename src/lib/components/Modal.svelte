<script lang="ts">
	import type { Snippet } from 'svelte';
	import { browser } from '$app/environment';

	interface Props {
		open: boolean;
		title?: string;
		children: Snippet;
		actions?: Snippet;
		onclose?: () => void;
	}

	let { open = $bindable(false), title, children, actions, onclose }: Props = $props();
	let dialogEl = $state<HTMLDialogElement | null>(null);

	$effect(() => {
		if (!browser) return;
		const d = dialogEl;
		if (!d) return;
		if (open && !d.open) {
			d.showModal();
		} else if (!open && d.open) {
			d.close();
		}
	});

	function handleClose() {
		open = false;
		onclose?.();
	}

	function handleBackdropClick(event: MouseEvent) {
		if (event.target === dialogEl) {
			dialogEl?.close();
		}
	}
</script>

<dialog
	bind:this={dialogEl}
	class="modal-dialog"
	onclose={handleClose}
	onclick={handleBackdropClick}
>
	<div class="modal-panel">
		{#if title}
			<div class="modal-head">
				<h2 class="modal-title">{title}</h2>
			</div>
		{/if}
		<div class="modal-body">
			{@render children()}
		</div>
		{#if actions}
			<div class="modal-foot">
				{@render actions()}
			</div>
		{/if}
	</div>
</dialog>

<style>
	.modal-dialog {
		position: fixed;
		inset: 0;
		margin: auto;
		width: 100%;
		max-width: 28rem;
		padding: 0;
		border: none;
		background: transparent;
		overflow: visible;
	}
	.modal-dialog::backdrop {
		background: rgba(0, 0, 0, 0.6);
		backdrop-filter: blur(2px);
	}
	.modal-panel {
		position: relative;
		overflow: hidden;
		border-radius: 0.75rem;
		box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.35);
		background: var(--theme-surface, #fff);
		color: var(--theme-ink, inherit);
	}
	.modal-head {
		padding: 1rem 1.25rem;
		border-bottom: 1px solid var(--theme-line);
	}
	.modal-title {
		font-size: 1.125rem;
		font-weight: 600;
		color: var(--theme-strong);
	}
	.modal-body {
		padding: 1rem 1.25rem;
		color: var(--theme-ink);
	}
	.modal-foot {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 0.5rem;
		padding: 1rem 1.25rem;
		border-top: 1px solid var(--theme-line);
	}
</style>
