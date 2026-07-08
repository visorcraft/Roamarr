<script lang="ts">
	import CancelButton from '$lib/components/CancelButton.svelte';
	import ConfirmButton from '$lib/components/ConfirmButton.svelte';
	import { startRegistration as webauthnRegister } from '@simplewebauthn/browser';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { useDateFormat } from '$lib/dateFormatContext.svelte';

	const { formatDate, formatDateTime } = useDateFormat();

	let { data } = $props();

	let registering = $state(false);
	let newName = $state('');
	let regError = $state('');
	let isDirty = $state(false);

	async function startRegistration() {
		regError = '';
		if (!data.available) {
			regError = 'ORIGIN must be configured to use passkeys.';
			return;
		}
		try {
			registering = true;
			const opts = await fetch('/api/webauthn/register/options', { method: 'POST' }).then((r) => r.json());
			const credential = await webauthnRegister({ optionsJSON: opts });
			const name = newName.trim() || 'Passkey';
			const res = await fetch('/api/webauthn/register/verify', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ response: credential, name })
			});
			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				regError = body.message || 'Registration failed';
			} else {
				registering = false;
				window.location.reload();
			}
		} catch (e) {
			regError = e instanceof Error ? e.message : 'Registration failed';
		} finally {
			registering = false;
		}
	}

	let editingId = $state<number | null>(null);
	let dirtyIds = $state<Record<number, boolean>>({});
</script>

<header class="page-header">
	<div>
		<h1 class="page-title">Passkeys</h1>
		<p class="page-subtitle">
			{data.passkeys.length} passkey{data.passkeys.length === 1 ? '' : 's'} registered
		</p>
	</div>
</header>

<section class="card mt-6 p-5">
	<h2 class="section-title mb-3">Register a new passkey</h2>
	{#if !data.available}
		<p class="text-sm text-amber-400">Passkeys require the ORIGIN environment variable to be set.</p>
	{:else}
		<div class="space-y-4" oninput={() => (isDirty = true)}>
			<div class="field">
				<label class="label" for="passkeyName">Name (optional)</label>
				<input id="passkeyName" bind:value={newName} placeholder="e.g. iPhone, YubiKey" class="input" />
			</div>
			<div class="flex flex-wrap justify-end gap-2">
				<CancelButton dirty={isDirty} onConfirm={() => goto('/profile/security')}>Cancel</CancelButton>
				<button class="btn btn-primary" onclick={startRegistration} disabled={registering}>
					{registering ? 'Waiting…' : 'Add passkey'}
				</button>
			</div>
		</div>
		{#if regError}
			<p class="mt-2 text-sm text-red-400">{regError}</p>
		{/if}
	{/if}
</section>

{#if data.passkeys.length}
	<section class="card mt-6 p-5">
		<h2 class="section-title mb-3">Your passkeys</h2>
		<ul class="list-stack">
			{#each data.passkeys as pk (pk.id)}
				<li class="list-item flex items-center gap-3">
					<div class="min-w-0 flex-1">
						{#if editingId === pk.id}
							<form method="POST" action="?/rename" class="flex items-center justify-end gap-2" oninput={() => (dirtyIds[pk.id] = true)}>
								<input type="hidden" name="id" value={pk.id} />
								<input name="name" value={pk.name ?? ''} class="input min-w-0 flex-1" placeholder="Name" />
								<CancelButton class="btn btn-ghost btn-sm" dirty={dirtyIds[pk.id] ?? false} onConfirm={() => (editingId = null)}>Cancel</CancelButton>
								<button class="btn btn-primary btn-sm">Save</button>
							</form>
						{:else}
							<div class="list-title">{pk.name ?? 'Unnamed passkey'}</div>
							<div class="meta mt-0.5">
								{pk.deviceType ?? 'Unknown device'}
								{#if pk.lastUsedAt}· Last used {formatDate(pk.lastUsedAt)}{/if}
							</div>
						{/if}
					</div>
					{#if editingId !== pk.id}
						<div class="flex gap-1">
							<button type="button" class="btn btn-primary btn-sm" onclick={() => { editingId = pk.id; dirtyIds[pk.id] = false; }}>Rename</button>
							<form method="POST" action="?/delete">
								<input type="hidden" name="id" value={pk.id} />
								<ConfirmButton class="btn btn-danger btn-sm" message="Delete this passkey?">Delete</ConfirmButton>
							</form>
						</div>
					{/if}
				</li>
			{/each}
		</ul>
	</section>
{/if}

{#if page.form?.error}
	<p class="mt-4 text-sm text-red-400">{page.form.error}</p>
{/if}
