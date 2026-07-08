<script lang="ts">
	import { page } from '$app/state';

	const status = $derived(page.status);
	const message = $derived(page.error?.message);
</script>

<header class="page-header">
	<div>
		<h1 class="page-title">{status}</h1>
		<p class="page-subtitle">
			{#if status >= 500}
				Something went wrong on the server. Please try again in a moment.
			{:else if status === 400}
				Your request couldn't be processed. Please check your input and try again.
			{:else if status === 401}
				Please sign in to continue.
			{:else if status === 403}
				You don't have permission to do that.
			{:else if status === 404}
				That page doesn't exist.
			{:else}
				{message ?? 'An unexpected error occurred.'}
			{/if}
		</p>
	</div>
</header>

<section class="card mt-6 p-5 sm:p-6">
	{#if message && status < 500}
		<p class="text-sm">{message}</p>
	{/if}
	<div class="mt-4 flex gap-2">
		<a href="/" class="btn btn-primary">Back to home</a>
		{#if status === 401}
			<a href="/login" class="btn btn-ghost">Sign in</a>
		{/if}
	</div>
</section>
