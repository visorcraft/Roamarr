<script lang="ts">
	import { goto } from '$app/navigation';
	import { enhance } from '$app/forms';
	import TextField from '$lib/components/TextField.svelte';
	import SelectField from '$lib/components/SelectField.svelte';
	import CancelButton from '$lib/components/CancelButton.svelte';
	import ConfirmButton from '$lib/components/ConfirmButton.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let cardSubmitting = $state(false);
	let cardDirty = $state(false);
	let benefitSubmitting = $state(false);
	let benefitDirty = $state(false);
	let editingBenefitId = $state<number | null>(null);
	let selectedTemplateId = $state('');

	const networks = [
		{ key: 'visa', label: 'Visa' },
		{ key: 'mc', label: 'Mastercard' },
		{ key: 'amex', label: 'Amex' },
		{ key: 'disc', label: 'Discover' },
		{ key: 'other', label: 'Other' }
	];

	const benefitTypes = [
		{ key: 'trip_delay', label: 'Trip delay' },
		{ key: 'baggage_delay', label: 'Baggage delay' },
		{ key: 'trip_cancellation', label: 'Trip cancellation' },
		{ key: 'other', label: 'Other' }
	];

	const selectedTemplate = $derived(
		data.templates.find((t) => String(t.id) === selectedTemplateId)
	);
</script>

<header class="page-header">
	<div>
		<h1 class="page-title">Edit card</h1>
		<p class="page-subtitle">{data.card.nickname}</p>
	</div>
</header>

<section class="card mt-6 p-5 sm:p-6">
	<form
		method="POST"
		action="?/updateCard"
		class="grid gap-4 sm:grid-cols-2"
		use:enhance={() => {
			cardSubmitting = true;
			return async ({ update }) => {
				await update();
				cardSubmitting = false;
			};
		}}
		aria-busy={cardSubmitting}
		oninput={() => (cardDirty = true)}
	>
		<TextField
			name="nickname"
			label="Nickname"
			value={data.card.nickname}
			placeholder="e.g. Sapphire Reserve"
			required
			disabled={cardSubmitting}
		/>
		<SelectField name="network" label="Network" value={data.card.network} required disabled={cardSubmitting}>
			{#each networks as n (n.key)}
				<option value={n.key}>{n.label}</option>
			{/each}
		</SelectField>
		<TextField
			name="last4"
			label="Last 4"
			value={data.card.last4 ?? ''}
			placeholder="1234"
			maxlength="4"
			inputmode="numeric"
			disabled={cardSubmitting}
		/>
		<TextField
			name="notes"
			label="Notes"
			value={data.card.notes ?? ''}
			placeholder="Optional notes"
			disabled={cardSubmitting}
		/>
		<div class="flex flex-wrap justify-end gap-2 sm:col-span-2">
			<CancelButton dirty={cardDirty} onConfirm={() => goto('/cards')}>Cancel</CancelButton>
			<button class="btn btn-primary" disabled={cardSubmitting} class:btn-loading={cardSubmitting}>
				Save card
			</button>
		</div>
	</form>
</section>

<section class="card mt-6 p-5 sm:p-6">
	<h2 class="section-title mb-4">Benefits</h2>

	{#if data.benefits.length}
		<ul class="space-y-3">
			{#each data.benefits as b (b.id)}
				<li class="list-item-compact">
					{#if editingBenefitId === b.id}
						<form
							method="POST"
							action="?/updateBenefit"
							class="flex flex-wrap items-end gap-3"
							use:enhance={() => {
								benefitSubmitting = true;
								return async ({ update }) => {
									await update();
									benefitSubmitting = false;
									editingBenefitId = null;
								};
							}}
							aria-busy={benefitSubmitting}
							oninput={() => (benefitDirty = true)}
						>
							<input type="hidden" name="id" value={b.id} />
							<SelectField name="benefitType" label="Benefit" value={b.benefitType} required disabled={benefitSubmitting}>
								{#each benefitTypes as bt (bt.key)}
									<option value={bt.key}>{bt.label}</option>
								{/each}
							</SelectField>
							<TextField
								name="coverageAmount"
								label="Coverage"
								type="number"
								value={b.coverageAmount ?? ''}
								placeholder="0"
								disabled={benefitSubmitting}
							/>
							<TextField
								name="currency"
								label="Currency"
								value={b.currency}
								placeholder="USD"
								disabled={benefitSubmitting}
							/>
							<TextField
								name="notes"
								label="Notes"
								value={b.notes ?? ''}
								placeholder="Optional"
								disabled={benefitSubmitting}
							/>
							<div class="action-row">
								<CancelButton
									dirty={benefitDirty}
									onConfirm={() => (editingBenefitId = null)}
								>
									Cancel
								</CancelButton>
								<button class="btn btn-primary" disabled={benefitSubmitting} class:btn-loading={benefitSubmitting}>
									Update
								</button>
							</div>
						</form>
					{:else}
						<div class="flex items-center justify-between gap-3">
							<div>
								<span class="font-medium">{benefitTypes.find((bt) => bt.key === b.benefitType)?.label ?? b.benefitType}</span>
								<span class="ml-2 font-mono text-sm text-muted">
									{b.coverageAmount ?? '—'} {b.currency}
								</span>
								{#if b.notes}<p class="mt-1 text-sm text-muted">{b.notes}</p>{/if}
							</div>
							<div class="action-row gap-1">
								<button
									type="button"
									class="btn btn-primary"
									onclick={() => { editingBenefitId = b.id; benefitDirty = false; }}
								>
									Edit
								</button>
								<form method="POST" action="?/deleteBenefit" class="inline">
									<input type="hidden" name="id" value={b.id} />
									<ConfirmButton class="btn btn-danger" message="Delete this benefit?">Delete</ConfirmButton>
								</form>
							</div>
						</div>
					{/if}
				</li>
			{/each}
		</ul>
	{:else}
		<p class="text-sm text-muted">No benefits added yet.</p>
	{/if}

	<form
		method="POST"
		action="?/addBenefit"
		class="mt-6 grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end"
		use:enhance={() => {
			benefitSubmitting = true;
			return async ({ update }) => {
				await update();
				benefitSubmitting = false;
				selectedTemplateId = '';
			};
		}}
		aria-busy={benefitSubmitting}
	>
		<div class="field">
			<label class="label" for="templateId">Template</label>
			<select
				id="templateId"
				name="templateId"
				class="input"
				disabled={benefitSubmitting}
				bind:value={selectedTemplateId}
			>
				<option value="">Custom</option>
				{#each data.templates as t (t.id)}
					<option value={t.id}>{t.name} ({benefitTypes.find((bt) => bt.key === t.benefitType)?.label ?? t.benefitType})</option>
				{/each}
			</select>
		</div>
		<SelectField name="benefitType" label="Benefit" required disabled={benefitSubmitting || !!selectedTemplate}>
			{#each benefitTypes as bt (bt.key)}
				<option value={bt.key}>{bt.label}</option>
			{/each}
		</SelectField>
		<TextField
			name="coverageAmount"
			label="Coverage"
			type="number"
			placeholder="0"
			disabled={benefitSubmitting || !!selectedTemplate}
		/>
		<TextField
			name="notes"
			label="Notes"
			placeholder="Optional"
			disabled={benefitSubmitting}
		/>
		<button class="btn btn-primary justify-self-end" disabled={benefitSubmitting}>Add benefit</button>
	</form>
	{#if selectedTemplate}
		<p class="mt-2 text-xs text-muted">Using {selectedTemplate.name}</p>
	{/if}
</section>
