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

	function fmt(iso: string | null | undefined, tz = 'UTC') {
		if (!iso) return '';
		try {
			return new Intl.DateTimeFormat('en-US', {
				dateStyle: 'medium',
				timeStyle: 'short',
				timeZone: tz
			}).format(new Date(iso));
		} catch {
			return iso;
		}
	}
</script>

{#if data.owner === true}
	<header class="flex flex-wrap items-end justify-between gap-4">
		<div class="min-w-0">
			<h1 class="truncate text-3xl font-extrabold text-white">{data.trip.name}</h1>
			<p class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
				{#if data.trip.destination}<span>{data.trip.destination}</span>{/if}
				{#if data.trip.startDate || data.trip.endDate}
					<span class="font-mono text-xs text-slate-500">{data.trip.startDate || '—'} → {data.trip.endDate || '—'}</span>
				{/if}
			</p>
		</div>
		<div class="flex gap-2">
			<a href={`/trips/${data.trip.id}/edit`} class="btn btn-ghost btn-sm">Edit</a>
			<a href={`/trips/${data.trip.id}/share`} class="btn btn-ghost btn-sm">Share</a>
		</div>
	</header>

	<section class="card mt-6 p-5">
		<h2 class="section-title mb-3">Itinerary</h2>
		{#if data.segments.length}
			<ul class="space-y-2">
				{#each data.segments as s (s.id)}
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
								{fmt(s.startAt, s.startTz)}{#if s.endAt} → {fmt(s.endAt, s.startTz)}{/if}
							</div>
							<div class="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-slate-500">
								{#if s.location}<span>{s.location}</span>{/if}
								{#if s.confirmationNumber}<span class="font-mono">conf {s.confirmationNumber}</span>{/if}
							</div>
						</div>
						<form method="POST" action={`/trips/${data.trip.id}/segments?/delete`}>
							<input type="hidden" name="segmentId" value={s.id} />
							<button class="rounded-md px-2 py-1 text-xs text-slate-400 transition hover:bg-red-500/10 hover:text-red-300">Delete</button>
						</form>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="py-6 text-center text-sm text-slate-500">No segments yet. Add a flight or stay below.</p>
		{/if}
	</section>

	<section class="card mt-6 p-5">
		<h2 class="section-title mb-3">Add segment</h2>
		<form method="POST" action={`/trips/${data.trip.id}/segments?/add`} class="grid gap-4 sm:grid-cols-2">
			<div class="field">
				<label class="label" for="type">Type</label>
				<select id="type" name="type" class="select">
					<option value="flight">Flight</option>
					<option value="lodging">Lodging</option>
				</select>
			</div>
			<div class="field">
				<label class="label" for="title">Title</label>
				<input id="title" name="title" placeholder="UA123 / Grand Hotel" class="input" required />
			</div>
			<div class="field">
				<label class="label" for="localStart">Starts</label>
				<input id="localStart" name="localStart" type="datetime-local" class="input" required />
			</div>
			<div class="field">
				<label class="label" for="startTz">Timezone</label>
				<input id="startTz" name="startTz" placeholder="America/New_York" value="UTC" class="input" />
			</div>
			<div class="field">
				<label class="label" for="location">Location</label>
				<input id="location" name="location" placeholder="JFK → LHR" class="input" />
			</div>
			<div class="field">
				<label class="label" for="confirmationNumber">Confirmation #</label>
				<input id="confirmationNumber" name="confirmationNumber" placeholder="ABC123" class="input" />
			</div>
			<div class="sm:col-span-2">
				<button class="btn btn-primary">Add segment</button>
			</div>
		</form>
	</section>

	{#if data.providers?.length}
		<section class="card mt-6 flex flex-wrap items-center gap-3 p-5">
			<h2 class="section-title mr-auto">Fare watch</h2>
			<form method="POST" action={`/trips/${data.trip.id}/fare-watch?/enable`} class="flex items-center gap-2">
				<select name="providerId" class="select w-auto">
					{#each data.providers as p (p.id)}
						<option value={p.id}>{p.providerKey}</option>
					{/each}
				</select>
				<button class="btn btn-ghost">Enable</button>
			</form>
		</section>
	{/if}
{:else}
	<header>
		<span class="badge badge-brand">Shared view</span>
		<h1 class="mt-2 text-3xl font-extrabold text-white">{data.trip.name}</h1>
		<p class="mt-1 flex flex-wrap items-center gap-x-3 text-sm text-muted">
			{#if data.trip.destination}<span>{data.trip.destination}</span>{/if}
			{#if data.trip.startDate || data.trip.endDate}
				<span class="font-mono text-xs text-slate-500">{data.trip.startDate || '—'} → {data.trip.endDate || '—'}</span>
			{/if}
		</p>
	</header>

	<section class="card mt-6 p-5">
		<h2 class="section-title mb-3">Itinerary</h2>
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
	</section>
{/if}
