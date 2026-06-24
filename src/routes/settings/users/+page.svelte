<script lang="ts">
	import { enhance } from '$app/forms';

	let { data, form } = $props();
</script>

<header>
	<h1 class="text-3xl font-extrabold text-white">Users</h1>
	<p class="mt-1 text-sm text-muted">Manage accounts, roles, and access.</p>
</header>

{#if form?.error}
	<div class="mt-6 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
		{form.error}
	</div>
{/if}

<section class="card mt-8 p-5 sm:p-6">
	<div class="overflow-x-auto">
		<table class="w-full text-left text-sm">
			<thead>
				<tr class="border-b border-white/10 text-slate-400">
					<th class="py-3 pr-4 font-medium">User</th>
					<th class="py-3 pr-4 font-medium">Role</th>
					<th class="py-3 pr-4 font-medium">Status</th>
					<th class="py-3 pr-4 font-medium">Joined</th>
					<th class="py-3 text-right font-medium">Actions</th>
				</tr>
			</thead>
			<tbody>
				{#each data.users as user (user.id)}
					<tr class="border-b border-white/5 last:border-0">
						<td class="py-3 pr-4">
							<div class="font-medium text-white">{user.displayName}</div>
							<div class="text-xs text-slate-500">{user.email}</div>
						</td>
						<td class="py-3 pr-4 capitalize">{user.role}</td>
						<td class="py-3 pr-4">
							{#if user.disabled}
								<span class="badge badge-red">Disabled</span>
							{:else}
								<span class="badge badge-green">Active</span>
							{/if}
						</td>
						<td class="py-3 pr-4 text-slate-400">{user.createdAt}</td>
						<td class="py-3 text-right">
							<form method="POST" use:enhance class="inline-flex items-center gap-2">
								<input type="hidden" name="userId" value={user.id} />
								<select
									name="role"
									value={user.role}
									class="input py-1 text-xs"
									aria-label="Role"
								>
									<option value="user">User</option>
									<option value="admin">Admin</option>
								</select>
								<label class="inline-flex cursor-pointer items-center gap-1.5 text-xs text-slate-300">
									<input
										type="checkbox"
										name="disabled"
										checked={user.disabled}
										class="h-4 w-4 rounded border-white/20 bg-white/5 accent-indigo-500"
									/>
									Disabled
								</label>
								<button class="btn btn-primary btn-sm">Save</button>
							</form>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</section>
