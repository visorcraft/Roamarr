<script lang="ts">
	import { enhance } from '$app/forms';
	import PasswordStrength from '$lib/components/PasswordStrength.svelte';

	let { data, form } = $props();
	let password = $state('');
	let submitting = $state(false);
</script>

<div class="card w-full max-w-md p-7 sm:p-8">
	<h1 class="auth-title">Welcome to Roamarr</h1>
	<p class="page-subtitle">Create your admin account to get started.</p>

	{#if data.missingSecret}
		<div class="notice notice-error mt-6">
			<p class="font-semibold">ROAMARR_SECRET is required before setup.</p>
			<p class="mt-2">
				Roamarr encrypts sensitive data at rest with this key. Generate one with:
			</p>
			<pre class="mt-2 rounded bg-black/10 p-3 font-mono text-sm overflow-x-auto">openssl rand -base64 32</pre>
			<p class="mt-2">
				Then set it as the environment variable (or paste it into <code>.env</code>) and restart
				the app:
			</p>
			<pre class="mt-2 rounded bg-black/10 p-3 font-mono text-sm overflow-x-auto">ROAMARR_SECRET=&lt;output-from-openssl&gt;</pre>
		</div>
	{:else}
		{#if form?.error}<p class="notice notice-error mt-4">{form.error}</p>{/if}

		<form method="POST" class="mt-6 grid gap-4" use:enhance={() => { submitting = true; return async ({ update }) => { await update(); submitting = false; }; }} aria-busy={submitting}>
			<div class="field">
				<label class="label" for="instanceName">Instance name</label>
				<input id="instanceName" name="instanceName" placeholder="Roamarr" value="Roamarr" class="input" disabled={submitting} />
			</div>
			<div class="field">
				<label class="label" for="displayName">Your name</label>
				<input id="displayName" name="displayName" placeholder="Ada Lovelace" class="input" required disabled={submitting} />
			</div>
			<div class="field">
				<label class="label" for="email">Email</label>
				<input id="email" name="email" type="email" autocomplete="email" placeholder="you@example.com" class="input" required disabled={submitting} />
			</div>
			<div class="field">
				<label class="label" for="password">Password</label>
				<input id="password" name="password" type="password" autocomplete="new-password" placeholder="At least 8 characters" class="input" required bind:value={password} disabled={submitting} />
				<PasswordStrength {password} />
			</div>
			<div class="field">
				<label class="label" for="timezone">Timezone</label>
				<input id="timezone" name="timezone" placeholder="America/New_York" value="UTC" class="input" disabled={submitting} />
			</div>
			<button class="btn btn-primary mt-1 w-full" disabled={submitting} class:btn-loading={submitting}>Create admin</button>
		</form>
	{/if}
</div>
