<script lang="ts">
	let { data } = $props();

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
</script>

<header class="flex flex-wrap items-end justify-between gap-4">
	<div>
		<h1 class="text-3xl font-extrabold text-white">Cards</h1>
		<p class="mt-1 text-sm text-muted">
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
					<form method="POST" action="?/deleteCard">
						<input type="hidden" name="id" value={c.id} />
						<button class="rounded-md px-2 py-1 text-xs text-slate-400 transition hover:bg-red-500/10 hover:text-red-300">Delete</button>
					</form>
				</div>

				{#if c.benefits.length}
					<ul class="mt-3 space-y-1.5">
						{#each c.benefits as b (b.id)}
							<li class="flex items-center justify-between gap-3 rounded-lg bg-white/[0.03] px-3 py-2 ring-1 ring-white/5">
								<span class="text-sm text-slate-300">{benefitLabel[b.benefitType] ?? b.benefitType}</span>
								<span class="font-mono text-xs text-slate-400">{b.coverageAmount ?? '—'} {b.currency}</span>
							</li>
						{/each}
					</ul>
				{:else}
					<p class="mt-3 text-xs text-slate-500">No benefits added yet.</p>
				{/if}

				<form method="POST" action="?/addBenefit" class="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
					<input type="hidden" name="cardId" value={c.id} />
					<div class="field">
						<label class="label" for={`benefitType-${c.id}`}>Benefit</label>
						<select id={`benefitType-${c.id}`} name="benefitType" class="select">
							<option value="trip_delay">Trip delay</option>
							<option value="baggage_delay">Baggage delay</option>
							<option value="trip_cancellation">Trip cancellation</option>
							<option value="other">Other</option>
						</select>
					</div>
					<div class="field">
						<label class="label" for={`coverageAmount-${c.id}`}>Coverage (cents)</label>
						<input id={`coverageAmount-${c.id}`} name="coverageAmount" type="number" placeholder="0" class="input" />
					</div>
					<button class="btn btn-ghost btn-sm">Add benefit</button>
				</form>
			</section>
		{/each}
	</div>
{:else}
	<div class="card mt-6 grid place-items-center gap-3 p-12 text-center">
		<div class="grid h-12 w-12 place-items-center rounded-full bg-indigo-500/10 text-indigo-300 ring-1 ring-indigo-400/20">
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
