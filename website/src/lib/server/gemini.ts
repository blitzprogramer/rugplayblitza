import { env } from '$env/dynamic/private';

// Lightweight Gemini (Google AI Studio) client over the REST API.
// No SDK dependency — keeps install/lockfile concerns out of the way, and the
// key is validated against this same endpoint in the smoke test. Free tier,
// includes Google Search grounding for "what's hot now" pop-culture queries.

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
export const GEMINI_DEFAULT_MODEL = 'gemini-2.5-flash';

export interface GeminiCallOptions {
    prompt: string;
    systemInstruction?: string;
    /** Enables Google Search grounding (pop-culture / current-events queries). */
    webSearch?: boolean;
    temperature?: number;
    model?: string;
}

export interface GeminiCallResult {
    text: string;
    /** Web sources the model grounded on (when webSearch was enabled). */
    groundingSources: string[];
}

export function isGeminiConfigured(): boolean {
    return Boolean(env.GEMINI_API_KEY);
}

/**
 * Calls Gemini's generateContent endpoint. Always returns JSON
 * (responseMimeType: application/json) — strict responseSchema is intentionally
 * NOT used because it is incompatible with the googleSearch tool; callers
 * validate the shape with zod instead.
 */
export async function callGemini(opts: GeminiCallOptions): Promise<GeminiCallResult> {
    if (!env.GEMINI_API_KEY) {
        throw new Error('GEMINI_API_KEY is not set – AI features are disabled.');
    }

    const model = opts.model ?? GEMINI_DEFAULT_MODEL;

    const generationConfig: Record<string, unknown> = {
        temperature: opts.temperature ?? 0.2
    };
    // JSON mode (responseMimeType) is incompatible with the googleSearch tool,
    // so we only enforce JSON when not grounding. When searching, the model still
    // returns JSON (per the prompt) and the caller parses it defensively.
    if (!opts.webSearch) {
        generationConfig.responseMimeType = 'application/json';
    }

    const body: Record<string, unknown> = {
        contents: [{ role: 'user', parts: [{ text: opts.prompt }] }],
        generationConfig
    };

    if (opts.systemInstruction) {
        body.systemInstruction = { parts: [{ text: opts.systemInstruction }] };
    }

    if (opts.webSearch) {
        body.tools = [{ googleSearch: {} }];
    }

    const url = `${GEMINI_BASE}/models/${model}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`;

    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });

    if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`Gemini API error ${res.status}: ${detail.slice(0, 500)}`);
    }

    const data: any = await res.json();

    const candidate = data?.candidates?.[0];
    const text: string =
        candidate?.content?.parts
            ?.map((p: { text?: string }) => p.text)
            .filter((t: unknown): t is string => typeof t === 'string')
            .join('') ?? '';

    const groundingSources: string[] =
        candidate?.groundingMetadata?.groundingChunks
            ?.map((c: { web?: { uri?: string } }) => c?.web?.uri)
            .filter((u: unknown): u is string => typeof u === 'string') ?? [];

    if (!text) {
        const blockReason = candidate?.finishReason;
        throw new Error(`Gemini returned no text (finishReason: ${blockReason ?? 'unknown'})`);
    }

    return { text, groundingSources };
}

/**
 * Parses JSON from a Gemini text response, tolerating code fences and stray
 * prose around the JSON object/array (common when grounding is enabled, since
 * JSON mode cannot be combined with the googleSearch tool).
 */
export function parseJsonResponse<T = unknown>(text: string): T {
    const trimmed = text.trim();

    // 1. Strip ```json ... ``` fences if present.
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    let candidate = fenced ? fenced[1].trim() : trimmed;

    // 2. Try as-is.
    try {
        return JSON.parse(candidate) as T;
    } catch {
        // 3. Slice to the outermost JSON object/array (handles prose around it).
        const first = candidate.search(/[{[]/);
        const last = Math.max(candidate.lastIndexOf('}'), candidate.lastIndexOf(']'));
        if (first >= 0 && last > first) {
            return JSON.parse(candidate.slice(first, last + 1)) as T;
        }
        throw new Error('Could not parse JSON from Gemini response');
    }
}
