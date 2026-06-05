export type TabId = 'overview' | 'lists' | 'learn' | 'quiz' | 'progress' | 'voice' | 'vision' | 'settings';

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
    type?: 'meaning' | 'cloze';
    term: string;
    correctMeaning: string;
    options: string[];
    note: string;
    example: string;
    contextNote?: string;
    questionText?: string;
}

export interface PracticeSession {
    questions: PracticeQuestion[];
    currentIndex: number;
    correctCount: number;
    answered: boolean;
    selectedAnswer: string | null;
    finished: boolean;
}
