<script lang="ts">
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { useDateFormat } from '$lib/dateFormatContext.svelte';

	let { data } = $props();

	const { formatDate, formatDateTime } = useDateFormat();
	const unread = $derived(data.notifications.filter((n) => !n.readAt).length);
</script>

<header class="page-header">
	<div>
		<h1 class="page-title">Notifications</h1>
		<p class="page-subtitle">
			{#if unread > 0}
				{unread} unread alert{unread === 1 ? '' : 's'}
			{:else}
				You're all caught up.
			{/if}
		</p>
	</div>
	{#if unread > 0}
		<form method="POST" action="?/markAllRead">
			<button class="btn btn-primary">Mark all read</button>
		</form>
	{/if}
</header>

{#if data.notifications.length}
	<ul class="mt-6 space-y-3">
		{#each data.notifications as n (n.id)}
			<li class="card flex items-start gap-3 p-4">
				<span
					class="mt-1.5 h-2 w-2 shrink-0 rounded-full {n.readAt
						? 'bg-white/10'
						: 'bg-indigo-400'}"
				></span>
				<div class="min-w-0 flex-1">
					<div class="flex flex-wrap items-center gap-2">
						{#if n.link}
							<a href={n.link} class="link font-semibold no-underline hover:underline">{n.title}</a>
						{:else}
							<span class="font-semibold text-white">{n.title}</span>
						{/if}
						{#if !n.readAt}<span class="badge badge-brand">New</span>{/if}
					</div>
					{#if n.body}<p class="mt-0.5 text-sm text-slate-400">{n.body}</p>{/if}
					{#if n.createdAt}<p class="mt-1 font-mono text-xs text-slate-500">{formatDateTime(n.createdAt)}</p>{/if}
				</div>
				{#if n.readAt}
					<form method="POST" action="?/markUnread" class="shrink-0">
						<input type="hidden" name="id" value={n.id} />
						<button class="btn btn-primary">Mark unread</button>
					</form>
				{:else}
					<form method="POST" action="?/markRead" class="shrink-0">
						<input type="hidden" name="id" value={n.id} />
						<button class="btn btn-primary">Mark read</button>
					</form>
				{/if}
			</li>
		{/each}
	</ul>
{:else}
	<EmptyState message="No notifications yet.">
		{#snippet icon()}<Icon name="notification" class="h-6 w-6" />{/snippet}
	</EmptyState>
{/if}
