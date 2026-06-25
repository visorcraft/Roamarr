<script lang="ts">
	let { form, data } = $props();
</script>

<div class="card w-full max-w-md p-7 sm:p-8">
	<h1 class="auth-title">Set new password</h1>
	<p class="page-subtitle">Choose a new password for your account.</p>

	{#if form?.error}<p class="notice notice-error mt-4">{form.error}</p>{/if}

	<form method="POST" class="mt-6 grid gap-4">
		<input type="hidden" name="token" value={data.token} />
		<div class="field">
			<label class="label" for="password">New password</label>
			<input id="password" name="password" type="password" autocomplete="new-password" placeholder="At least 8 characters" class="input" required />
		</div>
		<div class="field">
			<label class="label" for="confirmPassword">Confirm password</label>
			<input id="confirmPassword" name="confirmPassword" type="password" autocomplete="new-password" placeholder="Repeat password" class="input" required />
		</div>
		<button class="btn btn-primary mt-1 w-full">Update password</button>
	</form>
</div>
