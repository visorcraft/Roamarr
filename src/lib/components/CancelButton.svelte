<script lang="ts">
	import type { Snippet } from 'svelte';
	import Modal from './Modal.svelte';

	interface Props {
		onConfirm: () => void;
		children: Snippet;
		class?: string;
		message?: string;
		confirmLabel?: string;
		cancelLabel?: string;
		title?: string;
		dirty?: boolean;
	}

	let {
		onConfirm,
		children,
		class: className = 'btn btn-ghost',
		message = 'Any unsaved changes will be lost.',
		confirmLabel = 'Discard changes',
		cancelLabel = 'Keep editing',
		title = 'Discard changes?',
		dirty = true
	}: Props = $props();

	let open = $state(false);

	function confirm() {
		open = false;
		onConfirm();
	}

	function handleClick() {
		if (dirty) {
			open = true;
		} else {
			onConfirm();
		}
	}
</script>

<button type="button" class={className} onclick={handleClick}>
	{@render children()}
</button>

<Modal {open} {title} onclose={() => (open = false)}>
	<p style="color: var(--theme-readable-muted);">{message}</p>
	{#snippet actions()}
		<button type="button" class="btn btn-ghost" onclick={() => (open = false)}>{cancelLabel}</button>
		<button type="button" class="btn btn-danger" onclick={confirm}>{confirmLabel}</button>
	{/snippet}
</Modal>
