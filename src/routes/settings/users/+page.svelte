<script lang="ts">
	import { enhance } from '$app/forms';

	let { data, form } = $props();
	let editingId = $state<number | null>(null);
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
					<th class="py-3 text-right font-medium"></th>
				</tr>
			</thead>
			<tbody>
				{#each data.users as user (user.id)}
					<tr class="border-b border-white/5 last:border-0">
						<td class="py-3 pr-4">
							<div class="font-medium text-white">{user.displayName}</div>
							<div class="text-xs text-slate-500">{user.email}</div>
						</td>
						<td class="py-3 pr-4">
							{#if user.role === 'admin'}
								<span class="badge badge-brand">Admin</span>
							{:else}
								<span class="badge badge-slate">User</span>
							{/if}
						</td>
						<td class="py-3 pr-4">
							<div class="flex flex-wrap gap-1">
								{#if user.disabled}
									<span class="badge badge-red">Disabled</span>
								{:else}
									<span class="badge badge-green">Active</span>
								{/if}
								{#if user.mustResetPassword}
									<span class="badge badge-amber">Password reset required</span>
								{/if}
							</div>
						</td>
						<td class="py-3 pr-4 text-slate-400">{user.createdAt}</td>
						<td class="py-3 text-right">
							<button
								type="button"
								class="btn btn-ghost btn-ghost-indigo"
								onclick={() => (editingId = editingId === user.id ? null : user.id)}
							>
								{editingId === user.id ? 'Cancel' : 'Edit'}
							</button>
						</td>
					</tr>
					{#if editingId === user.id}
						<tr class="border-b border-white/5 last:border-0">
							<td colspan="5" class="bg-white/[0.02] px-4 py-4">
								<form
									method="POST"
									action="?/update"
									use:enhance={() => {
										return async ({ update }) => {
											await update();
											editingId = null;
										};
									}}
									class="grid gap-6"
								>
									<input type="hidden" name="userId" value={user.id} />

									<div>
										<h3 class="text-sm font-semibold text-white">Account</h3>
										<div class="mt-3 grid gap-4 sm:grid-cols-2">
											<div class="field">
												<label class="label" for={`displayName-${user.id}`}>Display name</label>
												<input
													id={`displayName-${user.id}`}
													name="displayName"
													value={user.displayName}
													class="input"
													required
												/>
											</div>
											<div class="field">
												<label class="label" for={`email-${user.id}`}>Email</label>
												<input
													id={`email-${user.id}`}
													name="email"
													type="email"
													value={user.email}
													class="input"
													required
												/>
											</div>
										</div>
									</div>

									<div>
										<h3 class="text-sm font-semibold text-white">Access</h3>
										<div class="mt-3 grid gap-4 sm:grid-cols-2">
											<div class="field">
												<label class="label" for={`role-${user.id}`}>Role</label>
												<select id={`role-${user.id}`} name="role" class="input">
													<option value="user" selected={user.role === 'user'}>User</option>
													<option value="admin" selected={user.role === 'admin'}>Admin</option>
												</select>
											</div>
											<div class="field flex items-end">
												<label class="flex items-center gap-2 text-sm text-slate-300">
													<input
														type="checkbox"
														name="enabled"
														checked={!user.disabled}
														class="h-4 w-4 rounded border-white/20 bg-white/5 text-indigo-500 accent-indigo-500"
													/>
													Account enabled
												</label>
											</div>
											<div class="field sm:col-span-2">
												<label class="flex items-center gap-2 text-sm text-slate-300">
													<input
														type="checkbox"
														name="mustResetPassword"
														checked={user.mustResetPassword}
														class="h-4 w-4 rounded border-white/20 bg-white/5 text-indigo-500 accent-indigo-500"
													/>
													Require password change on next login
												</label>
												<p class="mt-1 field-help">
													The user will be prompted to choose a new password after signing in.
												</p>
											</div>
										</div>
									</div>

									<div>
										<h3 class="text-sm font-semibold text-white">Password</h3>
										<p class="mt-1 field-help">
											Set a new password directly, or send a reset link instead. Leave the fields blank to keep the current password.
										</p>
										<div class="mt-3 grid gap-4 sm:grid-cols-2">
											<div class="field">
												<label class="label" for={`newPassword-${user.id}`}>New password</label>
												<input
													id={`newPassword-${user.id}`}
													name="newPassword"
													type="password"
													autocomplete="new-password"
													class="input"
												/>
											</div>
											<div class="field">
												<label class="label" for={`confirmPassword-${user.id}`}>Confirm new password</label>
												<input
													id={`confirmPassword-${user.id}`}
													name="confirmPassword"
													type="password"
													autocomplete="new-password"
													class="input"
												/>
											</div>
										</div>
									</div>

									<div class="flex flex-wrap gap-2 border-t border-white/5 pt-4">
										<button type="button" class="btn btn-ghost" onclick={() => (editingId = null)}>
											Cancel
										</button>
										<button class="btn btn-primary">Save changes</button>
									</div>
								</form>

								<form method="POST" action="?/sendReset" class="mt-4 border-t border-white/5 pt-4">
									<input type="hidden" name="userId" value={user.id} />
									<p class="field-help">
										Send a one-hour password reset link to {user.email}.
									</p>
									<button class="btn btn-ghost btn-ghost-indigo mt-3">Send password reset email</button>
								</form>
							</td>
						</tr>
					{/if}
				{/each}
			</tbody>
		</table>
	</div>
</section>
