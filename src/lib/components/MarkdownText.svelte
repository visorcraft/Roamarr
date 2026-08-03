<script lang="ts">
	import { renderMarkdown } from '$lib/markdown';

	let { text, class: className = '' }: { text: string; class?: string } = $props();

	// renderMarkdown escapes HTML before applying markdown, so this {@html}
	// is safe. Never swap in a renderer that does not escape first.
	const html = $derived(renderMarkdown(text));
</script>

{#if text}
	<div class="markdown-body {className}">{@html html}</div>
{/if}
