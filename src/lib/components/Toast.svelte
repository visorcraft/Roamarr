<script lang="ts">
	interface Props {
		message: string;
		duration?: number;
	}

	let { message, duration = 4000 }: Props = $props();
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
</script>

{#if visible && message}
	<div
		class="fixed right-4 top-4 z-50 flex max-w-sm items-center gap-3 rounded-xl bg-surface/95 px-4 py-3 text-sm text-ink shadow-xl ring-1 ring-white/10 backdrop-blur-xl"
		role="status"
		aria-live="polite"
	>
		<span class="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-400/30">
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5">
				<polyline points="20 6 9 17 4 12" />
			</svg>
		</span>
		<span class="font-medium">{message}</span>
	</div>
{/if}
