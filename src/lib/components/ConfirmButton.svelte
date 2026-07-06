<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';
	import Modal from './Modal.svelte';

	interface Props extends HTMLButtonAttributes {
		message: string;
		children: Snippet;
		title?: string;
		confirmLabel?: string;
	}

	let {
		message,
		children,
		title = 'Are you sure?',
		confirmLabel = 'Confirm',
		type = 'submit',
		class: className = 'btn btn-ghost',
		...rest
	}: Props = $props();

	let open = $state(false);
</script>

<button {...rest} type="button" class={className} onclick={() => (open = true)}>
	{@render children()}
</button>

<Modal {open} {title} onclose={() => (open = false)}>
	<p style="color: var(--theme-readable-muted);">{message}</p>
	{#snippet actions()}
		<button type="button" class="btn btn-ghost" onclick={() => (open = false)}>Cancel</button>
		<button {type} class="btn btn-danger" onclick={() => (open = false)}>{confirmLabel}</button>
	{/snippet}
</Modal>
