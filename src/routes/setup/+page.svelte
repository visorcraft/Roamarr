<script lang="ts">
	let { form } = $props();
</script>

<div class="card w-full max-w-md p-7 sm:p-8">
	<h1 class="text-2xl font-extrabold text-white">Welcome to Roamarr</h1>
	<p class="mt-1 text-sm text-muted">Create your admin account to get started.</p>

	{#if form?.error}<p class="notice notice-error mt-4">{form.error}</p>{/if}

	<form method="POST" class="mt-6 grid gap-4">
		<div class="field">
			<label class="label" for="instanceName">Instance name</label>
			<input id="instanceName" name="instanceName" placeholder="Roamarr" value="Roamarr" class="input" />
		</div>
		<div class="field">
			<label class="label" for="displayName">Your name</label>
			<input id="displayName" name="displayName" placeholder="Ada Lovelace" class="input" required />
		</div>
		<div class="field">
			<label class="label" for="email">Email</label>
			<input id="email" name="email" type="email" autocomplete="email" placeholder="you@example.com" class="input" required />
		</div>
		<div class="field">
			<label class="label" for="password">Password</label>
			<input id="password" name="password" type="password" autocomplete="new-password" placeholder="At least 8 characters" class="input" required />
		</div>
		<div class="field">
			<label class="label" for="timezone">Timezone</label>
			<input id="timezone" name="timezone" placeholder="America/New_York" value="UTC" class="input" />
		</div>
		<button class="btn btn-primary mt-1 w-full">Create admin</button>
	</form>
</div>
