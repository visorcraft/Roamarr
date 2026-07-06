<script lang="ts">
	import { enhance } from '$app/forms';
	import CancelButton from '$lib/components/CancelButton.svelte';

	let { data, form } = $props();
	let editingId = $state<number | null>(null);
	let creating = $state(false);
	let dirtyIds = $state<Record<number, boolean>>({});
</script>

<header>
	<h1 class="page-title">Users</h1>
	<p class="page-subtitle">Manage accounts, roles, and access.</p>
</header>

{#if form?.error}
	<div class="notice notice-error mt-6">
		{form.error}
	</div>
{/if}

{#if form?.success && form?.generatedPassword}
	<div class="notice notice-success mt-6">
		<p>Created account for <strong>{form.email}</strong>.</p>
		<p class="mt-1">
			Temporary password: <code class="code-chip">{form.generatedPassword}</code>
		</p>
		<p class="field-help mt-1">The user must change this password on first sign-in.</p>
	</div>
{/if}

<section class="card mt-8 p-5 sm:p-6">
	<div class="flex items-center justify-between">
		<h2 class="subsection-title">Create user</h2>
		<button type="button" class="btn btn-primary" onclick={() => (creating = !creating)}>
			{creating ? 'Hide form' : 'Create user'}
		</button>
	</div>

	{#if creating}
		<form
			method="POST"
			action="?/create"
			use:enhance={() => {
				return async ({ update, result }) => {
					await update();
					if (result.type === 'success') {
						creating = false;
					}
				};
			}}
			class="mt-4 grid gap-4 sm:grid-cols-3"
		>
			<div class="field">
				<label class="label" for="create-displayName">Display name</label>
				<input id="create-displayName" name="displayName" class="input" required />
			</div>
			<div class="field">
				<label class="label" for="create-email">Email</label>
				<input id="create-email" name="email" type="email" class="input" required />
			</div>
			<div class="field">
				<label class="label" for="create-role">Role</label>
				<select id="create-role" name="role" class="input">
					<option value="user" selected>User</option>
					<option value="admin">Admin</option>
				</select>
			</div>
			<div class="flex items-end justify-end sm:col-span-3">
				<button class="btn btn-primary">Create account</button>
			</div>
		</form>
	{/if}
</section>

<section class="card mt-6 p-5 sm:p-6">
	<div class="overflow-x-auto">
		<table class="table">
			<thead>
				<tr>
					<th>User</th>
					<th>Role</th>
					<th>Status</th>
					<th>Joined</th>
					<th class="text-right"></th>
				</tr>
			</thead>
			<tbody>
				{#each data.users as user (user.id)}
					<tr>
						<td>
							<div class="font-medium text-white">{user.displayName}</div>
							<div class="text-xs text-slate-500">{user.email}</div>
						</td>
						<td>
							{#if user.role === 'admin'}
								<span class="badge badge-brand">Admin</span>
							{:else}
								<span class="badge badge-slate">User</span>
							{/if}
						</td>
						<td>
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
						<td class="text-slate-400">{user.createdAt}</td>
						<td class="text-right">
							<div class="flex items-center justify-end gap-2">
								{#if editingId === user.id}
									<CancelButton dirty={dirtyIds[user.id] ?? false} onConfirm={() => (editingId = null)}>Cancel</CancelButton>
								{:else}
									<button type="button" class="btn btn-primary" onclick={() => { editingId = user.id; dirtyIds[user.id] = false; }}>Edit</button>
								{/if}
								<form
									method="POST"
									action="?/delete"
									class="inline"
									onsubmit={(e: SubmitEvent) => {
										if (!confirm(`Delete ${user.displayName} (${user.email})? This cannot be undone.`)) {
											e.preventDefault();
										}
									}}
								>
									<input type="hidden" name="userId" value={user.id} />
									<button type="submit" class="btn btn-danger">Delete</button>
								</form>
							</div>
						</td>
					</tr>
					{#if editingId === user.id}
						<tr>
							<td colspan="5" class="table-expanded-cell">
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
								oninput={() => (dirtyIds[user.id] = true)}
								>
									<input type="hidden" name="userId" value={user.id} />

									<div>
										<h3 class="subsection-title">Account</h3>
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
										<h3 class="subsection-title">Access</h3>
										<div class="mt-3 grid gap-4 sm:grid-cols-2">
											<div class="field">
												<label class="label" for={`role-${user.id}`}>Role</label>
												<select id={`role-${user.id}`} name="role" class="input">
													<option value="user" selected={user.role === 'user'}>User</option>
													<option value="admin" selected={user.role === 'admin'}>Admin</option>
												</select>
											</div>
											<div class="field flex items-end">
												<label class="checkbox-label">
													<input
														type="checkbox"
														name="enabled"
														checked={!user.disabled}
														class="checkbox"
													/>
													Account enabled
												</label>
											</div>
											<div class="field sm:col-span-2">
												<label class="checkbox-label">
													<input
														type="checkbox"
														name="mustResetPassword"
														checked={user.mustResetPassword}
														class="checkbox"
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
										<h3 class="subsection-title">Password</h3>
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

									<div class="flex flex-wrap justify-end gap-2 border-t border-white/5 pt-4">
										<CancelButton dirty={dirtyIds[user.id] ?? false} onConfirm={() => (editingId = null)}>Cancel</CancelButton>
										<button class="btn btn-primary">Save changes</button>
									</div>
								</form>

							<form method="POST" action="?/sendReset" class="mt-4 flex justify-end border-t border-white/5 pt-4">
								<input type="hidden" name="userId" value={user.id} />
								<p class="field-help">
									Send a one-hour password reset link to {user.email}.
								</p>
								<button class="btn btn-primary mt-3">Send password reset email</button>
							</form>

							{#if user.twoFactorEnabled}
								<form method="POST" action="?/disableTwoFactor" class="mt-3 flex justify-end">
									<input type="hidden" name="userId" value={user.id} />
									<p class="field-help">Two-factor authentication is enabled for this user.</p>
									<button class="btn btn-danger mt-2">Disable user 2FA (admin reset)</button>
								</form>
							{/if}
							</td>
						</tr>
					{/if}
				{/each}
			</tbody>
		</table>
	</div>
</section>
