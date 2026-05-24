import { generateSmartWords } from './utils';

const BACKEND_URL = 'http://localhost:5001';

export interface GeneratedWord {
    term: string;
    meaning: string;
    example: string;
    note: string;
    id: string;
}

export interface WordCompletion {
    meaning: string;
    example: string;
    note: string;
}

/**
 * 尝试调用后端 AI 生成单词；若后端不可用则回退到本地生成器。
 */
export async function fetchGeneratedWords(
    context: string,
    count: number,
    difficulty: 'basic' | 'intermediate' | 'advanced'
): Promise<GeneratedWord[]> {
    try {
        const resp = await fetch(`${BACKEND_URL}/api/generate-words`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ context, count, difficulty }),
            signal: AbortSignal.timeout(8000)
        });

        if (!resp.ok) {
            console.warn('Backend returned error, falling back to local', resp.status);
            return fallback(context, count, difficulty);
        }

        const data = await resp.json();
        const words = data?.words ?? [];

        if (!Array.isArray(words) || words.length === 0) {
            console.warn('Backend returned empty words, falling back to local');
            return fallback(context, count, difficulty);
        }

        return words.map((w: any, i: number) => ({
            term: w.term ?? '',
            meaning: w.meaning ?? '',
            example: w.example ?? '',
            note: w.note ?? '',
            id: `ai_${Date.now()}_${i}`
        }));
    } catch (err) {
        console.warn('Backend unavailable, falling back to local generator', err);
        return fallback(context, count, difficulty);
    }
}

function fallback(
    context: string,
    count: number,
    difficulty: 'basic' | 'intermediate' | 'advanced'
): GeneratedWord[] {
    return generateSmartWords(context, count, difficulty);
}

/** AI 补全单词的释义/例句/提示；失败时返回 null */
export async function fetchWordCompletion(
    term: string,
    context: string
): Promise<WordCompletion | null> {
    try {
        const resp = await fetch(`${BACKEND_URL}/api/complete-word`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ term, context }),
            signal: AbortSignal.timeout(6000)
        });
        if (!resp.ok) return null;
        const data = await resp.json();
        if (!data.meaning) return null;
        return { meaning: data.meaning, example: data.example, note: data.note };
    } catch {
        return null;
    }
}

export interface ReadingResult {
    passage: string;
    terms: string[];
}

/** AI 生成短文（包含词表单词）；失败时回退本地 */
export async function fetchReading(
    terms: string[],
    context: string
): Promise<ReadingResult | null> {
    try {
        const resp = await fetch(`${BACKEND_URL}/api/generate-reading`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ words: terms, context, language: 'en' }),
            signal: AbortSignal.timeout(25000)
        });
        if (!resp.ok) {
            const errBody = await resp.text().catch(() => '');
            console.error(`Reading API error ${resp.status}: ${errBody.slice(0, 200)}`);
            return null;
        }
        const data = await resp.json();
        if (!data.passage) {
            console.error('Reading API: response missing passage', data);
            return null;
        }
        return { passage: data.passage, terms };
    } catch (err) {
        console.error('Reading API exception:', err);
        return null;
    }
}

export interface ImageResult {
    url: string;
    alt: string;
    photographer: string;
    source: string;
}

/** 从 Pexels 搜索与查询相关的图片 */
export async function fetchImage(query: string): Promise<ImageResult | null> {
    try {
        const resp = await fetch(`${BACKEND_URL}/api/find-image`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query }),
            signal: AbortSignal.timeout(8000)
        });
        if (!resp.ok) return null;
        return await resp.json();
    } catch {
        return null;
    }
}

interface AiQuizQuestion {
    type?: 'meaning' | 'cloze';
    term: string;
    correctMeaning: string;
    options: string[];
    note: string;
    example: string;
    contextNote?: string;
    questionText?: string;
}

/** AI 生成额外综合题；失败时返回空数组 */
export async function fetchQuizExtras(
    words: Array<{ term: string; meaning: string }>,
    context: string
): Promise<AiQuizQuestion[]> {
    try {
        const resp = await fetch(`${BACKEND_URL}/api/generate-quiz-extra`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ words, context }),
            signal: AbortSignal.timeout(15000)
        });
        if (!resp.ok) return [];
        const data = await resp.json();
        return data.questions ?? [];
    } catch {
        return [];
    }
}
