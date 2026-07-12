<script lang="ts">
	import Icon from '$lib/components/Icon.svelte';
	import TripCard from '$lib/components/TripCard.svelte';
	import { SEG } from '$lib/segmentLabels';
	import { useDateFormat } from '$lib/dateFormatContext.svelte';
	import { DateTime } from 'luxon';

	const { formatDate, formatDateTime } = useDateFormat();

	let { data } = $props();

	const firstName = $derived((data.user?.displayName ?? '').split(/\s+/)[0]);

	const stats = $derived([
		{ label: 'Upcoming trips', value: data.stats.upcoming, href: '/trips', accent: 'text-indigo-300' },
		{ label: 'Unread alerts', value: data.stats.unread, href: '/notifications', accent: 'text-amber-300' },
		{ label: 'Docs expiring', value: data.stats.expiring, href: '/profile/documents', accent: 'text-emerald-300' },
		{ label: 'Fare watches', value: data.stats.watches, href: '/fare-providers', accent: 'text-fuchsia-300' }
	]);
</script>

<header class="page-header">
	<div>
		<h1 class="page-title">Welcome back, {firstName}</h1>
		<p class="page-subtitle">
			{#if data.stats.unread > 0}
				You have <a href="/notifications" class="link">{data.stats.unread} unread alert{data.stats.unread === 1 ? '' : 's'}</a>.
			{:else}
				You're all caught up. Safe travels.
			{/if}
		</p>
	</div>
	<a href="/trips/new" class="btn btn-primary">
		<Icon name="plus" class="h-4 w-4" />
		New trip
	</a>
</header>

<section class="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
	{#each stats as s (s.label)}
		<a href={s.href} class="metric-card group">
			<div class="text-4xl font-extrabold {s.accent}">{s.value}</div>
			<div class="metric-label group-hover:text-slate-300">{s.label}</div>
		</a>
	{/each}
</section>

<section class="mt-8">
	<div class="panel-header">
		<h2 class="section-title">Today</h2>
		<span class="meta">{formatDate(DateTime.now().toISODate())}</span>
	</div>
	{#if data.agenda.length}
		<div class="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
			{#each data.agenda as item (`${item.kind}:${item.id}`)}
				<div>
					{#if item.kind === 'trip'}
						<a href={`/trips/${item.id}`} class="card flex h-full p-5">
							<span class="min-w-0">
								<span class="flex items-center gap-2">
									<span class="row-title">{item.name}</span>
									{#if item.isShared}<span class="badge badge-brand">Shared</span>{/if}
									<span class="badge badge-slate">Trip</span>
								</span>
								{#if item.destinationLabel}<span class="row-subtitle">{item.destinationLabel}</span>{/if}
							</span>
						</a>
					{:else}
						<a href={`/trips/${item.tripId}`} class="card flex h-full items-start justify-between gap-4 p-5">
							<span class="min-w-0">
								<span class="flex items-center gap-2">
									<span class="row-title">{item.title}</span>
									<span class="badge badge-slate">{SEG[item.type as keyof typeof SEG]?.label ?? item.type}</span>
									<span class="badge badge-amber">{item.kind === 'segment-start' ? 'Start' : 'End'}</span>
								</span>
								<span class="row-subtitle">{item.tripName}</span>
							</span>
							<span class="row-meta">{item.time}</span>
						</a>
					{/if}
				</div>
			{/each}
		</div>
	{:else}
		<p class="empty-text">Nothing on the agenda today.</p>
	{/if}
</section>

<div class="mt-8 grid gap-8 xl:grid-cols-2">
	<section>
		<div class="panel-header">
			<h2 class="section-title">Upcoming trips</h2>
			<a href="/trips" class="link text-sm">All trips</a>
		</div>
		{#if data.upcoming.length}
			<div class="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
				{#each data.upcoming as t (t.id)}
					<TripCard trip={t} />
				{/each}
			</div>
		{:else}
			<p class="empty-text">No upcoming trips yet.</p>
		{/if}
	</section>

	<section>
		<div class="panel-header">
			<h2 class="section-title">Documents expiring soon</h2>
			<a href="/profile/documents" class="link text-sm">Manage</a>
		</div>
		{#if data.expiring.length}
			<div class="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
				{#each data.expiring as d (d.id)}
					<div class="card flex items-center justify-between gap-4 p-5">
						<span class="text-sm font-medium capitalize">{d.type.replace('_', ' ')}</span>
						<span class="badge badge-amber font-mono">{formatDate(d.expiresOn)}</span>
					</div>
				{/each}
			</div>
		{:else}
			<p class="empty-text">Nothing expiring in the next few months.</p>
		{/if}
	</section>
</div>

<div class="mt-8 grid gap-8 xl:grid-cols-2">
<section>
	<div class="panel-header">
		<h2 class="section-title">Payments due soon</h2>
		<a href="/trips" class="link text-sm">All trips</a>
	</div>
	{#if data.paymentsDue.length}
		<div class="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
			{#each data.paymentsDue as p (`${p.tripId}-${p.segmentId}`)}
				<div>
					<a href={`/trips/${p.tripId}`} class="card flex h-full items-start justify-between gap-4 p-5">
						<span class="min-w-0">
							<span class="row-title">{p.title}</span>
							<span class="row-subtitle">{p.tripName}</span>
						</span>
						<span class="row-meta">{formatDate(p.paymentDueDate!)}</span>
					</a>
				</div>
			{/each}
		</div>
	{:else}
		<p class="empty-text">No payments due soon.</p>
	{/if}
</section>


<section>
	<div class="panel-header">
		<h2 class="section-title">Recent activity</h2>
		<a href="/trips" class="link text-sm">All trips</a>
	</div>
	{#if data.activity.length}
		<div class="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
			{#each data.activity as a (`${a.kind}-${a.id}`)}
				<div class="card flex items-start justify-between gap-4 p-5">
					<div class="min-w-0">
						<div class="flex items-center gap-2">
							<span class="row-title">{a.title ?? 'Comment'}</span>
							<span class="badge badge-slate badge-compact">{a.kind}</span>
						</div>
						<p class="row-subtitle truncate">{a.tripName}</p>
						{#if a.kind === 'comment'}
							<p class="mt-1 text-sm text-slate-300">{a.body ?? ''}</p>
							<p class="mt-0.5 text-xs text-slate-500">by {a.displayName ?? 'Unknown'}</p>
						{/if}
					</div>
					<span class="row-meta">{formatDateTime(a.createdAt)}</span>
				</div>
			{/each}
		</div>
	{:else}
		<p class="empty-text">No recent activity.</p>
	{/if}
</section>
</div>
