<script lang="ts">
	import { enhance } from '$app/forms';
	import ConfirmButton from '$lib/components/ConfirmButton.svelte';
	import CopyButton from '$lib/components/CopyButton.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import TextField from '$lib/components/TextField.svelte';
	import SelectField from '$lib/components/SelectField.svelte';

	let { data, form } = $props();
	let sharingUser = $state(false);
	let sharingGroup = $state(false);
	let makingPublic = $state(false);
	let calendarBusy = $state(false);
	const userShares = $derived(data.shares.filter((s) => s.email));
	const groupShares = $derived(data.shares.filter((s) => s.groupName));
</script>

<header class="page-header">
	<div class="min-w-0">
		<h1 class="page-title truncate">Share trip</h1>
		<p class="page-subtitle">Control who can see {data.trip.name}.</p>
	</div>
	<a href={`/trips/${data.trip.id}`} class="btn btn-ghost">Back to trip</a>
</header>

{#if form?.error}<p class="notice notice-error mt-6">{form.error}</p>{/if}

<section class="card mt-6 p-5 sm:p-6">
	<h2 class="section-title mb-3">Shared with people</h2>
	{#if userShares.length}
		<ul class="list-stack">
			{#each userShares as s (s.id)}
				<li class="list-item flex items-center justify-between gap-3">
					<div class="flex items-center gap-3 min-w-0">
						<span class="list-icon">
							<Icon name="user" class="h-4 w-4" />
						</span>
						<div class="min-w-0">
							<p class="list-title text-sm">{s.displayName || s.email}</p>
							{#if s.displayName}<p class="field-help truncate">{s.email}</p>{/if}
						</div>
						<span class="badge badge-slate uppercase">{s.permission}</span>
					</div>
					<div class="action-row">
						<form method="POST" action="?/setShowDetails">
							<input type="hidden" name="shareId" value={s.id} />
							<input type="hidden" name="showDetails" value={s.showDetails ? '0' : '1'} />
							<button class="btn btn-ghost">{s.showDetails ? 'Hide details' : 'Show details'}</button>
						</form>
						<form method="POST" action="?/unshareUser">
							<input type="hidden" name="shareId" value={s.id} />
							<ConfirmButton class="btn btn-danger" aria-label="Remove share" message="Remove this share?">Remove</ConfirmButton>
						</form>
					</div>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="empty-text py-4 text-left">Not shared with anyone yet.</p>
	{/if}
	{#if data.invitations.length}
		<h3 class="mt-6 font-semibold">Pending invitations</h3>
		<ul class="list-stack mt-2">
			{#each data.invitations as invitation (invitation.id)}
				<li class="list-item flex items-center justify-between gap-3">
					<div><p class="list-title text-sm">{invitation.email}</p><p class="field-help uppercase">{invitation.permission} · expires {invitation.expiresAt.slice(0, 10)}</p></div>
					<form method="POST" action="?/revokeInvitation"><input type="hidden" name="invitationId" value={invitation.id} /><ConfirmButton class="btn btn-danger" message="Revoke this invitation?">Revoke</ConfirmButton></form>
				</li>
			{/each}
		</ul>
	{/if}

	<form method="POST" action="?/shareUser" class="mt-6 grid gap-4 sm:grid-cols-2" use:enhance={() => { sharingUser = true; return async ({ update }) => { await update(); sharingUser = false; }; }} aria-busy={sharingUser}>
		<TextField name="email" label="Email address" type="email" placeholder="user@example.com" required disabled={sharingUser} />
		<SelectField name="permission" id="permission-user" label="Permission" disabled={sharingUser}>
				<option value="read">Read</option>
				<option value="edit">Edit</option>
		</SelectField>
		<div class="flex justify-end sm:col-span-2">
			<button class="btn btn-primary" disabled={sharingUser} class:btn-loading={sharingUser}>Send invitation</button>
		</div>
	</form>
</section>

{#if data.groups.length || groupShares.length}
	<section class="card mt-6 p-5 sm:p-6">
		<h2 class="section-title mb-3">Shared with groups</h2>
		{#if groupShares.length}
			<ul class="list-stack">
				{#each groupShares as s (s.id)}
					<li class="list-item flex items-center justify-between gap-3">
						<div class="flex items-center gap-3 min-w-0">
							<span class="list-icon">
								<Icon name="users" class="h-4 w-4" />
							</span>
							<span class="list-title text-sm">{s.groupName}</span>
							<span class="badge badge-slate uppercase">{s.permission}</span>
						</div>
						<div class="action-row">
							<form method="POST" action="?/setShowDetails">
								<input type="hidden" name="shareId" value={s.id} />
								<input type="hidden" name="showDetails" value={s.showDetails ? '0' : '1'} />
								<button class="btn btn-ghost">{s.showDetails ? 'Hide details' : 'Show details'}</button>
							</form>
							<form method="POST" action="?/unshareGroup">
								<input type="hidden" name="shareId" value={s.id} />
								<ConfirmButton class="btn btn-danger" aria-label="Remove group share" message="Remove this group share?">Remove</ConfirmButton>
							</form>
						</div>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="empty-text py-4 text-left">Not shared with any groups yet.</p>
		{/if}

		{#if data.groups.length}
			<form method="POST" action="?/shareGroup" class="mt-6 grid gap-4 sm:grid-cols-2" use:enhance={() => { sharingGroup = true; return async ({ update }) => { await update(); sharingGroup = false; }; }} aria-busy={sharingGroup}>
				<SelectField name="groupId" label="Group" disabled={sharingGroup}>
						{#each data.groups as g (g.id)}
							<option value={g.id}>{g.name}</option>
						{/each}
				</SelectField>
				<SelectField name="permission" id="permission-group" label="Permission" disabled={sharingGroup}>
						<option value="read">Read</option>
						<option value="edit">Edit</option>
				</SelectField>
				<div class="flex justify-end sm:col-span-2">
					<button class="btn btn-primary" disabled={sharingGroup} class:btn-loading={sharingGroup}>Share</button>
				</div>
			</form>
		{/if}
	</section>
{/if}

<section class="card mt-6 p-5 sm:p-6">
	<h2 class="section-title mb-3">Public link</h2>
	{#if data.publicShareUrl}
		<p class="field-help">Anyone with this link can view the trip.</p>
		<div class="mt-2 flex items-center gap-2">
			<p class="code-chip flex-1">/share/{data.trip.publicToken}</p>
			<CopyButton text={data.publicShareUrl} class="btn btn-ghost shrink-0" label="Copy link" />
		</div>
		<form method="POST" action="?/setPublicShowDetails" class="mt-3">
			<input type="hidden" name="publicShowDetails" value={data.trip.publicShowDetails ? '0' : '1'} />
			<button class="btn btn-ghost">{data.trip.publicShowDetails ? 'Hide details on public link' : 'Show details on public link'}</button>
		</form>
		<form method="POST" action="?/revokePublic" class="mt-3">
			<ConfirmButton class="btn btn-danger" message="Revoke the public link? Anyone with the link will lose access.">Revoke public link</ConfirmButton>
		</form>
	{:else}
		<p class="field-help">Generate a link that lets anyone view this trip without an account. You can optionally set an expiry.</p>
		<form method="POST" action="?/makePublic" class="mt-4 grid gap-4 sm:grid-cols-2" use:enhance={() => { makingPublic = true; return async ({ update }) => { await update(); makingPublic = false; }; }} aria-busy={makingPublic}>
			<TextField name="publicExpiresAt" label="Expires (optional)" type="datetime-local" disabled={makingPublic} />
			<div class="field flex items-end">
				<label class="checkbox-label">
					<input type="checkbox" name="publicShowDetails" value="1" class="checkbox" disabled={makingPublic} />
					Show confirmation numbers and details
				</label>
			</div>
			<div class="flex justify-end sm:col-span-2">
				<button class="btn btn-primary" disabled={makingPublic} class:btn-loading={makingPublic}>Create public link</button>
			</div>
		</form>
	{/if}
</section>

<section class="card mt-6 p-5 sm:p-6">
	<h2 class="section-title">Calendar feed</h2>
	<p class="field-help mt-1">Subscribe to this trip from a calendar app using a private feed URL.</p>
	{#if data.feedUrl}
		<div class="mt-4 flex items-start gap-2">
			<p class="code-chip flex-1 px-2.5 text-xs leading-relaxed">{data.feedUrl}</p>
			<CopyButton text={data.feedUrl} class="btn btn-ghost shrink-0" label="Copy feed URL" />
		</div>
		<div class="mt-4 grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
			<form method="POST" action="?/regenerateCalendarFeed" class="grid gap-4" use:enhance={() => { calendarBusy = true; return async ({ update }) => { await update(); calendarBusy = false; }; }} aria-busy={calendarBusy}>
				<TextField name="calendarExpiresAt" label="New URL expires (optional)" type="datetime-local" disabled={calendarBusy} />
				<div class="flex justify-end"><button class="btn btn-primary" disabled={calendarBusy} class:btn-loading={calendarBusy}>Regenerate feed URL</button></div>
			</form>
			<form method="POST" action="?/revokeCalendarFeed" use:enhance={() => { calendarBusy = true; return async ({ update }) => { await update(); calendarBusy = false; }; }} aria-busy={calendarBusy}>
				<ConfirmButton class="btn btn-danger" disabled={calendarBusy} message="Revoke the calendar feed URL? Calendar apps using it will stop receiving updates.">Revoke feed URL</ConfirmButton>
			</form>
		</div>
	{:else}
		<form method="POST" action="?/regenerateCalendarFeed" class="mt-4 grid gap-4 sm:grid-cols-2" use:enhance={() => { calendarBusy = true; return async ({ update }) => { await update(); calendarBusy = false; }; }} aria-busy={calendarBusy}>
			<TextField name="calendarExpiresAt" label="Expires (optional)" type="datetime-local" disabled={calendarBusy} />
			<div class="flex justify-end sm:col-span-2"><button class="btn btn-primary" disabled={calendarBusy} class:btn-loading={calendarBusy}>Generate feed URL</button></div>
		</form>
	{/if}
</section>
