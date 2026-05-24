export type TabId = 'overview' | 'lists' | 'learn' | 'quiz' | 'progress';

export interface WordItem {
    id: string;
    term: string;
    meaning: string;
    example: string;
    note: string;
    score: number;
    mastered: boolean;
    createdAt: string;
}

export interface WordList {
    id: string;
    name: string;
    context: string;
    description: string;
    color: string;
    createdAt: string;
    words: WordItem[];
}

export interface AppState {
    lists: WordList[];
    activeListId: string;
}

export interface PracticeQuestion {
    wordId: string;
    term: string;
    correctMeaning: string;
    options: string[];
    note: string;
    example: string;
}

export interface PracticeSession {
    questions: PracticeQuestion[];
    currentIndex: number;
    correctCount: number;
    answered: boolean;
    selectedAnswer: string | null;
    finished: boolean;
}
