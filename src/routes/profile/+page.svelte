<script lang="ts">
	import { browser } from '$app/environment';
	import { enhance } from '$app/forms';
	import { onDestroy } from 'svelte';
	import CopyButton from '$lib/components/CopyButton.svelte';
	import TimezoneSelect from '$lib/components/TimezoneSelect.svelte';
	import { formatDateTime } from '$lib/dateFormat';

	let { data, form } = $props();
	let selectedThemeId = $state('midnight-travels');
	let submittingProfile = $state(false);
	let submittingPassword = $state(false);
	let submittingEmail = $state(false);
	let submittingCalendar = $state(false);
	let submittingEmergency = $state(false);
	let editingContactId = $state<number | null>(null);

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

	const currencyOptions = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'CHF', 'NZD', 'MXN'];
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
	<form
		method="POST"
		action="?/updateProfile"
		use:enhance={() => {
			submittingProfile = true;
			return async ({ update }) => {
				await update();
				submittingProfile = false;
			};
		}}
		class="mt-4 grid gap-4 sm:grid-cols-2"
	>
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
		<div class="field">
			<label class="label" for="defaultCurrency">Default currency</label>
			<select id="defaultCurrency" name="defaultCurrency" value={data.user.defaultCurrency} class="input" required>
				{#each currencyOptions as currency}
					<option value={currency}>{currency}</option>
				{/each}
			</select>
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
			<button class="btn btn-primary" class:btn-loading={submittingProfile} disabled={submittingProfile}>
				Save profile
			</button>
		</div>
	</form>
</section>

<section class="card mt-6 p-5 sm:p-6">
	<h2 class="section-title">Change email</h2>
	<form
		method="POST"
		action="?/changeEmail"
		use:enhance={() => {
			submittingEmail = true;
			return async ({ update }) => {
				await update();
				submittingEmail = false;
			};
		}}
		class="mt-4 grid gap-4 sm:grid-cols-2"
	>
		<div class="field">
			<label class="label" for="currentPassword">Current password</label>
			<input id="currentPassword" name="currentPassword" type="password" class="input" required />
		</div>
		<div class="field">
			<label class="label" for="newEmail">New email</label>
			<input id="newEmail" name="newEmail" type="email" class="input" required />
		</div>
		<div class="field sm:col-span-2">
			<label class="label" for="confirmEmail">Confirm new email</label>
			<input id="confirmEmail" name="confirmEmail" type="email" class="input" required />
		</div>
		<div class="sm:col-span-2">
			<button class="btn btn-primary" class:btn-loading={submittingEmail} disabled={submittingEmail}>
				Change email
			</button>
		</div>
	</form>
</section>

<section class="card mt-6 p-5 sm:p-6">
	<h2 class="section-title">Change password</h2>
	<form
		method="POST"
		action="?/updatePassword"
		use:enhance={() => {
			submittingPassword = true;
			return async ({ update }) => {
				await update();
				submittingPassword = false;
			};
		}}
		class="mt-4 grid gap-4 sm:grid-cols-2"
	>
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
			<button class="btn btn-primary" class:btn-loading={submittingPassword} disabled={submittingPassword}>
				Update password
			</button>
		</div>
	</form>
</section>

<section class="card mt-6 p-5 sm:p-6">
	<h2 class="section-title">Active sessions</h2>
	{#if data.sessions.length}
		<ul class="mt-4 list-stack">
			{#each data.sessions as s (s.id)}
				<li class="list-item flex flex-wrap items-center justify-between gap-3">
					<div class="min-w-0 flex-1">
						<p class="list-title">
							{s.current ? 'This session' : `Session ${s.id}`}
							{#if s.current}<span class="badge badge-brand ml-2">Current</span>{/if}
						</p>
						<p class="meta mt-0.5">
							Created {formatDateTime(s.createdAt)} · Expires {formatDateTime(s.expiresAt)}
							{#if s.lastIp || s.userAgent}<span class="block text-xs">{s.userAgent || ''}{#if s.lastIp && s.userAgent} · {/if}{s.lastIp || ''}</span>{/if}
						</p>
					</div>
					<form method="POST" action="?/revokeSession">
						<input type="hidden" name="id" value={s.id} />
						<button type="submit" class="btn btn-danger">Revoke</button>
					</form>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="empty-text mt-4 text-left">No active sessions.</p>
	{/if}
</section>

<section class="card mt-6 p-5 sm:p-6">
	<h2 class="section-title">Aggregate calendar feed</h2>
	{#if data.feedUrl}
		<p class="mt-4 text-sm">Subscribe to all your trips with one calendar URL.</p>
		<div class="mt-2 flex items-start gap-2">
			<p class="code-chip flex-1 px-2.5 text-xs leading-relaxed">{data.feedUrl}</p>
			<CopyButton text={data.feedUrl} class="btn btn-ghost shrink-0" label="Copy" />
		</div>
		{#if data.calendarTokenExpiresAt}
			<p class="mt-2 text-xs text-muted">
				Expires {formatDateTime(data.calendarTokenExpiresAt)}
			</p>
		{/if}
		<form
			method="POST"
			action="?/regenerateCalendarToken"
			use:enhance={() => {
				submittingCalendar = true;
				return async ({ update }) => {
					await update();
					submittingCalendar = false;
				};
			}}
			class="mt-4 flex flex-col gap-2"
		>
			<label for="calendarExpiresAt" class="label">New URL expires (optional)</label>
			<input id="calendarExpiresAt" name="calendarExpiresAt" type="datetime-local" class="input text-sm" />
			<button class="btn btn-primary" class:btn-loading={submittingCalendar} disabled={submittingCalendar}>
				Regenerate feed URL
			</button>
		</form>
	{:else}
		<p class="empty-text mt-4 text-left">Generate a single .ics feed URL for all your trips.</p>
		<form
			method="POST"
			action="?/regenerateCalendarToken"
			use:enhance={() => {
				submittingCalendar = true;
				return async ({ update }) => {
					await update();
					submittingCalendar = false;
				};
			}}
			class="mt-4 flex flex-col gap-2"
		>
			<label for="calendarExpiresAt" class="label">Expires (optional)</label>
			<input id="calendarExpiresAt" name="calendarExpiresAt" type="datetime-local" class="input text-sm" />
			<button class="btn btn-primary" class:btn-loading={submittingCalendar} disabled={submittingCalendar}>
				Generate feed URL
			</button>
		</form>
	{/if}
</section>


<section class="card mt-6 p-5 sm:p-6">
	<h2 class="section-title">Emergency contacts</h2>
	{#if data.emergencyContacts.length}
		<ul class="mt-4 list-stack">
			{#each data.emergencyContacts as contact (contact.id)}
				<li class="list-item">
					{#if editingContactId === contact.id}
						<form
							method="POST"
							action="?/updateEmergencyContact"
							use:enhance={() => {
								submittingEmergency = true;
								return async ({ update }) => {
									await update();
									submittingEmergency = false;
									editingContactId = null;
								};
							}}
							class="grid gap-3 sm:grid-cols-2"
						>
							<input type="hidden" name="id" value={contact.id} />
							<div class="field">
								<label class="label" for={`ec-name-${contact.id}`}>Name</label>
								<input id={`ec-name-${contact.id}`} name="name" value={contact.name} class="input" required />
							</div>
							<div class="field">
								<label class="label" for={`ec-rel-${contact.id}`}>Relationship</label>
								<input id={`ec-rel-${contact.id}`} name="relationship" value={contact.relationship ?? ''} class="input" />
							</div>
							<div class="field">
								<label class="label" for={`ec-phone-${contact.id}`}>Phone</label>
								<input id={`ec-phone-${contact.id}`} name="phone" type="tel" value={contact.phone ?? ''} class="input" />
							</div>
							<div class="field">
								<label class="label" for={`ec-email-${contact.id}`}>Email</label>
								<input id={`ec-email-${contact.id}`} name="email" type="email" value={contact.email ?? ''} class="input" />
							</div>
							<div class="field sm:col-span-2">
								<label class="checkbox-label">
									<input type="checkbox" name="isPrimary" checked={contact.isPrimary} class="checkbox" />
									Primary contact
								</label>
							</div>
							<div class="flex flex-wrap gap-2 sm:col-span-2">
								<button class="btn btn-primary btn-sm" class:btn-loading={submittingEmergency} disabled={submittingEmergency}>
									Save
								</button>
								<button type="button" class="btn btn-ghost btn-sm" onclick={() => (editingContactId = null)}>
									Cancel
								</button>
							</div>
						</form>
					{:else}
						<div class="flex flex-wrap items-start justify-between gap-3">
							<div class="min-w-0">
								<p class="list-title flex flex-wrap items-center gap-2">
									{contact.name}
									{#if contact.isPrimary}<span class="badge badge-brand">Primary</span>{/if}
								</p>
								{#if contact.relationship}<p class="text-sm text-muted">{contact.relationship}</p>{/if}
								{#if contact.phone || contact.email}
									<p class="meta mt-1">
										{#if contact.phone}{contact.phone}{/if}
										{#if contact.phone && contact.email}<span class="mx-1">·</span>{/if}
										{#if contact.email}{contact.email}{/if}
									</p>
								{/if}
							</div>
							<div class="flex items-center gap-2">
								<button type="button" class="icon-button" onclick={() => (editingContactId = contact.id)} aria-label={`Edit ${contact.name}`}>
									<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
								</button>
								<form method="POST" action="?/deleteEmergencyContact" class="inline">
									<input type="hidden" name="id" value={contact.id} />
									<button class="icon-button icon-button-danger" aria-label={`Delete ${contact.name}`}>
										<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
									</button>
								</form>
							</div>
						</div>
					{/if}
				</li>
			{/each}
		</ul>
	{:else}
		<p class="empty-text mt-4 text-left">No emergency contacts saved yet.</p>
	{/if}

	<form
		method="POST"
		action="?/addEmergencyContact"
		use:enhance={() => {
			submittingEmergency = true;
			return async ({ update }) => {
				await update();
				submittingEmergency = false;
			};
		}}
		class="mt-6 grid gap-3 border-t border-white/5 pt-5 sm:grid-cols-2"
	>
		<div class="field sm:col-span-2">
			<h3 class="subsection-title">Add emergency contact</h3>
		</div>
		<div class="field">
			<label class="label" for="ec-name">Name</label>
			<input id="ec-name" name="name" class="input" required />
		</div>
		<div class="field">
			<label class="label" for="ec-relationship">Relationship</label>
			<input id="ec-relationship" name="relationship" class="input" />
		</div>
		<div class="field">
			<label class="label" for="ec-phone">Phone</label>
			<input id="ec-phone" name="phone" type="tel" class="input" />
		</div>
		<div class="field">
			<label class="label" for="ec-email">Email</label>
			<input id="ec-email" name="email" type="email" class="input" />
		</div>
		<div class="field sm:col-span-2">
			<label class="checkbox-label">
				<input type="checkbox" name="isPrimary" class="checkbox" />
				Primary contact
			</label>
		</div>
		<div class="sm:col-span-2">
			<button class="btn btn-primary" class:btn-loading={submittingEmergency} disabled={submittingEmergency}>
				Add contact
			</button>
		</div>
	</form>
</section>
