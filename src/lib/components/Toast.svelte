<script lang="ts">
	export type ToastVariant = 'success' | 'error' | 'info' | 'warning';

	interface Props {
		message: string;
		duration?: number;
		variant?: ToastVariant;
		dismissible?: boolean;
	}

	let { message, duration = 4000, variant = 'success', dismissible = true }: Props = $props();
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

	const icons: Record<ToastVariant, string> = {
		success:
			'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5"><polyline points="20 6 9 17 4 12" /></svg>',
		error:
			'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>',
		info:
			'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5"><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>',
		warning:
			'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>'
	};
</script>

{#if visible && message}
	<div
		class="toast toast-{variant}"
		role="status"
		aria-live="polite"
	>
		<span class="toast-icon toast-icon-{variant}">
			{@html icons[variant]}
		</span>
		<span class="font-medium">{message}</span>
		{#if dismissible}
			<button
				type="button"
				class="icon-button -mr-1 ml-auto h-7 w-7 shrink-0"
				aria-label="Dismiss"
				onclick={() => (visible = false)}
			>
				<svg
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					class="h-4 w-4"
					aria-hidden="true"
				>
					<line x1="18" y1="6" x2="6" y2="18" />
					<line x1="6" y1="6" x2="18" y2="18" />
				</svg>
			</button>
		{/if}
	</div>
{/if}
