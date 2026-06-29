<script lang="ts">
	import ConfirmButton from '$lib/components/ConfirmButton.svelte';

	let { data } = $props();
	const o = $derived(data.override);
</script>

<header class="page-header">
	<div>
		<h1 class="page-title">Notifications</h1>
		<p class="page-subtitle">
			Send notifications from your own mailbox instead of the admin SMTP server.
		</p>
	</div>
</header>

<section class="card mt-6 p-5">
	<h2 class="section-title mb-1">Personal SMTP override</h2>
	<p class="field-help mb-4">
		When enabled and complete (host + from address), your notifications are sent through this
		server instead of the admin-configured one. Leave disabled to use the system default.
	</p>

	<form method="POST" action="?/save" class="space-y-4">
		<div class="settings-rows">
			<div class="settings-row">
				<div>
					<label class="label" for="enabled">Enabled</label>
					<p class="field-help">Route your notifications through this SMTP server.</p>
				</div>
				<input id="enabled" name="enabled" type="checkbox" class="h-5 w-5" checked={o?.enabled ?? false} />
			</div>

			<div class="settings-row">
				<div>
					<label class="label" for="host">Host</label>
					<p class="field-help">Your SMTP server hostname.</p>
				</div>
				<input id="host" name="host" value={o?.host ?? ''} placeholder="smtp.gmail.com" class="input" />
			</div>

			<div class="settings-row">
				<div>
					<label class="label" for="port">Port</label>
					<p class="field-help">Typically 587 (STARTTLS) or 465 (TLS).</p>
				</div>
				<input id="port" name="port" type="number" value={o?.port ?? ''} placeholder="587" class="input" />
			</div>

			<div class="settings-row">
				<div>
					<label class="label" for="security">Transport security</label>
					<p class="field-help">Match your server's encryption mode.</p>
				</div>
				<select id="security" name="security" class="input">
					<option value="starttls" selected={o?.security === 'starttls' || !o}>STARTTLS (recommended)</option>
					<option value="ssl/tls" selected={o?.security === 'ssl/tls'}>SSL/TLS (implicit, port 465)</option>
					<option value="none" selected={o?.security === 'none'}>None (plaintext)</option>
				</select>
			</div>

			<div class="settings-row">
				<div>
					<label class="label" for="username">Username</label>
					<p class="field-help">SMTP authentication username.</p>
				</div>
				<input id="username" name="username" value={o?.username ?? ''} placeholder="you@example.com" class="input" />
			</div>

			<div class="settings-row">
				<div>
					<label class="label" for="password">Password</label>
					<p class="field-help">
						{#if o?.passwordSet}
							Stored. Enter a new value to replace it.
						{:else}
							App password or SMTP credential.
						{/if}
					</p>
				</div>
				<div>
					<input id="password" name="password" type="password" value={o?.passwordSet ? '********' : ''} placeholder="Password" class="input" />
					{#if o?.passwordSet}
						<label class="checkbox-label mt-2 text-xs">
							<input type="checkbox" name="clearPassword" class="checkbox" />
							Clear the stored password
						</label>
					{/if}
				</div>
			</div>

			<div class="settings-row">
				<div>
					<label class="label" for="fromAddress">From address</label>
					<p class="field-help">The sender address for your outgoing notifications.</p>
				</div>
				<input id="fromAddress" name="fromAddress" value={o?.fromAddress ?? ''} placeholder="you@example.com" class="input" />
			</div>
		</div>

		<div class="flex flex-wrap gap-2">
			<button class="btn btn-primary">Save override</button>
			<button class="btn btn-ghost" type="submit" formaction="?/testEmail">Send test email</button>
		</div>
	</form>

	{#if o}
		<form method="POST" action="?/disable" class="mt-4">
			<ConfirmButton class="btn btn-ghost btn-ghost-danger" message="Remove your SMTP override entirely?">
				Remove override
			</ConfirmButton>
		</form>
	{/if}
</section>
