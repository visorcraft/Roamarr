<script lang="ts">
	import { DateTime } from 'luxon';
	import type { PageData } from './$types';

	let { data, form }: { data: PageData; form?: { error?: string } } = $props();
	let editingId = $state<number | null>(null);

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

	function toDatetimeLocal(iso: string | null | undefined, tz = 'UTC') {
		if (!iso) return '';
		const dt = DateTime.fromISO(iso, { zone: 'utc' }).setZone(tz);
		if (!dt.isValid) return iso;
		return dt.toFormat("yyyy-MM-dd'T'HH:mm");
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

	{#if form?.error}<p class="notice notice-error mt-4">{form.error}</p>{/if}

	<section class="card mt-6 p-5">
		<h2 class="section-title mb-3">Itinerary</h2>
		{#if data.segments.length}
			<ul class="space-y-2">
				{#each data.segments as s (s.id)}
					<li class="flex items-start gap-3 rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/5">
						{#if editingId === s.id}
							<form method="POST" action={`/trips/${data.trip.id}/segments?/update`} class="grid flex-1 gap-4 sm:grid-cols-2">
								<input type="hidden" name="segmentId" value={s.id} />
								<div class="field">
									<label class="label" for={`title-${s.id}`}>Title</label>
									<input id={`title-${s.id}`} name="title" value={s.title} class="input" required />
								</div>
								<div class="field">
									<label class="label" for={`localStart-${s.id}`}>Starts</label>
									<input id={`localStart-${s.id}`} name="localStart" type="datetime-local" value={toDatetimeLocal(s.startAt, s.startTz)} class="input" required />
								</div>
								<div class="field">
									<label class="label" for={`startTz-${s.id}`}>Timezone</label>
									<input id={`startTz-${s.id}`} name="startTz" value={s.startTz} class="input" />
								</div>
								<div class="field">
									<label class="label" for={`endAt-${s.id}`}>Ends</label>
									<input id={`endAt-${s.id}`} name="endAt" type="datetime-local" value={toDatetimeLocal(s.endAt, s.startTz)} class="input" />
								</div>
								<div class="field">
									<label class="label" for={`location-${s.id}`}>Location</label>
									<input id={`location-${s.id}`} name="location" value={s.location ?? ''} class="input" />
								</div>
								<div class="field">
									<label class="label" for={`confirmationNumber-${s.id}`}>Confirmation #</label>
									<input id={`confirmationNumber-${s.id}`} name="confirmationNumber" value={s.confirmationNumber ?? ''} class="input" />
								</div>
								<div class="field sm:col-span-2">
									<label class="label" for={`detailsJson-${s.id}`}>Details (JSON)</label>
									<textarea id={`detailsJson-${s.id}`} name="detailsJson" class="input h-20 font-mono text-xs">{s.detailsJson ?? ''}</textarea>
								</div>
								<div class="flex gap-2 sm:col-span-2">
									<button class="btn btn-primary">Save</button>
									<button type="button" class="btn btn-ghost" onclick={() => editingId = null}>Cancel</button>
								</div>
							</form>
						{:else}
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
							<div class="flex gap-1">
								<button type="button" class="rounded-md px-2 py-1 text-xs text-slate-400 transition hover:bg-slate-500/10 hover:text-slate-200" onclick={() => editingId = s.id}>Edit</button>
								<form method="POST" action={`/trips/${data.trip.id}/segments?/delete`}>
									<input type="hidden" name="segmentId" value={s.id} />
									<button class="rounded-md px-2 py-1 text-xs text-slate-400 transition hover:bg-red-500/10 hover:text-red-300">Delete</button>
								</form>
							</div>
						{/if}
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

	{#if data.providers?.length || data.watches?.length}
		<section class="card mt-6 p-5">
			<div class="mb-3 flex flex-wrap items-center gap-3">
				<h2 class="section-title mr-auto">Fare watch</h2>
				{#if data.providers?.length}
					<form method="POST" action={`/trips/${data.trip.id}/fare-watch?/enable`} class="flex items-center gap-2">
						<select name="providerId" class="select w-auto">
							{#each data.providers as p (p.id)}
								<option value={p.id}>{p.providerKey}</option>
							{/each}
						</select>
						<button class="btn btn-ghost">Enable</button>
					</form>
				{/if}
			</div>
			{#if data.watches?.length}
				<ul class="space-y-2">
					{#each data.watches as w (w.id)}
						{@const last = w.lastResultJson ? JSON.parse(w.lastResultJson) : null}
						<li class="flex items-center gap-3 rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/5">
							<div class="min-w-0 flex-1">
								<div class="flex flex-wrap items-center gap-2">
									<span class="badge badge-slate">{w.providerKey}</span>
									<span class="badge {w.status === 'active' ? 'badge-brand' : 'badge-slate'}">{w.status}</span>
								</div>
								{#if last?.summary}
									<p class="mt-1 text-xs text-slate-400">{last.summary}</p>
								{/if}
								{#if w.lastCheckedAt}
									<p class="mt-0.5 text-xs text-slate-500">Last checked: {fmt(w.lastCheckedAt)}</p>
								{/if}
							</div>
							<div class="flex items-center gap-1">
								{#if w.status === 'active'}
									<form method="POST" action={`/trips/${data.trip.id}/fare-watch?/pause`}>
										<input type="hidden" name="watchId" value={w.id} />
										<button class="rounded-md px-2 py-1 text-xs text-slate-400 transition hover:bg-amber-500/10 hover:text-amber-300">Pause</button>
									</form>
								{:else}
									<form method="POST" action={`/trips/${data.trip.id}/fare-watch?/resume`}>
										<input type="hidden" name="watchId" value={w.id} />
										<button class="rounded-md px-2 py-1 text-xs text-slate-400 transition hover:bg-emerald-500/10 hover:text-emerald-300">Resume</button>
									</form>
								{/if}
								<form method="POST" action={`/trips/${data.trip.id}/fare-watch?/delete`}>
									<input type="hidden" name="watchId" value={w.id} />
									<button class="rounded-md px-2 py-1 text-xs text-slate-400 transition hover:bg-red-500/10 hover:text-red-300">Delete</button>
								</form>
							</div>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="py-4 text-center text-sm text-slate-500">No fare watches enabled for this trip.</p>
			{/if}
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
