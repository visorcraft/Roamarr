<script lang="ts">
	import TimezoneSelect from '$lib/components/TimezoneSelect.svelte';

	let { data, form } = $props();

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
		<h1 class="text-3xl font-extrabold text-white">Your profile</h1>
		<p class="mt-1 text-sm text-muted">{data.user.email}</p>
	</div>
</header>

{#if form?.error}<p class="notice notice-error mt-4">{form.error}</p>{/if}

<section class="card mt-6 p-5 sm:p-6">
	<h2 class="section-title">Profile</h2>
	<form method="POST" action="?/updateProfile" class="mt-4 grid gap-4 sm:grid-cols-2">
		<div class="field">
			<label class="label" for="displayName">Display name</label>
			<input id="displayName" name="displayName" value={data.user.displayName} class="input" required />
		</div>
		<div class="field">
			<label class="label" for="timezone">Timezone</label>
			<TimezoneSelect id="timezone" name="timezone" value={data.user.timezone} required class="input" />
		</div>
		<div class="field">
			<label class="label" for="flightCheckinLeadHours">Flight check-in lead (hours)</label>
			<input
				id="flightCheckinLeadHours"
				name="flightCheckinLeadHours"
				type="number"
				min="0"
				step="1"
				value={data.user.flightCheckinLeadHours}
				class="input"
				required
			/>
		</div>
		<div class="field">
			<label class="label" for="documentExpiryLeadDays">Document expiry lead (days)</label>
			<input
				id="documentExpiryLeadDays"
				name="documentExpiryLeadDays"
				type="number"
				min="0"
				step="1"
				value={data.user.documentExpiryLeadDays}
				class="input"
				required
			/>
		</div>
		<div class="field sm:col-span-2">
			<label class="flex items-center gap-2 text-sm text-slate-300">
				<input type="checkbox" name="emailNotifications" checked={data.user.emailNotifications} class="h-4 w-4 rounded border-white/20 bg-white/5 text-indigo-500 accent-indigo-500" />
				Email notifications
			</label>
		</div>
		<div class="field sm:col-span-2">
			<label class="flex items-center gap-2 text-sm text-slate-300">
				<input type="checkbox" name="webhookNotifications" checked={data.user.webhookNotifications} class="h-4 w-4 rounded border-white/20 bg-white/5 text-indigo-500 accent-indigo-500" />
				Webhook notifications
			</label>
		</div>
		<div class="sm:col-span-2">
			<button class="btn btn-primary">Save profile</button>
		</div>
	</form>
</section>

<section class="card mt-6 p-5 sm:p-6">
	<h2 class="section-title">Change password</h2>
	<form method="POST" action="?/updatePassword" class="mt-4 grid gap-4 sm:grid-cols-2">
		<div class="field">
			<label class="label" for="oldPassword">Current password</label>
			<input id="oldPassword" name="oldPassword" type="password" class="input" required />
		</div>
		<div class="field">
			<label class="label" for="newPassword">New password</label>
			<input id="newPassword" name="newPassword" type="password" class="input" required />
		</div>
		<div class="field">
			<label class="label" for="confirmPassword">Confirm new password</label>
			<input id="confirmPassword" name="confirmPassword" type="password" class="input" required />
		</div>
		<div class="sm:col-span-2">
			<button class="btn btn-primary">Update password</button>
		</div>
	</form>
</section>

<section class="card mt-6 p-5 sm:p-6">
	<h2 class="section-title">Active sessions</h2>
	{#if data.sessions.length}
		<ul class="mt-4 divide-y divide-white/5">
			{#each data.sessions as s (s.id)}
				<li class="flex flex-wrap items-center justify-between gap-3 py-3">
					<div class="text-sm">
						<p class="font-medium text-white">
							{s.current ? 'This session' : `Session ${s.id}`}
							{#if s.current}<span class="badge badge-brand ml-2">Current</span>{/if}
						</p>
						<p class="text-slate-400">
							Created {fmt(s.createdAt)} · Expires {fmt(s.expiresAt)}
							{#if s.lastIp || s.userAgent}<span class="block text-xs text-slate-500">{s.userAgent || ''}{#if s.lastIp && s.userAgent} · {/if}{s.lastIp || ''}</span>{/if}
						</p>
					</div>
					<form method="POST" action="?/revokeSession">
						<input type="hidden" name="id" value={s.id} />
						<button class="btn btn-ghost text-red-300 hover:text-red-200">Revoke</button>
					</form>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="mt-4 text-sm text-slate-500">No active sessions.</p>
	{/if}
</section>
