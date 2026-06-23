<script lang="ts">
	let { data } = $props();
</script>

<main class="p-4 max-w-xl">
	<h1 class="text-2xl font-bold mb-4">Loyalty programs</h1>
	<ul>
		{#each data.programs as p (p.id)}
			<li class="border-b py-2 flex justify-between">
				<span>{p.programName}: {p.membershipNumber ?? '—'} {#if p.balance != null}<span class="text-gray-500 text-sm">{p.balance}</span>{/if}</span>
				<form method="POST" action="?/delete">
					<input type="hidden" name="id" value={p.id} />
					<button class="text-red-600 text-sm">delete</button>
				</form>
			</li>
		{/each}
	</ul>
	<form method="POST" action="?/add" class="grid gap-2 mt-4 border-t pt-4">
		<input name="programName" placeholder="Program" class="border p-2" required />
		<input name="membershipNumber" placeholder="Membership #" class="border p-2" />
		<input name="balance" type="number" placeholder="Balance" class="border p-2" />
		<input name="notes" placeholder="Notes" class="border p-2" />
		<button class="bg-blue-600 text-white p-2 rounded">Add program</button>
	</form>
</main>
