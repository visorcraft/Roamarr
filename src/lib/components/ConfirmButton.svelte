<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';
	import { confirmHandler } from '$lib/confirm';

	interface Props extends HTMLButtonAttributes {
		message: string;
		children: Snippet;
	}

	let { message, children, type = 'submit', class: className = '', ...rest }: Props = $props();
</script>

<button {...rest} {type} class={className} onclick={confirmHandler(message)}>
	{@render children()}
</button>
