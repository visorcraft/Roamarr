<script lang="ts">
	import { enhance } from '$app/forms';
	import TimezoneSelect from '$lib/components/TimezoneSelect.svelte';
	import ProfileTabs from '$lib/components/ProfileTabs.svelte';

	let { data, form } = $props();
	let submittingProfile = $state(false);

	const currencyOptions = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'CHF', 'NZD', 'MXN'];
</script>

<header class="page-header">
	<div>
		<h1 class="page-title">Your profile</h1>
		<p class="page-subtitle">{data.user.email}</p>
	</div>
</header>

<ProfileTabs />

{#if form?.error}<p class="notice notice-error mt-6">{form.error}</p>{/if}

<section class="card mt-6 p-5 sm:p-6">
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
		class="grid gap-4 sm:grid-cols-2"
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
		<div class="flex justify-end sm:col-span-2">
			<button class="btn btn-primary" class:btn-loading={submittingProfile} disabled={submittingProfile}>
				Save profile
			</button>
		</div>
	</form>
</section>
