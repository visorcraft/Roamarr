<script lang="ts">
	import ConfirmButton from '$lib/components/ConfirmButton.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Icon from '$lib/components/Icon.svelte';

	let { data } = $props();
</script>

<header class="page-header">
	<div>
		<h1 class="page-title">Groups</h1>
		<p class="page-subtitle">
			{data.groups.length} group{data.groups.length === 1 ? '' : 's'} you own
		</p>
	</div>
</header>

<section class="card mt-6 p-5">
	<h2 class="section-title mb-3">Create a group</h2>
	<form method="POST" action="?/create" class="flex flex-wrap items-end gap-3">
		<div class="field min-w-0 flex-1">
			<label class="label" for="name">Group name</label>
			<input id="name" name="name" placeholder="Family, Coworkers…" class="input" required />
		</div>
		<button class="btn btn-primary">
			<Icon name="plus" class="h-4 w-4" />
			Create group
		</button>
	</form>
</section>

{#if data.groups.length}
	<div class="mt-6 grid gap-4 sm:grid-cols-2">
		{#each data.groups as g (g.id)}
			<section class="card flex flex-col gap-4 p-5">
				<div class="flex items-start justify-between gap-3">
					<h2 class="section-title">{g.name}</h2>
					<span class="badge badge-slate shrink-0">{g.members.length} member{g.members.length === 1 ? '' : 's'}</span>
				</div>

				{#if g.members.length}
					<ul class="flex flex-wrap gap-2">
						{#each g.members as m}
							<li class="tag">
								<Icon name="user" class="h-3.5 w-3.5 text-slate-500" />
								{m.email}
								<form method="POST" action="?/removeMember" class="contents">
									<input type="hidden" name="groupId" value={g.id} />
									<input type="hidden" name="userId" value={m.id} />
									<ConfirmButton class="ml-1 text-slate-500 transition hover:text-red-300" aria-label={`Remove ${m.email}`} message="Remove this member from the group?">
										<Icon name="close" class="h-3 w-3" />
									</ConfirmButton>
								</form>
							</li>
						{/each}
					</ul>
				{:else}
					<p class="text-sm text-slate-500">No members yet.</p>
				{/if}

				<form method="POST" action="?/addMember" class="mt-auto flex flex-wrap items-end gap-2">
					<input type="hidden" name="groupId" value={g.id} />
					<div class="field min-w-0 flex-1">
						<label class="label" for={`email-${g.id}`}>Add member</label>
						<input id={`email-${g.id}`} name="email" type="email" placeholder="member@example.com" class="input" />
					</div>
					<button class="btn btn-ghost">Add</button>
				</form>

				<form method="POST" action="?/deleteGroup" class="mt-2 flex justify-end">
					<input type="hidden" name="groupId" value={g.id} />
					<ConfirmButton class="btn btn-ghost btn-ghost-danger" message="Delete this group? This cannot be undone.">Delete group</ConfirmButton>
				</form>
			</section>
		{/each}
	</div>
{:else}
	<EmptyState message="No groups yet — create one to share trips.">
		{#snippet icon()}<Icon name="users" class="h-6 w-6" />{/snippet}
	</EmptyState>
{/if}
