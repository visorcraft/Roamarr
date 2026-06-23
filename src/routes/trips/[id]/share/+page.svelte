<script lang="ts">
	let { data } = $props();
</script>

<main class="p-4 max-w-xl">
	<h1 class="text-xl font-bold">Share “{data.trip.name}”</h1>

	<section class="mt-4">
		<h2 class="font-semibold">Shared with users</h2>
		<ul class="text-sm text-gray-600">
			{#each data.shares as s (s.id)}
				{#if s.email}<li>{s.email}</li>{/if}
			{/each}
		</ul>
		<form method="POST" action="?/shareUser" class="flex gap-2 mt-2">
			<input name="email" placeholder="user email" class="border p-1 flex-1" required />
			<button class="bg-blue-600 text-white px-2 rounded text-sm">Share</button>
		</form>
	</section>

	{#if data.groups.length}
		<section class="mt-4">
			<h2 class="font-semibold">Share with a group</h2>
			<form method="POST" action="?/shareGroup" class="flex gap-2 mt-2">
				<select name="groupId" class="border p-1">
					{#each data.groups as g (g.id)}
						<option value={g.id}>{g.name}</option>
					{/each}
				</select>
				<button class="bg-blue-600 text-white px-2 rounded text-sm">Share</button>
			</form>
		</section>
	{/if}

	<section class="mt-4">
		<h2 class="font-semibold">Public link</h2>
		{#if data.trip.publicToken}
			<p class="text-sm text-gray-600 break-all">/share/{data.trip.publicToken}</p>
			<form method="POST" action="?/revokePublic"><button class="text-red-600 text-sm">Revoke public link</button></form>
		{:else}
			<form method="POST" action="?/makePublic"><button class="bg-blue-600 text-white px-2 rounded text-sm">Create public link</button></form>
		{/if}
	</section>
</main>
