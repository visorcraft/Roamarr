<script lang="ts">
	import { goto } from '$app/navigation';
	import { enhance } from '$app/forms';
	import TextField from '$lib/components/TextField.svelte';
	import SelectField from '$lib/components/SelectField.svelte';
	import CancelButton from '$lib/components/CancelButton.svelte';
	import type { PageData } from './$types';

	let { data, form }: { data: PageData; form: Record<string, unknown> | null } = $props();
	let submitting = $state(false);
	let isDirty = $state(false);

	let user = $derived(data.user);
</script>

<header class="page-header">
	<div>
		<h1 class="page-title">Edit user</h1>
		<p class="page-subtitle">{user.displayName} ({user.email})</p>
	</div>
</header>

<section class="card mt-6 p-5 sm:p-6">
	{#if form?.error}
		<div class="notice notice-error mb-4">
			{form.error}
		</div>
	{/if}

	<form
		method="POST"
		action="?/update"
		class="grid gap-6"
		use:enhance={() => {
			submitting = true;
			return async ({ update }) => {
				await update();
				submitting = false;
			};
		}}
		aria-busy={submitting}
		oninput={() => (isDirty = true)}
	>
		<div>
			<h3 class="subsection-title">Account</h3>
			<div class="mt-3 grid gap-4 sm:grid-cols-2">
				<TextField
					name="displayName"
					label="Display name"
					value={user.displayName}
					required
					disabled={submitting}
				/>
				<TextField
					name="email"
					label="Email"
					type="email"
					value={user.email}
					required
					disabled={submitting}
				/>
			</div>
		</div>

		<div>
			<h3 class="subsection-title">Access</h3>
			<div class="mt-3 grid gap-4 sm:grid-cols-2">
				<SelectField name="role" label="Role" required disabled={submitting}>
					<option value="user" selected={user.role === 'user'}>User</option>
					<option value="admin" selected={user.role === 'admin'}>Admin</option>
				</SelectField>
				<div class="field flex items-end">
					<label class="checkbox-label">
						<input
							type="checkbox"
							name="enabled"
							checked={!user.disabled}
							class="checkbox"
							disabled={submitting}
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
							disabled={submitting}
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
				Set a new password directly, or send a reset link instead. Leave the fields blank to keep
				the current password.
			</p>
			<div class="mt-3 grid gap-4 sm:grid-cols-2">
				<TextField
					name="newPassword"
					label="New password"
					type="password"
					autocomplete="new-password"
					disabled={submitting}
				/>
				<TextField
					name="confirmPassword"
					label="Confirm new password"
					type="password"
					autocomplete="new-password"
					disabled={submitting}
				/>
			</div>
		</div>

		<div class="flex flex-wrap justify-end gap-2 border-t border-white/5 pt-4">
			<CancelButton dirty={isDirty} onConfirm={() => goto('/users')}>Cancel</CancelButton>
			<button class="btn btn-primary" disabled={submitting} class:btn-loading={submitting}>
				Save changes
			</button>
		</div>
	</form>

	<form
		method="POST"
		action="?/sendReset"
		class="mt-4 flex flex-col items-end justify-end gap-2 border-t border-white/5 pt-4"
		use:enhance={() => {
			submitting = true;
			return async ({ update }) => {
				await update();
				submitting = false;
			};
		}}
	>
		<p class="field-help text-right">
			Send a one-hour password reset link to {user.email}.
		</p>
		<button class="btn btn-primary" disabled={submitting} class:btn-loading={submitting}>
			Send password reset email
		</button>
	</form>

	{#if data.twoFactorEnabled}
		<form
			method="POST"
			action="?/disableTwoFactor"
			class="mt-3 flex flex-col items-end justify-end gap-2"
			use:enhance={() => {
				submitting = true;
				return async ({ update }) => {
					await update();
					submitting = false;
				};
			}}
		>
			<p class="field-help text-right">Two-factor authentication is enabled for this user.</p>
			<button class="btn btn-danger" disabled={submitting} class:btn-loading={submitting}>
				Disable user 2FA (admin reset)
			</button>
		</form>
	{/if}
</section>
