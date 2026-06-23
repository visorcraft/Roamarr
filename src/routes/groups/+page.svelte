<script lang="ts">
	let { data } = $props();
</script>

<main class="p-4 max-w-xl">
	<h1 class="text-2xl font-bold mb-4">Groups</h1>
	{#each data.groups as g (g.id)}
		<section class="border-b py-3">
			<h2 class="font-semibold">{g.name}</h2>
			<ul class="text-sm text-gray-600">
				{#each g.members as m}<li>{m.email}</li>{/each}
			</ul>
			<form method="POST" action="?/addMember" class="flex gap-2 mt-2">
				<input type="hidden" name="groupId" value={g.id} />
				<input name="email" placeholder="member email" class="border p-1 flex-1" />
				<button class="bg-blue-600 text-white px-2 rounded text-sm">Add</button>
			</form>
		</section>
	{/each}
	<form method="POST" action="?/create" class="flex gap-2 mt-4 border-t pt-4">
		<input name="name" placeholder="New group name" class="border p-2 flex-1" required />
		<button class="bg-blue-600 text-white p-2 rounded">Create group</button>
	</form>
</main>
