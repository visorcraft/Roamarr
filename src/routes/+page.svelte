<script lang="ts">
	let { data } = $props();
</script>

<main class="p-4 max-w-2xl">
	<h1 class="text-2xl font-bold">{data.user?.displayName}'s dashboard</h1>
	<p class="text-gray-600">You have {data.unread} unread notification{#if data.unread !== 1}s{/if}. <a href="/notifications" class="text-blue-600">View</a></p>

	<section class="mt-6">
		<h2 class="text-xl font-semibold">Upcoming trips</h2>
		<ul class="mt-2">
			{#each data.upcoming as t (t.id)}
				<li class="border-b py-2">
					<a href={`/trips/${t.id}`} class="text-blue-600">{t.name}</a>
					{#if t.startDate}<span class="text-gray-500 text-sm ml-2">from {t.startDate}</span>{/if}
				</li>
			{/each}
		</ul>
		<a href="/trips/new" class="inline-block mt-3 bg-blue-600 text-white px-3 py-2 rounded">New trip</a>
	</section>

	<section class="mt-6">
		<h2 class="text-xl font-semibold">Documents expiring soon</h2>
		<ul class="mt-2">
			{#each data.expiring as d (d.id)}
				<li class="border-b py-2 text-sm">{d.type} expires {d.expiresOn}</li>
			{/each}
		</ul>
		<a href="/profile/documents" class="text-blue-600 text-sm">Manage documents</a>
	</section>
</main>
