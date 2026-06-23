<script lang="ts">
	let { form } = $props();
</script>

<form method="POST" class="grid gap-3 max-w-sm p-4">
	<h1 class="text-xl font-bold">Sign in</h1>
	{#if form?.error}<p class="text-red-600">{form.error}</p>{/if}
	<input name="email" type="email" placeholder="Email" class="border p-2" required />
	<input name="password" type="password" placeholder="Password" class="border p-2" required />
	<button class="bg-blue-600 text-white p-2 rounded">Sign in</button>
	<a href="/register" class="text-blue-600 text-sm">Create an account</a>
</form>
