<script lang="ts">
	import { enhance } from '$app/forms';
	import ProfileTabs from '$lib/components/ProfileTabs.svelte';

	let { data, form } = $props();
	let submitting = $state(false);
</script>

<header class="page-header">
	<div>
		<h1 class="page-title">Email</h1>
		<p class="page-subtitle">Current address: {data.email}</p>
	</div>
</header>

<ProfileTabs />

{#if form?.error}<p class="notice notice-error mt-4">{form.error}</p>{/if}

<section class="card mt-6 p-5 sm:p-6">
	<form
		method="POST"
		action="?/changeEmail"
		use:enhance={() => {
			submitting = true;
			return async ({ update }) => {
				await update();
				submitting = false;
			};
		}}
		class="grid gap-4 sm:grid-cols-2"
	>
		<div class="field">
			<label class="label" for="newEmail">New email</label>
			<input id="newEmail" name="newEmail" type="email" class="input" required />
		</div>
		<div class="field">
			<label class="label" for="confirmEmail">Confirm new email</label>
			<input id="confirmEmail" name="confirmEmail" type="email" class="input" required />
		</div>
		<div class="field sm:col-span-2 sm:max-w-[calc(50%-0.5rem)]">
			<label class="label" for="currentPassword">Current password</label>
			<input id="currentPassword" name="currentPassword" type="password" class="input" required />
		</div>
		<div class="flex justify-end sm:col-span-2">
			<button class="btn btn-primary" class:btn-loading={submitting} disabled={submitting}>
				Change email
			</button>
		</div>
	</form>
</section>
