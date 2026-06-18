<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import confetti from 'canvas-confetti';
	import { toast } from 'svelte-sonner';
	import { formatValue, playSound, showConfetti, crashMultiplierFromElapsed } from '$lib/utils';
	import { volumeSettings } from '$lib/stores/volume-settings';
	import { onMount, onDestroy } from 'svelte';
	import { fetchPortfolioSummary } from '$lib/stores/portfolio-data';
	import { haptic } from '$lib/stores/haptics';

	const MAX_BET_AMOUNT = 1000000;
	const POLL_INTERVAL_MS = 150;
	const MAX_PAYOUT = 2000000;

	let {
		balance = $bindable(),
		onBalanceUpdate
	}: {
		balance: number;
		onBalanceUpdate?: (newBalance: number) => void;
	} = $props();

	type GameState = 'idle' | 'rising' | 'cashed' | 'crashed';

	let betAmount = $state(10);
	let betAmountDisplay = $state('10');
	let autoCashoutInput = $state('');
	let isPlaying = $state(false);
	let gameState: GameState = $state('idle');
	let sessionToken = $state<string | null>(null);
	let startTime = $state(0);
	let currentMultiplier = $state(1);
	let crashPoint = $state<number | null>(null);
	let lastPayout = $state(0);
	let curvePath = $state('');
	let processing = $state(false);

	let rafId: number | null = null;
	let pollId: ReturnType<typeof setInterval> | null = null;
	let curvePoints: { t: number; m: number }[] = [];

	let canBet = $derived(betAmount > 0 && betAmount <= balance && betAmount <= MAX_BET_AMOUNT && !isPlaying);
	let autoCashoutTarget = $derived.by(() => {
		const v = parseFloat(autoCashoutInput);
		return !isNaN(v) && v >= 1.01 ? Math.floor(v * 100) / 100 : null;
	});
	let potentialPayout = $derived(betAmount * currentMultiplier);

	function multiplierColor(): string {
		if (gameState === 'crashed') return '#ef4444';
		if (gameState === 'cashed') return '#22c55e';
		if (gameState === 'rising') return '#22c55e';
		return 'var(--muted-foreground)';
	}

	function setBetAmount(amount: number) {
		const clamped = Math.min(amount, Math.min(balance, MAX_BET_AMOUNT));
		if (clamped >= 0) {
			betAmount = clamped;
			betAmountDisplay = clamped.toLocaleString();
		}
	}

	function handleBetAmountInput(event: Event) {
		const value = (event.target as HTMLInputElement).value.replace(/,/g, '');
		const num = parseFloat(value) || 0;
		const clamped = Math.min(num, Math.min(balance, MAX_BET_AMOUNT));
		betAmount = clamped;
		betAmountDisplay = value;
	}

	function handleBetAmountBlur() {
		betAmountDisplay = betAmount.toLocaleString();
	}

	function buildCurvePath() {
		if (curvePoints.length === 0) {
			curvePath = '';
			return;
		}
		const maxT = Math.max(20000, curvePoints[curvePoints.length - 1].t);
		const maxM = Math.max(2, ...curvePoints.map((p) => p.m));
		const W = 300;
		const H = 160;
		const pad = 8;
		let d = '';
		for (let i = 0; i < curvePoints.length; i++) {
			const p = curvePoints[i];
			const x = pad + Math.min(p.t / maxT, 1) * (W - pad * 2);
			const y = H - pad - Math.min((p.m - 1) / (maxM - 1), 1) * (H - pad * 2);
			d += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)} `;
		}
		curvePath = d.trim();
	}

	function stopAnimation() {
		if (rafId !== null) {
			cancelAnimationFrame(rafId);
			rafId = null;
		}
		if (pollId !== null) {
			clearInterval(pollId);
			pollId = null;
		}
	}

	function animate() {
		if (!isPlaying || gameState !== 'rising') return;
		const elapsed = Date.now() - startTime;
		const m = crashMultiplierFromElapsed(elapsed);
		currentMultiplier = Math.floor(m * 100) / 100;
		curvePoints.push({ t: elapsed, m });
		if (curvePoints.length > 300) curvePoints.shift();
		buildCurvePath();

		const target = autoCashoutTarget;
		if (target !== null && currentMultiplier >= target) {
			cashOut(true);
			return;
		}
		rafId = requestAnimationFrame(animate);
	}

	function startPolling() {
		if (!sessionToken) return;
		pollId = setInterval(async () => {
			if (!sessionToken || gameState !== 'rising') return;
			try {
				const res = await fetch(`/api/arcade/crash/state?sessionToken=${sessionToken}`);
				if (!res.ok) return;
				const data = await res.json();
				if (data.status === 'crashed') {
					handleCrash(data.crashPoint);
				} else if (data.status === 'ended') {
					// Resolved elsewhere (e.g. cashout). Stop polling.
					stopAnimation();
				}
			} catch {
				// network blip — keep going
			}
		}, POLL_INTERVAL_MS);
	}

	function handleCrash(point: number) {
		stopAnimation();
		gameState = 'crashed';
		crashPoint = point;
		currentMultiplier = point;
		isPlaying = false;
		sessionToken = null;
		haptic.trigger('error');
		playSound('lose');
		toast.error(`Crashed @ ${point.toFixed(2)}x`);
	}

	async function startGame() {
		if (!canBet || processing) return;
		processing = true;

		const target = autoCashoutTarget;

		// Optimistic balance deduction
		balance -= betAmount;
		onBalanceUpdate?.(balance);

		try {
			const response = await fetch('/api/arcade/crash/start', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ betAmount, autoCashoutTarget: target })
			});
			if (!response.ok) {
				const errorData = await response.json();
				balance += betAmount;
				onBalanceUpdate?.(balance);
				throw new Error(errorData.error || 'Failed to start game');
			}
			const result = await response.json();
			sessionToken = result.sessionToken;
			startTime = result.startTime;
			balance = result.newBalance;
			onBalanceUpdate?.(balance);
			currentMultiplier = 1;
			crashPoint = null;
			lastPayout = 0;
			curvePoints = [{ t: 0, m: 1 }];
			buildCurvePath();
			gameState = 'rising';
			isPlaying = true;
			rafId = requestAnimationFrame(animate);
			startPolling();
		} catch (error) {
			console.error('Crash start error:', error);
			toast.error('Failed to start game', {
				description: error instanceof Error ? error.message : 'Unknown error occurred'
			});
		} finally {
			processing = false;
		}
	}

	async function cashOut(auto = false) {
		if (!isPlaying || !sessionToken || processing || gameState !== 'rising') return;
		processing = true;
		stopAnimation();

		try {
			const response = await fetch('/api/arcade/crash/cashout', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ sessionToken })
			});
			if (!response.ok) {
				const errorData = await response.json();
				const err = errorData.error || 'Failed to cash out';
				// Round resolved concurrently (e.g. crash detected by polling) — stop silently;
				// the polling handler will surface the crash result.
				if (err === 'Session already processed' || err === 'Invalid session') {
					isPlaying = false;
					sessionToken = null;
					stopAnimation();
					return;
				}
				throw new Error(err);
			}
			const result = await response.json();
			balance = result.newBalance;
			onBalanceUpdate?.(balance);
			lastPayout = result.payout;
			crashPoint = result.crashPoint;

			if (result.won) {
				gameState = 'cashed';
				currentMultiplier = result.multiplier;
				haptic.trigger('success');
				playSound('win');
				if (result.payout > betAmount) showConfetti(confetti);
				toast.success(`Cashed out @ ${result.multiplier.toFixed(2)}x`, {
					description: `Won ${formatValue(result.payout)}`
				});
			} else {
				// Cashed out too late — it had already crashed.
				gameState = 'crashed';
				currentMultiplier = result.crashPoint;
				haptic.trigger('error');
				playSound('lose');
				toast.error(`Crashed @ ${result.crashPoint.toFixed(2)}x`);
			}
			isPlaying = false;
			sessionToken = null;
		} catch (error) {
			console.error('Crash cashout error:', error);
			toast.error('Failed to cash out', {
				description: error instanceof Error ? error.message : 'Unknown error occurred'
			});
		} finally {
			processing = false;
		}
	}

	onMount(async () => {
		volumeSettings.load();
		try {
			const data = await fetchPortfolioSummary();
			if (data) {
				balance = data.baseCurrencyBalance;
				onBalanceUpdate?.(data.baseCurrencyBalance);
			}
		} catch (error) {
			console.error('Failed to fetch balance:', error);
		}
	});

	onDestroy(stopAnimation);
</script>

<Card>
	<CardHeader>
		<CardTitle>Crash</CardTitle>
		<CardDescription>
			Watch the multiplier rise and cash out before it crashes. How long can you hold?
		</CardDescription>
	</CardHeader>
	<CardContent>
		<div class="grid grid-cols-1 gap-8 md:grid-cols-2">
			<!-- Left: multiplier display + curve -->
			<div class="flex flex-col space-y-4">
				<div class="text-center">
					<p class="text-muted-foreground text-sm">Balance</p>
					<p class="text-2xl font-bold">{formatValue(balance)}</p>
				</div>

				<div class="crash-stage" class:crashed={gameState === 'crashed'} class:cashed={gameState === 'cashed'}>
					<svg viewBox="0 0 300 160" preserveAspectRatio="none" class="absolute inset-0 h-full w-full">
						<defs>
							<linearGradient id="crashFill" x1="0" y1="0" x2="0" y2="1">
								<stop offset="0%" stop-color={multiplierColor()} stop-opacity="0.35" />
								<stop offset="100%" stop-color={multiplierColor()} stop-opacity="0" />
							</linearGradient>
						</defs>
						{#if curvePath}
							<path d={`${curvePath} L300,160 L0,160 Z`} fill="url(#crashFill)" />
							<path d={curvePath} fill="none" stroke={multiplierColor()} stroke-width="2.5" stroke-linejoin="round" />
						{/if}
					</svg>

					<div class="relative z-10 flex h-full flex-col items-center justify-center">
						<div
							class="crash-multiplier font-mono font-extrabold tracking-tight"
							style="color: {multiplierColor()}"
						>
							{currentMultiplier.toFixed(2)}x
						</div>
						<div class="mt-2 text-center text-sm font-medium">
							{#if gameState === 'idle'}
								<span class="text-muted-foreground">Place your bet to begin</span>
							{:else if gameState === 'rising'}
								<span class="text-muted-foreground">Rising…</span>
							{:else if gameState === 'cashed'}
								<span class="text-success">Cashed out for {formatValue(lastPayout)}</span>
							{:else if gameState === 'crashed'}
								<span class="text-destructive">Crashed @ {(crashPoint ?? 1).toFixed(2)}x</span>
							{/if}
						</div>
					</div>
				</div>
			</div>

			<!-- Right: controls -->
			<div class="space-y-4">
				<div>
					<label for="bet-amount" class="mb-2 block text-sm font-medium">Bet Amount</label>
					<Input
						id="bet-amount"
						type="text"
						value={betAmountDisplay}
						oninput={handleBetAmountInput}
						onblur={handleBetAmountBlur}
						disabled={isPlaying}
						placeholder="Enter bet amount"
					/>
					<div class="mt-2 grid grid-cols-4 gap-2">
						<Button size="sm" variant="outline" onclick={() => setBetAmount(Math.floor(Math.min(balance, MAX_BET_AMOUNT) * 0.25))} disabled={isPlaying}>25%</Button>
						<Button size="sm" variant="outline" onclick={() => setBetAmount(Math.floor(Math.min(balance, MAX_BET_AMOUNT) * 0.5))} disabled={isPlaying}>50%</Button>
						<Button size="sm" variant="outline" onclick={() => setBetAmount(Math.floor(Math.min(balance, MAX_BET_AMOUNT) * 0.75))} disabled={isPlaying}>75%</Button>
						<Button size="sm" variant="outline" onclick={() => setBetAmount(Math.floor(Math.min(balance, MAX_BET_AMOUNT)))} disabled={isPlaying}>Max</Button>
					</div>
				</div>

				<div>
					<label for="auto-cashout" class="mb-2 block text-sm font-medium">Auto Cashout (x)</label>
					<Input
						id="auto-cashout"
						type="number"
						min="1.01"
						step="0.1"
						value={autoCashoutInput}
						oninput={(e) => (autoCashoutInput = (e.target as HTMLInputElement)?.value ?? '')}
						disabled={isPlaying}
						placeholder="optional, e.g. 2.00"
					/>
					<p class="text-muted-foreground mt-1 text-xs">
						Auto-cashes out when the multiplier reaches this value.
					</p>
				</div>

				<div class="flex flex-col gap-2">
					{#if !isPlaying}
						<Button class="h-12 flex-1 text-lg" onclick={startGame} disabled={!canBet}>
							Start Game
						</Button>
					{:else}
						<Button class="cashout-btn h-14 flex-1 flex-col text-lg" onclick={() => cashOut(false)} disabled={processing}>
							<span>Cash Out</span>
							<span class="text-sm font-semibold">{formatValue(Math.min(potentialPayout, MAX_PAYOUT))}</span>
						</Button>
						<div class="bg-muted/50 space-y-2 rounded-lg p-3">
							<div class="flex justify-between">
								<span class="text-muted-foreground">Current Multiplier:</span>
								<span class="font-mono font-medium">{currentMultiplier.toFixed(2)}x</span>
							</div>
							<div class="flex justify-between">
								<span class="text-muted-foreground">Potential Payout:</span>
								<span class="text-success">{formatValue(Math.min(potentialPayout, MAX_PAYOUT))}</span>
							</div>
							<div class="flex justify-between">
								<span class="text-muted-foreground">Profit:</span>
								<span class="text-success">
									+{formatValue(Math.min(potentialPayout, MAX_PAYOUT) - betAmount)}
								</span>
							</div>
						</div>
					{/if}
				</div>

				<p class="text-muted-foreground text-xs">
					Note: Maximum payout per game is capped at {MAX_PAYOUT.toLocaleString()}.
				</p>
			</div>
		</div>
	</CardContent>
</Card>

<style>
	.crash-stage {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		height: 220px;
		border: 2px solid var(--border);
		border-radius: var(--radius);
		background:
			radial-gradient(circle at 50% 120%, var(--muted) 0%, transparent 70%),
			var(--card);
		overflow: hidden;
		transition: border-color 0.3s ease;
	}

	.crash-stage.cashed {
		border-color: rgb(34, 197, 94);
	}

	.crash-stage.crashed {
		border-color: rgb(239, 68, 68);
		animation: shake 0.4s ease;
	}

	.crash-multiplier {
		font-size: 3.5rem;
		line-height: 1;
		text-shadow: 0 0 24px currentColor;
	}

	.cashout-btn {
		background: rgb(34, 197, 94);
		color: white;
		animation: pulse-green 1s ease-in-out infinite;
	}

	.cashout-btn:hover {
		background: rgb(22, 163, 74);
	}

	@keyframes pulse-green {
		0%, 100% {
			box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.5);
		}
		50% {
			box-shadow: 0 0 0 8px rgba(34, 197, 94, 0);
		}
	}

	@keyframes shake {
		0%, 100% { transform: translateX(0); }
		25% { transform: translateX(-6px); }
		75% { transform: translateX(6px); }
	}
</style>
