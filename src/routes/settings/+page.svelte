<script lang="ts">
	let { data } = $props();
	const s = $derived(data.settings);
</script>

<header>
	<h1 class="text-3xl font-extrabold text-white">Settings</h1>
	<p class="mt-1 text-sm text-muted">Configure your Roamarr instance and outgoing email.</p>
</header>

<form method="POST" class="mt-8 grid gap-6">
	<section class="card p-5 sm:p-6">
		<h2 class="section-title">General</h2>
		<div class="mt-2">
			<div class="grid gap-3 border-b border-white/5 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] sm:items-center">
				<div>
					<label class="label" for="instanceName">Instance name</label>
					<p class="text-xs text-slate-500">The display name for this Roamarr instance.</p>
				</div>
				<input id="instanceName" name="instanceName" value={s.instanceName} class="input" />
			</div>

			<div class="grid gap-3 border-b border-white/5 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] sm:items-center">
				<div>
					<label class="label" for="defaultTimezone">Default timezone</label>
					<p class="text-xs text-slate-500">Used when a trip or segment has no timezone set.</p>
				</div>
				<input id="defaultTimezone" name="defaultTimezone" value={s.defaultTimezone} class="input" />
			</div>

			<div class="grid gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] sm:items-center">
				<div>
					<label class="label" for="allowRegistration">Allow self-registration</label>
					<p class="text-xs text-slate-500">Let new users create their own accounts.</p>
				</div>
				<div class="sm:justify-self-end">
					<input
						id="allowRegistration"
						type="checkbox"
						name="allowRegistration"
						checked={s.allowRegistration}
						class="h-5 w-5 rounded border-white/20 bg-white/5 text-indigo-500 accent-indigo-500"
					/>
				</div>
			</div>
		</div>
	</section>

	<section class="card p-5 sm:p-6">
		<h2 class="section-title">Email (SMTP)</h2>
		<div class="mt-2">
			<div class="grid gap-3 border-b border-white/5 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] sm:items-center">
				<div>
					<label class="label" for="smtpHost">Host</label>
					<p class="text-xs text-slate-500">SMTP server hostname.</p>
				</div>
				<input id="smtpHost" name="smtpHost" value={s.smtpHost ?? ''} placeholder="smtp.example.com" class="input" />
			</div>

			<div class="grid gap-3 border-b border-white/5 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] sm:items-center">
				<div>
					<label class="label" for="smtpPort">Port</label>
					<p class="text-xs text-slate-500">Typically 587 (STARTTLS) or 465 (TLS).</p>
				</div>
				<input id="smtpPort" name="smtpPort" type="number" value={s.smtpPort ?? ''} placeholder="587" class="input" />
			</div>

			<div class="grid gap-3 border-b border-white/5 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] sm:items-center">
				<div>
					<label class="label" for="smtpUser">Username</label>
					<p class="text-xs text-slate-500">SMTP authentication username.</p>
				</div>
				<input id="smtpUser" name="smtpUser" value={s.smtpUser ?? ''} placeholder="apikey" class="input" />
			</div>

			<div class="grid gap-3 border-b border-white/5 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] sm:items-center">
				<div>
					<label class="label" for="smtpPass">Password</label>
					<p class="text-xs text-slate-500">Leave the masked value to keep the stored secret.</p>
				</div>
				<input id="smtpPass" name="smtpPass" type="password" value={s.smtpPass} placeholder="Password" class="input" />
			</div>

			<div class="grid gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] sm:items-center">
				<div>
					<label class="label" for="smtpFrom">From address</label>
					<p class="text-xs text-slate-500">The sender address used for outgoing email.</p>
				</div>
				<input id="smtpFrom" name="smtpFrom" value={s.smtpFrom ?? ''} placeholder="roamarr@example.com" class="input" />
			</div>
		</div>
	</section>

	<div class="flex justify-end">
		<button class="btn btn-primary">Save settings</button>
	</div>
</form>
