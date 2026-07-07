<script lang="ts">
	import Modal from './Modal.svelte';

	interface Props {
		open: boolean;
		title: string;
		message: string;
		confirmLabel?: string;
		cancelLabel?: string;
		onconfirm: () => void;
		oncancel: () => void;
	}

	let {
		open = $bindable(false),
		title,
		message,
		confirmLabel = 'Confirm',
		cancelLabel = 'Cancel',
		onconfirm,
		oncancel
	}: Props = $props();

	function handleClose() {
		oncancel();
	}
</script>

{#if open}
	<Modal bind:open {title} onclose={handleClose}>
		{#snippet children()}
			<p>{message}</p>
		{/snippet}
		{#snippet actions()}
			<button type="button" class="btn btn-ghost" onclick={oncancel}>{cancelLabel}</button>
			<button type="button" class="btn btn-danger" onclick={onconfirm}>{confirmLabel}</button>
		{/snippet}
	</Modal>
{/if}
