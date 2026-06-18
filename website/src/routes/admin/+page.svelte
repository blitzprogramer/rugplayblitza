<script lang="ts">
	import { onMount } from 'svelte';
	import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '$lib/components/ui/card';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import {
		Dollar02Icon,
		GemIcon,
		UserGroupIcon,
		Cancel01Icon,
		UserIcon,
		Coins01Icon,
		Joystick04Icon,
		PiggyBankIcon,
		ArrowUpDownIcon,
		Analytics01Icon,
		Loading03Icon
	} from '@hugeicons/core-free-icons';
	import { formatValue, formatRelativeTime } from '$lib/utils';

	interface AdminStats {
		users: { total: number; banned: number; new24h: number };
		economy: { totalCash: number; totalGems: number };
		arcade: {
			totalWagered: number;
			totalWins: number;
			totalLosses: number;
			ggr: number;
			totalGames: number;
		};
		hopium: {
			active: number;
			resolved: number;
			cancelled: number;
			total: number;
			volume: number;
		};
		recentSignups: { id: number; username: string; name: string; createdAt: string }[];
	}

	let stats = $state<AdminStats | null>(null);
	let loading = $state(true);
	let loadError = $state('');

	async function loadStats() {
		loading = true;
		loadError = '';
		try {
			const res = await fetch('/api/admin/stats');
			if (!res.ok) throw new Error('Failed to load stats');
			stats = await res.json();
		} catch (e) {
			loadError = e instanceof Error ? e.message : 'Unknown error';
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		loadStats();
	});

	const fmt = (n: number) => n.toLocaleString('en-US');
</script>

<svelte:head>
	<title>Admin Overview - Rugplay</title>
</svelte:head>

