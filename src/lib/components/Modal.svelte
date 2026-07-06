<script lang="ts">
	import type { Snippet } from 'svelte';
	import { browser } from '$app/environment';
	import { portal } from '$lib/actions/portal';

	interface Props {
		open: boolean;
		title?: string;
		children: Snippet;
		actions?: Snippet;
		onclose?: () => void;
	}

	let { open = $bindable(false), title, children, actions, onclose }: Props = $props();
	let dialogRef = $state<HTMLDivElement | null>(null);
	let previouslyFocused = $state<HTMLElement | null>(null);

	$effect(() => {
		if (!browser) return;
		if (open) {
			previouslyFocused = document.activeElement as HTMLElement;
			const firstFocusable = dialogRef?.querySelector<HTMLElement>(
				'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
			);
			firstFocusable?.focus();
			document.body.classList.add('overflow-hidden');
		} else {
			document.body.classList.remove('overflow-hidden');
			previouslyFocused?.focus();
		}
		return () => {
			document.body.classList.remove('overflow-hidden');
		};
	});

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.preventDefault();
			onclose?.();
		}
		if (event.key === 'Tab' && dialogRef) {
			const focusable = Array.from(
				dialogRef.querySelectorAll<HTMLElement>(
					'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
				)
			).filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null);
			if (focusable.length === 0) return;
			const first = focusable[0];
			const last = focusable[focusable.length - 1];
			if (event.shiftKey && document.activeElement === first) {
				event.preventDefault();
				last.focus();
			} else if (!event.shiftKey && document.activeElement === last) {
				event.preventDefault();
				first.focus();
			}
		}
	}

	function handleBackdropClick(event: MouseEvent) {
		if (event.target === event.currentTarget) {
			onclose?.();
		}
	}
</script>

{#if open}
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		class="fixed inset-0 z-[9999] grid place-items-center p-4"
		role="dialog"
		aria-modal="true"
		aria-labelledby={title ? 'modal-title' : undefined}
		tabindex="-1"
		use:portal
		onclick={handleBackdropClick}
		onkeydown={handleKeydown}
	>
		<div class="fixed inset-0 bg-black/60 backdrop-blur-sm" aria-hidden="true"></div>
		<div
			bind:this={dialogRef}
			class="modal-panel relative z-10 w-full max-w-md overflow-hidden rounded-xl shadow-2xl"
		>
			{#if title}
				<div class="border-b px-5 py-4" style="border-color: var(--theme-line);">
					<h2 id="modal-title" class="font-display text-lg font-semibold" style="color: var(--theme-strong);">
						{title}
					</h2>
				</div>
			{/if}
			<div class="px-5 py-4" style="color: var(--theme-ink);">
				{@render children()}
			</div>
			{#if actions}
				<div class="flex flex-wrap justify-end gap-2 border-t px-5 py-4" style="border-color: var(--theme-line);">
					{@render actions()}
				</div>
			{/if}
		</div>
	</div>
{/if}
