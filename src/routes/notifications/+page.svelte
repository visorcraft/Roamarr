<script lang="ts">
	let { data } = $props();
</script>

<main class="p-4 max-w-2xl">
	<h1 class="text-2xl font-bold mb-4">Notifications</h1>
	<ul>
		{#each data.notifications as n (n.id)}
			<li class="border-b py-2 flex justify-between">
				<span>
					<span class="font-semibold">{n.title}</span>
					<span class="text-gray-600 text-sm ml-2">{n.body}</span>
					{#if !n.readAt}<span class="text-blue-600 text-xs ml-2">new</span>{/if}
				</span>
				{#if !n.readAt}
					<form method="POST" action="?/markRead">
						<input type="hidden" name="id" value={n.id} />
						<button class="text-blue-600 text-sm">mark read</button>
					</form>
				{/if}
			</li>
		{/each}
	</ul>
</main>
