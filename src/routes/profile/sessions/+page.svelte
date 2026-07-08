<script lang="ts">
	import { useDateFormat } from '$lib/dateFormatContext.svelte';
	import ProfileTabs from '$lib/components/ProfileTabs.svelte';

	let { data } = $props();
	const { formatDateTime } = useDateFormat();
</script>

<header class="page-header">
	<div>
		<h1 class="page-title">Active sessions</h1>
		<p class="page-subtitle">Devices and browsers currently signed in to your account.</p>
	</div>
</header>

<ProfileTabs />

<section class="card mt-6 p-5 sm:p-6">
	{#if data.sessions.length}
		<ul class="list-stack">
			{#each data.sessions as s (s.id)}
				<li class="list-item flex flex-wrap items-center justify-between gap-3">
					<div class="min-w-0 flex-1">
						<p class="list-title">
							{s.current ? 'This session' : `Session ${s.id}`}
							{#if s.current}<span class="badge badge-brand ml-2">Current</span>{/if}
						</p>
						<p class="meta mt-0.5">
							Created {formatDateTime(s.createdAt)} · Expires {formatDateTime(s.expiresAt)}
							{#if s.lastIp || s.userAgent}
								<span class="block">{s.userAgent || ''}{#if s.lastIp && s.userAgent} · {/if}{s.lastIp || ''}</span>
							{/if}
						</p>
					</div>
					<form method="POST" action="?/revokeSession" class="ml-auto flex justify-end">
						<input type="hidden" name="id" value={s.id} />
						<button type="submit" class="btn btn-danger">Revoke</button>
					</form>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="empty-text text-left">No active sessions.</p>
	{/if}
</section>
