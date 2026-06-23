<script lang="ts">
	let { data } = $props();
	const s = $derived(data.settings);
</script>

<main class="p-4 max-w-xl">
	<h1 class="text-2xl font-bold mb-4">Admin settings</h1>
	<form method="POST" class="grid gap-3">
		<label class="text-sm">Instance name
			<input name="instanceName" value={s.instanceName} class="border p-2 w-full" />
		</label>
		<label class="text-sm">Default timezone
			<input name="defaultTimezone" value={s.defaultTimezone} class="border p-2 w-full" />
		</label>
		<label class="text-sm flex items-center gap-2">
			<input type="checkbox" name="allowRegistration" checked={s.allowRegistration} /> Allow self-registration
		</label>
		<fieldset class="border p-3 grid gap-2">
			<legend class="text-sm font-semibold">SMTP</legend>
			<input name="smtpHost" value={s.smtpHost ?? ''} placeholder="Host" class="border p-2" />
			<input name="smtpPort" type="number" value={s.smtpPort ?? ''} placeholder="Port" class="border p-2" />
			<input name="smtpUser" value={s.smtpUser ?? ''} placeholder="User" class="border p-2" />
			<input name="smtpPass" value={s.smtpPass} placeholder="Password (leave masked to keep)" class="border p-2" />
			<input name="smtpFrom" value={s.smtpFrom ?? ''} placeholder="From address" class="border p-2" />
		</fieldset>
		<button class="bg-blue-600 text-white p-2 rounded">Save settings</button>
	</form>
</main>
