import { AppState, PracticeQuestion, PracticeSession, WordItem, WordList } from './types';

const genericDistractors = [
    '一个地点',
    '一种动作',
    '一个情绪',
    '一个工具',
    '一种状态',
    '一段描述',
    '一个概念',
    '一个原因'
];

export function createId(prefix: string): string {
    const random = Math.random().toString(36).slice(2, 8);
    return `${prefix}_${Date.now()}_${random}`;
}

export function shuffle<T>(items: T[]): T[] {
    const copy = [...items];
    for (let index = copy.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(Math.random() * (index + 1));
        [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
    }
    return copy;
}

export function clampScore(value: number): number {
    return Math.max(0, Math.min(100, value));
}

export function buildAutoContent(term: string, context: string): Pick<WordItem, 'meaning' | 'example' | 'note'> {
    return {
        meaning: `在「${context}」语境下，${term} 的常用含义`,
        example: `在 ${context} 场景里，人们会更自然地使用 ${term} 这个词。`,
        note: '在场景语境中使用含义明确。'
    };
}

function collectDistractors(words: WordItem[], currentWord: WordItem): string[] {
    const fromOtherWords = words
        .filter((word) => word.id !== currentWord.id)
        .map((word) => word.meaning)
        .filter(Boolean);

    return [...fromOtherWords, ...genericDistractors];
}

function uniqueOptions(options: string[]): string[] {
    return Array.from(new Set(options)).slice(0, 4);
}

function buildOptions(words: WordItem[], currentWord: WordItem): string[] {
    const candidateOptions = uniqueOptions([
        currentWord.meaning,
        ...collectDistractors(words, currentWord)
    ]);

    while (candidateOptions.length < 4) {
        candidateOptions.push(genericDistractors[candidateOptions.length % genericDistractors.length]);
    }

    return shuffle(candidateOptions.slice(0, 4));
}

export function createPracticeSession(words: WordItem[], limit: number): PracticeSession {
    const selectedWords = shuffle(words).slice(0, Math.max(1, Math.min(limit, words.length)));

    const questions: PracticeQuestion[] = selectedWords.map((word) => ({
        wordId: word.id,
        term: word.term,
        correctMeaning: word.meaning,
        options: buildOptions(words, word),
        note: word.note,
        example: word.example
    }));

    return {
        questions,
        currentIndex: 0,
        correctCount: 0,
        answered: false,
        selectedAnswer: null,
        finished: false
    };
}

export function getActiveList(state: AppState): WordList | undefined {
    return state.lists.find((list) => list.id === state.activeListId) ?? state.lists[0];
}

export function updateWordProgress(list: WordList, wordId: string, correct: boolean): WordList {
    return {
        ...list,
        words: list.words.map((word) => {
            if (word.id !== wordId) {
                return word;
            }

            const scoreDelta = correct ? 28 : 6;
            const score = clampScore(word.score + scoreDelta);

            return {
                ...word,
                score,
                mastered: score >= 60
            };
        })
    };
}

export function calculateStats(state: AppState): {
    listCount: number;
    wordCount: number;
    masteredCount: number;
    averageScore: number;
} {
    const words = state.lists.flatMap((list) => list.words);
    const wordCount = words.length;
    const masteredCount = words.filter((word) => word.mastered).length;
    const totalScore = words.reduce((sum, word) => sum + word.score, 0);

    return {
        listCount: state.lists.length,
        wordCount,
        masteredCount,
        averageScore: wordCount ? Math.round(totalScore / wordCount) : 0
    };
}

export function generateSmartWords(context: string, count: number, difficulty: 'basic' | 'intermediate' | 'advanced' = 'intermediate') {
    const baseTerms = context
        .split(/[,，\s]+/)
        .filter(Boolean)
        .slice(0, 3);

    const difficultyMap = {
        basic: 0.6,
        intermediate: 0.85,
        advanced: 1.2
    } as const;

    const factor = difficultyMap[difficulty];
    const results = [] as Array<Pick<WordItem, 'id' | 'term' | 'meaning' | 'example' | 'note' | 'score' | 'mastered' | 'createdAt'>>;

    for (let i = 0; i < count; i++) {
        const seed = baseTerms.length ? baseTerms[i % baseTerms.length] : `topic`;
        const term = `${seed}-${Math.random().toString(36).slice(2, 7)}`;
        const meaning = `常见于「${context}」场景的词，属于${difficulty}难度。`;
        const example = `在${context}场景中使用 ${term} 的示例句子。`;
        const note = `自动生成：${seed} 相关词，难度 ${difficulty}`;
        const score = Math.max(10, Math.round(20 * factor));

        results.push({
            id: createId('word'),
            term,
            meaning,
            example,
            note,
            score,
            mastered: false,
            createdAt: new Date().toISOString()
        });
    }

    return results;
}

const ACTIVITY_KEY = 'wordpecker-activity-v1';

function loadActivity(): Record<string, number> {
    try {
        return JSON.parse(localStorage.getItem(ACTIVITY_KEY) || '{}');
    } catch { return {}; }
}

function saveActivity(data: Record<string, number>) {
    try { localStorage.setItem(ACTIVITY_KEY, JSON.stringify(data)); } catch { /* ignore */ }
}

/** 记录一次答题活动 */
export function logActivity() {
    const today = new Date().toISOString().slice(0, 10);
    const data = loadActivity();
    data[today] = (data[today] || 0) + 1;
    saveActivity(data);
}

/** 获取活动统计数据 */
export function getActivityStats() {
    const data = loadActivity();
    const today = new Date().toISOString().slice(0, 10);
    const todayStr = today;

    // 本月
    const thisMonth = todayStr.slice(0, 7);
    let monthSolved = 0;
    for (const [date, count] of Object.entries(data)) {
        if (date.startsWith(thisMonth)) monthSolved += count;
    }

    // 连续提交 streak
    let streak = 0;
    const d = new Date();
    while (true) {
        const key = d.toISOString().slice(0, 10);
        if (data[key]) { streak++; d.setDate(d.getDate() - 1); }
        else break;
    }

    // 今日
    const todayCount = data[todayStr] || 0;

    // 最近 365 天数据（用于渲染网格）
    const days: Array<{ date: string; count: number }> = [];
    for (let i = 364; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const key = d.toISOString().slice(0, 10);
        days.push({ date: key, count: data[key] || 0 });
    }

    return { streak, monthSolved, todayCount, days };
}

export function buildLocalReading(words: Pick<WordItem, 'term' | 'meaning'>[], context: string): string {
    const terms = words.slice(0, 10);
    const sentences = terms.map((w, i) => {
        const phrases = [
            `In the context of "${context}", we often use the word "${w.term}" which means "${w.meaning}".`,
            `One important term here is "${w.term}" — it refers to ${w.meaning}.`,
            `You should remember "${w.term}" when talking about ${context}.`,
            `The word "${w.term}" appears frequently in ${context} scenarios, meaning "${w.meaning}".`,
            `When discussing ${context}, "${w.term}" is a key vocabulary word — ${w.meaning}.`
        ];
        return phrases[i % phrases.length];
    });
    return `${sentences.join(' ')}\n\nThese are the basic vocabulary words related to "${context}". Try to use them in your own sentences!`;
}

/** 本地挖空生成完形填空题 */
export function buildLocalCloze(
    words: WordItem[],
    count: number = 3
): Array<{ type: 'cloze'; wordId: string; term: string; correctMeaning: string; options: string[]; note: string; example: string; questionText: string; contextNote: string }> {
    const shuffled = shuffle(words).slice(0, count);
    const results: any[] = [];

    for (const word of shuffled) {
        if (!word.example) continue;
        // 从例句中找到目标词并替换为 ___
        const regex = new RegExp(`\\b${word.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
        if (!regex.test(word.example)) continue;

        const questionText = word.example.replace(regex, '___');
        // 干扰项：从其他词中随机取 3 个词
        const distractors = shuffle(
            words.filter((w) => w.id !== word.id).map((w) => w.term)
        ).slice(0, 3);
        // 补足到 3 个
        while (distractors.length < 3) distractors.push(['it', 'this', 'that'][distractors.length]);

        results.push({
            type: 'cloze',
            wordId: word.id,
            term: word.term,
            correctMeaning: word.term,
            options: shuffle([word.term, ...distractors]),
            note: word.note || '根据上下文选择正确单词',
            example: word.example,
            questionText,
            contextNote: '选择适合空格的单词'
        });
    }

    return results;
}

/** 基础 Markdown 渲染 — 将 Markdown 文本转为安全的 HTML */
export function renderMarkdown(text: string): string {
    let html = text
        // 转义 HTML 特殊字符
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')

        // 代码块 (```...```)
        .replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) =>
            `<pre><code>${code.trim()}</code></pre>`
        )

        // 行内代码 (`code`)
        .replace(/`([^`]+)`/g, '<code>$1</code>')

        // 加粗 (**text**)
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')

        // 斜体 (*text*)
        .replace(/\*([^*]+)\*/g, '<em>$1</em>')

        // 换行 -> <br>
        .replace(/\n/g, '<br>')

        // 无序列表
        .replace(/((?:<br>• [^<]+)+)/g, (match) => {
            const items = match.split('<br>').filter(Boolean).map(line =>
                `<li>${line.replace(/^• /, '')}</li>`
            ).join('');
            return `<ul>${items}</ul>`;
        })

        // 有序列表
        .replace(/((?:<br>\d+\. [^<]+)+)/g, (match) => {
            const items = match.split('<br>').filter(Boolean).map(line =>
                `<li>${line.replace(/^\d+\. /, '')}</li>`
            ).join('');
            return `<ol>${items}</ol>`;
        });

    return html;
}
