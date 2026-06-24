<script lang="ts">
	import SegmentTypeForm from '$lib/components/segments/SegmentTypeForm.svelte';
	import { ADD_SEGMENT_WIZARD_TYPES, SEG, type SegmentType } from '$lib/segmentLabels';

	interface Props {
		open: boolean;
		tripId: number;
		form?: { error?: string; errors?: Record<string, string>; type?: string };
		onclose: () => void;
	}

	let { open, tripId, form, onclose }: Props = $props();
	let step = $state<'type' | 'details'>('type');
	let selectedType = $state<SegmentType | null>(null);

	const hasFormErrors = $derived(
		!!(
			form?.errors &&
			(form.errors.title ||
				form.errors.localStart ||
				form.errors.startDate ||
				form.errors.endDate ||
				form.errors.endAt ||
				form.errors.type ||
				form.errors.startTz ||
				form.errors.location)
		)
	);
	const showDetails = $derived(hasFormErrors || step === 'details');
	const activeType = $derived(
		hasFormErrors
			? form?.type && form.type in SEG
				? (form.type as SegmentType)
				: ADD_SEGMENT_WIZARD_TYPES[0].type
			: selectedType
	);
	const selectedMeta = $derived(activeType ? SEG[activeType] : null);

	function pickType(type: SegmentType) {
		selectedType = type;
		step = 'details';
	}

	function back() {
		if (hasFormErrors) {
			close();
			return;
		}
		step = 'type';
		selectedType = null;
	}

	function close() {
		step = 'type';
		selectedType = null;
		onclose();
	}

	function onBackdropClick(event: MouseEvent) {
		if (event.target === event.currentTarget) close();
	}

	function onKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') close();
	}
</script>

<svelte:window onkeydown={open ? onKeydown : undefined} />

{#if open}
	<div
		class="modal-backdrop"
		role="presentation"
		onclick={onBackdropClick}
	>
		<div
			class="modal-panel modal-panel-wide"
			role="dialog"
			aria-modal="true"
			aria-labelledby="add-segment-title"
		>
			<div class="mb-5 flex items-start justify-between gap-4">
				<div>
					<h2 id="add-segment-title" class="section-title">
						{showDetails ? `Add ${selectedMeta?.label ?? 'segment'}` : 'Add segment'}
					</h2>
					<p class="mt-1 text-sm text-muted">
						{showDetails ? 'Fill in the details below.' : 'Choose what you are adding to this trip.'}
					</p>
				</div>
				<button type="button" class="btn btn-ghost btn-sm shrink-0" aria-label="Close" onclick={close}>
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="h-4 w-4"><path d="M18 6 6 18M6 6l12 12" /></svg>
				</button>
			</div>

			{#if !showDetails}
				<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
					{#each ADD_SEGMENT_WIZARD_TYPES as option (option.type)}
						<button
							type="button"
							class="card group flex items-center gap-3 p-3.5 text-left transition hover:-translate-y-0.5 hover:ring-white/20"
							onclick={() => pickType(option.type)}
						>
							<span class="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-indigo-500/15 text-indigo-300 ring-1 ring-indigo-400/20">
								<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-5 w-5">{@html SEG[option.type].icon}</svg>
							</span>
							<span class="min-w-0 font-display text-sm font-bold leading-snug text-white">{option.label}</span>
						</button>
					{/each}
				</div>
			{:else if activeType}
				<form method="POST" action={`/trips/${tripId}/segments?/add`} class="grid gap-4 sm:grid-cols-2">
					<input type="hidden" name="type" value={activeType} />
					{#if form?.error}<p class="notice notice-error sm:col-span-2">{form.error}</p>{/if}
					{#if form?.errors?.type}<p class="field-error sm:col-span-2">{form.errors.type}</p>{/if}

					<SegmentTypeForm type={activeType} errors={form?.errors} />

					<div class="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4 sm:col-span-2">
						<button type="button" class="btn btn-ghost" onclick={back}>Back</button>
						<div class="flex flex-wrap gap-2">
							<button type="button" class="btn btn-ghost" onclick={close}>Cancel</button>
							<button class="btn btn-primary">Save</button>
						</div>
					</div>
				</form>
			{/if}
		</div>
	</div>
{/if}
