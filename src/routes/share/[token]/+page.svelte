<script lang="ts">
	let { data } = $props();

	const SEG = {
		flight: {
			label: 'Flight',
			icon: '<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>'
		},
		lodging: {
			label: 'Lodging',
			icon: '<path d="M2 4v16"/><path d="M2 8h18a2 2 0 0 1 2 2v10"/><path d="M2 17h20"/><path d="M6 8v9"/>'
		}
	} as const;

	function fmt(iso: string | null | undefined) {
		if (!iso) return '';
		try {
			return new Intl.DateTimeFormat('en-US', {
				dateStyle: 'medium',
				timeStyle: 'short',
				timeZone: 'UTC'
			}).format(new Date(iso));
		} catch {
			return iso;
		}
	}
</script>

<div class="card w-full max-w-3xl p-7 sm:p-8">
	<p class="text-xs font-medium tracking-wide text-indigo-300/80 uppercase">Shared via {data.instanceName}</p>
	<h1 class="mt-2 text-3xl font-extrabold text-white">{data.trip.name}</h1>
	<p class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
		{#if data.trip.destination}
			<span class="flex items-center gap-1.5">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4 shrink-0 text-slate-500"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" /></svg>
				{data.trip.destination}
			</span>
		{/if}
		{#if data.trip.startDate || data.trip.endDate}
			<span class="font-mono text-xs text-slate-500">{data.trip.startDate || '—'} → {data.trip.endDate || '—'}</span>
		{/if}
	</p>

	<h2 class="section-title mt-7 mb-3">Itinerary</h2>
	{#if data.trip.segments.length}
		<ul class="space-y-2">
			{#each data.trip.segments as s, i (i)}
				<li class="flex items-start gap-3 rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/5">
					<span class="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-indigo-500/15 text-indigo-300 ring-1 ring-indigo-400/20">
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4.5 w-4.5">{@html SEG[s.type as keyof typeof SEG]?.icon ?? ''}</svg>
					</span>
					<div class="min-w-0 flex-1">
						<div class="flex items-center gap-2">
							<span class="badge badge-slate">{SEG[s.type as keyof typeof SEG]?.label ?? s.type}</span>
							<span class="truncate font-semibold text-white">{s.title}</span>
						</div>
						<div class="mt-1 font-mono text-xs text-slate-400">
							{fmt(s.startAt)}{#if s.endAt} → {fmt(s.endAt)}{/if}
						</div>
						{#if s.location}<div class="mt-0.5 text-xs text-slate-500">{s.location}</div>{/if}
					</div>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="py-6 text-center text-sm text-slate-500">No itinerary shared.</p>
	{/if}
</div>
