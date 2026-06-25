<script lang="ts">
	import { ICON_PATHS, type IconName } from '$lib/icons';

	interface Props {
		name: IconName;
		class?: string;
	}

	let { name, class: className = 'h-5 w-5' }: Props = $props();

	const content = $derived(ICON_PATHS[name] ?? '');
</script>

<svg
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="2"
	stroke-linecap="round"
	stroke-linejoin="round"
	class="shrink-0 {className}"
	aria-hidden="true"
>
	{@html content}
</svg>
