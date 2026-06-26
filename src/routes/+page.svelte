<script lang="ts">
	import Icon from '$lib/components/Icon.svelte';
	import { SEG } from '$lib/segmentLabels';
import { formatDate } from '$lib/dateFormat';

	let { data } = $props();

	function daysUntil(iso: string | null | undefined) {
		if (!iso) return null;
		const start = new Date(`${iso}T00:00:00`);
		const now = new Date();
		now.setHours(0, 0, 0, 0);
		const diff = Math.ceil((start.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
		return diff > 0 ? diff : null;
	}
	const firstName = $derived((data.user?.displayName ?? '').split(/\s+/)[0]);

	const stats = $derived([
		{ label: 'Upcoming trips', value: data.stats.upcoming, href: '/trips', accent: 'text-indigo-300' },
		{ label: 'Unread alerts', value: data.stats.unread, href: '/notifications', accent: 'text-amber-300' },
		{ label: 'Docs expiring', value: data.stats.expiring, href: '/profile/documents', accent: 'text-emerald-300' },
		{ label: 'Fare watches', value: data.stats.watches, href: '/settings/fare-providers', accent: 'text-fuchsia-300' }
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

<section class="card mt-6 p-5">
	<div class="panel-header">
		<h2 class="section-title">Today</h2>
		<span class="meta">{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</span>
	</div>
	{#if data.agenda.length}
		<ul class="panel-list">
			{#each data.agenda as item (`${item.kind}:${item.id}`)}
				<li>
					{#if item.kind === 'trip'}
						<a href={`/trips/${item.id}`} class="row-link">
							<span class="min-w-0">
								<span class="flex items-center gap-2">
									<span class="row-title">{item.name}</span>
									{#if item.isShared}<span class="badge badge-brand">Shared</span>{/if}
									<span class="badge badge-slate">Trip</span>
								</span>
								{#if item.destination}<span class="row-subtitle">{item.destination}</span>{/if}
							</span>
						</a>
					{:else}
						<a href={`/trips/${item.tripId}`} class="row-link">
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
				</li>
			{/each}
		</ul>
	{:else}
		<p class="empty-text">Nothing on the agenda today.</p>
	{/if}
</section>

<div class="mt-6 grid gap-6 lg:grid-cols-2">
	<section class="card p-5">
		<div class="panel-header">
			<h2 class="section-title">Upcoming trips</h2>
			<a href="/trips" class="link text-sm">All trips</a>
		</div>
		{#if data.upcoming.length}
			<ul class="panel-list">
				{#each data.upcoming as t (t.id)}
					{@const until = daysUntil(t.startDate)}
					<li>
						<a href={`/trips/${t.id}`} class="row-link">
							<span class="min-w-0">
								<span class="flex items-center gap-2">
										<span class="row-title">{t.name}</span>
									{#if t.isShared}<span class="badge badge-brand">Shared</span>{/if}
									{#if until != null}<span class="badge badge-compact badge-brand">{until} day{until === 1 ? '' : 's'}</span>{/if}
								</span>
								{#if t.destination}<span class="row-subtitle">{t.destination}</span>{/if}
							</span>
							{#if t.startDate}<span class="row-meta">{t.startDate}</span>{/if}
						</a>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="empty-text">No upcoming trips yet.</p>
		{/if}
	</section>

	<section class="card p-5">
		<div class="panel-header">
			<h2 class="section-title">Documents expiring soon</h2>
			<a href="/profile/documents" class="link text-sm">Manage</a>
		</div>
		{#if data.expiring.length}
			<ul class="panel-list">
				{#each data.expiring as d (d.id)}
					<li class="row-static">
						<span class="text-sm font-medium capitalize">{d.type.replace('_', ' ')}</span>
						<span class="badge badge-amber font-mono">{d.expiresOn}</span>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="empty-text">Nothing expiring in the next few months.</p>
		{/if}
	</section>
</div>

<section class="card mt-6 p-5">
	<div class="panel-header">
		<h2 class="section-title">Payments due soon</h2>
		<a href="/trips" class="link text-sm">All trips</a>
	</div>
	{#if data.paymentsDue.length}
		<ul class="panel-list">
			{#each data.paymentsDue as p (`${p.tripId}-${p.segmentId}`)}
				<li>
					<a href={`/trips/${p.tripId}`} class="row-link">
						<span class="min-w-0">
							<span class="row-title">{p.title}</span>
							<span class="row-subtitle">{p.tripName}</span>
						</span>
						<span class="row-meta">{formatDate(p.paymentDueDate!)}</span>
					</a>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="empty-text">No payments due soon.</p>
	{/if}
</section>


<section class="card mt-6 p-5">
	<div class="panel-header">
		<h2 class="section-title">Recent activity</h2>
		<a href="/trips" class="link text-sm">All trips</a>
	</div>
	{#if data.activity.length}
		<ul class="panel-list">
			{#each data.activity as a (`${a.kind}-${a.id}`)}
				<li class="row-static">
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
					<span class="row-meta">{new Date(a.createdAt).toLocaleString()}</span>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="empty-text">No recent activity.</p>
	{/if}
</section>
