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
        note: '当前版本使用本地规则生成，后续可切换为后端 AI 释义。'
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
