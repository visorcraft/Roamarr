<script lang="ts">
	import { enhance } from '$app/forms';
	import CancelButton from '$lib/components/CancelButton.svelte';

	let { data, form } = $props();
	let submitting = $state(false);
	let editingContactId = $state<number | null>(null);
	let dirtyContactIds = $state<Record<number, boolean>>({});
</script>

<header class="page-header">
	<div>
		<h1 class="page-title">Emergency contacts</h1>
		<p class="page-subtitle">People to reach in case of an emergency.</p>
	</div>
</header>

{#if form?.error}<p class="notice notice-error mt-6">{form.error}</p>{/if}

<section class="card mt-6 p-5 sm:p-6">
	{#if data.emergencyContacts.length}
		<ul class="list-stack">
			{#each data.emergencyContacts as contact (contact.id)}
				<li class="list-item">
					{#if editingContactId === contact.id}
						<form
							method="POST"
							action="?/updateEmergencyContact"
							use:enhance={() => {
								submitting = true;
								return async ({ update }) => {
									await update();
									submitting = false;
									editingContactId = null;
								};
							}}
							class="grid gap-3 sm:grid-cols-2"
							oninput={() => (dirtyContactIds[contact.id] = true)}
						>
							<input type="hidden" name="id" value={contact.id} />
							<div class="field">
								<label class="label" for={`ec-name-${contact.id}`}>Name</label>
								<input id={`ec-name-${contact.id}`} name="name" value={contact.name} class="input" required />
							</div>
							<div class="field">
								<label class="label" for={`ec-rel-${contact.id}`}>Relationship</label>
								<input id={`ec-rel-${contact.id}`} name="relationship" value={contact.relationship ?? ''} class="input" />
							</div>
							<div class="field">
								<label class="label" for={`ec-phone-${contact.id}`}>Phone</label>
								<input id={`ec-phone-${contact.id}`} name="phone" type="tel" value={contact.phone ?? ''} class="input" />
							</div>
							<div class="field">
								<label class="label" for={`ec-email-${contact.id}`}>Email</label>
								<input id={`ec-email-${contact.id}`} name="email" type="email" value={contact.email ?? ''} class="input" />
							</div>
							<div class="field sm:col-span-2">
								<label class="checkbox-label">
									<input type="checkbox" name="isPrimary" checked={contact.isPrimary} class="checkbox" />
									Primary contact
								</label>
							</div>
							<div class="flex flex-wrap justify-end gap-2 sm:col-span-2">
								<CancelButton
									class="btn btn-ghost btn-sm"
									dirty={dirtyContactIds[contact.id] ?? false}
									onConfirm={() => (editingContactId = null)}>Cancel</CancelButton
								>
								<button class="btn btn-primary btn-sm" class:btn-loading={submitting} disabled={submitting}>
									Save
								</button>
							</div>
						</form>
					{:else}
						<div class="flex flex-wrap items-start justify-between gap-3">
							<div class="min-w-0">
								<p class="list-title flex flex-wrap items-center gap-2">
									{contact.name}
									{#if contact.isPrimary}<span class="badge badge-brand">Primary</span>{/if}
								</p>
								{#if contact.relationship}<p class="text-sm muted">{contact.relationship}</p>{/if}
								{#if contact.phone || contact.email}
									<p class="meta mt-1">
										{#if contact.phone}{contact.phone}{/if}
										{#if contact.phone && contact.email}<span class="mx-1">·</span>{/if}
										{#if contact.email}{contact.email}{/if}
									</p>
								{/if}
							</div>
							<div class="flex items-center gap-2">
								<button
									type="button"
									class="icon-button"
									onclick={() => {
										editingContactId = contact.id;
										dirtyContactIds[contact.id] = false;
									}}
									aria-label={`Edit ${contact.name}`}
								>
									<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
								</button>
								<form method="POST" action="?/deleteEmergencyContact" class="inline">
									<input type="hidden" name="id" value={contact.id} />
									<button class="icon-button icon-button-danger" aria-label={`Delete ${contact.name}`}>
										<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
									</button>
								</form>
							</div>
						</div>
					{/if}
				</li>
			{/each}
		</ul>
	{:else}
		<p class="empty-text text-left">No emergency contacts saved yet.</p>
	{/if}

	<form
		method="POST"
		action="?/addEmergencyContact"
		use:enhance={() => {
			submitting = true;
			return async ({ update }) => {
				await update();
				submitting = false;
			};
		}}
		class="mt-6 grid gap-3 border-t border-white/5 pt-5 sm:grid-cols-2"
	>
		<div class="field sm:col-span-2">
			<h3 class="subsection-title">Add emergency contact</h3>
		</div>
		<div class="field">
			<label class="label" for="ec-name">Name</label>
			<input id="ec-name" name="name" class="input" required />
		</div>
		<div class="field">
			<label class="label" for="ec-relationship">Relationship</label>
			<input id="ec-relationship" name="relationship" class="input" />
		</div>
		<div class="field">
			<label class="label" for="ec-phone">Phone</label>
			<input id="ec-phone" name="phone" type="tel" class="input" />
		</div>
		<div class="field">
			<label class="label" for="ec-email">Email</label>
			<input id="ec-email" name="email" type="email" class="input" />
		</div>
		<div class="field sm:col-span-2">
			<label class="checkbox-label">
				<input type="checkbox" name="isPrimary" class="checkbox" />
				Primary contact
			</label>
		</div>
		<div class="flex justify-end sm:col-span-2">
			<button class="btn btn-primary" class:btn-loading={submitting} disabled={submitting}>
				Add contact
			</button>
		</div>
	</form>
</section>
