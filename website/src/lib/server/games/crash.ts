import { randomInt } from 'crypto';

export interface CrashSession {
    sessionToken: string;
    betAmount: number;
    crashPoint: number; // multiplier at which the round busts (secret during play)
    startTime: number; // epoch ms
    status: 'active' | 'cashed' | 'crashed';
    userId: number;
    autoCashoutTarget: number | null;
}

const CRASH_SESSION_PREFIX = 'crash:session:';
export const getSessionKey = (token: string) => `${CRASH_SESSION_PREFIX}${token}`;

export const CRASH_SESSION_TTL_SECONDS = 300; // orphaned rounds auto-expire
export const CRASH_MAX_MULTIPLIER = 1000; // sanity cap on crash point
export const CRASH_MAX_PAYOUT = 2_000_000; // matches mines cap

// Canonical bustabit-style crash point with ~3% house edge (1/33 instant bust)
// and a heavy tail: median ~2x, ~10% exceed 10x, ~1% exceed 100x.
export function generateCrashPoint(): number {
    const e = 2 ** 32;
    const h = randomInt(0, e); // uniform [0, 2^32)
    if (h % 33 === 0) return 1; // ~3.03% instant bust
    const raw = ((100 * e - h) / (e - h)) / 100;
    const point = Math.max(1, Math.floor(raw * 100) / 100);
    return Math.min(point, CRASH_MAX_MULTIPLIER);
}
