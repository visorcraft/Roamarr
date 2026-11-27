<script lang="ts">
	import { DateTime } from 'luxon';
	import Icon from '$lib/components/Icon.svelte';
	import type { DayForecast, TripWeatherOverview } from '$lib/server/weather';
	import { weatherIconForCode } from '$lib/weatherCodes';

	let { weather }: { weather: TripWeatherOverview } = $props();

	const previewLength = 4;
	const forecast = $derived(weather.days.filter((day) => !day.typical));
	const historical = $derived(weather.days.filter((day) => day.typical));
	const preview = $derived((forecast.length ? forecast : historical).slice(0, previewLength));
	const laterForecast = $derived(forecast.slice(previewLength));
	const laterHistorical = $derived(forecast.length ? historical : historical.slice(previewLength));
	const moreCount = $derived(laterForecast.length + laterHistorical.length);
	const hasWeather = $derived(weather.days.some((day) => day.code != null || day.tempMax != null || day.tempMin != null));
</script>

{#snippet daysList(days: DayForecast[])}
	<ul class="weather-days" role="list">
		{#each days as day (day.date)}
			{@const icon = weatherIconForCode(day.code)}
			<li class="weather-day">
				<time datetime={day.date} class="font-semibold">{DateTime.fromISO(day.date).toFormat('EEE, MMM d')}</time>
				{#if day.locationLabel}<span class="weather-location trip-modern-panel-muted">{day.locationLabel}</span>{/if}
				{#if day.tempMax != null || day.tempMin != null}
					<div class="flex flex-wrap items-baseline gap-x-2">
						{#if day.tempMax != null}<span class="text-lg font-semibold tabular-nums"><span class="sr-only">High </span>{Math.round(day.tempMax)}{weather.tempUnit}</span>{/if}
						{#if day.tempMin != null}<span class="trip-modern-panel-muted text-sm tabular-nums"><span class="sr-only">Low </span>{Math.round(day.tempMin)}{weather.tempUnit}</span>{/if}
					</div>
				{/if}
				{#if !day.typical || (day.tempMax == null && day.tempMin == null)}
					<div class="flex items-start gap-1.5 text-sm">
						{#if icon}<Icon name={icon} class="mt-0.5 h-4 w-4 shrink-0" />{/if}
						<span>{day.summary}</span>
					</div>
				{/if}
				{#if day.precipProb != null}<span class="trip-modern-panel-muted text-xs">{day.precipProb}% chance of precipitation</span>{/if}
				{#if day.degraded && !day.typical}<span class="trip-modern-panel-muted text-xs">Stale forecast</span>{/if}
			</li>
		{/each}
	</ul>
{/snippet}

<section class="trip-modern-panel" aria-labelledby="trip-weather-title">
	<div class="trip-modern-panel-head weather-heading">
		<h2 id="trip-weather-title" class="trip-modern-panel-title">Weather</h2>
		{#if hasWeather}<h3 class="weather-subheading">{forecast.length ? 'Daily forecast' : 'Historical averages'}</h3>{/if}
	</div>
	{#if weather.advisory}<p class="notice notice-warning mb-3">{weather.advisory}</p>{/if}
	{#if hasWeather}
		{@render daysList(preview)}
		{#if moreCount}
			<details class="weather-more">
				<summary class="min-h-11 cursor-pointer py-2.5 text-sm font-semibold">More weather dates ({moreCount})</summary>
				{#if laterForecast.length}{@render daysList(laterForecast)}{/if}
				{#if laterHistorical.length}
					{#if forecast.length}<h3 class="weather-subheading mt-3">Historical averages</h3>{/if}
					{@render daysList(laterHistorical)}
				{/if}
			</details>
		{/if}
	{:else}
		<p class="trip-modern-panel-muted text-sm">Weather data is unavailable for these dates.</p>
	{/if}
</section>

<style>
	.weather-days {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, max(7.5rem, 25%)), 1fr));
	}

	.weather-day {
		display: grid;
		align-content: start;
		align-items: start;
		gap: 0.2rem;
		border-top: 1px solid var(--trip-modern-line);
		padding: 0.65rem 0.6rem 0.65rem 0;
		overflow-wrap: anywhere;
	}

	.weather-location,
	.weather-subheading {
		font-size: 0.8rem;
	}

	.weather-subheading {
		color: var(--trip-modern-muted);
		font-weight: 650;
	}

	.weather-heading {
		flex-wrap: wrap;
		gap: 0.35rem 1rem;
		margin-bottom: 0.65rem;
	}

	.weather-more {
		border-top: 1px solid var(--trip-modern-line);
	}

	.weather-more summary {
		color: var(--theme-brand-readable);
	}
</style>
