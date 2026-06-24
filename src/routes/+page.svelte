<script lang="ts">
	let { data } = $props();
	const firstName = $derived((data.user?.displayName ?? '').split(/\s+/)[0]);

	const stats = $derived([
		{ label: 'Upcoming trips', value: data.upcoming.length, href: '/trips', accent: 'text-indigo-300' },
		{ label: 'Unread alerts', value: data.unread, href: '/notifications', accent: 'text-amber-300' },
		{ label: 'Docs expiring', value: data.expiring.length, href: '/profile/documents', accent: 'text-emerald-300' }
	]);
</script>

<header class="flex flex-wrap items-end justify-between gap-4">
	<div>
		<h1 class="text-3xl font-extrabold text-white">Welcome back, {firstName}</h1>
		<p class="mt-1 text-sm text-muted">
			{#if data.unread > 0}
				You have <a href="/notifications" class="link">{data.unread} unread alert{data.unread === 1 ? '' : 's'}</a>.
			{:else}
				You're all caught up. Safe travels.
			{/if}
		</p>
	</div>
	<a href="/trips/new" class="btn btn-primary">
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="h-4 w-4"><path d="M5 12h14M12 5v14" /></svg>
		New trip
	</a>
</header>

<section class="mt-8 grid gap-4 sm:grid-cols-3">
	{#each stats as s (s.label)}
		<a href={s.href} class="card group p-5 transition hover:ring-white/20">
			<div class="text-4xl font-extrabold tracking-tight {s.accent}">{s.value}</div>
			<div class="mt-1 text-sm font-medium text-slate-400 group-hover:text-slate-300">{s.label}</div>
		</a>
	{/each}
</section>

<div class="mt-6 grid gap-6 lg:grid-cols-2">
	<section class="card p-5">
		<div class="mb-3 flex items-center justify-between">
			<h2 class="section-title">Upcoming trips</h2>
			<a href="/trips" class="link text-sm">All trips</a>
		</div>
		{#if data.upcoming.length}
			<ul class="divide-y divide-white/5">
				{#each data.upcoming as t (t.id)}
					<li>
						<a href={`/trips/${t.id}`} class="-mx-2 flex items-center justify-between rounded-lg px-2 py-3 transition hover:bg-white/5">
							<span class="min-w-0">
								<span class="flex items-center gap-2">
									<span class="block truncate font-semibold text-white">{t.name}</span>
									{#if t.isShared}<span class="badge badge-brand">Shared</span>{/if}
								</span>
								{#if t.destination}<span class="block truncate text-sm text-slate-400">{t.destination}</span>{/if}
							</span>
							{#if t.startDate}<span class="ml-3 shrink-0 font-mono text-xs text-slate-400">{t.startDate}</span>{/if}
						</a>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="py-6 text-center text-sm text-slate-500">No upcoming trips yet.</p>
		{/if}
	</section>

	<section class="card p-5">
		<div class="mb-3 flex items-center justify-between">
			<h2 class="section-title">Documents expiring soon</h2>
			<a href="/profile/documents" class="link text-sm">Manage</a>
		</div>
		{#if data.expiring.length}
			<ul class="divide-y divide-white/5">
				{#each data.expiring as d (d.id)}
					<li class="flex items-center justify-between py-3">
						<span class="text-sm font-medium text-slate-200 capitalize">{d.type.replace('_', ' ')}</span>
						<span class="badge badge-amber font-mono">{d.expiresOn}</span>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="py-6 text-center text-sm text-slate-500">Nothing expiring in the next few months.</p>
		{/if}
	</section>
</div>
