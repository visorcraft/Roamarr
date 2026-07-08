<script lang="ts">
	import { goto } from '$app/navigation';
	import CancelButton from '$lib/components/CancelButton.svelte';
	import type { PageData } from './$types';

	let {
		data,
		form
	}: {
		data: PageData;
		form?: { error?: string; backupCodes?: string[] };
	} = $props();
	let setupToken = $state('');
	let savedAck = $state(false);
	let isDirty = $state(false);

	const backupCodes = $derived(form?.backupCodes);
</script>

<header class="page-header">
	<div>
		<h1 class="page-title">Set up two-factor authentication</h1>
		<p class="page-subtitle">Scan the QR code with your authenticator app.</p>
	</div>
</header>

{#if form?.error}<p class="notice notice-error mt-4">{form.error}</p>{/if}

<section class="card mt-6 p-5 sm:p-6">
	{#if backupCodes}
		<div class="notice notice-warning p-4">
			<p class="text-sm font-medium">Save these backup codes</p>
			<p class="field-help mt-1">Each can be used once if you lose access to your authenticator. They won't be shown again.</p>
			<div class="mt-3 grid grid-cols-2 gap-2 font-mono text-sm">
				{#each backupCodes as code (code)}<span class="rounded bg-surface2 px-2 py-1 text-center">{code}</span>{/each}
			</div>
			<label class="mt-4 flex items-center gap-2 text-sm">
				<input type="checkbox" bind:checked={savedAck} class="checkbox" />
				I saved these backup codes
			</label>
			<a
				href="/profile/security"
				class="btn btn-primary mt-3 inline-block"
				class:opacity-50={!savedAck}
				class:pointer-events-none={!savedAck}
				aria-disabled={!savedAck}
			>
				Done
			</a>
		</div>
	{:else}
		<form
			method="POST"
			action="/profile/security?/enable"
			class="space-y-4"
			oninput={() => (isDirty = true)}
		>
			<p class="text-sm">
				Scan this QR code with your authenticator app (Google Authenticator, Authy, etc.), or enter the secret manually.
			</p>
			<img src={data.setup.qr} alt="QR code" class="mx-auto rounded-lg border border-line" />
			<div class="rounded-md bg-surface2 px-3 py-2 text-center font-mono text-sm">
				{data.setup.secret}
			</div>
			<input type="hidden" name="secret" value={data.setup.secret} />
			<div class="field">
				<label class="label" for="setupToken">Enter the 6-digit code</label>
				<input
					id="setupToken"
					name="token"
					bind:value={setupToken}
					class="input text-center text-lg tracking-widest"
					inputmode="numeric"
					placeholder="123456"
					autocomplete="one-time-code"
				/>
			</div>
			<div class="flex flex-wrap justify-end gap-2">
				<CancelButton dirty={isDirty} onConfirm={() => goto('/profile/security')}>Cancel</CancelButton>
				<button class="btn btn-primary">Enable 2FA</button>
			</div>
		</form>
	{/if}
</section>
