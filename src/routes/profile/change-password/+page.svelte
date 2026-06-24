<script lang="ts">
	import PasswordStrength from '$lib/components/PasswordStrength.svelte';

	let { data, form } = $props();
	let newPassword = $state('');
</script>

<header>
	<h1 class="text-3xl font-extrabold text-white">Choose a new password</h1>
	<p class="mt-1 text-sm text-muted">
		Your account must set a new password before you can continue. Signed in as {data.email}.
	</p>
</header>

{#if form?.error}
	<p class="notice notice-error mt-4">{form.error}</p>
{/if}

<section class="card mt-6 p-5 sm:p-6 sm:max-w-lg">
	<form method="POST" class="grid gap-4">
		<div class="field">
			<label class="label" for="newPassword">New password</label>
			<input id="newPassword" name="newPassword" type="password" autocomplete="new-password" class="input" required bind:value={newPassword} />
			<PasswordStrength password={newPassword} />
		</div>
		<div class="field">
			<label class="label" for="confirmPassword">Confirm new password</label>
			<input
				id="confirmPassword"
				name="confirmPassword"
				type="password"
				autocomplete="new-password"
				class="input"
				required
			/>
		</div>
		<button class="btn btn-primary">Save password</button>
	</form>
</section>
