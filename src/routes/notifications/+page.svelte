<script lang="ts">
	let { data } = $props();

	const unread = $derived(data.notifications.filter((n) => !n.readAt).length);

	function fmt(iso: string | null | undefined) {
		if (!iso) return '';
		try {
			return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
		} catch {
			return iso;
		}
	}
</script>

<header class="flex flex-wrap items-end justify-between gap-4">
	<div>
		<h1 class="text-3xl font-extrabold text-white">Notifications</h1>
		<p class="mt-1 text-sm text-muted">
			{#if unread > 0}
				{unread} unread alert{unread === 1 ? '' : 's'}
			{:else}
				You're all caught up.
			{/if}
		</p>
	</div>
</header>

{#if data.notifications.length}
	<ul class="mt-6 space-y-3">
		{#each data.notifications as n (n.id)}
			<li
				class="card flex items-start gap-3 p-4 {n.readAt
					? ''
					: 'ring-indigo-400/30 bg-indigo-500/[0.04]'}"
			>
				<span
					class="mt-1.5 h-2 w-2 shrink-0 rounded-full {n.readAt
						? 'bg-white/10'
						: 'bg-indigo-400'}"
				></span>
				<div class="min-w-0 flex-1">
					<div class="flex flex-wrap items-center gap-2">
						<span class="font-semibold text-white">{n.title}</span>
						{#if !n.readAt}<span class="badge badge-brand">New</span>{/if}
					</div>
					{#if n.body}<p class="mt-0.5 text-sm text-slate-400">{n.body}</p>{/if}
					{#if n.createdAt}<p class="mt-1 font-mono text-xs text-slate-500">{fmt(n.createdAt)}</p>{/if}
				</div>
				{#if !n.readAt}
					<form method="POST" action="?/markRead" class="shrink-0">
						<input type="hidden" name="id" value={n.id} />
						<button class="btn btn-ghost btn-sm">Mark read</button>
					</form>
				{/if}
			</li>
		{/each}
	</ul>
{:else}
	<div class="card mt-6 grid place-items-center gap-3 p-12 text-center">
		<div class="grid h-12 w-12 place-items-center rounded-full bg-indigo-500/10 text-indigo-300 ring-1 ring-indigo-400/20">
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-6 w-6"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
		</div>
		<p class="text-slate-300">No notifications yet.</p>
	</div>
{/if}
