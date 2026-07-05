<script lang="ts">
	import { enhance } from '$app/forms';
	import PasswordStrength from '$lib/components/PasswordStrength.svelte';
	import Icon from '$lib/components/Icon.svelte';

	let { data, form } = $props();

	let step = $state(1);
	let instanceName = $state('Roamarr');
	let timezone = $state('UTC');
	let displayName = $state('');
	let email = $state('');
	let password = $state('');
	let confirmPassword = $state('');
	let submitting = $state(false);

	const passwordsMatch = $derived(password === confirmPassword || confirmPassword === '');
	const canContinue = $derived(data.setupCheck?.writable);
	const canSubmit = $derived(
		!!displayName && !!email && password.length >= 8 && password === confirmPassword
	);

	function statusClass(ok?: boolean) {
		return ok ? 'text-green-600' : 'text-red-600';
	}
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

		{#if step === 1}
			<div class="mt-6 grid gap-4">
				<div class="field">
					<label class="label" for="instanceName">Instance name</label>
					<input id="instanceName" bind:value={instanceName} class="input" />
				</div>
				<div class="field">
					<label class="label" for="timezone">Timezone</label>
					<input id="timezone" bind:value={timezone} class="input" placeholder="America/New_York" />
				</div>

				<div class="rounded border p-4 mt-2">
					<h2 class="font-semibold mb-2">System check</h2>
					<ul class="space-y-2">
						<li class="flex items-center gap-2 {statusClass(data.setupCheck?.secretPresent)}">
							<Icon name={data.setupCheck?.secretPresent ? 'check' : 'empty'} class="w-5 h-5" />
							<span>ROAMARR_SECRET {data.setupCheck?.secretPresent ? 'is set' : 'is missing'}</span>
						</li>
						<li class="flex items-center gap-2 {statusClass(data.setupCheck?.encrypted)}">
							<Icon name={data.setupCheck?.encrypted ? 'check' : 'empty'} class="w-5 h-5" />
							<span>Database encryption {data.setupCheck?.encrypted ? 'verified' : 'not verified'}</span>
						</li>
						<li class="flex items-center gap-2 {statusClass(data.setupCheck?.writable)}">
							<Icon name={data.setupCheck?.writable ? 'check' : 'empty'} class="w-5 h-5" />
							<span>Database {data.setupCheck?.writable ? 'writable' : 'not writable'}</span>
						</li>
					</ul>
					{#if data.setupCheck?.error || data.bootError}
						<div class="mt-3 p-3 rounded bg-red-50 text-red-800 text-sm font-mono whitespace-pre-wrap">
							{data.setupCheck?.error ?? data.bootError}
						</div>
					{/if}
				</div>

				<div class="flex gap-3">
					<button type="button" class="btn btn-secondary flex-1" onclick={() => location.reload()}>Re-check</button>
					<button type="button" class="btn btn-primary flex-1" disabled={!canContinue} onclick={() => step = 2}>Continue</button>
				</div>
			</div>
		{:else}
			<form method="POST" class="mt-6 grid gap-4" use:enhance={() => { submitting = true; return async ({ update }) => { await update(); submitting = false; }; }} aria-busy={submitting}>
				<input type="hidden" name="instanceName" value={instanceName} />
				<input type="hidden" name="timezone" value={timezone} />

				<div class="field">
					<label class="label" for="displayName">Your name</label>
					<input id="displayName" name="displayName" bind:value={displayName} class="input" required disabled={submitting} />
				</div>
				<div class="field">
					<label class="label" for="email">Email</label>
					<input id="email" name="email" type="email" bind:value={email} class="input" required disabled={submitting} />
				</div>
				<div class="field">
					<label class="label" for="password">Password</label>
					<input id="password" name="password" type="password" autocomplete="new-password" bind:value={password} class="input" required disabled={submitting} />
					<PasswordStrength {password} />
				</div>
				<div class="field">
					<label class="label" for="confirmPassword">Confirm password</label>
					<input id="confirmPassword" name="confirmPassword" type="password" autocomplete="new-password" bind:value={confirmPassword} class="input" required disabled={submitting} />
					{#if !passwordsMatch}
						<p class="field-error text-sm mt-1">Passwords do not match.</p>
					{/if}
				</div>

				<div class="flex gap-3 mt-1">
					<button type="button" class="btn btn-secondary flex-1" disabled={submitting} onclick={() => step = 1}>Back</button>
					<button type="submit" class="btn btn-primary flex-1" disabled={submitting || !canSubmit} class:btn-loading={submitting}>Create admin</button>
				</div>
			</form>
		{/if}
	{/if}
</div>
