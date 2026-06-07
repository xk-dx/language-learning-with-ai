import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { initialState } from './data';
import { AppState, PracticeSession, TabId, WordItem, WordList } from './types';
import {
    buildAutoContent,
    calculateStats,
    clampScore,
    createId,
    createPracticeSession,
    getActiveList,
    shuffle,
    updateWordProgress,
    generateSmartWords,
    buildLocalReading,
    buildLocalCloze,
    logActivity,
    getActivityStats,
    renderMarkdown
} from './utils';
import { fetchGeneratedWords, fetchWordCompletion, fetchReading, fetchImage, fetchQuizExtras } from './apiService';

const STORAGE_KEY = 'wordpecker-mini-state-v1';
const THEME_KEY = 'wordpecker-theme-v1';
const ONBOARDING_KEY = 'wordforge-onboarding-v1';
const SETTINGS_KEY = 'wordforge-user-settings-v1';
const NAV_ITEMS: Array<{ id: TabId; label: string; hint: string; description: string }> = [
    { id: 'overview', label: '仪表盘', hint: 'Dashboard', description: '从词表出发查看学习入口、当前进度和下一步建议。' },
    { id: 'lists', label: '我的词库', hint: 'Vocab', description: '创建场景词表，收集单词，并用 AI、PDF 和图片补充语料。' },
    { id: 'learn', label: '沉浸学习', hint: 'Study', description: '选择词表后进入阅读、卡片、测验、口语和资料问答。' },
    { id: 'progress', label: '学习报告', hint: 'Progress', description: '复盘各词表掌握情况，发现薄弱词和长期练习趋势。' },
    { id: 'settings', label: '系统设置', hint: 'Settings', description: '配置模型服务、图片服务、学习偏好和本地数据管理。' }
];

const difficultyPills = ['入门', '日常', '进阶'];

function WordForgeLogo({ variant = 'full', className = '' }: { variant?: 'icon' | 'full'; className?: string }) {
    return (
        <div className={`wordforge-logo wordforge-logo-${variant} ${className}`.trim()} aria-label="WordForge">
            <svg className="wordforge-logo-mark" viewBox="0 0 48 48" role="img" aria-hidden="true">
                <rect className="logo-mark-bg" x="4" y="4" width="40" height="40" rx="13" />
                <path className="logo-book-left" d="M13 16.5c4.6-.9 8.2.1 10.8 3v15c-2.6-2.1-6.2-2.8-10.8-1.9v-16.1Z" />
                <path className="logo-book-right" d="M35 16.5c-4.6-.9-8.2.1-10.8 3v15c2.6-2.1 6.2-2.8 10.8-1.9v-16.1Z" />
                <path className="logo-book-spine" d="M24 19.5v15" />
                <path className="logo-spark" d="M32.5 10.5l1.1 2.7 2.7 1.1-2.7 1.1-1.1 2.7-1.1-2.7-2.7-1.1 2.7-1.1 1.1-2.7Z" />
            </svg>
            {variant === 'full' && (
                <span className="wordforge-logo-text">
                    <strong>WordForge</strong>
                </span>
            )}
        </div>
    );
}

function loadState(): AppState {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) {
            return initialState;
        }

        const parsed = JSON.parse(raw) as AppState;
        if (!parsed?.lists?.length) {
            return initialState;
        }

        return parsed;
    } catch {
        return initialState;
    }
}

function saveState(state: AppState) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

type SettingsSection = 'model' | 'image' | 'preference' | 'data' | 'about';

interface UserSettings {
    apiKey: string;
    baseUrl: string;
    defaultModel: string;
    pexelsKey: string;
    defaultListId: string;
    defaultPractice: 'flashcard' | 'reading' | 'quiz' | 'voice';
    speechEnabled: boolean;
    speechLang: string;
}

type StudyMode = 'hub' | 'flashcard' | 'reading' | 'quiz' | 'voice' | 'materials';
type ReportWordPanel = 'weak' | 'mastered' | null;

const defaultUserSettings: UserSettings = {
    apiKey: '',
    baseUrl: 'https://api.deepseek.com',
    defaultModel: 'deepseek-v4-flash',
    pexelsKey: '',
    defaultListId: '',
    defaultPractice: 'flashcard',
    speechEnabled: true,
    speechLang: 'zh-CN'
};

function loadUserSettings(): UserSettings {
    try {
        const raw = localStorage.getItem(SETTINGS_KEY);
        if (!raw) {
            return defaultUserSettings;
        }

        return { ...defaultUserSettings, ...JSON.parse(raw) };
    } catch {
        return defaultUserSettings;
    }
}

function nextColor(index: number): string {
    const palette = ['sun', 'mint', 'violet', 'sky', 'amber'];
    return palette[index % palette.length];
}

function updateList(state: AppState, listId: string, updater: (list: WordList) => WordList): AppState {
    return {
        ...state,
        lists: state.lists.map((list) => (list.id === listId ? updater(list) : list))
    };
}

function removeList(state: AppState, listId: string): AppState {
    const nextLists = state.lists.filter((list) => list.id !== listId);
    const nextActiveListId = nextLists[0]?.id ?? '';

    return {
        lists: nextLists,
        activeListId: nextActiveListId
    };
}

function deleteWordFromList(state: AppState, listId: string, wordId: string): AppState {
    return updateList(state, listId, (list) => ({
        ...list,
        words: list.words.filter((word) => word.id !== wordId)
    }));
}

function addWordToList(state: AppState, listId: string, term: string, meaning: string, example?: string, note?: string): AppState {
    const list = state.lists.find((item) => item.id === listId);
    if (!list) {
        return state;
    }

    const auto = buildAutoContent(term, list.context);
    const newWord: WordItem = {
        id: createId('word'),
        term,
        meaning: meaning.trim() || auto.meaning,
        example: example?.trim() || auto.example,
        note: note?.trim() || auto.note,
        score: meaning.trim() ? 20 : 12,
        mastered: false,
        createdAt: new Date().toISOString()
    };

    return updateList(state, listId, (current) => ({
        ...current,
        words: [newWord, ...current.words]
    }));
}

function createList(state: AppState, name: string, context: string, description: string): AppState {
    const list: WordList = {
        id: createId('list'),
        name,
        context,
        description: description.trim() || `围绕「${context}」的最小词表`,
        color: nextColor(state.lists.length),
        createdAt: new Date().toISOString(),
        words: []
    };

    return {
        lists: [list, ...state.lists],
        activeListId: list.id
    };
}

function scoreWord(state: AppState, listId: string, wordId: string, correct: boolean): AppState {
    return updateList(state, listId, (list) => updateWordProgress(list, wordId, correct));
}

function buildSession(words: WordItem[], limit: number): PracticeSession {
    if (!words.length) {
        return {
            questions: [],
            currentIndex: 0,
            correctCount: 0,
            answered: false,
            selectedAnswer: null,
            finished: true
        };
    }

    return createPracticeSession(words, limit);
}

