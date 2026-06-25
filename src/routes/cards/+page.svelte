<script lang="ts">
	import ConfirmButton from '$lib/components/ConfirmButton.svelte';

	let { data } = $props();
	let editingCardId = $state<number | null>(null);
	let editingBenefitId = $state<number | null>(null);
	let selectedTemplateId = $state('');

	const networkLabel: Record<string, string> = {
		visa: 'Visa',
		mc: 'Mastercard',
		amex: 'Amex',
		disc: 'Discover',
		other: 'Other'
	};
	const benefitLabel: Record<string, string> = {
		trip_delay: 'Trip delay',
		baggage_delay: 'Baggage delay',
		trip_cancellation: 'Trip cancellation',
		other: 'Other'
	};

	const selectedTemplate = $derived(
		data.templates.find((t) => String(t.id) === selectedTemplateId)
	);
</script>

<header class="page-header">
	<div>
		<h1 class="page-title">Cards</h1>
		<p class="page-subtitle">
			{data.cards.length} card{data.cards.length === 1 ? '' : 's'} and their travel benefits
		</p>
	</div>
</header>


{#if data.cards.length}
	<div class="mt-6 grid gap-4">
		{#each data.cards as c (c.id)}
			<section class="card p-5">
				<div class="flex items-start justify-between gap-3">
					<div class="min-w-0">
						<div class="flex items-center gap-2">
							<span class="truncate font-semibold text-white">{c.nickname}</span>
							<span class="badge badge-slate">{networkLabel[c.network] ?? c.network}</span>
						</div>
						{#if c.last4}<div class="mt-1 font-mono text-xs text-slate-400">…{c.last4}</div>{/if}
					</div>
					<div class="action-row gap-1">
						<button type="button" class="btn btn-ghost btn-ghost-indigo" onclick={() => (editingCardId = c.id)}>Edit</button>
						<form method="POST" action="?/deleteCard">
							<input type="hidden" name="id" value={c.id} />
							<ConfirmButton class="btn btn-ghost btn-ghost-danger" message="Delete this card and all its benefits?">Delete</ConfirmButton>
						</form>
					</div>
				</div>

				{#if editingCardId === c.id}
					<form method="POST" action="?/updateCard" class="mt-4 grid gap-4 border-t border-white/5 pt-4 sm:grid-cols-2">
						<input type="hidden" name="id" value={c.id} />
						<div class="field">
							<label class="label" for={`nickname-${c.id}`}>Nickname</label>
							<input id={`nickname-${c.id}`} name="nickname" value={c.nickname} class="input" required />
						</div>
						<div class="field">
							<label class="label" for={`network-${c.id}`}>Network</label>
							<select id={`network-${c.id}`} name="network" class="select">
								<option value="visa" selected={c.network === 'visa'}>Visa</option>
								<option value="mc" selected={c.network === 'mc'}>Mastercard</option>
								<option value="amex" selected={c.network === 'amex'}>Amex</option>
								<option value="disc" selected={c.network === 'disc'}>Discover</option>
								<option value="other" selected={c.network === 'other'}>Other</option>
							</select>
						</div>
						<div class="field">
							<label class="label" for={`last4-${c.id}`}>Last 4</label>
							<input id={`last4-${c.id}`} name="last4" value={c.last4 ?? ''} placeholder="1234" maxlength="4" inputmode="numeric" class="input" />
						</div>
						<div class="field">
							<label class="label" for={`notes-${c.id}`}>Notes</label>
							<input id={`notes-${c.id}`} name="notes" value={c.notes ?? ''} placeholder="Optional notes" class="input" />
						</div>
						<div class="flex gap-2 sm:col-span-2">
							<button type="button" class="btn btn-ghost" onclick={() => (editingCardId = null)}>Cancel</button>
							<button class="btn btn-primary">Update card</button>
						</div>
					</form>
				{/if}

				{#if c.benefits.length}
					<ul class="mt-3 space-y-1.5">
						{#each c.benefits as b (b.id)}
							<li class="list-item-compact flex items-center justify-between gap-3">
								{#if editingBenefitId === b.id}
									<form method="POST" action="?/updateBenefit" class="flex flex-1 flex-wrap items-end gap-3">
										<input type="hidden" name="id" value={b.id} />
										<input type="hidden" name="cardId" value={c.id} />
										<div class="field">
											<label class="label" for={`benefitType-${b.id}`}>Benefit</label>
											<select id={`benefitType-${b.id}`} name="benefitType" class="select">
												<option value="trip_delay" selected={b.benefitType === 'trip_delay'}>Trip delay</option>
												<option value="baggage_delay" selected={b.benefitType === 'baggage_delay'}>Baggage delay</option>
												<option value="trip_cancellation" selected={b.benefitType === 'trip_cancellation'}>Trip cancellation</option>
												<option value="other" selected={b.benefitType === 'other'}>Other</option>
											</select>
										</div>
										<div class="field">
											<label class="label" for={`coverageAmount-${b.id}`}>Coverage</label>
											<input id={`coverageAmount-${b.id}`} name="coverageAmount" type="number" value={b.coverageAmount ?? ''} placeholder="0" class="input" />
										</div>
										<div class="field">
											<label class="label" for={`currency-${b.id}`}>Currency</label>
											<input id={`currency-${b.id}`} name="currency" value={b.currency} class="input" />
										</div>
										<div class="field">
											<label class="label" for={`benefitNotes-${b.id}`}>Notes</label>
											<input id={`benefitNotes-${b.id}`} name="notes" value={b.notes ?? ''} placeholder="Optional" class="input" />
										</div>
										<div class="action-row">
											<button type="button" class="btn btn-ghost" onclick={() => (editingBenefitId = null)}>Cancel</button>
											<button class="btn btn-primary">Update</button>
										</div>
									</form>
								{:else}
									<span class="text-sm text-slate-300">{benefitLabel[b.benefitType] ?? b.benefitType}</span>
									<div class="flex items-center gap-3">
										<span class="font-mono text-xs text-slate-400">{b.coverageAmount ?? '—'} {b.currency}</span>
										<div class="action-row gap-1">
											<button type="button" class="btn btn-ghost btn-ghost-indigo" onclick={() => (editingBenefitId = b.id)}>Edit</button>
											<form method="POST" action="?/deleteBenefit">
												<input type="hidden" name="id" value={b.id} />
												<input type="hidden" name="cardId" value={c.id} />
												<ConfirmButton class="btn btn-ghost btn-ghost-danger" message="Delete this benefit?">Delete</ConfirmButton>
											</form>
										</div>
									</div>
								{/if}
							</li>
						{/each}
					</ul>
				{:else}
					<p class="mt-3 text-xs text-slate-500">No benefits added yet.</p>
				{/if}

				<form method="POST" action="?/addBenefit" class="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
					<input type="hidden" name="cardId" value={c.id} />
					<div class="field">
						<label class="label" for={`template-${c.id}`}>Template</label>
						<select id={`template-${c.id}`} name="templateId" bind:value={selectedTemplateId} class="select">
							<option value="">Custom</option>
							{#each data.templates as t (t.id)}
								<option value={t.id}>{t.name} ({benefitLabel[t.benefitType] ?? t.benefitType})</option>
							{/each}
						</select>
					</div>
					<div class="field">
						<label class="label" for={`benefitType-${c.id}`}>Benefit</label>
						<select id={`benefitType-${c.id}`} name="benefitType" class="select" disabled={!!selectedTemplate}>
							<option value="trip_delay">Trip delay</option>
							<option value="baggage_delay">Baggage delay</option>
							<option value="trip_cancellation">Trip cancellation</option>
							<option value="other">Other</option>
						</select>
						{#if selectedTemplate}
							<p class="mt-1 text-xs text-slate-500">Using {selectedTemplate.name}</p>
						{/if}
					</div>
					<div class="field">
						<label class="label" for={`coverageAmount-${c.id}`}>Coverage (cents)</label>
						<input id={`coverageAmount-${c.id}`} name="coverageAmount" type="number" placeholder="0" class="input" disabled={!!selectedTemplate} />
					</div>
					<button class="btn btn-ghost">Add benefit</button>
				</form>
			</section>
		{/each}
	</div>
{:else}
	<div class="empty-state">
		<div class="empty-icon">
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-6 w-6"><rect width="20" height="14" x="2" y="5" rx="2" /><path d="M2 10h20" /></svg>
		</div>
		<p class="text-slate-300">No cards yet — add one below to track its benefits.</p>
	</div>
{/if}

<section class="card mt-6 p-5">
	<h2 class="section-title mb-3">Add card</h2>
	<form method="POST" action="?/addCard" class="grid gap-4 sm:grid-cols-2">
		<div class="field">
			<label class="label" for="nickname">Nickname</label>
			<input id="nickname" name="nickname" placeholder="e.g. Sapphire Reserve" class="input" required />
		</div>
		<div class="field">
			<label class="label" for="network">Network</label>
			<select id="network" name="network" class="select">
				<option value="visa">Visa</option>
				<option value="mc">Mastercard</option>
				<option value="amex">Amex</option>
				<option value="disc">Discover</option>
				<option value="other">Other</option>
			</select>
		</div>
		<div class="field">
			<label class="label" for="last4">Last 4</label>
			<input id="last4" name="last4" placeholder="1234" maxlength="4" inputmode="numeric" class="input" />
		</div>
		<div class="field">
			<label class="label" for="notes">Notes</label>
			<input id="notes" name="notes" placeholder="Optional notes" class="input" />
		</div>
		<div class="sm:col-span-2">
			<button class="btn btn-primary">Add card</button>
		</div>
	</form>
</section>
