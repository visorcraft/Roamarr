<script lang="ts">
	let { data, form } = $props();
</script>

<div class="card w-full max-w-md p-7 sm:p-8">
	<h1 class="text-2xl font-extrabold text-white">Sign in</h1>
	<p class="mt-1 text-sm text-muted">Welcome back to your travel HQ.</p>

	{#if form?.error}<p class="notice notice-error mt-4">{form.error}</p>{/if}

	<form method="POST" class="mt-6 grid gap-4">
		<div class="field">
			<label class="label" for="email">Email</label>
			<input id="email" name="email" type="email" autocomplete="email" placeholder="you@example.com" class="input" required />
		</div>
		<div class="field">
			<label class="label" for="password">Password</label>
			<input id="password" name="password" type="password" autocomplete="current-password" placeholder="••••••••" class="input" required />
		</div>
		<div class="flex items-center justify-between">
			<a href="/forgot-password" class="text-sm link">Forgot password?</a>
			<button class="btn btn-primary">Sign in</button>
		</div>
	</form>

	{#if data.allowRegistration}
		<p class="mt-5 text-center text-sm text-muted">
			Need an account? <a href="/register" class="link">Create one</a>
		</p>
	{/if}
</div>
