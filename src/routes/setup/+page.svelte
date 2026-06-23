<script lang="ts">
	let { form } = $props();
</script>

<h1 class="text-2xl font-bold p-4">Welcome to Roamarr — create your admin account</h1>
{#if form?.error}<p class="text-red-600 px-4">{form.error}</p>{/if}
<form method="POST" class="grid gap-3 max-w-sm p-4">
	<input name="instanceName" placeholder="Instance name" value="Roamarr" class="border p-2" />
	<input name="displayName" placeholder="Your name" class="border p-2" required />
	<input name="email" type="email" placeholder="Email" class="border p-2" required />
	<input name="password" type="password" placeholder="Password (≥ 8 chars)" class="border p-2" required />
	<input name="timezone" placeholder="Timezone (e.g. America/New_York)" value="UTC" class="border p-2" />
	<button class="bg-blue-600 text-white p-2 rounded">Create admin</button>
</form>