<div class="container mx-auto max-w-6xl space-y-6 px-4 py-6">
	<div class="flex items-center justify-between">
		<div>
			<h2 class="text-lg font-semibold">Overview</h2>
			<p class="text-muted-foreground text-sm">Live platform snapshot.</p>
		</div>
		<button
			onclick={loadStats}
			disabled={loading}
			class="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm transition-colors disabled:opacity-50"
		>
			<HugeiconsIcon icon={Loading03Icon} class={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
			Refresh
		</button>
	</div>

	{#if loadError}
		<p class="text-destructive text-sm">{loadError}</p>
	{/if}

	<!-- Economy -->
	<section class="space-y-2">
		<h3 class="text-muted-foreground text-xs font-medium tracking-wide uppercase">Economy</h3>
		<div class="grid grid-cols-2 gap-3 md:grid-cols-4">
			{#if loading || !stats}
				{#each Array(2) as _}<Skeleton class="h-24 rounded-lg" />{/each}
			{:else}
				<Card>
					<CardContent class="p-4">
						<div class="flex items-center justify-between">
							<span class="text-muted-foreground text-sm">Cash in circulation</span>
							<HugeiconsIcon icon={Dollar02Icon} class="text-muted-foreground h-4 w-4" />
						</div>
						<div class="mt-2 font-mono text-2xl font-bold">${formatValue(stats.economy.totalCash)}</div>
					</CardContent>
				</Card>
				<Card>
					<CardContent class="p-4">
						<div class="flex items-center justify-between">
							<span class="text-muted-foreground text-sm">Gems</span>
							<HugeiconsIcon icon={GemIcon} class="h-4 w-4" style="color: #ca00ff" />
						</div>
						<div class="mt-2 font-mono text-2xl font-bold">{fmt(stats.economy.totalGems)}</div>
					</CardContent>
				</Card>
			{/if}
		</div>
	</section>

	<!-- Users -->
	<section class="space-y-2">
		<h3 class="text-muted-foreground text-xs font-medium tracking-wide uppercase">Users</h3>
		<div class="grid grid-cols-2 gap-3 md:grid-cols-4">
			{#if loading || !stats}
				{#each Array(3) as _}<Skeleton class="h-24 rounded-lg" />{/each}
			{:else}
				<Card>
					<CardContent class="p-4">
						<div class="flex items-center justify-between">
							<span class="text-muted-foreground text-sm">Total users</span>
							<HugeiconsIcon icon={UserGroupIcon} class="text-muted-foreground h-4 w-4" />
						</div>
						<div class="mt-2 text-2xl font-bold">{fmt(stats.users.total)}</div>
					</CardContent>
				</Card>
				<Card>
					<CardContent class="p-4">
						<div class="flex items-center justify-between">
							<span class="text-muted-foreground text-sm">Banned</span>
							<HugeiconsIcon icon={Cancel01Icon} class="text-muted-foreground h-4 w-4" />
						</div>
						<div class="mt-2 text-2xl font-bold">{fmt(stats.users.banned)}</div>
					</CardContent>
				</Card>
				<Card>
					<CardContent class="p-4">
						<div class="flex items-center justify-between">
							<span class="text-muted-foreground text-sm">New (24h)</span>
							<HugeiconsIcon icon={UserIcon} class="text-muted-foreground h-4 w-4" />
						</div>
						<div class="mt-2 text-2xl font-bold">{fmt(stats.users.new24h)}</div>
					</CardContent>
				</Card>
			{/if}
		</div>
	</section>

	<!-- Arcade -->
	<section class="space-y-2">
		<h3 class="text-muted-foreground text-xs font-medium tracking-wide uppercase">Arcade</h3>
		<div class="grid grid-cols-2 gap-3 md:grid-cols-4">
			{#if loading || !stats}
				{#each Array(4) as _}<Skeleton class="h-24 rounded-lg" />{/each}
			{:else}
				<Card>
					<CardContent class="p-4">
						<div class="flex items-center justify-between">
							<span class="text-muted-foreground text-sm">Total wagered</span>
							<HugeiconsIcon icon={Coins01Icon} class="text-muted-foreground h-4 w-4" />
						</div>
						<div class="mt-2 font-mono text-2xl font-bold">${formatValue(stats.arcade.totalWagered)}</div>
					</CardContent>
				</Card>
				<Card>
					<CardContent class="p-4">
						<div class="flex items-center justify-between">
							<span class="text-muted-foreground text-sm">Games played</span>
							<HugeiconsIcon icon={Joystick04Icon} class="text-muted-foreground h-4 w-4" />
						</div>
						<div class="mt-2 text-2xl font-bold">{fmt(stats.arcade.totalGames)}</div>
					</CardContent>
				</Card>
				<Card>
					<CardContent class="p-4">
						<div class="flex items-center justify-between">
							<span class="text-muted-foreground text-sm">House GGR</span>
							<HugeiconsIcon icon={PiggyBankIcon} class="text-muted-foreground h-4 w-4" />
						</div>
						<div
							class="mt-2 font-mono text-2xl font-bold {stats.arcade.ggr >= 0
								? 'text-green-500'
								: 'text-red-500'}"
						>
							{stats.arcade.ggr >= 0 ? '+' : '-'}${formatValue(Math.abs(stats.arcade.ggr))}
						</div>
						<p class="text-muted-foreground mt-1 text-xs">losses − wins</p>
					</CardContent>
				</Card>
				<Card>
					<CardContent class="p-4">
						<div class="flex items-center justify-between">
							<span class="text-muted-foreground text-sm">Player wins / losses</span>
						</div>
						<div class="mt-2 space-y-0.5 text-sm font-mono">
							<div class="text-green-500">+${formatValue(stats.arcade.totalWins)}</div>
							<div class="text-red-500">-${formatValue(stats.arcade.totalLosses)}</div>
						</div>
					</CardContent>
				</Card>
			{/if}
		</div>
	</section>

	<!-- Hopium -->
	<section class="space-y-2">
		<h3 class="text-muted-foreground text-xs font-medium tracking-wide uppercase">Hopium</h3>
		<div class="grid grid-cols-2 gap-3 md:grid-cols-4">
			{#if loading || !stats}
				{#each Array(3) as _}<Skeleton class="h-24 rounded-lg" />{/each}
			{:else}
				<Card>
					<CardContent class="p-4">
						<div class="flex items-center justify-between">
							<span class="text-muted-foreground text-sm">Active questions</span>
							<HugeiconsIcon icon={ArrowUpDownIcon} class="text-muted-foreground h-4 w-4" />
						</div>
						<div class="mt-2 text-2xl font-bold">{fmt(stats.hopium.active)}</div>
					</CardContent>
				</Card>
				<Card>
					<CardContent class="p-4">
						<div class="flex items-center justify-between">
							<span class="text-muted-foreground text-sm">Resolved</span>
							<HugeiconsIcon icon={Analytics01Icon} class="text-muted-foreground h-4 w-4" />
						</div>
						<div class="mt-2 text-2xl font-bold">{fmt(stats.hopium.resolved)}</div>
					</CardContent>
				</Card>
				<Card>
					<CardContent class="p-4">
						<div class="flex items-center justify-between">
							<span class="text-muted-foreground text-sm">Volume wagered</span>
						</div>
						<div class="mt-2 font-mono text-2xl font-bold">${formatValue(stats.hopium.volume)}</div>
					</CardContent>
				</Card>
			{/if}
		</div>
	</section>

	<!-- Recent signups -->
	<section class="space-y-2">
		<h3 class="text-muted-foreground text-xs font-medium tracking-wide uppercase">Recent signups</h3>
		<Card>
			<CardContent class="p-0">
				{#if loading || !stats}
					<div class="divide-y">
						{#each Array(5) as _}
							<div class="flex items-center justify-between p-3">
								<Skeleton class="h-4 w-32" />
								<Skeleton class="h-3 w-20" />
							</div>
						{/each}
					</div>
				{:else if stats.recentSignups.length === 0}
					<p class="text-muted-foreground p-6 text-center text-sm">No users yet.</p>
				{:else}
					<div class="divide-y">
						{#each stats.recentSignups as u (u.id)}
							<div class="flex items-center justify-between p-3">
								<a
									href={`/user/${u.username}`}
									class="hover:text-primary font-medium transition-colors"
								>
									{u.name}
									<span class="text-muted-foreground font-normal">@{u.username}</span>
								</a>
								<span class="text-muted-foreground text-xs">
									{formatRelativeTime(new Date(u.createdAt))}
								</span>
							</div>
						{/each}
					</div>
				{/if}
			</CardContent>
		</Card>
	</section>
</div>
