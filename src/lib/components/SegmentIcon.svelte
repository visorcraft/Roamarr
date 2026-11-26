<script lang="ts">
	import { SEG, type SegmentType } from '$lib/segmentLabels';

	interface Props {
		type: SegmentType | string;
		class?: string;
	}

	let { type, class: className = '' }: Props = $props();

	const content = $derived(SEG[type as SegmentType]?.icon ?? '');
</script>

<svg
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="2"
	stroke-linecap="round"
	stroke-linejoin="round"
	class={className ? `shrink-0 ${className}` : 'shrink-0'}
	aria-hidden="true"
>
	{@html content}
</svg>