function App() {
    const [state, setState] = useState<AppState>(() => loadState());
    const [activeTab, setActiveTab] = useState<TabId>('overview');
    const [selectedWordId, setSelectedWordId] = useState('');
    const [listName, setListName] = useState('');
    const [listContext, setListContext] = useState('');
    const [listDescription, setListDescription] = useState('');
    const [wordTerm, setWordTerm] = useState('');
    const [wordMeaning, setWordMeaning] = useState('');
    const [message, setMessage] = useState('');
    const [learnRound, setLearnRound] = useState(0);
    const [quizRound, setQuizRound] = useState(0);
    const [learnSession, setLearnSession] = useState<PracticeSession>(() => buildSession(initialState.lists[0].words, 6));
    const [quizSession, setQuizSession] = useState<PracticeSession>(() => buildSession(initialState.lists[0].words, 5));
    const [learnShowExplanationIndex, setLearnShowExplanationIndex] = useState<number | null>(null);
    const [quizShowExplanationIndex, setQuizShowExplanationIndex] = useState<number | null>(null);
    const [learnSubTab, setLearnSubTab] = useState<'flashcard' | 'reading'>('flashcard');
    const [studyMode, setStudyMode] = useState<StudyMode>('hub');
    const [flashcardWords, setFlashcardWords] = useState<WordItem[]>([]);
    const [flashcardIndex, setFlashcardIndex] = useState(0);
    const [flashcardFlipped, setFlashcardFlipped] = useState(false);
    const [flashcardKnown, setFlashcardKnown] = useState(0);
    const [theme, setTheme] = useState<'dark' | 'light'>(() => (localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark'));
    const [showOnboarding, setShowOnboarding] = useState(() => localStorage.getItem(ONBOARDING_KEY) !== 'done');
    const [onboardingStep, setOnboardingStep] = useState<0 | 1>(0);
    const [settingsSection, setSettingsSection] = useState<SettingsSection>('model');
    const [userSettings, setUserSettings] = useState<UserSettings>(() => loadUserSettings());
    const [configStatus, setConfigStatus] = useState<'idle' | 'checking' | 'ok' | 'error'>('idle');
    const [configMessage, setConfigMessage] = useState('尚未测试连接。');
    const [reportWordPanel, setReportWordPanel] = useState<ReportWordPanel>(null);
    const messageTimer = useRef<number | null>(null);

    const activeList = useMemo(() => getActiveList(state), [state]);
    const stats = useMemo(() => calculateStats(state), [state]);
    const selectedWord = useMemo(() => {
        if (!activeList) {
            return null;
        }

        return activeList.words.find((word) => word.id === selectedWordId) ?? activeList.words[0] ?? null;
    }, [activeList, selectedWordId]);

    useEffect(() => {
        saveState(state);
    }, [state]);

    useEffect(() => {
        try {
            localStorage.setItem(THEME_KEY, theme);
        } catch {
            // ignore write errors
        }
    }, [theme]);

    useEffect(() => {
        try {
            localStorage.setItem(SETTINGS_KEY, JSON.stringify(userSettings));
        } catch {
            // ignore write errors
        }
    }, [userSettings]);

    useEffect(() => {
        try {
            if (typeof document !== 'undefined' && document.body) {
                document.body.classList.toggle('light-mode', theme === 'light');
            }
        } catch {
            // ignore
        }
    }, [theme]);

    useEffect(() => {
        if (!state.lists.length) {
            setState(initialState);
            return;
        }

        if (!state.activeListId || !state.lists.some((list) => list.id === state.activeListId)) {
            setState((current) => ({
                ...current,
                activeListId: current.lists[0]?.id ?? ''
            }));
        }
    }, [state]);

    useEffect(() => {
        if (!activeList) {
            return;
        }

        if (!selectedWordId || !activeList.words.some((word) => word.id === selectedWordId)) {
            setSelectedWordId(activeList.words[0]?.id ?? '');
        }
    }, [activeList, selectedWordId]);

    useEffect(() => {
        if (!activeList) {
            return;
        }

        setLearnSession(buildSession(activeList.words, activeList.words.length));
        setQuizSession(buildSession(activeList.words, activeList.words.length));
        setLearnShowExplanationIndex(null);
        setQuizShowExplanationIndex(null);
    }, [state.activeListId, learnRound, quizRound]);

    useEffect(() => {
        return () => {
            if (messageTimer.current) {
                window.clearTimeout(messageTimer.current);
            }
        };
    }, []);

    const notify = (text: string) => {
        setMessage(text);
        if (messageTimer.current) {
            window.clearTimeout(messageTimer.current);
        }

        messageTimer.current = window.setTimeout(() => {
            setMessage('');
        }, 2800);
    };

    // 自定义确认对话框
    const [confirmState, setConfirmState] = useState<{
        message: string;
        onConfirm: (() => void) | null;
    }>({ message: '', onConfirm: null });

    const confirmAction = (message: string, onConfirm: () => void) => {
        setConfirmState({ message, onConfirm });
    };

    const handleCreateList = () => {
        const trimmedName = listName.trim();
        const trimmedContext = listContext.trim();

        if (!trimmedName || !trimmedContext) {
            notify('先填词表名称和场景说明。');
            return;
        }

        setState((current) => createList(current, trimmedName, trimmedContext, listDescription));
        setListName('');
        setListContext('');
        setListDescription('');
        notify('词表已创建。');
        setActiveTab('lists');
        setListView('workspace');
        setShowCreateListModal(false);
    };

    const handleAddWord = async () => {
        if (!activeList) {
            notify('先选择一个词表。');
            return;
        }

        const term = wordTerm.trim();
        if (!term) {
            notify('请输入要添加的单词。');
            return;
        }

        let meaning = wordMeaning.trim();

        // 释义为空时优先调用 AI 补全
        if (!meaning) {
            const completion = await fetchWordCompletion(term, activeList.context);
            if (completion) {
                meaning = completion.meaning;
                // 用 AI 返回的内容直接创建单词（不走 buildAutoContent）
                const newWord: WordItem = {
                    id: createId('word'),
                    term,
                    meaning: completion.meaning,
                    example: completion.example,
                    note: completion.note,
                    score: 20,
                    mastered: false,
                    createdAt: new Date().toISOString()
                };
                setState((current) =>
                    updateList(current, activeList.id, (list) => ({
                        ...list,
                        words: [newWord, ...list.words]
                    }))
                );
                setWordTerm('');
                setWordMeaning('');
                notify('单词已加入词表（AI 补全释义）。');
                return;
            }
            // AI 不可用，交给 addWordToList 用 buildAutoContent 兜底
        }

        setState((current) => addWordToList(current, activeList.id, term, meaning));
        setWordTerm('');
        setWordMeaning('');
        notify('单词已加入词表。');
    };

    // Smart generation state
    const [genCount, setGenCount] = useState(6);
    const [genDifficulty, setGenDifficulty] = useState<'basic' | 'intermediate' | 'advanced'>('intermediate');
    const [genResults, setGenResults] = useState<Array<any>>([]);
    const [genLoading, setGenLoading] = useState(false);

    const handleGenerateWords = async () => {
        if (!activeList) return notify('先选择一个词表以生成新词。');
        setGenLoading(true);
        notify('正在通过 AI 生成…');
        const results = await fetchGeneratedWords(
            activeList.context || activeList.name,
            Math.min(Math.max(1, genCount), 20),
            genDifficulty
        );
        setGenResults(results);
        setGenLoading(false);
        notify(`已生成 ${results.length} 个候选单词`);
    };

    const handleAddGenerated = (word: any) => {
        if (!activeList) return;
        const newWord: WordItem = {
            id: createId('word'),
            term: word.term,
            meaning: word.meaning || '',
            example: word.example || '',
            note: word.note || '',
            score: 20,
            mastered: false,
            createdAt: new Date().toISOString()
        };
        setState((current) => updateList(current, activeList.id, (list) => ({
            ...list,
            words: [newWord, ...list.words]
        })));
        notify('已加入词表');
        setGenResults((cur) => cur.filter((w) => w.id !== word.id));
    };

    const handleAddAllGenerated = () => {
        if (!activeList) return;
        setState((current) => {
            let next = current;
            genResults.forEach((w) => {
                const newWord: WordItem = {
                    id: createId('word'),
                    term: w.term,
                    meaning: w.meaning || '',
                    example: w.example || '',
                    note: w.note || '',
                    score: 20,
                    mastered: false,
                    createdAt: new Date().toISOString()
                };
                next = updateList(next, activeList.id, (list) => ({
                    ...list,
                    words: [newWord, ...list.words]
                }));
            });
            return next;
        });
        notify(`已加入 ${genResults.length} 个单词`);
        setGenResults([]);
    };

    // Reading state
    const [readingPassage, setReadingPassage] = useState('');
    const [readingLoading, setReadingLoading] = useState(false);
    const [showTranslation, setShowTranslation] = useState(false);
    const [readingTranslation, setReadingTranslation] = useState('');

    const fetchReadingTranslation = async (text: string) => {
        try {
            const resp = await fetch('http://localhost:5001/api/text-proxy', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    prompt: `Translate the following English passage into Chinese (中文). Return ONLY the Chinese translation, no extra text:\n\n${text.slice(0, 2000)}`,
                    max_tokens: 1000,
                    temperature: 0.3
                }),
                signal: AbortSignal.timeout(15000)
            });
            const data = await resp.json();
            const trans = data?.provider_response?.choices?.[0]?.message?.content?.trim() || '';
            setReadingTranslation(trans);
        } catch {
            setReadingTranslation('');
        }
    };

    const handleGenerateReading = async () => {
        if (!activeList || !activeList.words.length) return notify('当前词表还没有单词。');
        setReadingLoading(true);
        setReadingPassage('');
        setReadingTranslation('');
        notify('正在生成短文…');

        const terms = activeList.words.map((w) => w.term);
        const result = await fetchReading(terms, activeList.context);

        if (result) {
            setReadingPassage(result.passage);
            setReadingLoading(false);
            notify('短文已生成。');
        } else {
            // fallback to local
            const localText = buildLocalReading(activeList.words, activeList.context);
            setReadingPassage(localText);
            setReadingLoading(false);
            notify('使用本地生成的示例段落。');
        }
    };

    // Word image state
    const [wordImageUrl, setWordImageUrl] = useState('');
    const [wordImageLoading, setWordImageLoading] = useState(false);
    const [listView, setListView] = useState<'hall' | 'workspace'>('hall');
    const [showCreateListModal, setShowCreateListModal] = useState(false);
    const [showVisionModal, setShowVisionModal] = useState(false);
    const [wordSearch, setWordSearch] = useState('');
    const [wordDrawerOpen, setWordDrawerOpen] = useState(false);

    const handleGenerateImage = async (term: string, context: string) => {
        setWordImageUrl('');
        setWordImageLoading(true);
        const query = `${term} ${context}`;
        const result = await fetchImage(query);
        if (result) {
            setWordImageUrl(result.url);
        } else {
            notify('未找到相关图片。');
        }
        setWordImageLoading(false);
    };

    const [quizGenerating, setQuizGenerating] = useState(false);

    // New quiz state
    const [quizPhase, setQuizPhase] = useState<'setup' | 'active' | 'done'>('setup');
    const [quizQuestions, setQuizQuestions] = useState<any[]>([]);
    const [quizQIndex, setQuizQIndex] = useState(0);
    const [quizQAnswered, setQuizQAnswered] = useState(false);
    const [quizQSelected, setQuizQSelected] = useState('');
    const [quizQCorrect, setQuizQCorrect] = useState(false);
    const [quizQCorrectCount, setQuizQCorrectCount] = useState(0);
    const [quizSpellingInput, setQuizSpellingInput] = useState('');
    const [quizIncludeSpelling, setQuizIncludeSpelling] = useState(true);
    const [quizIncludeCloze, setQuizIncludeCloze] = useState(true);
    const [quizIncludeMeaning, setQuizIncludeMeaning] = useState(true);
    const [quizShowExplanation, setQuizShowExplanation] = useState(false);

    const quizQScore = quizQuestions.length ? Math.round((quizQCorrectCount / quizQuestions.length) * 100) : 0;

    const handleQuizStart = () => {
        if (!activeList || !activeList.words.length) return;

        // Build local questions: meaning-match + spelling + cloze
        const words = shuffle([...activeList.words]);
        const local: any[] = [];
        for (const w of words) {
            // Meaning match
            if (quizIncludeMeaning) {
                const distractors = shuffle(words.filter((x) => x.id !== w.id)).slice(0, 3).map((x) => x.meaning);
                while (distractors.length < 3) distractors.push('其他含义');
                local.push({
                    type: 'meaning', wordId: w.id, term: w.term, correctMeaning: w.meaning,
                    options: shuffle([w.meaning, ...distractors]), note: w.note, example: w.example, contextNote: '选择正确的释义'
                });
            }
            // Spelling
            if (quizIncludeSpelling) {
                local.push({
                    type: 'spelling', wordId: w.id, term: w.term, meaning: w.meaning, note: w.note, example: w.example
                });
            }
        }
        // Cloze — 本地挖空
        if (quizIncludeCloze) {
            const clozeQ = buildLocalCloze(words, words.length);
            local.push(...clozeQ);
            if (clozeQ.length === 0) notify('部分单词缺少例句，完形填空题数可能较少。');
        }
        setQuizQuestions(shuffle(local));
        setQuizQIndex(0);
        setQuizQAnswered(false);
        setQuizQSelected('');
        setQuizQCorrect(false);
        setQuizQCorrectCount(0);
        setQuizPhase('active');
    };

    const handleQuizChoice = (option: string) => {
        logActivity();
        const q = quizQuestions[quizQIndex];
        const correct = option === q.correctMeaning;
        setQuizQSelected(option);
        setQuizQAnswered(true);
        setQuizQCorrect(correct);
        if (correct) setQuizQCorrectCount((v) => v + 1);
        if (activeList) setState((current) => scoreWord(current, activeList.id, q.wordId, correct));
    };

    const handleQuizSpellingSubmit = () => {
        const q = quizQuestions[quizQIndex];
        const correct = quizSpellingInput.trim().toLowerCase() === q.term.toLowerCase();
        setQuizQAnswered(true);
        setQuizQCorrect(correct);
        if (correct) setQuizQCorrectCount((v) => v + 1);
        if (activeList) setState((current) => scoreWord(current, activeList.id, q.wordId, correct));
    };

    const handleQuizNext = () => {
        setQuizQIndex((v) => v + 1);
        setQuizQAnswered(false);
        setQuizQSelected('');
        setQuizQCorrect(false);
        setQuizSpellingInput('');
        setQuizShowExplanation(false);
    };

    const handleQuizFinish = () => {
        setQuizPhase('done');
        setQuizShowExplanation(false);
    };

    const handleQuizReset = () => {
        setQuizPhase('setup');
        setQuizQuestions([]);
        setQuizQIndex(0);
        setQuizQAnswered(false);
        setQuizQCorrectCount(0);
        setQuizGenerating(false);
    };

    // Voice chat state — 多轮对话 agent
    const [voiceStatus, setVoiceStatus] = useState<'idle' | 'listening' | 'processing' | 'speaking'>('idle');
    const [voiceListening, setVoiceListening] = useState(false);
    const recognitionRef = useRef<any>(null);
    const synthRef = useRef(window.speechSynthesis);

    const voiceSystemPrompt = useMemo(() => {
        if (!activeList) return '你是一个友好的语言学习助手。';

        const words = activeList.words.map((w) => `${w.term}(${w.meaning})`).join(', ');
        return `你是一个英语口语陪练，你正在扮演${activeList.context}场景下的角色。

对话规则：
- 全程用英语交流、用词简单
- 你的角色是${activeList.context}场景中的对话者（如店员、朋友、导游等）
- 用户扮演该场景中的另一个角色
- 尽量自然地使用以下词表中的单词：${words}
- 每次回复 1-3 句，不要长篇大论
- 如果用户说中文，先用英语回答，再简单解释`;
    }, [activeList]);

    const speakText = (text: string) => {
        synthRef.current.cancel();
        setVoiceStatus('speaking');
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'en-US';
        utterance.rate = 0.9;
        utterance.onend = () => {
            setVoiceStatus('idle');
            setVoiceListening(false);
        };
        synthRef.current.speak(utterance);
    };

    // RAG PDF 上传状态
    const [ragUploading, setRagUploading] = useState(false);
    const [ragChunks, setRagChunks] = useState(0);
    const [ragFiles, setRagFiles] = useState<Array<{ filename: string; chunks: number; pages: number; uploaded_at: string }>>([]);
    const [ragError, setRagError] = useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [extracting, setExtracting] = useState(false);
    const [extractedWords, setExtractedWords] = useState<Array<{term: string; meaning: string; example: string; note: string}>>([]);

    // 刷新 RAG 知识库状态
    const fetchRagStats = async () => {
        try {
            const resp = await fetch('http://localhost:5001/api/rag/stats');
            const data = await resp.json();
            if (data?.chunks !== undefined) setRagChunks(data.chunks);
            if (data?.files) setRagFiles(data.files);
            setRagError('');  // 刷新时清除错误
        } catch { /* ignore */ }
    };

    // 进入需要资料能力的页面时刷新状态
    useEffect(() => {
        if (activeTab === 'learn' || activeTab === 'lists') fetchRagStats();
    }, [activeTab]);

    // 从 PDF 资料提取单词
    const extractWordsFromRag = async () => {
        if (extracting) return;
        setExtracting(true);
        setExtractedWords([]);
        try {
            const resp = await fetch('http://localhost:5001/api/rag/extract-words', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
                signal: AbortSignal.timeout(30000)
            });
            const data = await resp.json();

            if (!resp.ok) {
                notify(data?.error || `请求失败 (${resp.status})`);
                return;
            }

            if (data?.error) {
                notify(data.error);
                return;
            }

            if (data?.words?.length > 0) {
                setExtractedWords(data.words);
            } else {
                notify('未提取到单词，请检查 PDF 内容');
            }
        } catch (err: any) {
            notify(err?.message === 'The operation was aborted' ? '请求超时，请重试' : '提取失败，请重试');
        } finally {
            setExtracting(false);
        }
    };

    // Vision 识图学词
    const [visionImage, setVisionImage] = useState<string | null>(null);
    const [visionDetections, setVisionDetections] = useState<Array<{
        bbox: [number, number, number, number];  // [x, y, w, h]
        class: string;
        score: number;
    }>>([]);
    const [visionHovered, setVisionHovered] = useState<{ class: string; bbox: [number, number, number, number]; chinese?: string } | null>(null);
    const visionCanvasRef = useRef<HTMLCanvasElement>(null);
    const visionImgRef = useRef<HTMLImageElement>(null);
    const [visionLoading, setVisionLoading] = useState(false);
    const [visionModel, setVisionModel] = useState<any>(null);

    // 加载 COCO-SSD 模型
    useEffect(() => {
        if (typeof (window as any).cocoSsd !== 'undefined' && !visionModel) {
            (window as any).cocoSsd.load().then((model: any) => {
                setVisionModel(model);
            });
        }
    }, []);

    // 上传图片并检测
    const uploadVisionImage = (file: File) => {
        const reader = new FileReader();
        reader.onload = async (e) => {
            const dataUrl = e.target?.result as string;
            setVisionImage(dataUrl);
            setVisionDetections([]);
            setVisionHovered(null);
            setVisionLoading(true);
            // 等图片渲染后再检测
            setTimeout(async () => {
                if (visionModel && visionImgRef.current) {
                    try {
                        const predictions = await visionModel.detect(visionImgRef.current);
                        setVisionDetections(predictions);
                    } catch (err) {
                        notify('物体检测失败');
                    }
                }
                setVisionLoading(false);
            }, 300);
        };
        reader.readAsDataURL(file);
    };

    const handleVisionFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) uploadVisionImage(file);
        if (e.target) e.target.value = '';
    };

    // 鼠标在图片上移动 → 检测悬停物体
    const handleVisionMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
        const img = visionImgRef.current;
        if (!img || !visionDetections.length) return;

        const rect = img.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const scaleX = img.naturalWidth / rect.width;
        const scaleY = img.naturalHeight / rect.height;

        let found: typeof visionHovered = null;
        for (const d of visionDetections) {
            const [x, y, w, h] = d.bbox;
            if (mx * scaleX >= x && mx * scaleX <= x + w &&
                my * scaleY >= y && my * scaleY <= y + h) {
                found = { class: d.class, bbox: d.bbox };
                break;
            }
        }
        setVisionHovered(found);
    };

    const addVisionHoveredWord = () => {
        if (!visionHovered) return;
        const listId = activeList?.id;
        if (!listId) {
            notify('请先选择一个词表');
            return;
        }

        const term = visionHovered.class;
        fetch('http://localhost:5001/api/complete-word', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ term, context: activeList?.context || '通用' }),
            signal: AbortSignal.timeout(6000)
        }).then((resp) => resp.json()).then((data) => {
            setState((current) => addWordToList(current, listId, term, data.meaning || term, data.example || '', data.note || ''));
            notify(`已加入「${activeList?.name}」`);
        }).catch(() => {
            setState((current) => addWordToList(current, listId, term, ''));
            notify(`已加入「${activeList?.name}」`);
        });
    };

    // 绘制轮廓
    useEffect(() => {
        const canvas = visionCanvasRef.current;
        const img = visionImgRef.current;
        if (!canvas || !img || !visionDetections.length) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;

        // 清除旧绘制
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // 绘制所有检测框（淡色）
        for (const d of visionDetections) {
            const [x, y, w, h] = d.bbox;
            ctx.strokeStyle = 'rgba(91, 228, 155, 0.3)';
            ctx.lineWidth = 2;
            ctx.strokeRect(x, y, w, h);
        }

        // 绘制悬停物体的高亮框
        if (visionHovered) {
            const [x, y, w, h] = visionHovered.bbox;
            ctx.strokeStyle = '#5be49b';
            ctx.lineWidth = 4;
            ctx.strokeRect(x, y, w, h);
            ctx.fillStyle = 'rgba(91, 228, 155, 0.1)';
            ctx.fillRect(x, y, w, h);
        }
    }, [visionDetections, visionHovered]);

    const uploadPdf = async (file: File) => {
        setRagUploading(true);
        setRagError('');
        try {
            const formData = new FormData();
            formData.append('file', file);
            const resp = await fetch('http://localhost:5001/api/rag/upload-pdf', {
                method: 'POST',
                body: formData,
                signal: AbortSignal.timeout(120000)  // 首次下载模型可能较慢
            });
            const data = await resp.json();
            if (!resp.ok) throw new Error(data.error || '上传失败');
            await fetchRagStats();  // 刷新文件列表
            // 预加载 embedding 模型，确保首次提问时立即可用
            fetch('http://localhost:5001/api/rag/preload', { method: 'POST', signal: AbortSignal.timeout(60000) }).catch(() => {});
            notify(`PDF 已导入，共 ${data.chunks} 个段落`);
        } catch (err: any) {
            const msg = err?.message || 'PDF 上传失败';
            setRagError(msg);
            notify(msg);
        } finally {
            setRagUploading(false);
        }
    };

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) uploadPdf(file);
        if (e.target) e.target.value = '';
    };

    const sendToAgent = async (userText: string) => {
        setVoiceDisplay((prev) => [...prev, { role: 'user', text: userText }]);
        const newHistory = [...voiceHistory, { role: 'user', content: userText }];
        // 仅发往 API 时截断，前端保留完整历史供用户查看
        const MAX_HISTORY = 100;
        const trimmedHistory = newHistory.length > MAX_HISTORY ? newHistory.slice(-MAX_HISTORY) : newHistory;
        setVoiceHistory(newHistory);
        setVoiceStatus('processing');

        try {
            // 尝试检索 RAG 上下文
            let ragContext = '';
            try {
                const ragResp = await fetch('http://localhost:5001/api/rag/context', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ query: userText, top_k: 3, max_chars: 1200 }),
                    signal: AbortSignal.timeout(5000)
                });
                const ragData = await ragResp.json();
                if (ragData?.has_context) {
                    ragContext = ragData.context;
                }
            } catch { /* RAG 检索失败不影响主流程 */ }

            const systemMsg = ragContext
                ? `${voiceSystemPrompt}\n\n【学习资料参考】\n${ragContext}\n\n在回答时尽量引用学习资料中的相关内容帮助用户理解。`
                : voiceSystemPrompt;

            const resp = await fetch('http://localhost:5001/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    system: systemMsg,
                    messages: trimmedHistory
                }),
                signal: AbortSignal.timeout(15000)
            });
            const data = await resp.json();
            const reply = data?.text || 'Sorry, I didn\'t catch that.';
            setVoiceDisplay((prev) => [...prev, { role: 'ai', text: reply }]);
            setVoiceHistory((prev) => [...prev, { role: 'assistant', content: reply }]);
            speakText(reply);
        } catch {
            setVoiceDisplay((prev) => [...prev, { role: 'ai', text: 'Connection failed. Please retry.' }]);
            setVoiceStatus('idle');
            setVoiceListening(false);
        }
    };

    const startVoiceChat = () => {
        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (!SpeechRecognition) {
            notify('浏览器不支持语音识别，请使用 Chrome。');
            return;
        }

        setVoiceListening(true);
        setVoiceStatus('listening');

        const recognition = new SpeechRecognition();
        recognition.lang = 'zh-CN';  // zh-CN 模式下可同时识别中文和英语单词
        recognition.interimResults = false;

        recognition.onresult = (event: any) => {
            const transcript = event.results[0][0].transcript;
            sendToAgent(transcript);
        };

        recognition.onerror = () => {
            setVoiceStatus('idle');
            setVoiceListening(false);
            notify('语音识别出错，请重试。');
        };

        recognition.onend = () => {
            if (voiceStatus === 'listening') {
                setVoiceStatus('idle');
                setVoiceListening(false);
            }
        };

        recognitionRef.current = recognition;
        recognition.start();
    };

    const stopVoiceChat = () => {
        if (recognitionRef.current) recognitionRef.current.stop();
        synthRef.current.cancel();
        setVoiceListening(false);
        setVoiceStatus('idle');
    };

    const clearVoiceChat = () => {
        setVoiceHistory([]);
        setVoiceDisplay([]);
        setVoiceStatus('idle');
        setVoiceListening(false);
        setRagTextInput('');
    };

    // Agent 模式切换: 'voice' | 'rag'
    const [agentMode, setAgentMode] = useState<'voice' | 'rag' | 'vision'>('voice');
    const [ragTextInput, setRagTextInput] = useState('');

    // 各模式独立保存对话记录
    const [voiceSession, setVoiceSession] = useState<{
        history: Array<{ role: string; content: string }>;
        display: Array<{ role: 'user' | 'ai'; text: string; sources?: { file: string; page: number }[] }>;
    }>({ history: [], display: [] });
    const [ragSession, setRagSession] = useState<{
        history: Array<{ role: string; content: string }>;
        display: Array<{ role: 'user' | 'ai'; text: string; sources?: { file: string; page: number }[] }>;
    }>({ history: [], display: [] });

    // 当前模式对应的对话记录
    const voiceHistory = agentMode === 'voice' ? voiceSession.history : ragSession.history;
    const voiceDisplay = agentMode === 'voice' ? voiceSession.display : ragSession.display;

    const setVoiceHistory = useCallback((updater: Array<{ role: string; content: string }> | ((prev: Array<{ role: string; content: string }>) => Array<{ role: string; content: string }>)) => {
        const setter = agentMode === 'voice' ? setVoiceSession : setRagSession;
        setter((prev: any) => ({
            ...prev,
            history: typeof updater === 'function' ? updater(prev.history) : updater
        }));
    }, [agentMode]);

    const setVoiceDisplay = useCallback((updater: Array<{ role: 'user' | 'ai'; text: string; sources?: { file: string; page: number }[] }> | ((prev: Array<{ role: 'user' | 'ai'; text: string; sources?: { file: string; page: number }[] }>) => Array<{ role: 'user' | 'ai'; text: string; sources?: { file: string; page: number }[] }>)) => {
        const setter = agentMode === 'voice' ? setVoiceSession : setRagSession;
        setter((prev: any) => ({
            ...prev,
            display: typeof updater === 'function' ? updater(prev.display) : updater
        }));
    }, [agentMode]);

    const ragChatEndRef = useRef<HTMLDivElement>(null);

    // 纯文字 RAG 聊天
    const sendRagMessage = async () => {
        const text = ragTextInput.trim();
        if (!text) return;
        setRagTextInput('');

        setVoiceDisplay((prev) => [...prev, { role: 'user', text }]);
        const newHistory = [...voiceHistory, { role: 'user', content: text }];
        // 仅发往 API 时截断，前端保留完整历史供用户查看
        const MAX_HISTORY = 100;
        const trimmedHistory = newHistory.length > MAX_HISTORY ? newHistory.slice(-MAX_HISTORY) : newHistory;
        setVoiceHistory(newHistory);
        setVoiceStatus('processing');

        try {
            let ragContext = '';
            let sources: { file: string; page: number }[] = [];
            let ragFound = false;
            let ragErrorMsg = '';
            try {
                const ragResp = await fetch('http://localhost:5001/api/rag/search', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ query: text, top_k: 3 }),
                    signal: AbortSignal.timeout(5000)
                });
                const ragData = await ragResp.json();
                if (ragData?.results?.length) {
                    ragFound = true;
                    sources = ragData.results.map((r: any) => ({
                        file: r.metadata?.source?.replace(/\.pdf$/i, '')?.split(/[/\\]/).pop() || '资料',
                        page: r.metadata?.page || 0
                    }));
                    const seen = new Set();
                    sources = sources.filter(s => {
                        const key = `${s.file}-${s.page}`;
                        if (seen.has(key)) return false;
                        seen.add(key);
                        return true;
                    });
                    ragContext = ragData.results.map((r: any) =>
                        `[来源: 第${r.metadata?.page || '?'}页(相似度${r.score})] ${r.text}`
                    ).join('\n\n');
                }
            } catch (e: any) {
                ragErrorMsg = e?.message || '检索超时或失败';
            }

            // 显示检索状态
            if (!ragFound && ragChunks > 0) {
                setVoiceDisplay((prev) => [...prev, { role: 'ai', text: `📡 已在 ${ragChunks} 段资料中检索，未找到相关内容。将用通用知识回答。` }]);
            } else if (ragFound) {
                setVoiceDisplay((prev) => [...prev, { role: 'ai', text: `📡 已检索到 ${sources.length} 条相关段落` }]);
            } else if (ragErrorMsg) {
                setVoiceDisplay((prev) => [...prev, { role: 'ai', text: `⚠️ 知识库检索异常: ${ragErrorMsg}。将用通用知识回答。` }]);
            }

            // RAG 模式用中文回答，专注知识问答
            const ragPrompt = ragContext
                ? `You are an English learning assistant. Answer based on the learning materials below.\n\n【Learning Materials】\n${ragContext}\n\nAnswer in English. If relevant, quote the source materials naturally and explain key vocabulary in simple English.`
                : `You are an English learning assistant. Answer the user's questions about English learning in English. Current learning scenario: ${activeList?.context ?? 'General'}. Use simple English and explain difficult words.`;

            const resp = await fetch('http://localhost:5001/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    system: ragPrompt,
                    messages: trimmedHistory
                }),
                signal: AbortSignal.timeout(15000)
            });
            const data = await resp.json();
            const reply = data?.text || '抱歉，我没有理解你的问题。';
            setVoiceDisplay((prev) => [...prev, { role: 'ai', text: reply, sources }]);
            setVoiceHistory((prev) => [...prev, { role: 'assistant', content: reply }]);
            setVoiceStatus('idle');
        } catch {
            setVoiceDisplay((prev) => [...prev, { role: 'ai', text: '网络连接失败，请稍后重试。' }]);
            setVoiceStatus('idle');
        }
    };

    const handleRagKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendRagMessage();
        }
    };

    // 语音 / RAG 模式切换
    const switchAgentMode = (mode: 'voice' | 'rag' | 'vision') => {
        if (mode === agentMode) return;
        if (mode === 'rag' && voiceListening) stopVoiceChat();
        setAgentMode(mode);
        setRagTextInput('');
    };

    const handleGenerateQuiz = async () => {
        if (!activeList || !activeList.words.length) return notify('当前词表还没有单词。');
        setQuizGenerating(true);
        notify('生成测验题…');

        // 重置本地题目
        setQuizRound((value) => value + 1);

        // 等 state 更新后再拉取 AI 题
        await new Promise((r) => setTimeout(r, 50));

        const extras = await fetchQuizExtras(
            activeList.words.map((w) => ({ term: w.term, meaning: w.meaning })),
            activeList.context
        );
        if (extras.length > 0) {
            const mapped = extras.filter((q) => q.type === 'cloze').map((q, i) => ({
                wordId: `quiz_ai_${Date.now()}_${i}`,
                type: 'cloze' as const,
                term: q.term,
                correctMeaning: q.correctMeaning,
                options: q.options,
                note: q.note,
                example: q.example,
                contextNote: q.contextNote ?? '选择适合空格的单词',
                questionText: q.questionText
            }));
            if (mapped.length > 0) {
                setQuizSession((current) => ({
                    ...current,
                    questions: [...current.questions, ...mapped]
                }));
            }
        }

        setQuizGenerating(false);
        notify('测验题已生成。');
    };

    const handleDeleteList = (listId: string) => {
        const list = state.lists.find((item) => item.id === listId);
        if (!list) {
            return;
        }

        confirmAction(`确定删除词表「${list.name}」吗？此操作不可撤销。`, () => {
            setState((current) => removeList(current, listId));
            setListView('hall');
            setWordDrawerOpen(false);
            notify('词表已删除。');
        });
    };

    const handleDeleteWord = (wordId: string) => {
        if (!activeList) {
            return;
        }

        const word = activeList.words.find((item) => item.id === wordId);
        if (!word) {
            return;
        }

        confirmAction(`确定删除单词「${word.term}」吗？`, () => {
            setState((current) => deleteWordFromList(current, activeList.id, wordId));
            setWordDrawerOpen(false);
            notify('单词已删除。');
        });
    };

    const handleLearnAnswer = (answer: string) => {
        if (!activeList || learnSession.answered || learnSession.finished) {
            return;
        }

        const currentQuestion = learnSession.questions[learnSession.currentIndex];
        const isCorrect = answer === currentQuestion.correctMeaning;

        setLearnSession((current) => ({
            ...current,
            answered: true,
            selectedAnswer: answer,
            correctCount: current.correctCount + (isCorrect ? 1 : 0)
        }));
        setState((current) => scoreWord(current, activeList.id, currentQuestion.wordId, isCorrect));
        notify(isCorrect ? '回答正确。' : '答案已记录，再看一遍解释。');
    };

    const handleLearnNext = () => {
        setLearnSession((current) => {
            const nextIndex = current.currentIndex + 1;
            if (nextIndex >= current.questions.length) {
                return {
                    ...current,
                    finished: true
                };
            }

            return {
                ...current,
                currentIndex: nextIndex,
                answered: false,
                selectedAnswer: null
            };
        });
        setLearnShowExplanationIndex(null);
    };

    const resetLearnSession = () => {
        setLearnRound((value) => value + 1);
        notify('学习轮次已重置。');
    };

    // Flashcard logic
    const resetFlashcard = () => {
        if (!activeList) return;
        setFlashcardWords(shuffle([...activeList.words]));
        setFlashcardIndex(0);
        setFlashcardFlipped(false);
        setFlashcardKnown(0);
    };

    useEffect(() => {
        resetFlashcard();
    }, [state.activeListId]);

    const handleFlashcardResult = (known: boolean) => {
        logActivity();
        if (known) {
            setFlashcardKnown((v) => v + 1);
            if (activeList) {
                const word = flashcardWords[flashcardIndex];
                setState((current) => scoreWord(current, activeList.id, word.id, true));
            }
        } else if (activeList) {
            const word = flashcardWords[flashcardIndex];
            // 不认识：扣 15 分，最低 0
            setState((current) => updateList(current, activeList.id, (list) => ({
                ...list,
                words: list.words.map((w) =>
                    w.id === word.id
                        ? { ...w, score: clampScore(w.score - 15), mastered: w.score - 15 >= 60 }
                        : w
                )
            })));
        }
        // Move to next card
        setFlashcardFlipped(false);
        setFlashcardIndex((v) => v + 1);
    };

    const resetQuizSession = () => {
        setQuizRound((value) => value + 1);
        notify('测验已重新开始。');
        setQuizShowExplanationIndex(null);
    };

    const updateUserSetting = <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => {
        setUserSettings((current) => ({ ...current, [key]: value }));
    };

    const finishOnboarding = (goToSettings = false) => {
        localStorage.setItem(ONBOARDING_KEY, 'done');
        setShowOnboarding(false);
        setOnboardingStep(0);
        if (goToSettings) {
            setActiveTab('settings');
            setSettingsSection('model');
        }
    };

    const handleTestConnection = async () => {
        setConfigStatus('checking');
        setConfigMessage('正在检查模型服务连接...');

        try {
            const resp = await fetch('http://localhost:5001/api/config', {
                signal: AbortSignal.timeout(6000)
            });
            const data = await resp.json();

            if (!resp.ok) {
                throw new Error(data?.error || `连接失败 (${resp.status})`);
            }

            setConfigStatus('ok');
            setConfigMessage(`模型服务已连接：${data.default_model ?? '默认模型'}`);
        } catch (err: any) {
            setConfigStatus('error');
            setConfigMessage(err?.message === 'The operation was aborted' ? '连接超时，请稍后重试。' : '暂时无法连接模型服务。');
        }
    };

    const handleSeedReset = () => {
        confirmAction('确定清空本地数据并恢复示例词表吗？所有自定义数据将丢失。', () => {
            setState(initialState);
            setSelectedWordId(initialState.lists[0]?.words[0]?.id ?? '');
            setActiveTab('overview');
            setListView('hall');
            setWordDrawerOpen(false);
            setLearnRound((value) => value + 1);
            setQuizRound((value) => value + 1);
            notify('已恢复示例数据。');
        });
    };

    const renderWordCard = (word: WordItem) => {
        const isSelected = word.id === selectedWord?.id;

        return (
            <button
                key={word.id}
                type="button"
                className={`word-card ${isSelected ? 'word-card-selected' : ''}`}
                onClick={() => {
                    setSelectedWordId(word.id);
                    setWordDrawerOpen(true);
                }}
            >
                <div className="word-card-top">
                    <div>
                        <div className="word-term">{word.term}</div>
                        <div className="word-meaning">{word.meaning}</div>
                    </div>
                    <span className={`mastery-badge ${word.mastered ? 'is-mastered' : ''}`}>
                        {word.mastered ? '已掌握' : '学习中'}
                    </span>
                </div>
                <div className="score-row">
                    <span>掌握度</span>
                    <strong>{word.score}%</strong>
                </div>
                <div className="progress-track">
                    <div className="progress-fill" style={{ width: `${word.score}%` }} />
                </div>
            </button>
        );
    };

    const renderHighlightedPassage = (passage: string, words: WordItem[], showTrans: boolean) => {
        // Sort terms by length descending to match longer terms first
        const sorted = [...words].sort((a, b) => b.term.length - a.term.length);
        const termMap = new Map(sorted.map((w) => [w.term.toLowerCase(), w]));

        // Escape special regex chars in term
        const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = sorted.map((w) => escapeRegex(w.term)).join('|');
        if (!pattern) return <p>{passage}</p>;

        const re = new RegExp(`\\b(${pattern})\\b`, 'gi');
        const parts: Array<{ text: string; matched: boolean; wordInfo?: WordItem }> = [];
        let lastIndex = 0;
        let match: RegExpExecArray | null;

        while ((match = re.exec(passage)) !== null) {
            if (match.index > lastIndex) {
                parts.push({ text: passage.slice(lastIndex, match.index), matched: false });
            }
            const matchedTerm = match[0];
            const wordInfo = termMap.get(matchedTerm.toLowerCase());
            parts.push({ text: matchedTerm, matched: true, wordInfo });
            lastIndex = re.lastIndex;
        }
        if (lastIndex < passage.length) {
            parts.push({ text: passage.slice(lastIndex), matched: false });
        }

        return (
            <div className="reading-text">
                {parts.map((part, i) =>
                    part.matched ? (
                        <span key={i} className="reading-highlight"
                            onMouseEnter={(e) => {
                                if (part.wordInfo) {
                                    const rect = (e.target as HTMLElement).getBoundingClientRect();
                                    const passage = (e.target as HTMLElement).closest('.reading-passage');
                                    const passageRect = passage?.getBoundingClientRect();
                                    setWordTooltip({
                                        word: part.wordInfo,
                                        x: rect.left - (passageRect?.left || 0) + rect.width / 2,
                                        y: rect.top - (passageRect?.top || 0)
                                    });
                                }
                            }}
                            onMouseLeave={() => setWordTooltip(null)}
                        >
                            {part.text}
                            {showTrans && part.wordInfo && (
                                <span className="reading-trans"> ({part.wordInfo.meaning})</span>
                            )}
                        </span>
                    ) : (
                        <span key={i}>{part.text}</span>
                    )
                )}
                {/* 悬浮弹窗 */}
                {wordTooltip && (
                    <div ref={wordTooltipRef} className="word-tooltip"
                        style={{
                            left: wordTooltip.x,
                            top: wordTooltip.y
                        }}
                    >
                        <div className="word-tooltip-term">{wordTooltip.word.term}</div>
                        <div className="word-tooltip-meaning">{wordTooltip.word.meaning}</div>
                        {wordTooltip.word.example && (
                            <div className="word-tooltip-example">"{wordTooltip.word.example}"</div>
                        )}
                        {wordTooltip.word.note && (
                            <div className="word-tooltip-note">💡 {wordTooltip.word.note}</div>
                        )}
                    </div>
                )}
            </div>
        );
    };

    const renderPracticePanel = (
        title: string,
        session: PracticeSession,
        onAnswer: (answer: string) => void,
        onNext: () => void,
        onReset: () => void,
        showExplanationImmediate: boolean = true,
        explanationVisible: boolean = true,
        onRequestShowExplanation: () => void = () => { }
    ) => {
        if (!activeList) {
            return <div className="empty-state">先创建或选择一个词表。</div>;
        }

        if (!session.questions.length) {
            return <div className="empty-state">当前词表还没有词，先添加几个单词吧。</div>;
        }

        if (session.finished) {
            return (
                <section className="panel practice-panel">
                    <div className="panel-head">
                        <div>
                            <p className="eyebrow">{title}</p>
                            <h2>本轮完成</h2>
                        </div>
                        <button className="ghost-button" type="button" onClick={onReset}>重新开始</button>
                    </div>
                    <div className="summary-grid">
                        <div className="summary-card">
                            <span>答对</span>
                            <strong>{session.correctCount}</strong>
                        </div>
                        <div className="summary-card">
                            <span>题目数</span>
                            <strong>{session.questions.length}</strong>
                        </div>
                        <div className="summary-card">
                            <span>正确率</span>
                            <strong>{Math.round((session.correctCount / session.questions.length) * 100)}%</strong>
                        </div>
                    </div>
                </section>
            );
        }

        const currentQuestion = session.questions[session.currentIndex];
        const answered = session.answered;

        return (
            <section className="panel practice-panel">
                <div className="panel-head">
                    <div>
                        <p className="eyebrow">{title}</p>
                        <h2>{currentQuestion.term}</h2>
                    </div>
                    <span className="muted-pill">第 {session.currentIndex + 1} 题 / {session.questions.length} 题</span>
                </div>
                <p className="question-text">{currentQuestion.type === 'cloze' ? '选择适合填入空格的单词：' : (currentQuestion.contextNote ?? '这个词在当前词表里的中文意思是什么？')}</p>
                {currentQuestion.type === 'cloze' && currentQuestion.questionText && (
                    <div className="cloze-sentence">
                        {currentQuestion.questionText.split('___').map((part, i, arr) => (
                            <span key={i}>
                                {part}
                                {i < arr.length - 1 && <span className="cloze-blank">______</span>}
                            </span>
                        ))}
                    </div>
                )}
                <div className="option-grid">
                    {currentQuestion.options.map((option) => {
                        const selected = session.selectedAnswer === option;
                        const isCorrect = option === currentQuestion.correctMeaning;
                        const showCorrect = answered && isCorrect;
                        const showWrong = answered && selected && !isCorrect;

                        return (
                            <button
                                key={option}
                                type="button"
                                className={`option-card ${selected ? 'selected' : ''} ${showCorrect ? 'correct' : ''} ${showWrong ? 'wrong' : ''}`}
                                onClick={() => onAnswer(option)}
                                disabled={answered}
                            >
                                {option}
                            </button>
                        );
                    })}
                </div>
                {answered && (
                    <div className="answer-box">
                        {!showExplanationImmediate && !session.finished ? (
                            <>
                                <strong>{session.selectedAnswer === currentQuestion.correctMeaning ? '回答正确' : '回答错误'}</strong>
                                <p className="muted-text">本题解析已隐藏。若想查看，请点击下方按钮。</p>
                                {!explanationVisible ? (
                                    <button className="secondary-button" type="button" onClick={onRequestShowExplanation}>显示解析</button>
                                ) : (
                                    <>
                                        <strong>参考解释</strong>
                                        <p>{currentQuestion.correctMeaning}</p>
                                        <span>{currentQuestion.note}</span>
                                        <div className="detail-example">
                                            <strong>例句</strong>
                                            <p>{currentQuestion.example}</p>
                                        </div>
                                    </>
                                )}
                                <button className="primary-button" type="button" onClick={onNext}>
                                    {session.currentIndex + 1 === session.questions.length ? '查看结果' : '下一题'}
                                </button>
                            </>
                        ) : (
                            <>
                                <strong>参考解释</strong>
                                <p>{currentQuestion.correctMeaning}</p>
                                <span>{currentQuestion.note}</span>
                                <div className="detail-example">
                                    <strong>例句</strong>
                                    <p>{currentQuestion.example}</p>
                                </div>
                                <button className="primary-button" type="button" onClick={onNext}>
                                    {session.currentIndex + 1 === session.questions.length ? '查看结果' : '下一题'}
                                </button>
                            </>
                        )}
                    </div>
                )}
            </section>
        );
    };

    const quizScore = quizSession.questions.length ? Math.round((quizSession.correctCount / quizSession.questions.length) * 100) : 0;
    const learnScore = learnSession.questions.length ? Math.round((learnSession.correctCount / learnSession.questions.length) * 100) : 0;
    const allWordsWithList = useMemo(() => state.lists.flatMap((list) => list.words.map((word) => ({ word, list }))), [state.lists]);
    const weakWords = useMemo(() => [...allWordsWithList]
        .filter(({ word }) => word.score < 60)
        .sort((a, b) => a.word.score - b.word.score), [allWordsWithList]);
    const masteredWords = useMemo(() => [...allWordsWithList]
        .filter(({ word }) => word.mastered)
        .sort((a, b) => b.word.score - a.word.score), [allWordsWithList]);
    const listProgress = useMemo(() => state.lists.map((list) => {
        const average = Math.round(list.words.reduce((sum, word) => sum + word.score, 0) / Math.max(1, list.words.length));
        const mastered = list.words.filter((word) => word.mastered).length;
        const weakCount = list.words.filter((word) => word.score < 60).length;
        return { list, average, mastered, weakCount };
    }), [state.lists]);
    const activeListProgress = useMemo(() => listProgress.find((item) => item.list.id === state.activeListId) ?? null, [listProgress, state.activeListId]);
    const reviewTarget = useMemo(() => [...listProgress]
        .sort((a, b) => b.weakCount - a.weakCount || a.average - b.average)
        .find((item) => item.list.words.length > 0) ?? null, [listProgress]);
    const activityStats = useMemo(() => getActivityStats(), []);

    // 阅读生词悬浮弹窗
    const [wordTooltip, setWordTooltip] = useState<{
        word: WordItem;
        x: number; y: number;
    } | null>(null);
    const wordTooltipRef = useRef<HTMLDivElement>(null);

    const activeNavId: TabId = activeTab;
    const activeNavItem = NAV_ITEMS.find((item) => item.id === activeNavId) ?? NAV_ITEMS[0];
    const settingsMenu: Array<{ id: SettingsSection; label: string }> = [
        { id: 'model', label: '大模型配置' },
        { id: 'image', label: '图片服务配置' },
        { id: 'preference', label: '学习偏好' },
        { id: 'data', label: '数据管理' },
        { id: 'about', label: '关于项目' }
    ];
    const studyModeLabels: Record<StudyMode, string> = {
        hub: '学习首页',
        flashcard: '词义速记',
        reading: 'AI 短文阅读',
        quiz: '混合测验',
        voice: '场景口语陪练',
        materials: '资料问答'
    };
    const enterStudyMode = (mode: StudyMode) => {
        setActiveTab('learn');
        setStudyMode(mode);

        if (mode === 'flashcard') {
            setLearnSubTab('flashcard');
            resetFlashcard();
        }

        if (mode === 'materials') {
            // 进入资料问答时预加载 embedding 模型
            fetch('http://localhost:5001/api/rag/preload', { method: 'POST', signal: AbortSignal.timeout(60000) })
                .catch(() => {});
        }

        if (mode === 'reading') {
            setLearnSubTab('reading');
        }

        if (mode === 'quiz') {
            setQuizPhase('setup');
            setQuizQAnswered(false);
            setQuizQSelected('');
            setQuizSpellingInput('');
            setQuizShowExplanation(false);
        }

        if (mode === 'voice') {
            switchAgentMode('voice');
        }

        if (mode === 'materials') {
            switchAgentMode('rag');
            fetchRagStats();
        }
    };
    const returnToStudyHub = () => {
        if (voiceListening) {
            stopVoiceChat();
        }
        setStudyMode('hub');
        setActiveTab('learn');
    };
    const handleStudyListChange = (listId: string) => {
        const nextList = state.lists.find((list) => list.id === listId);
        setState((current) => ({ ...current, activeListId: listId }));
        setSelectedWordId(nextList?.words[0]?.id ?? '');
        setFlashcardWords(nextList ? shuffle([...nextList.words]) : []);
        setFlashcardIndex(0);
        setFlashcardFlipped(false);
        setFlashcardKnown(0);
        setQuizPhase('setup');
        setReadingPassage('');
        setReadingTranslation('');
    };
    const openWordInVocab = (listId: string, wordId: string) => {
        setState((current) => ({ ...current, activeListId: listId }));
        setSelectedWordId(wordId);
        setWordImageUrl('');
        setListView('workspace');
        setWordDrawerOpen(true);
        setActiveTab('lists');
    };
    const startReviewForList = (listId: string) => {
        const nextList = state.lists.find((list) => list.id === listId);
        handleStudyListChange(listId);
        setActiveTab('learn');
        setStudyMode('flashcard');
        setLearnSubTab('flashcard');
        setFlashcardWords(nextList ? shuffle([...nextList.words]) : []);
        setFlashcardIndex(0);
        setFlashcardFlipped(false);
        setFlashcardKnown(0);
    };

    const renderSettingsContent = () => {
        if (settingsSection === 'model') {
            return (
                <div className="settings-card">
                    <div>
                        <p className="eyebrow">Model Provider</p>
                        <h2>大模型配置</h2>
                    </div>
                    <label>
                        API Key
                        <input
                            type="password"
                            value={userSettings.apiKey}
                            onChange={(event) => updateUserSetting('apiKey', event.target.value)}
                            placeholder="用于启用 AI 释义、阅读和对话"
                        />
                    </label>
                    <label>
                        Base URL
                        <input
                            value={userSettings.baseUrl}
                            onChange={(event) => updateUserSetting('baseUrl', event.target.value)}
                            placeholder="https://api.deepseek.com"
                        />
                    </label>
                    <label>
                        默认模型
                        <input
                            value={userSettings.defaultModel}
                            onChange={(event) => updateUserSetting('defaultModel', event.target.value)}
                            placeholder="deepseek-v4-flash"
                        />
                    </label>
                    <div className={`config-status config-${configStatus}`}>
                        <span>{configMessage}</span>
                        <button className="secondary-button" type="button" onClick={handleTestConnection} disabled={configStatus === 'checking'}>
                            {configStatus === 'checking' ? '测试中' : '测试连接'}
                        </button>
                    </div>
                    <p className="muted-text settings-note">
                        配置完成后，AI 释义、短文阅读、测验生成和场景对话会使用这组模型服务。
                    </p>
                </div>
            );
        }

        if (settingsSection === 'image') {
            return (
                <div className="settings-card">
                    <div>
                        <p className="eyebrow">Image Provider</p>
                        <h2>图片服务配置</h2>
                    </div>
                    <label>
                        Pexels API Key
                        <input
                            type="password"
                            value={userSettings.pexelsKey}
                            onChange={(event) => updateUserSetting('pexelsKey', event.target.value)}
                            placeholder="用于单词详情配图"
                        />
                    </label>
                    <p className="muted-text settings-note">
                        配置图片服务后，单词详情页可以为重点词补充更直观的配图。
                    </p>
                </div>
            );
        }

        if (settingsSection === 'preference') {
            return (
                <div className="settings-card">
                    <div>
                        <p className="eyebrow">Learning Defaults</p>
                        <h2>学习偏好</h2>
                    </div>
                    <label>
                        默认词表
                        <select value={userSettings.defaultListId} onChange={(event) => updateUserSetting('defaultListId', event.target.value)}>
                            <option value="">跟随当前词表</option>
                            {state.lists.map((list) => (
                                <option key={list.id} value={list.id}>{list.name}</option>
                            ))}
                        </select>
                    </label>
                    <label>
                        默认练习模式
                        <select value={userSettings.defaultPractice} onChange={(event) => updateUserSetting('defaultPractice', event.target.value as UserSettings['defaultPractice'])}>
                            <option value="flashcard">词义速记</option>
                            <option value="reading">AI 短文阅读</option>
                            <option value="quiz">混合测验</option>
                            <option value="voice">场景口语陪练</option>
                        </select>
                    </label>
                    <label className="inline-setting">
                        <input
                            type="checkbox"
                            checked={userSettings.speechEnabled}
                            onChange={(event) => updateUserSetting('speechEnabled', event.target.checked)}
                        />
                        语音回复后自动朗读
                    </label>
                    <label>
                        语音识别语言
                        <select value={userSettings.speechLang} onChange={(event) => updateUserSetting('speechLang', event.target.value)}>
                            <option value="zh-CN">中文 + 英文混合</option>
                            <option value="en-US">英文优先</option>
                        </select>
                    </label>
                </div>
            );
        }

        if (settingsSection === 'data') {
            return (
                <div className="settings-card">
                    <div>
                        <p className="eyebrow">Local Data</p>
                        <h2>数据管理</h2>
                    </div>
                    <div className="settings-action-row">
                        <div>
                            <strong>恢复示例词表</strong>
                            <p className="muted-text">清空当前本地词表并回到课程演示数据。</p>
                        </div>
                        <button className="ghost-button danger" type="button" onClick={handleSeedReset}>恢复示例</button>
                    </div>
                    <div className="settings-action-row">
                        <div>
                            <strong>重新显示快速上手</strong>
                            <p className="muted-text">下次进入或立即查看首次引导流程。</p>
                        </div>
                        <button className="ghost-button" type="button" onClick={() => {
                            localStorage.removeItem(ONBOARDING_KEY);
                            setOnboardingStep(0);
                            setShowOnboarding(true);
                        }}>打开引导</button>
                    </div>
                </div>
            );
        }

        return (
            <div className="settings-card">
                <div>
                    <p className="eyebrow">About</p>
                    <h2>关于 WordForge</h2>
                </div>
                <p className="muted-text">
                    WordForge 是一个以“词库”为核心的 AI 英语学习产品。你可以围绕旅行、课堂、咖啡店等真实场景建立词表，把单词、例句、图片和资料片段收进同一个学习单元，再从这个词表出发阅读、测验、口语练习和复盘。
                </p>
                <div className="settings-action-row">
                    <div>
                        <strong>核心理念</strong>
                        <p className="muted-text">先建立属于自己的场景词库，再让学习、练习和报告都围绕词库循环展开。</p>
                    </div>
                    <span className="muted-pill">Word-list first</span>
                </div>
            </div>
        );
    };

    return (
        <div className="app-shell">
            <div className="background-orb background-orb-left" />
            <div className="background-orb background-orb-right" />

            <div className="app-layout">
                <aside className="app-sidebar panel">
                    <div className="sidebar-brand">
                        <WordForgeLogo variant="full" />
                        <p>AI 英语学习平台</p>
                    </div>
                    <nav className="sidebar-nav">
                        {NAV_ITEMS.slice(0, 4).map((item) => (
                            <button
                                key={item.id}
                                type="button"
                                className={`sidebar-nav-item ${activeNavId === item.id ? 'active' : ''}`}
                                onClick={() => {
                                    if (item.id === 'learn') {
                                        returnToStudyHub();
                                        return;
                                    }
                                    setActiveTab(item.id);
                                }}
                            >
                                <span>{item.label}</span>
                                <small>{item.hint}</small>
                            </button>
                        ))}
                    </nav>
                    <div className="sidebar-spacer" />
                    <div className="sidebar-context">
                        <p className="sidebar-context-label">当前词表</p>
                        {activeList ? (
                            <>
                                <button className="current-list-badge sidebar-current-list" type="button" onClick={() => setActiveTab('lists')}>
                                    <span className={`clr-dot clr-${activeList.color}`} />
                                    <span>{activeList.name}</span>
                                </button>
                                <div className="sidebar-mini-meter">
                                    <span style={{ width: `${activeListProgress?.average ?? 0}%` }} />
                                </div>
                                <div className="sidebar-context-stats">
                                    <span>{activeList.words.length} 个词</span>
                                    <span>{activeListProgress?.mastered ?? 0} 已掌握</span>
                                </div>
                                <button className="sidebar-context-action" type="button" onClick={() => {
                                    handleStudyListChange(activeList.id);
                                    enterStudyMode('hub');
                                }}>
                                    继续学习
                                </button>
                            </>
                        ) : (
                            <p className="muted-text">创建词表后，这里会显示当前学习场景。</p>
                        )}
                    </div>
                    <button
                        type="button"
                        className={`sidebar-nav-item sidebar-settings ${activeNavId === 'settings' ? 'active' : ''}`}
                        onClick={() => setActiveTab('settings')}
                    >
                        <span>系统设置</span>
                        <small>Settings</small>
                    </button>
                </aside>

            <main className="app-frame">
                <div className="panel top-bar">
                    <div className="top-bar-left">
                        <WordForgeLogo variant="icon" className="top-bar-logo" />
                        <div className="top-bar-title">
                            <h1 className="page-title">{activeNavItem.label}</h1>
                            <p className="top-bar-description">{activeNavItem.description}</p>
                        </div>
                    </div>
                    <div className="top-bar-right">
                        <button className="ghost-button" type="button" onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))} style={{ padding: '6px 10px', fontSize: '0.85rem' }}>
                            {theme === 'light' ? '🌙 暗色' : '☀️ 亮色'}
                        </button>
                        <button className="ghost-button" type="button" onClick={handleSeedReset} style={{ padding: '6px 10px', fontSize: '0.85rem' }}>恢复</button>
                    </div>
                </div>

                {message && <div className="toast">{message}</div>}

                {activeTab === 'overview' && (
                    <section className="dashboard-home dashboard-wordlist-home">
                        <div className="panel dashboard-hero">
                            <div className="dashboard-hero-copy">
                                <p className="eyebrow">Dashboard</p>
                                <h2>从一个词表开始学习</h2>
                                <p className="muted-text">
                                    WordForge 的学习闭环以场景词表为单位展开：先整理词表，再进入阅读、卡片、测验和口语练习。
                                </p>
                            </div>
                            <div className="dashboard-hero-side">
                                <div className="dashboard-overview-stats">
                                    <span>{stats.listCount} 个词表</span>
                                    <span>{stats.wordCount} 个单词</span>
                                    <span>{stats.averageScore}% 平均掌握</span>
                                </div>
                                <div className="dashboard-hero-actions">
                                    <button className="primary-button" type="button" onClick={() => {
                                        setActiveTab('lists');
                                        setListView('hall');
                                        setShowCreateListModal(true);
                                    }}>创建词表</button>
                                    <button className="ghost-button" type="button" onClick={() => {
                                        setActiveTab('lists');
                                        setListView('hall');
                                    }}>管理词库</button>
                                </div>
                            </div>
                        </div>

                        <section className="panel dashboard-list-panel dashboard-list-panel-focus">
                            <div className="panel-head">
                                <div>
                                    <p className="eyebrow">Word Lists</p>
                                    <h2>我的词表</h2>
                                    <p className="muted-text">选择一个词表进入工作台，或把它带入学习首页选择练习方式。</p>
                                </div>
                                <button className="ghost-button" type="button" onClick={() => setActiveTab('progress')}>学习报告</button>
                            </div>
                            <div className="dashboard-list-grid dashboard-list-grid-featured">
                                {listProgress.map(({ list, average, mastered, weakCount }) => (
                                    <article key={list.id} className="dashboard-list-card dashboard-list-card-featured">
                                        <div className="dashboard-list-card-top">
                                            <span className={`list-color list-${list.color}`} />
                                            <div>
                                                <strong>{list.name}</strong>
                                                <p>{list.context}</p>
                                            </div>
                                        </div>
                                        <div className="dashboard-card-meta">
                                            <span>{list.words.length} 个单词</span>
                                            <span>{average}% 掌握</span>
                                            <span>{weakCount} 个待复习</span>
                                        </div>
                                        <div className="progress-track">
                                            <div className="progress-fill" style={{ width: `${average}%` }} />
                                        </div>
                                        <small>{mastered}/{list.words.length} 已掌握</small>
                                        <div className="dashboard-card-actions">
                                            <button className="ghost-button" type="button" onClick={() => {
                                                setState((current) => ({ ...current, activeListId: list.id }));
                                                setListView('workspace');
                                                setActiveTab('lists');
                                            }}>
                                                进入工作台
                                            </button>
                                            <button className="primary-button" type="button" onClick={() => {
                                                handleStudyListChange(list.id);
                                                enterStudyMode('hub');
                                            }}>
                                                去学习
                                            </button>
                                        </div>
                                    </article>
                                ))}
                                {listProgress.length < 4 && (
                                    <article className="dashboard-empty-guide">
                                        <div className="dashboard-empty-illustration" aria-hidden="true">
                                            <span />
                                            <span />
                                            <span />
                                        </div>
                                        <div>
                                            <p className="eyebrow">Next Step</p>
                                            <h3>{listProgress.length === 0 ? '先创建一个场景词表' : '补充更多学习场景'}</h3>
                                            <p className="muted-text">
                                                建议把词汇按真实场景拆分，比如旅行、课堂讨论、论文汇报。场景越清楚，后面的阅读、测验和口语练习越贴近日常使用。
                                            </p>
                                            <div className="dashboard-empty-steps">
                                                <span>1. 选场景</span>
                                                <span>2. 加入核心词</span>
                                                <span>3. 进入练习</span>
                                            </div>
                                        </div>
                                        <button className="primary-button" type="button" onClick={() => {
                                            setActiveTab('lists');
                                            setListView('hall');
                                            setShowCreateListModal(true);
                                        }}>
                                            创建词表
                                        </button>
                                    </article>
                                )}
                            </div>
                        </section>
                    </section>
                )}

                {activeTab === 'lists' && (
                    <>
                        {listView === 'hall' ? (
                            <section className="vocab-page">
                                <div className="panel vocab-hero">
                                    <div>
                                        <p className="eyebrow">My Word Lists</p>
                                        <h2>我的词库</h2>
                                        <p className="muted-text">先用真实场景组织词汇，再把这些词放进短文、卡片、测验和口语练习里。</p>
                                    </div>
                                    <button className="primary-button" type="button" onClick={() => setShowCreateListModal(true)}>+ 创建新词表</button>
                                </div>

                                <div className="vocab-list-grid">
                                    {state.lists.map((list) => {
                                        const average = Math.round(list.words.reduce((sum, word) => sum + word.score, 0) / Math.max(1, list.words.length));
                                        const mastered = list.words.filter((word) => word.mastered).length;
                                        return (
                                            <article key={list.id} className="panel vocab-list-card">
                                                <button
                                                    type="button"
                                                    className="vocab-list-main"
                                                    onClick={() => {
                                                        setState((current) => ({ ...current, activeListId: list.id }));
                                                        setSelectedWordId(list.words[0]?.id ?? '');
                                                        setWordSearch('');
                                                        setWordDrawerOpen(false);
                                                        setListView('workspace');
                                                    }}
                                                >
                                                    <span className={`list-color list-${list.color}`} />
                                                    <div>
                                                        <p className="eyebrow">Scenario</p>
                                                        <h3>{list.name}</h3>
                                                        <p>{list.context}</p>
                                                    </div>
                                                </button>
                                                <div className="vocab-list-meta">
                                                    <span>{list.words.length} 个单词</span>
                                                    <span>{mastered} 个已掌握</span>
                                                </div>
                                                <div className="progress-track">
                                                    <div className="progress-fill" style={{ width: `${average}%` }} />
                                                </div>
                                                <div className="vocab-card-actions">
                                                    <strong>{average}% 掌握度</strong>
                                                    <button className="ghost-button danger" type="button" onClick={() => handleDeleteList(list.id)}>删除</button>
                                                </div>
                                            </article>
                                        );
                                    })}
                                    {state.lists.length < 4 && (
                                        <article className="panel vocab-list-card vocab-list-placeholder">
                                            <div className="vocab-placeholder-illustration" aria-hidden="true">
                                                <span />
                                                <span />
                                                <span />
                                            </div>
                                            <div>
                                                <p className="eyebrow">New Scenario</p>
                                                <h3>{state.lists.length === 0 ? '创建第一个词表' : '继续添加学习场景'}</h3>
                                                <p className="muted-text">把词汇按真实任务拆开管理，比如课堂讨论、论文汇报、旅行沟通或产品展示。</p>
                                            </div>
                                            <button className="primary-button" type="button" onClick={() => setShowCreateListModal(true)}>
                                                创建词表
                                            </button>
                                        </article>
                                    )}
                                </div>
                            </section>
                        ) : !activeList ? (
                            <section className="panel main-panel">
                                <div className="empty-state">还没有词表，先创建一个场景词表。</div>
                            </section>
                        ) : (
                            <section className="vocab-workspace">
                                <div className="panel vocab-workspace-head">
                                    <button className="ghost-button" type="button" onClick={() => {
                                        setListView('hall');
                                        setWordDrawerOpen(false);
                                    }}>← 返回词库</button>
                                    <div>
                                        <p className="eyebrow">List Workspace</p>
                                        <h2>{activeList.name}</h2>
                                        <p className="muted-text">{activeList.description}</p>
                                    </div>
                                    <div className="vocab-workspace-stats">
                                        <span>{activeList.words.length} 个词</span>
                                        <strong>{Math.round(activeList.words.reduce((sum, word) => sum + word.score, 0) / Math.max(1, activeList.words.length))}%</strong>
                                    </div>
                                </div>

                                <div className="vocab-workspace-grid">
                                    <section className="panel vocab-word-list-panel">
                                        <div className="panel-head">
                                            <div>
                                                <p className="eyebrow">Words</p>
                                                <h2>单词列表</h2>
                                            </div>
                                            <span className="muted-pill">{activeList.words.length} 个</span>
                                        </div>
                                        <input
                                            className="vocab-search"
                                            value={wordSearch}
                                            onChange={(event) => setWordSearch(event.target.value)}
                                            placeholder="搜索单词或释义..."
                                        />
                                        <div className="vocab-word-table">
                                            {activeList.words
                                                .filter((word) => {
                                                    const query = wordSearch.trim().toLowerCase();
                                                    if (!query) return true;
                                                    return `${word.term} ${word.meaning} ${word.example} ${word.note}`.toLowerCase().includes(query);
                                                })
                                                .map((word) => (
                                                    <button
                                                        key={word.id}
                                                        type="button"
                                                        className={`vocab-word-row ${selectedWord?.id === word.id && wordDrawerOpen ? 'active' : ''}`}
                                                        onClick={() => {
                                                            setSelectedWordId(word.id);
                                                            setWordImageUrl('');
                                                            setWordDrawerOpen(true);
                                                        }}
                                                    >
                                                        <div>
                                                            <strong>{word.term}</strong>
                                                            <p>{word.meaning}</p>
                                                        </div>
                                                        <div className="vocab-word-score">
                                                            <span>{word.score}%</span>
                                                            <div className="progress-track">
                                                                <div className="progress-fill" style={{ width: `${word.score}%` }} />
                                                            </div>
                                                        </div>
                                                    </button>
                                                ))}
                                            {activeList.words.length === 0 && <div className="empty-state">这个词表还没有单词，先从右侧加入几个。</div>}
                                        </div>
                                    </section>

                                    <aside className="vocab-actions-panel">
                                        <div className="panel form-card vocab-action-card">
                                            <p className="eyebrow">手动添加</p>
                                            <label>
                                                单词
                                                <input value={wordTerm} onChange={(event) => setWordTerm(event.target.value)} placeholder="例如：luggage" />
                                            </label>
                                            <label>
                                                释义（可留空）
                                                <input value={wordMeaning} onChange={(event) => setWordMeaning(event.target.value)} placeholder="留空时使用 AI 自动补全" />
                                            </label>
                                            <button className="primary-button" type="button" onClick={handleAddWord}>加入词表</button>
                                        </div>

                                        <div className="panel form-card vocab-action-card">
                                            <div className="panel-head">
                                                <div>
                                                    <p className="eyebrow">AI Discovery</p>
                                                    <h3>智能发现新单词</h3>
                                                </div>
                                                {genResults.length > 0 && <span className="muted-pill">{genResults.length} 个候选</span>}
                                            </div>
                                            <div className="vocab-inline-controls">
                                                <label>
                                                    数量
                                                    <input type="number" min={1} max={20} value={genCount} onChange={(event) => setGenCount(Number(event.target.value))} />
                                                </label>
                                                <label>
                                                    难度
                                                    <div className="difficulty-pills">
                                                        {(['basic', 'intermediate', 'advanced'] as const).map((d) => (
                                                            <button key={d} type="button" className={`difficulty-pill${genDifficulty === d ? ' active' : ''}`} onClick={() => setGenDifficulty(d)}>
                                                                {{ basic: '入门', intermediate: '中级', advanced: '高级' }[d]}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </label>
                                            </div>
                                            <button className="primary-button" type="button" onClick={handleGenerateWords} disabled={genLoading}>
                                                {genLoading ? '生成中…' : '围绕场景生成'}
                                            </button>
                                            {genResults.length > 0 && (
                                                <div className="generated-list">
                                                    <div className="generated-list-head">
                                                        <strong>候选词</strong>
                                                        <div>
                                                            <button className="ghost-button" type="button" onClick={() => setGenResults([])}>清空</button>
                                                            <button className="primary-button" type="button" onClick={handleAddAllGenerated}>全部加入</button>
                                                        </div>
                                                    </div>
                                                    {genResults.map((word) => (
                                                        <div key={word.id} className="generated-word-row">
                                                            <div>
                                                                <strong>{word.term}</strong>
                                                                <p>{word.meaning}</p>
                                                            </div>
                                                            <button className="secondary-button" type="button" onClick={() => handleAddGenerated(word)}>加入</button>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>

                                        <div className="panel form-card vocab-action-card">
                                            <div className="panel-head">
                                                <div>
                                                    <p className="eyebrow">Materials</p>
                                                    <h3>资料导入</h3>
                                                </div>
                                                <span className="muted-pill">{ragChunks} 段</span>
                                            </div>
                                            <input ref={fileInputRef} type="file" accept=".pdf" style={{ display: 'none' }} onChange={handleFileSelect} />
                                            <div className="vocab-action-row">
                                                <button className="primary-button" type="button" onClick={() => fileInputRef.current?.click()} disabled={ragUploading}>
                                                    {ragUploading ? '上传中…' : '上传 PDF'}
                                                </button>
                                                <button className="ghost-button" type="button" onClick={extractWordsFromRag} disabled={extracting || ragChunks === 0}>
                                                    {extracting ? '提取中…' : '提取生词'}
                                                </button>
                                            </div>
                                            {ragError && <p className="muted-text" style={{ color: 'var(--danger)' }}>{ragError}</p>}
                                            {ragFiles.length > 0 ? (
                                                <div className="rag-file-list compact">
                                                    {ragFiles.slice().reverse().slice(0, 4).map((file, index) => (
                                                        <div key={`${file.filename}-${index}`} className="rag-file-row">
                                                            <span>{file.filename}</span>
                                                            <small>{file.chunks} 段 · {file.pages} 页</small>
                                                        </div>
                                                    ))}
                                                </div>
                                            ) : (
                                                <p className="muted-text settings-note">上传课程资料后，可一键提取其中的重要英文词汇。</p>
                                            )}
                                        </div>

                                        <div className="panel form-card vocab-action-card">
                                            <div className="panel-head">
                                                <div>
                                                    <p className="eyebrow">Vision</p>
                                                    <h3>图片识词</h3>
                                                </div>
                                                {visionLoading && <span className="muted-pill">检测中</span>}
                                            </div>
                                            <p className="muted-text settings-note">上传图片后在大图上悬停物体，选择识别出的英文名称加入当前词表。</p>
                                            <button className="ghost-button" type="button" onClick={() => setShowVisionModal(true)}>
                                                打开图片识词
                                            </button>
                                            {visionImage && (
                                                <div className="vision-preview-strip">
                                                    <span>已选择图片</span>
                                                    <strong>{visionDetections.length ? `${visionDetections.length} 个候选物体` : '等待检测'}</strong>
                                                </div>
                                            )}
                                            {!visionModel && <p className="muted-text settings-note">正在准备图片识词能力，首次使用可能需要几秒。</p>}
                                        </div>
                                    </aside>
                                </div>
                            </section>
                        )}

                        {showCreateListModal && (
                            <div className="modal-overlay" onClick={() => setShowCreateListModal(false)}>
                                <div className="modal-panel create-list-modal" onClick={(event) => event.stopPropagation()}>
                                    <div className="panel-head">
                                        <div>
                                            <p className="eyebrow">New List</p>
                                            <h2>创建场景词表</h2>
                                        </div>
                                        <button className="ghost-button" type="button" onClick={() => setShowCreateListModal(false)}>关闭</button>
                                    </div>
                                    <div className="form-card" style={{ border: 'none', background: 'transparent', padding: 0 }}>
                                        <label>
                                            名称
                                            <input value={listName} onChange={(event) => setListName(event.target.value)} placeholder="例如：咖啡店聊天" />
                                        </label>
                                        <label>
                                            场景
                                            <input value={listContext} onChange={(event) => setListContext(event.target.value)} placeholder="例如：朋友见面、点单、闲聊" />
                                        </label>
                                        <label>
                                            描述
                                            <textarea value={listDescription} onChange={(event) => setListDescription(event.target.value)} placeholder="可选，写一句这个词表为什么存在。" rows={3} />
                                        </label>
                                        <button className="primary-button" type="button" onClick={handleCreateList}>创建并进入工作台</button>
                                    </div>
                                </div>
                            </div>
                        )}

                        {showVisionModal && (
                            <div className="modal-overlay vision-modal-overlay" onClick={() => setShowVisionModal(false)}>
                                <div className="vision-modal panel" onClick={(event) => event.stopPropagation()}>
                                    <div className="panel-head">
                                        <div>
                                            <p className="eyebrow">Vision Vocabulary</p>
                                            <h2>图片识词</h2>
                                            <p className="muted-text">在图片上移动鼠标，悬停到识别框后可把物体英文名加入「{activeList?.name ?? '当前词表'}」。</p>
                                        </div>
                                        <button className="ghost-button" type="button" onClick={() => setShowVisionModal(false)}>关闭</button>
                                    </div>

                                    <input type="file" accept="image/*" style={{ display: 'none' }} id="vocab-vision-modal-file-input" onChange={handleVisionFileSelect} />

                                    {!visionImage ? (
                                        <div className="vision-upload-state">
                                            <div>
                                                <p className="eyebrow">Upload</p>
                                                <h3>上传一张场景图片</h3>
                                                <p className="muted-text">例如咖啡店、机场、办公室或课堂照片。上传后可从图片中的物体名称快速补充当前词表。</p>
                                            </div>
                                            <button className="primary-button" type="button" onClick={() => document.getElementById('vocab-vision-modal-file-input')?.click()}>
                                                上传图片
                                            </button>
                                            {!visionModel && <p className="muted-text settings-note">正在准备图片识词能力，首次使用可能需要几秒。</p>}
                                        </div>
                                    ) : (
                                        <div className="vision-modal-body">
                                            <div className="vision-canvas-wrap" onMouseMove={handleVisionMouseMove} onMouseLeave={() => setVisionHovered(null)}>
                                                <img ref={visionImgRef} src={visionImage} alt="识别对象" />
                                                <canvas ref={visionCanvasRef} />
                                                {visionHovered && (
                                                    <div className="vocab-vision-popover vision-modal-popover">
                                                        <strong>{visionHovered.class}</strong>
                                                        <button className="secondary-button" type="button" onClick={addVisionHoveredWord}>加入词表</button>
                                                    </div>
                                                )}
                                            </div>

                                            <aside className="vision-side-panel">
                                                <div className="summary-card wide">
                                                    <span>检测状态</span>
                                                    <strong>{visionLoading ? '检测中' : visionDetections.length ? `${visionDetections.length} 个物体` : '暂无结果'}</strong>
                                                </div>
                                                <p className="muted-text settings-note">把鼠标移动到图片中的物体框上，底部会出现英文名称和加入词表按钮。</p>
                                                {visionHovered ? (
                                                    <div className="vision-selected-object">
                                                        <span>当前悬停</span>
                                                        <strong>{visionHovered.class}</strong>
                                                        <button className="primary-button" type="button" onClick={addVisionHoveredWord}>加入当前词表</button>
                                                    </div>
                                                ) : (
                                                    <div className="empty-state">悬停到图片中的识别框查看物体名称。</div>
                                                )}
                                                <div className="vision-modal-actions">
                                                    <button className="ghost-button" type="button" onClick={() => document.getElementById('vocab-vision-modal-file-input')?.click()}>
                                                        换一张图片
                                                    </button>
                                                    <button className="ghost-button danger" type="button" onClick={() => {
                                                        setVisionImage(null);
                                                        setVisionDetections([]);
                                                        setVisionHovered(null);
                                                    }}>清除图片</button>
                                                </div>
                                            </aside>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {wordDrawerOpen && selectedWord && activeList && (
                            <div className="word-drawer-overlay" onClick={() => setWordDrawerOpen(false)}>
                                <aside className="word-drawer panel" onClick={(event) => event.stopPropagation()}>
                                    <div className="panel-head">
                                        <div>
                                            <p className="eyebrow">Word Detail</p>
                                            <h2>{selectedWord.term}</h2>
                                        </div>
                                        <button className="ghost-button" type="button" onClick={() => setWordDrawerOpen(false)}>关闭</button>
                                    </div>
                                    <span className={`mastery-badge ${selectedWord.mastered ? 'is-mastered' : ''}`}>
                                        {selectedWord.mastered ? '已掌握' : '学习中'} · {selectedWord.score}%
                                    </span>
                                    <p className="detail-meaning">{selectedWord.meaning}</p>
                                    <p className="muted-text">{selectedWord.note}</p>
                                    <div className="detail-example">
                                        <strong>例句</strong>
                                        <p>{selectedWord.example}</p>
                                    </div>
                                    <div className="progress-track">
                                        <div className="progress-fill" style={{ width: `${selectedWord.score}%` }} />
                                    </div>
                                    {wordImageUrl && (
                                        <div className="detail-image">
                                            <img src={wordImageUrl} alt={selectedWord.term} className="word-image" />
                                        </div>
                                    )}
                                    <div className="detail-actions">
                                        <button className="ghost-button" type="button" onClick={() => handleGenerateImage(selectedWord.term, activeList.context)} disabled={wordImageLoading}>
                                            {wordImageLoading ? '搜索图片…' : wordImageUrl ? '换一张' : '生成图片'}
                                        </button>
                                        <button className="ghost-button danger" type="button" onClick={() => handleDeleteWord(selectedWord.id)}>删除这个词</button>
                                    </div>
                                </aside>
                            </div>
                        )}
                    </>
                )}

                {activeTab === 'learn' && studyMode === 'hub' && (
                    <section className="study-hub panel">
                        <div className="study-hub-head">
                            <div>
                                <p className="eyebrow">Study Home</p>
                                <h2>今天想怎么练？</h2>
                                <p className="muted-text">先选目标词表，再选择一种沉浸练习方式。</p>
                            </div>
                            <label className="study-list-picker">
                                目标词表
                                <select value={state.activeListId} onChange={(event) => handleStudyListChange(event.target.value)}>
                                    {state.lists.map((list) => (
                                        <option key={list.id} value={list.id}>{list.name}</option>
                                    ))}
                                </select>
                            </label>
                        </div>

                        <div className="study-target-card">
                            <div>
                                <span className={`clr-dot clr-${activeList?.color ?? 'mint'}`} />
                                <strong>{activeList?.name ?? '暂无词表'}</strong>
                                <p className="muted-text">{activeList?.context ?? '先去我的词库创建一个学习场景。'}</p>
                            </div>
                            <div className="study-target-stats">
                                <span>{activeList?.words.length ?? 0} 个单词</span>
                                <span>{activeList ? Math.round(activeList.words.reduce((sum, word) => sum + word.score, 0) / Math.max(activeList.words.length, 1)) : 0}% 平均掌握</span>
                            </div>
                        </div>

                        <div className="study-card-grid">
                            <button className="study-entry-card" type="button" onClick={() => enterStudyMode('flashcard')}>
                                <span>词义速记</span>
                                <strong>翻卡片记单词</strong>
                                <p>适合快速复习当前词表，认识或不认识都会同步更新掌握度。</p>
                            </button>
                            <button className="study-entry-card" type="button" onClick={() => enterStudyMode('reading')}>
                                <span>AI 短文阅读</span>
                                <strong>在语境里理解词</strong>
                                <p>把词表单词放进一段短文里，高亮重点词并支持全文翻译。</p>
                            </button>
                            <button className="study-entry-card" type="button" onClick={() => enterStudyMode('quiz')}>
                                <span>混合测验</span>
                                <strong>词义、拼写、完形一起练</strong>
                                <p>答题后即时反馈，错误会暴露例句和正确答案。</p>
                            </button>
                            <button className="study-entry-card" type="button" onClick={() => enterStudyMode('voice')}>
                                <span>场景口语陪练</span>
                                <strong>和 AI 角色对话</strong>
                                <p>基于当前词表场景进行英语口语角色扮演。</p>
                            </button>
                        </div>

                        <button className="study-aux-card" type="button" onClick={() => enterStudyMode('materials')}>
                            <span>{ragChunks > 0 ? `资料问答 · ${ragFiles.length} 份资料` : '资料问答'}</span>
                            <strong>基于已上传 PDF 提问</strong>
                            <p>上传和提取生词已经归入“我的词库”，这里专注用资料辅助理解。</p>
                        </button>
                    </section>
                )}

                {activeTab === 'learn' && (studyMode === 'flashcard' || studyMode === 'reading') && (
                    <section className="practice-layout">
                        <section className="panel practice-panel">
                            <div className="panel-head">
                                <div>
                                    <p className="eyebrow">{activeList?.name ?? '当前词表'}</p>
                                    <h2>{studyModeLabels[studyMode]}</h2>
                                </div>
                                <button className="ghost-button" type="button" onClick={returnToStudyHub}>返回学习首页</button>
                            </div>

                            {studyMode === 'flashcard' ? (
                                <div className="flashcard-section">
                                    {!activeList || !activeList.words.length ? (
                                        <div className="empty-state">当前词表还没有单词，先添加几个词再开始。</div>
                                    ) : flashcardIndex >= flashcardWords.length ? (
                                        <div style={{ textAlign: 'center', padding: '40px 0' }}>
                                            <h2 style={{ fontSize: '1.6rem', color: 'var(--accent)' }}>🎉 本轮完成！</h2>
                                            <p className="muted-text" style={{ marginTop: 8 }}>复习了 {flashcardWords.length} 个单词，标记认识了 {flashcardKnown} 个</p>
                                            <button className="primary-button" type="button" onClick={resetFlashcard} style={{ marginTop: 20 }}>再来一轮</button>
                                        </div>
                                    ) : (
                                        <>
                                            <div className="flashcard-progress">
                                                <span className="muted-text">第 {flashcardIndex + 1} / {flashcardWords.length} 张</span>
                                                <div className="progress-track" style={{ flex: 1, margin: '0 12px' }}>
                                                    <div className="progress-fill" style={{ width: `${((flashcardIndex) / flashcardWords.length) * 100}%` }} />
                                                </div>
                                                <span className="muted-text">{flashcardKnown} 认识</span>
                                            </div>

                                            <div className={`flashcard ${flashcardFlipped ? 'flipped' : ''}`} onClick={() => !flashcardFlipped && setFlashcardFlipped(true)}>
                                                <div className="flashcard-inner">
                                                    <div className="flashcard-front">
                                                        <p className="eyebrow">🧠 这是什么单词？</p>
                                                        <h2 className="flashcard-word">{flashcardWords[flashcardIndex].term}</h2>
                                                        <p className="muted-text" style={{ marginTop: 16 }}>点击翻转查看答案</p>
                                                    </div>
                                                    <div className="flashcard-back">
                                                        <p className="eyebrow" style={{ marginBottom: 8 }}>释义</p>
                                                        <h2 className="flashcard-word">{flashcardWords[flashcardIndex].meaning}</h2>
                                                        <div className="detail-example" style={{ marginTop: 14, textAlign: 'left' }}>
                                                            <strong>例句</strong>
                                                            <p>{flashcardWords[flashcardIndex].example}</p>
                                                        </div>
                                                        <p className="muted-text" style={{ marginTop: 8 }}>{flashcardWords[flashcardIndex].note}</p>
                                                    </div>
                                                </div>
                                            </div>

                                            {flashcardFlipped && (
                                                <div className="flashcard-actions">
                                                    <button className="ghost-button" type="button" style={{ borderColor: 'var(--danger)', color: 'var(--danger)', padding: '12px 24px', fontSize: '1rem' }} onClick={() => handleFlashcardResult(false)}>
                                                        ❌ 不认识
                                                    </button>
                                                    <button className="primary-button" type="button" style={{ padding: '12px 24px', fontSize: '1rem' }} onClick={() => handleFlashcardResult(true)}>
                                                        ✅ 认识
                                                    </button>
                                                </div>
                                            )}
                                        </>
                                    )}
                                </div>
                            ) : (
                                <div className="reading-section">
                                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16 }}>
                                        <label className="toggle-label" style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: '0.9rem' }}>
                                            <input type="checkbox" checked={showTranslation} onChange={(e) => {
                                                const checked = e.target.checked;
                                                setShowTranslation(checked);
                                                if (checked && readingPassage && !readingTranslation) fetchReadingTranslation(readingPassage);
                                                if (!checked) setReadingTranslation('');
                                            }} />
                                            全文翻译
                                        </label>
                                        <button className="primary-button" type="button" onClick={handleGenerateReading} disabled={readingLoading}>
                                            {readingLoading ? '生成中…' : '生成短文'}
                                        </button>
                                    </div>

                                    {!activeList || !activeList.words.length ? (
                                        <div className="empty-state">当前词表还没有单词，先添加几个词再生成阅读短文。</div>
                                    ) : readingPassage ? (
                                        <div className="reading-passage">
                                            <div className="reading-text">
                                                {readingPassage.split('\n').map((line, i, arr) => (
                                                    <span key={i}>
                                                        {renderHighlightedPassage(line, activeList?.words ?? [], false)}
                                                        {i < arr.length - 1 && <br />}
                                                    </span>
                                                ))}
                                            </div>
                                            {showTranslation && readingTranslation && (
                                                <div className="reading-translation">
                                                    <p className="eyebrow" style={{ marginBottom: 8 }}>中文翻译</p>
                                                    <p>{readingTranslation}</p>
                                                </div>
                                            )}
                                            {showTranslation && !readingTranslation && !readingLoading && (
                                                <p className="muted-text" style={{ fontSize: '0.85rem', marginTop: 8 }}>正在获取翻译…</p>
                                            )}
                                        </div>
                                    ) : (
                                        <div className="empty-state">点击「生成短文」，AI 会根据当前词表中的单词创作一段短文。</div>
                                    )}
                                </div>
                            )}
                        </section>
                        <aside className="panel practice-summary">
                            {studyMode === 'flashcard' ? (
                                <>
                                    <p className="eyebrow">卡片进度</p>
                                    <h2>{flashcardWords.length ? Math.round((flashcardKnown / flashcardWords.length) * 100) : 0}%</h2>
                                    <div className="summary-card wide">
                                        <span>已认识</span>
                                        <strong>{flashcardKnown}</strong>
                                    </div>
                                    <div className="summary-card wide">
                                        <span>待复习</span>
                                        <strong>{flashcardWords.length - flashcardIndex - (flashcardFlipped ? 1 : 0)}</strong>
                                    </div>
                                    <div className="summary-card wide">
                                        <span>当前词表</span>
                                        <strong>{activeList?.name ?? '无'}</strong>
                                    </div>
                                    <button className="primary-button" type="button" onClick={resetFlashcard}>重新打乱</button>
                                </>
                            ) : (
                                <>
                                    <p className="eyebrow">词表单词</p>
                                    <h2>{activeList?.words.length ?? 0} 个词</h2>
                                    <div className="mini-progress-list">
                                        {activeList?.words.slice(0, 12).map((w) => (
                                            <div key={w.id} className="mini-progress-item">
                                                <div>
                                                    <strong>{w.term}</strong>
                                                    {showTranslation && <p style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>{w.meaning}</p>}
                                                </div>
                                                <span>{w.score}%</span>
                                            </div>
                                        ))}
                                    </div>
                                    <button className="primary-button" type="button" onClick={handleGenerateReading} disabled={readingLoading}>重新生成</button>
                                </>
                            )}
                        </aside>
                    </section>
                )}

                {activeTab === 'learn' && studyMode === 'quiz' && (
                    <section className="practice-layout">
                        <section className="panel practice-panel">
                            {quizPhase === 'setup' && (
                                <div style={{ padding: '20px 0', display: 'grid', gap: 20 }}>
                                    <div>
                                        <div className="panel-head" style={{ padding: 0 }}>
                                            <div>
                                                <p className="eyebrow">{activeList?.name ?? '请选择词表'}</p>
                                                <h2 style={{ fontSize: '1.3rem', margin: '8px 0' }}>混合测验配置</h2>
                                            </div>
                                            <button className="ghost-button" type="button" onClick={returnToStudyHub}>返回学习首页</button>
                                        </div>
                                        <p className="muted-text">词表共 {activeList?.words.length ?? 0} 个单词</p>
                                    </div>

                                    <div className="form-card" style={{ background: 'transparent', border: 'none', padding: 0 }}>
                                        <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                                            <input type="checkbox" checked={quizIncludeMeaning} onChange={(e) => setQuizIncludeMeaning(e.target.checked)} style={{ accentColor: 'var(--accent-strong)', width: 18, height: 18 }} />
                                            <div>
                                                <strong>词义匹配</strong>
                                                <p className="muted-text" style={{ margin: '2px 0 0' }}>看英文单词，选择正确的中文释义</p>
                                            </div>
                                        </label>
                                        <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', marginTop: 12 }}>
                                            <input type="checkbox" checked={quizIncludeSpelling} onChange={(e) => setQuizIncludeSpelling(e.target.checked)} style={{ accentColor: 'var(--accent-strong)', width: 18, height: 18 }} />
                                            <div>
                                                <strong>拼写题</strong>
                                                <p className="muted-text" style={{ margin: '2px 0 0' }}>看中文释义，输入对应的英文单词</p>
                                            </div>
                                        </label>
                                        <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', marginTop: 12 }}>
                                            <input type="checkbox" checked={quizIncludeCloze} onChange={(e) => setQuizIncludeCloze(e.target.checked)} style={{ accentColor: 'var(--accent-strong)', width: 18, height: 18 }} />
                                            <div>
                                                <strong>完形填空</strong>
                                                <p className="muted-text" style={{ margin: '2px 0 0' }}>根据例句上下文选词填空</p>
                                            </div>
                                        </label>
                                    </div>

                                    <button className="primary-button" type="button" onClick={handleQuizStart} disabled={!activeList?.words.length} style={{ padding: '14px', fontSize: '1.1rem' }}>
                                        {!activeList?.words.length ? '词表为空' : '开始测验'}
                                    </button>
                                </div>
                            )}

                            {quizPhase === 'active' && (
                                <>
                                    <div className="panel-head">
                                        <div>
                                            <p className="eyebrow">测验中</p>
                                            <h2>{quizQuestions[quizQIndex]?.type === 'spelling' ? '拼写题' : quizQuestions[quizQIndex]?.type === 'cloze' ? '完形填空' : '词义匹配'}</h2>
                                        </div>
                                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                            <span className="muted-pill">第 {quizQIndex + 1} 题 / {quizQuestions.length} 题</span>
                                            <button className="ghost-button" type="button" onClick={returnToStudyHub} style={{ padding: '4px 10px', fontSize: '0.85rem' }}>退出</button>
                                        </div>
                                    </div>

                                    {quizQuestions[quizQIndex]?.type === 'spelling' ? (
                                        <div style={{ padding: '20px 0' }}>
                                            <p className="question-text">请根据中文释义输入对应的英文单词：</p>
                                            <div className="cloze-sentence" style={{ textAlign: 'center', fontSize: '1.3rem', marginTop: 12 }}>
                                                {quizQuestions[quizQIndex].meaning}
                                            </div>
                                            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                                                <input
                                                    value={quizSpellingInput}
                                                    onChange={(e) => setQuizSpellingInput(e.target.value)}
                                                    onKeyDown={(e) => e.key === 'Enter' && handleQuizSpellingSubmit()}
                                                    placeholder="输入英文单词…"
                                                    disabled={quizQAnswered}
                                                    style={{ flex: 1, padding: '12px 14px', borderRadius: 14, border: '1px solid var(--line)', background: 'rgba(255,255,255,0.04)', color: 'var(--text)', outline: 'none', fontSize: '1.05rem' }}
                                                />
                                                <button className="primary-button" type="button" onClick={handleQuizSpellingSubmit} disabled={quizQAnswered || !quizSpellingInput.trim()}>确认</button>
                                            </div>
                                            {quizQAnswered && (
                                                <div className="answer-box" style={{ marginTop: 16 }}>
                                                    <strong>{quizQCorrect ? '✅ 正确' : '❌ 错误'}</strong>
                                                    {!quizShowExplanation ? (
                                                        <button className="secondary-button" type="button" onClick={() => setQuizShowExplanation(true)}>显示解析</button>
                                                    ) : (
                                                        <>
                                                            {!quizQCorrect && <p className="muted-text">正确答案：<strong style={{ color: 'var(--accent)' }}>{quizQuestions[quizQIndex].term}</strong></p>}
                                                            <p className="muted-text">{quizQuestions[quizQIndex].note}</p>
                                                            {quizQuestions[quizQIndex].example && (
                                                                <div className="detail-example">
                                                                    <strong>例句</strong>
                                                                    <p>{quizQuestions[quizQIndex].example}</p>
                                                                </div>
                                                            )}
                                                        </>
                                                    )}
                                                    {quizQIndex + 1 >= quizQuestions.length ? (
                                                        <button className="primary-button" type="button" onClick={handleQuizFinish}>查看结果</button>
                                                    ) : (
                                                        <button className="primary-button" type="button" onClick={handleQuizNext}>下一题</button>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    ) : (
                                        <>
                                            <p className="question-text">{quizQuestions[quizQIndex]?.type === 'cloze' ? '选择适合填入空格的单词：' : `"${quizQuestions[quizQIndex]?.term}" 的意思是什么？`}</p>
                                            {quizQuestions[quizQIndex]?.type === 'cloze' && quizQuestions[quizQIndex]?.questionText && (
                                                <div className="cloze-sentence">
                                                    {quizQuestions[quizQIndex].questionText.split('___').map((part: string, i: number, arr: string[]) => (
                                                        <span key={i}>{part}{i < arr.length - 1 && <span className="cloze-blank">______</span>}</span>
                                                    ))}
                                                </div>
                                            )}
                                            <div className="option-grid">
                                                {quizQuestions[quizQIndex]?.options?.map((option: string) => {
                                                    const selected = quizQSelected === option;
                                                    const isCorrect = quizQAnswered && option === quizQuestions[quizQIndex].correctMeaning;
                                                    const isWrong = quizQAnswered && selected && !isCorrect;
                                                    return (
                                                        <button key={option} type="button" className={`option-card ${selected ? 'selected' : ''} ${isCorrect ? 'correct' : ''} ${isWrong ? 'wrong' : ''}`}
                                                            onClick={() => !quizQAnswered && handleQuizChoice(option)} disabled={quizQAnswered}>
                                                            {option}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                            {quizQAnswered && (
                                                <div className="answer-box">
                                                    <strong>{quizQCorrect ? '✅ 正确' : '❌ 错误'}</strong>
                                                    {!quizShowExplanation ? (
                                                        <button className="secondary-button" type="button" onClick={() => setQuizShowExplanation(true)}>显示解析</button>
                                                    ) : (
                                                        <>
                                                            {!quizQCorrect && <p className="muted-text">正确答案：<strong style={{ color: 'var(--accent)' }}>{quizQuestions[quizQIndex].correctMeaning}</strong></p>}
                                                            {quizQuestions[quizQIndex].example && (
                                                                <div className="detail-example" style={{ marginTop: 8 }}>
                                                                    <strong>例句</strong>
                                                                    <p>{quizQuestions[quizQIndex].example}</p>
                                                                </div>
                                                            )}
                                                        </>
                                                    )}
                                                    {quizQIndex + 1 >= quizQuestions.length ? (
                                                        <button className="primary-button" type="button" onClick={handleQuizFinish}>查看结果</button>
                                                    ) : (
                                                        <button className="primary-button" type="button" onClick={handleQuizNext}>下一题</button>
                                                    )}
                                                </div>
                                            )}
                                        </>
                                    )}
                                </>
                            )}

                            {quizPhase === 'done' && (
                                <div style={{ padding: '30px 0', textAlign: 'center', display: 'grid', gap: 16 }}>
                                    <h2 style={{ fontSize: '1.8rem', color: quizQScore >= 60 ? 'var(--accent)' : 'var(--accent-alt)' }}>
                                        {quizQScore >= 80 ? '🎉 太棒了！' : quizQScore >= 60 ? '👍 不错！' : '💪 继续加油！'}
                                    </h2>
                                    <div className="summary-grid" style={{ maxWidth: 300, margin: '0 auto' }}>
                                        <div className="summary-card">
                                            <span>答对</span>
                                            <strong>{quizQCorrectCount}</strong>
                                        </div>
                                        <div className="summary-card">
                                            <span>题目数</span>
                                            <strong>{quizQuestions.length}</strong>
                                        </div>
                                        <div className="summary-card">
                                            <span>正确率</span>
                                            <strong>{quizQScore}%</strong>
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                                        <button className="primary-button" type="button" onClick={handleQuizReset} style={{ marginTop: 12 }}>再来一次</button>
                                        <button className="ghost-button" type="button" onClick={returnToStudyHub} style={{ marginTop: 12 }}>返回学习首页</button>
                                    </div>
                                </div>
                            )}
                        </section>

                        <aside className="panel practice-summary">
                            {quizPhase === 'setup' ? (
                                <>
                                    <p className="eyebrow">当前词表</p>
                                    <h2>{activeList?.name ?? '无'}</h2>
                                    <div className="summary-card wide"><span>单词数</span><strong>{activeList?.words.length ?? 0}</strong></div>
                                    <div className="summary-card wide"><span>场景</span><strong>{activeList?.context ?? '-'}</strong></div>
                                    <div className="summary-card wide"><span>已掌握</span><strong>{activeList?.words.filter((w) => w.mastered).length ?? 0}</strong></div>
                                </>
                            ) : quizPhase === 'active' ? (
                                <>
                                    <p className="eyebrow">答题进度</p>
                                    <h2>{quizQScore}%</h2>
                                    <div className="summary-card wide"><span>已答</span><strong>{quizQIndex + (quizQAnswered ? 1 : 0)}</strong></div>
                                    <div className="summary-card wide"><span>剩余</span><strong>{quizQuestions.length - quizQIndex - (quizQAnswered ? 1 : 0)}</strong></div>
                                    <div style={{ borderTop: '1px solid var(--line)', marginTop: 12, paddingTop: 12 }}>
                                        <p className="muted-text" style={{ fontSize: '0.85rem', marginBottom: 8 }}>题型分布</p>
                                        {[
                                            { type: 'meaning', label: '词义匹配', color: 'var(--accent-alt)' },
                                            { type: 'spelling', label: '拼写题', color: 'var(--accent)' },
                                            { type: 'cloze', label: '完形填空', color: '#f59e0b' }
                                        ].map((t) => {
                                            const count = quizQuestions.filter((q) => q.type === t.type).length;
                                            return (
                                                <div key={t.type} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', fontSize: '0.85rem' }}>
                                                    <span><span style={{ color: count ? t.color : 'var(--muted)', marginRight: 6 }}>●</span>{t.label}</span>
                                                    <strong style={{ color: count ? 'var(--text)' : 'var(--danger)' }}>{count || '失败'}</strong>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </>
                            ) : (
                                <>
                                    <p className="eyebrow">测验结果</p>
                                    <h2>{quizQScore}%</h2>
                                    <div className="summary-card wide"><span>答对</span><strong>{quizQCorrectCount}</strong></div>
                                    <div className="summary-card wide"><span>总题</span><strong>{quizQuestions.length}</strong></div>
                                </>
                            )}
                        </aside>
                    </section>
                )}

                {activeTab === 'learn' && (studyMode === 'voice' || studyMode === 'materials') && (
                    <section className="practice-layout">
                        <section className="panel practice-panel">
                            <div className="panel-head">
                                <div>
                                    <p className="eyebrow">{activeList?.name ?? '当前词表'}</p>
                                    <h2>{studyModeLabels[studyMode]}</h2>
                                </div>
                                <button className="ghost-button" type="button" onClick={returnToStudyHub}>返回学习首页</button>
                            </div>

                            {studyMode === 'voice' && (
                                <>
                                    <div className="panel-head" style={{ borderTop: '1px solid var(--line)', paddingTop: 12, marginTop: 0 }}>
                                        <div>
                                            <p className="eyebrow">Voice Roleplay</p>
                                            <h2>和 AI 进行场景对话</h2>
                                        </div>
                                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                            <span className={`voice-status-dot ${voiceStatus}`} />
                                            <span className="muted-text">
                                                {voiceStatus === 'idle' && '待机'}
                                                {voiceStatus === 'listening' && '聆听中…'}
                                                {voiceStatus === 'processing' && '思考中…'}
                                                {voiceStatus === 'speaking' && '播报中…'}
                                            </span>
                                        </div>
                                    </div>

                                    <div className="voice-messages">
                                        {voiceDisplay.length === 0 && (
                                            <div className="empty-state">
                                                <p><strong>场景：{activeList?.context ?? '自由对话'}</strong></p>
                                                <p>点击「开始对话」进入角色扮演。AI 会扮演该场景中的角色，用英语与你互动。</p>
                                            </div>
                                        )}
                                        {voiceDisplay.map((msg, i) => (
                                            <div key={i} className={`voice-msg voice-msg-${msg.role}`}>
                                                <strong>{msg.role === 'user' ? '你' : 'AI'}</strong>
                                                <p dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.text) }} />
                                            </div>
                                        ))}
                                    </div>

                                    <div className="voice-controls">
                                        {!voiceListening ? (
                                            <button className="primary-button" type="button" onClick={startVoiceChat} style={{ fontSize: '1.1rem', padding: '14px 24px' }}>
                                                🎤 开始对话
                                            </button>
                                        ) : (
                                            <button className="ghost-button danger" type="button" onClick={stopVoiceChat} style={{ fontSize: '1.1rem', padding: '14px 24px' }}>
                                                ⏹ 结束对话
                                            </button>
                                        )}
                                        {voiceDisplay.length > 0 && (
                                            <button className="ghost-button" type="button" onClick={clearVoiceChat}>清空记录</button>
                                        )}
                                    </div>
                                </>
                            )}

                            {studyMode === 'materials' && (
                                <>
                                    <div className="panel-head" style={{ borderTop: '1px solid var(--line)', paddingTop: 12, marginTop: 0 }}>
                                        <div>
                                            <p className="eyebrow">Material Q&A</p>
                                            <h2>基于学习资料提问</h2>
                                        </div>
                                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                            <span className={`voice-status-dot ${voiceStatus}`} />
                                            <span className="muted-text">
                                                {voiceStatus === 'idle' && '待机'}
                                                {voiceStatus === 'processing' && '思考中…'}
                                            </span>
                                        </div>
                                    </div>

                                    <div className="voice-messages">
                                        {voiceDisplay.length === 0 && (
                                            <div className="empty-state">
                                                <p><strong>资料问答</strong></p>
                                                <p>你可以针对已上传的 PDF 学习资料提问，AI 会检索相关段落来回答。</p>
                                                {ragChunks === 0 && (
                                                    <p className="muted-text" style={{ marginTop: 8 }}>
                                                        💡 提示：先在“我的词库”的资料导入中上传一份 PDF 文档。
                                                    </p>
                                                )}
                                                <p className="muted-text" style={{ fontSize: '0.8rem', marginTop: 12, opacity: 0.6 }}>
                                                    🔌 首次使用需要连接外网下载 AI 模型（~80MB），之后完全离线运行。
                                                </p>
                                            </div>
                                        )}
                                        {voiceDisplay.map((msg, i) => (
                                            <div key={i} className={`voice-msg voice-msg-${msg.role}`}>
                                                <strong>{msg.role === 'user' ? '你' : 'AI'}</strong>
                                                <p dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.text) }} />
                                                {msg.sources && msg.sources.length > 0 && (
                                                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
                                                        {msg.sources.map((s, si) => (
                                                            <span key={si} style={{
                                                                fontSize: '0.7rem', padding: '2px 6px',
                                                                borderRadius: 4, background: 'rgba(91,228,155,0.12)',
                                                                color: 'var(--accent)'
                                                            }}>
                                                                📄 {s.file} p.{s.page}
                                                            </span>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                        <div ref={ragChatEndRef} />
                                    </div>

                                    <div className="voice-controls" style={{ flexDirection: 'column', gap: 8 }}>
                                        <div style={{ display: 'flex', gap: 8, width: '100%' }}>
                                            <input
                                                className="rag-text-input"
                                                type="text"
                                                placeholder="输入你的问题…"
                                                value={ragTextInput}
                                                onChange={(e) => setRagTextInput(e.target.value)}
                                                onKeyDown={handleRagKeyDown}
                                                disabled={voiceStatus === 'processing'}
                                            />
                                            <button
                                                className="primary-button"
                                                type="button"
                                                onClick={sendRagMessage}
                                                disabled={voiceStatus === 'processing' || !ragTextInput.trim()}
                                            >
                                                {voiceStatus === 'processing' ? '…' : '发送'}
                                            </button>
                                        </div>
                                        {voiceDisplay.length > 0 && (
                                            <button className="ghost-button" type="button" onClick={clearVoiceChat}>清空记录</button>
                                        )}
                                    </div>
                                </>
                            )}
                        </section>
                        <aside className="panel practice-summary">
                            <p className="eyebrow">当前词表</p>
                            <h2>{activeList?.name ?? '无'}</h2>
                            <div className="summary-card wide">
                                <span>单词数</span>
                                <strong>{activeList?.words.length ?? 0}</strong>
                            </div>
                            <div className="summary-card wide">
                                <span>场景</span>
                                <strong>{activeList?.context ?? '-'}</strong>
                            </div>

                            {studyMode === 'materials' && (<>
                                <hr className="divider" style={{ margin: '12px 0' }} />

                                {ragError && (
                                    <p className="muted-text" style={{ color: 'var(--color-danger)', fontSize: '0.8rem', marginBottom: 6 }}>
                                        {ragError}
                                    </p>
                                )}

                                <div className="summary-card wide">
                                    <span>资料段落</span>
                                    <strong>{ragChunks}</strong>
                                </div>

                                {ragFiles.length > 0 && (
                                    <div style={{ maxHeight: 180, overflowY: 'auto' }}>
                                        {ragFiles.slice().reverse().map((f, i) => (
                                            <div key={i} style={{
                                                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                                padding: '6px 8px', marginBottom: 3,
                                                background: 'var(--bg-soft)', borderRadius: 8, fontSize: '0.8rem'
                                            }}>
                                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                                                    {f.filename}
                                                </span>
                                                <span className="muted-text" style={{ fontSize: '0.75rem', whiteSpace: 'nowrap', marginLeft: 8 }}>
                                                    {f.chunks}段·{f.pages}页
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {ragChunks === 0 && <p className="muted-text settings-note">还没有可问答的资料。请先到词表工作台的“资料导入”模块上传 PDF。</p>}
                                <button
                                    className="ghost-button"
                                    type="button"
                                    onClick={() => {
                                        setActiveTab('lists');
                                        setListView('workspace');
                                    }}
                                    style={{ width: '100%', marginTop: 8, padding: '8px 12px', fontSize: '0.85rem' }}
                                >
                                    去词库导入资料
                                </button>
                            </>)}
                        </aside>
                    </section>
                )}

                {/* 确认对话框 */}
                {confirmState.onConfirm && (
                    <div className="modal-overlay" onClick={() => setConfirmState({ message: '', onConfirm: null })}>
                        <div className="modal-panel" style={{ maxWidth: 400 }} onClick={(e) => e.stopPropagation()}>
                            <p style={{ fontSize: '1rem', lineHeight: 1.6, margin: '0 0 20px' }}>{confirmState.message}</p>
                            <div style={{ display: 'flex', gap: 8 }}>
                                <button
                                    className="primary-button"
                                    type="button"
                                    style={{ flex: 1 }}
                                    onClick={() => {
                                        confirmState.onConfirm?.();
                                        setConfirmState({ message: '', onConfirm: null });
                                    }}
                                >
                                    确认
                                </button>
                                <button
                                    className="ghost-button"
                                    type="button"
                                    style={{ flex: 1 }}
                                    onClick={() => setConfirmState({ message: '', onConfirm: null })}
                                >
                                    取消
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* 提取单词浮层 */}
                {extractedWords.length > 0 && (
                    <div className="modal-overlay" onClick={() => setExtractedWords([])}>
                        <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
                            <div className="panel-head">
                                <div>
                                    <p className="eyebrow">Vocabulary Extraction</p>
                                    <h2>资料中的重点词汇</h2>
                                </div>
                                <button className="ghost-button" type="button" onClick={() => setExtractedWords([])}>✕</button>
                            </div>
                            <div style={{ maxHeight: 400, overflowY: 'auto', marginTop: 8 }}>
                                {extractedWords.map((w, i) => {
                                    const alreadyHas = activeList?.words.some((ow) => ow.term.toLowerCase() === w.term.toLowerCase());
                                    return (
                                        <div key={i} style={{
                                            padding: '10px 12px', marginBottom: 6,
                                            background: 'var(--bg-soft)', borderRadius: 10,
                                            border: '1px solid var(--line)'
                                        }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <strong style={{ fontSize: '1rem', color: 'var(--accent-alt)' }}>{w.term}</strong>
                                                {!alreadyHas ? (
                                                    <button
                                                        className="primary-button"
                                                        type="button"
                                                        style={{ padding: '4px 12px', fontSize: '0.8rem' }}
                                                        onClick={() => {
                                                            const listId = activeList?.id;
                                                            if (!listId) return notify('请先选择一个词表');
                                                            setState((current) => addWordToList(current, listId, w.term, w.meaning, w.example, w.note));
                                                            notify(`已加入「${activeList?.name}」`);
                                                        }}
                                                    >
                                                        ➕ 加入词表
                                                    </button>
                                                ) : (
                                                    <span className="muted-text" style={{ fontSize: '0.8rem' }}>✓ 已存在</span>
                                                )}
                                            </div>
                                            <p className="muted-text" style={{ fontSize: '0.85rem', marginTop: 4 }}>{w.meaning}</p>
                                            {w.example && (
                                                <p className="muted-text" style={{ fontSize: '0.8rem', marginTop: 4, fontStyle: 'italic' }}>
                                                    "{w.example}"
                                                </p>
                                            )}
                                            {w.note && (
                                                <p className="muted-text" style={{ fontSize: '0.8rem', marginTop: 2, opacity: 0.7 }}>💡 {w.note}</p>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                                <button
                                    className="primary-button"
                                    type="button"
                                    style={{ flex: 1 }}
                                    onClick={() => {
                                        const listId = activeList?.id;
                                        if (!listId) return notify('请先选择一个词表');
                                        let added = 0;
                                        extractedWords.forEach((w) => {
                                            const alreadyHas = activeList?.words.some((ow) => ow.term.toLowerCase() === w.term.toLowerCase());
                                            if (!alreadyHas) {
                                                setState((current) => addWordToList(current, listId, w.term, w.meaning, w.example, w.note));
                                                added++;
                                            }
                                        });
                                        setExtractedWords([]);
                                        notify(`已将 ${added} 个单词加入词表`);
                                    }}
                                >
                                    ➕ 全部加入词表
                                </button>
                                <button className="ghost-button" type="button" onClick={() => setExtractedWords([])}>关闭</button>
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'progress' && (
                    <section className="progress-report">
                        <div className="panel report-hero">
                            <div>
                                <p className="eyebrow">Progress Report</p>
                                <h2>学习报告</h2>
                                <p className="muted-text">这里负责复盘长期表现：哪些词表进展好，哪些词该回到学习流程里再练。</p>
                            </div>
                            <button
                                className="primary-button"
                                type="button"
                                onClick={() => reviewTarget ? startReviewForList(reviewTarget.list.id) : enterStudyMode('hub')}
                            >
                                {reviewTarget ? '复习薄弱词表' : '进入学习首页'}
                            </button>
                        </div>

                        <div className="report-stat-row">
                            <div className="panel dashboard-stat-card">
                                <span>平均掌握度</span>
                                <strong>{stats.averageScore}%</strong>
                                <p>全部词表综合分</p>
                            </div>
                            <div className="panel dashboard-stat-card">
                                <span>已掌握单词</span>
                                <strong>{stats.masteredCount}</strong>
                                <p>{stats.wordCount ? Math.round((stats.masteredCount / stats.wordCount) * 100) : 0}% 完成率</p>
                            </div>
                            <div className="panel dashboard-stat-card">
                                <span>今日练习</span>
                                <strong>{activityStats.todayCount}</strong>
                                <p>本月 {activityStats.monthSolved} 次</p>
                            </div>
                            <div className="panel dashboard-stat-card">
                                <span>连续练习</span>
                                <strong>{activityStats.streak}</strong>
                                <p>连续提交天数</p>
                            </div>
                        </div>

                        <section className="panel report-list-progress">
                            <div className="panel-head">
                                <div>
                                    <p className="eyebrow">By Word List</p>
                                    <h2>各词表掌握度</h2>
                                </div>
                                <span className="muted-pill">低分词优先显示</span>
                            </div>
                            <div className="report-progress-list">
                                {[...listProgress].sort((a, b) => a.average - b.average).map(({ list, average, mastered, weakCount }) => (
                                    <button
                                        key={list.id}
                                        className="report-progress-row"
                                        type="button"
                                        onClick={() => {
                                            setState((current) => ({ ...current, activeListId: list.id }));
                                            setListView('workspace');
                                            setActiveTab('lists');
                                        }}
                                    >
                                        <div>
                                            <strong>{list.name}</strong>
                                            <p>{list.context}</p>
                                        </div>
                                        <div className="report-progress-meter">
                                            <div className="progress-track">
                                                <div className="progress-fill" style={{ width: `${average}%` }} />
                                            </div>
                                            <span>{average}% · {mastered}/{list.words.length} 已掌握 · {weakCount} 待复习</span>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </section>

                        <div className="report-word-summary-grid">
                            <section className="panel report-word-summary-card">
                                <div className="report-word-summary-top">
                                    <div>
                                        <p className="eyebrow">Review First</p>
                                        <h2>薄弱单词</h2>
                                        <p className="muted-text">低于 60% 的词集中收纳，点击后在弹窗里查看完整列表。</p>
                                    </div>
                                    <strong>{weakWords.length}</strong>
                                </div>
                                <div className="report-word-preview">
                                    {weakWords.slice(0, 4).map(({ word }) => (
                                        <span key={word.id}>{word.term}</span>
                                    ))}
                                    {weakWords.length === 0 && <span>暂无薄弱词</span>}
                                </div>
                                <div className="report-word-summary-actions">
                                    <button className="ghost-button" type="button" onClick={() => setReportWordPanel('weak')}>查看详情</button>
                                    {reviewTarget && <button className="primary-button" type="button" onClick={() => startReviewForList(reviewTarget.list.id)}>开始复习</button>}
                                </div>
                            </section>

                            <section className="panel report-word-summary-card">
                                <div className="report-word-summary-top">
                                    <div>
                                        <p className="eyebrow">Mastered</p>
                                        <h2>已掌握单词</h2>
                                        <p className="muted-text">已达掌握标准的词统一折叠，报告页只保留数量和快速预览。</p>
                                    </div>
                                    <strong>{masteredWords.length}</strong>
                                </div>
                                <div className="report-word-preview">
                                    {masteredWords.slice(0, 4).map(({ word }) => (
                                        <span key={word.id}>{word.term}</span>
                                    ))}
                                    {masteredWords.length === 0 && <span>暂无已掌握词</span>}
                                </div>
                                <div className="report-word-summary-actions single">
                                    <button className="ghost-button" type="button" onClick={() => setReportWordPanel('mastered')}>查看详情</button>
                                </div>
                            </section>
                        </div>

                        <section className="panel progress-panel report-activity-panel">
                            <div className="panel-head">
                                <div>
                                    <p className="eyebrow">Practice Calendar</p>
                                    <h2>近一年练习热力图</h2>
                                </div>
                                <div className="activity-header">
                                    <div className="activity-stat"><span>连续</span><strong>{activityStats.streak} 天</strong></div>
                                    <div className="activity-stat"><span>本月</span><strong>{activityStats.monthSolved} 次</strong></div>
                                    <div className="activity-stat"><span>今日</span><strong>{activityStats.todayCount} 次</strong></div>
                                </div>
                            </div>
                            <div className="activity-grid">
                                {activityStats.days.map((day) => (
                                    <div
                                        key={day.date}
                                        className={`activity-cell${day.count > 0 ? ' active' : ''}${day.count >= 3 ? ' level2' : ''}${day.count >= 6 ? ' level3' : ''}${day.count >= 10 ? ' level4' : ''}`}
                                        title={`${day.date}: ${day.count} 次练习`}
                                    />
                                ))}
                            </div>
                            <p className="muted-text" style={{ fontSize: '0.8rem', marginTop: 8 }}>颜色越深代表当天完成的练习次数越多。</p>
                        </section>
                    </section>
                )}

                {reportWordPanel && (
                    <div className="modal-overlay report-word-modal-overlay" role="presentation" onClick={() => setReportWordPanel(null)}>
                        <section
                            className="modal-panel report-word-modal"
                            role="dialog"
                            aria-modal="true"
                            aria-labelledby="report-word-modal-title"
                            onClick={(event) => event.stopPropagation()}
                        >
                            <div className="panel-head">
                                <div>
                                    <p className="eyebrow">{reportWordPanel === 'weak' ? 'Review First' : 'Mastered'}</p>
                                    <h2 id="report-word-modal-title">{reportWordPanel === 'weak' ? '薄弱单词' : '已掌握单词'}</h2>
                                    <p className="muted-text">
                                        {reportWordPanel === 'weak'
                                            ? '按掌握度从低到高排列，点击任意单词可回到词表工作台查看详情。'
                                            : '按掌握度从高到低排列，点击任意单词可回到词表工作台查看详情。'}
                                    </p>
                                </div>
                                <button className="ghost-button" type="button" onClick={() => setReportWordPanel(null)}>关闭</button>
                            </div>

                            <div className="report-word-modal-list">
                                {(reportWordPanel === 'weak' ? weakWords : masteredWords).map(({ word, list }) => (
                                    <button
                                        key={`${list.id}-${word.id}`}
                                        type="button"
                                        className="mini-progress-item report-word-row"
                                        onClick={() => {
                                            setReportWordPanel(null);
                                            openWordInVocab(list.id, word.id);
                                        }}
                                    >
                                        <div>
                                            <strong>{word.term}</strong>
                                            <p>{word.meaning}</p>
                                            <small>{list.name}</small>
                                        </div>
                                        <span style={{ color: reportWordPanel === 'weak' && word.score < 40 ? 'var(--danger)' : 'var(--accent)' }}>{word.score}%</span>
                                    </button>
                                ))}
                                {(reportWordPanel === 'weak' ? weakWords : masteredWords).length === 0 && (
                                    <div className="empty-state">
                                        {reportWordPanel === 'weak' ? '目前没有低分词。' : '暂无已掌握单词，继续练习吧。'}
                                    </div>
                                )}
                            </div>
                        </section>
                    </div>
                )}

                {activeTab === 'settings' && (
                    <section className="settings-layout">
                        <aside className="panel settings-menu">
                            <div>
                                <p className="eyebrow">Settings</p>
                                <h2>系统设置</h2>
                            </div>
                            <div className="settings-menu-list">
                                {settingsMenu.map((item) => (
                                    <button
                                        key={item.id}
                                        type="button"
                                        className={`settings-menu-item ${settingsSection === item.id ? 'active' : ''}`}
                                        onClick={() => setSettingsSection(item.id)}
                                    >
                                        {item.label}
                                    </button>
                                ))}
                            </div>
                        </aside>
                        <section className="panel settings-content">
                            {renderSettingsContent()}
                        </section>
                    </section>
                )}

                {showOnboarding && (
                    <div className="modal-overlay onboarding-overlay" onClick={() => finishOnboarding(false)}>
                        <div className="modal-panel onboarding-panel" onClick={(event) => event.stopPropagation()}>
                            {onboardingStep === 0 ? (
                                <>
                                    <div>
                                        <p className="eyebrow">Quick Start</p>
                                        <h2>从一个真实场景开始学英语</h2>
                                        <p className="muted-text" style={{ margin: '8px 0 0' }}>
                                            先选一个你真的会用到的场景，再围绕它建立词库、补充表达、进入练习。
                                        </p>
                                    </div>
                                    <div className="onboarding-scenario">
                                        <p className="eyebrow">Example</p>
                                        <h3>比如：你想练“咖啡店聊天”</h3>
                                        <p>把点单、推荐、闲聊相关的词收进同一个词表，后续练习都会围绕它展开。</p>
                                    </div>
                                    <div className="onboarding-steps">
                                        <div className="onboarding-step">
                                            <strong>1</strong>
                                            <div>
                                                <h3>创建词表</h3>
                                                <p>用一个真实场景命名，比如“咖啡店聊天”。</p>
                                            </div>
                                        </div>
                                        <div className="onboarding-step">
                                            <strong>2</strong>
                                            <div>
                                                <h3>收集表达</h3>
                                                <p>手动添加单词，或让 AI 帮你发现同场景表达。</p>
                                            </div>
                                        </div>
                                        <div className="onboarding-step">
                                            <strong>3</strong>
                                            <div>
                                                <h3>开始练习</h3>
                                                <p>用卡片、阅读、测验和口语把词真正用起来。</p>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="modal-actions">
                                        <button className="ghost-button" type="button" onClick={() => finishOnboarding(false)}>稍后配置</button>
                                        <button className="primary-button" type="button" onClick={() => setOnboardingStep(1)}>配置 AI 能力</button>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div>
                                        <p className="eyebrow">AI Setup</p>
                                        <h2>配置 AI 学习能力</h2>
                                        <p className="muted-text" style={{ margin: '8px 0 0' }}>
                                            填入可用的 AI 配置后，释义补全、短文阅读和口语陪练会更完整。也可以先跳过，稍后再设置。
                                        </p>
                                    </div>
                                    <div className="onboarding-config-grid">
                                        <label>
                                            AI Key
                                            <input
                                                type="password"
                                                value={userSettings.apiKey}
                                                onChange={(event) => updateUserSetting('apiKey', event.target.value)}
                                                placeholder="可稍后在系统设置中修改"
                                            />
                                        </label>
                                        <label>
                                            服务地址
                                            <input
                                                value={userSettings.baseUrl}
                                                onChange={(event) => updateUserSetting('baseUrl', event.target.value)}
                                            />
                                        </label>
                                        <label>
                                            模型名称
                                            <input
                                                value={userSettings.defaultModel}
                                                onChange={(event) => updateUserSetting('defaultModel', event.target.value)}
                                            />
                                        </label>
                                        <label>
                                            图片服务 Key
                                            <input
                                                type="password"
                                                value={userSettings.pexelsKey}
                                                onChange={(event) => updateUserSetting('pexelsKey', event.target.value)}
                                                placeholder="单词配图可选"
                                            />
                                        </label>
                                    </div>
                                    <div className="config-status config-idle">
                                        <span>完成后可以测试一次，确认 AI 功能是否可用。</span>
                                        <button className="secondary-button" type="button" onClick={handleTestConnection} disabled={configStatus === 'checking'}>
                                            {configStatus === 'checking' ? '测试中' : '测试连接'}
                                        </button>
                                    </div>
                                    <p className={`config-inline-message config-${configStatus}`}>{configMessage}</p>
                                    <div className="modal-actions">
                                        <button className="ghost-button" type="button" onClick={() => setOnboardingStep(0)}>返回</button>
                                        <button className="primary-button" type="button" onClick={() => finishOnboarding(true)}>进入系统设置</button>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                )}
            </main>
            </div>
        </div>
    );
}

export default App;
