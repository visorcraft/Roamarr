<script lang="ts">
	let { data } = $props();
</script>

<main class="p-4 max-w-xl">
	<h1 class="text-2xl font-bold mb-4">Travel documents</h1>
	<ul>
		{#each data.documents as d (d.id)}
			<li class="border-b py-2 flex justify-between">
				<span>{d.type}: {d.number ?? '—'} {#if d.expiresOn}<span class="text-gray-500 text-sm">exp {d.expiresOn}</span>{/if}</span>
				<form method="POST" action="?/delete">
					<input type="hidden" name="id" value={d.id} />
					<button class="text-red-600 text-sm">delete</button>
				</form>
			</li>
		{/each}
	</ul>
	<form method="POST" action="?/add" class="grid gap-2 mt-4 border-t pt-4">
		<select name="type" class="border p-2">
			<option value="passport">Passport</option>
			<option value="drivers_license">Driver's license</option>
			<option value="global_entry">Global Entry</option>
		</select>
		<input name="number" placeholder="Number" class="border p-2" />
		<input name="issuingAuthority" placeholder="Issuing authority" class="border p-2" />
		<input name="expiresOn" type="date" class="border p-2" />
		<input name="notes" placeholder="Notes" class="border p-2" />
		<button class="bg-blue-600 text-white p-2 rounded">Add document</button>
	</form>
</main>
