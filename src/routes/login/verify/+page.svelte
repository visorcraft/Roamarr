<script lang="ts">
	import { page } from '$app/state';

	let code = $state('');
</script>

<svelte:head>
	<title>Two-factor verification — Roamarr</title>
</svelte:head>

<div class="mx-auto mt-20 max-w-sm">
	<h1 class="page-title mb-2 text-center">Verification required</h1>
	<p class="page-subtitle mb-6 text-center">
		Enter the 6-digit code from your authenticator app, or a backup code.
	</p>

	{#if page.status === 400 || page.status === 401 || page.status === 429}
		<p class="mb-4 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-center text-sm text-red-400">
			{page.form?.error ?? 'Invalid code.'}
		</p>
	{/if}

	<form method="POST" class="space-y-4">
		<div class="field">
			<label class="label" for="code">Authentication code</label>
			<input
				id="code"
				name="code"
				bind:value={code}
				placeholder="123456"
				class="input text-center text-lg tracking-widest"
				autocomplete="one-time-code"
				inputmode="numeric"
			/>
		</div>
		<button class="btn btn-primary w-full">Verify</button>
	</form>

	<p class="meta mt-4 text-center">
		<a href="/login" class="text-indigo-400 hover:underline">Back to login</a>
	</p>
</div>
