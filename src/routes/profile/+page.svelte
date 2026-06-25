<script lang="ts">
	import { browser } from '$app/environment';
	import { onDestroy } from 'svelte';
	import TimezoneSelect from '$lib/components/TimezoneSelect.svelte';
	import { formatDateTime } from '$lib/dateFormat';

	let { data, form } = $props();
	let selectedThemeId = $state('midnight-travels');

	function applyThemePreview(themeId: string) {
		if (!browser) return;
		document.querySelector<HTMLElement>('.theme-root')?.setAttribute('data-theme', themeId);
		const theme = data.themes.find((candidate) => candidate.id === themeId);
		if (theme) document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute('content', theme.themeColor);
	}

	$effect(() => {
		selectedThemeId = data.user.themeId;
	});

	$effect(() => {
		applyThemePreview(selectedThemeId);
	});

	onDestroy(() => applyThemePreview(data.user.themeId));

	const selectedThemeName = $derived(
		data.themes.find((theme) => theme.id === selectedThemeId)?.name ?? 'Midnight Travels'
	);
</script>

<header class="page-header">
	<div>
		<h1 class="page-title">Your profile</h1>
		<p class="page-subtitle">{data.user.email}</p>
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
			<div class="flex flex-wrap items-center justify-between gap-2">
				<span id="theme-label" class="label">Theme</span>
				<span class="badge badge-brand">{selectedThemeName}</span>
			</div>
			<div class="theme-option-grid" role="radiogroup" aria-labelledby="theme-label">
				{#each data.themes as theme (theme.id)}
					<label class="theme-option">
						<input
							type="radio"
							name="themeId"
							value={theme.id}
							bind:group={selectedThemeId}
						/>
						<span class="theme-option-preview theme-preview" data-theme={theme.id} aria-hidden="true">
							<span class="theme-option-sidebar"></span>
							<span class="theme-option-surface">
								<span class="theme-option-line"></span>
								<span class="theme-option-line theme-option-line-muted"></span>
								<span class="theme-option-accent"></span>
							</span>
						</span>
						<span class="min-w-0 flex-1">
							<span class="theme-option-name block font-semibold">{theme.name}</span>
							<span class="theme-option-description mt-1 block text-xs">{theme.description}</span>
						</span>
					</label>
				{/each}
			</div>
		</div>
		<div class="field sm:col-span-2">
			<label class="checkbox-label">
				<input type="checkbox" name="emailNotifications" checked={data.user.emailNotifications} class="checkbox" />
				Email notifications
			</label>
		</div>
		<div class="field sm:col-span-2">
			<label class="checkbox-label">
				<input type="checkbox" name="webhookNotifications" checked={data.user.webhookNotifications} class="checkbox" />
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
		<ul class="mt-4 list-stack">
			{#each data.sessions as s (s.id)}
				<li class="list-item flex flex-wrap items-center justify-between gap-3">
					<div class="text-sm">
						<p class="font-medium text-white">
							{s.current ? 'This session' : `Session ${s.id}`}
							{#if s.current}<span class="badge badge-brand ml-2">Current</span>{/if}
						</p>
						<p class="text-slate-400">
							Created {formatDateTime(s.createdAt)} · Expires {formatDateTime(s.expiresAt)}
							{#if s.lastIp || s.userAgent}<span class="block text-xs text-slate-500">{s.userAgent || ''}{#if s.lastIp && s.userAgent} · {/if}{s.lastIp || ''}</span>{/if}
						</p>
					</div>
					<form method="POST" action="?/revokeSession">
						<input type="hidden" name="id" value={s.id} />
						<button class="btn btn-ghost btn-ghost-danger">Revoke</button>
					</form>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="empty-text mt-4 text-left">No active sessions.</p>
	{/if}
</section>
