<script lang="ts">
	let { form } = $props();
</script>

<div class="card w-full max-w-md p-7 sm:p-8">
	<h1 class="text-2xl font-extrabold text-white">Reset password</h1>
	<p class="mt-1 text-sm text-muted">Enter your email and we’ll send you a reset link.</p>

	{#if form?.error}<p class="notice notice-error mt-4">{form.error}</p>{/if}
	{#if form?.success}<p class="notice notice-success mt-4">If an account exists, a reset link has been sent.</p>{/if}

	<form method="POST" class="mt-6 grid gap-4">
		<div class="field">
			<label class="label" for="email">Email</label>
			<input id="email" name="email" type="email" autocomplete="email" placeholder="you@example.com" class="input" required />
		</div>
		<button class="btn btn-primary mt-1 w-full">Send reset link</button>
	</form>

	<p class="mt-5 text-center text-sm text-muted">
		Remember your password? <a href="/login" class="link">Sign in</a>
	</p>
</div>
