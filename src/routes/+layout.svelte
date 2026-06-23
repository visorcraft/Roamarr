<script lang="ts">
	import '../app.css';
	let { data, children } = $props();
</script>

<header class="border-b px-4 py-2 flex items-center gap-4">
	<span class="font-bold">{data.instanceName}</span>
	{#if data.user}
		<nav class="flex gap-3 text-sm">
			<a href="/" class="text-blue-600">Home</a>
			<a href="/trips" class="text-blue-600">Trips</a>
			<a href="/notifications" class="text-blue-600">Notifications</a>
			<a href="/profile/documents" class="text-blue-600">Documents</a>
			<a href="/profile/loyalty" class="text-blue-600">Loyalty</a>
			<a href="/cards" class="text-blue-600">Cards</a>
			<a href="/insurance" class="text-blue-600">Insurance</a>
			<a href="/groups" class="text-blue-600">Groups</a>
		</nav>
		<span class="ml-auto text-sm text-gray-600">{data.user.displayName}</span>
		{#if data.user.role === 'admin'}
			<a href="/settings" class="text-sm text-blue-600">Settings</a>
		{/if}
		<form method="POST" action="/logout"><button class="text-sm text-red-600">Sign out</button></form>
	{/if}
</header>

{@render children()}
