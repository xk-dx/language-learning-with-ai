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
    getActivityStats
} from './utils';
import { fetchGeneratedWords, fetchWordCompletion, fetchReading, fetchImage, fetchQuizExtras } from './apiService';

const STORAGE_KEY = 'wordpecker-mini-state-v1';
const THEME_KEY = 'wordpecker-theme-v1';
const TABS: Array<{ id: TabId; label: string }> = [
    { id: 'overview', label: '总览' },
    { id: 'lists', label: '词表' },
    { id: 'learn', label: '学习' },
    { id: 'quiz', label: '测验' },
    { id: 'voice', label: '语音' },
    { id: 'progress', label: '进度' }
];

const difficultyPills = ['入门', '日常', '进阶'];

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

function addWordToList(state: AppState, listId: string, term: string, meaning: string): AppState {
    const list = state.lists.find((item) => item.id === listId);
    if (!list) {
        return state;
    }

    const auto = buildAutoContent(term, list.context);
    const newWord: WordItem = {
        id: createId('word'),
        term,
        meaning: meaning.trim() || auto.meaning,
        example: auto.example,
        note: auto.note,
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
    const [flashcardWords, setFlashcardWords] = useState<WordItem[]>([]);
    const [flashcardIndex, setFlashcardIndex] = useState(0);
    const [flashcardFlipped, setFlashcardFlipped] = useState(false);
    const [flashcardKnown, setFlashcardKnown] = useState(0);
    const [theme, setTheme] = useState<'dark' | 'light'>(() => (localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark'));
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

    const handleGenerateReading = async () => {
        if (!activeList || !activeList.words.length) return notify('当前词表还没有单词。');
        setReadingLoading(true);
        setReadingPassage('');
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
    const [listView, setListView] = useState<'grid' | 'detail'>('grid');

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
    const [voiceHistory, setVoiceHistory] = useState<Array<{ role: string; content: string }>>([]);
    const [voiceDisplay, setVoiceDisplay] = useState<Array<{ role: 'user' | 'ai'; text: string }>>([]);
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

    const sendToAgent = async (userText: string) => {
        setVoiceDisplay((prev) => [...prev, { role: 'user', text: userText }]);
        const newHistory = [...voiceHistory, { role: 'user', content: userText }];
        setVoiceHistory(newHistory);
        setVoiceStatus('processing');

        try {
            const resp = await fetch('http://localhost:5001/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    system: voiceSystemPrompt,
                    messages: newHistory
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

        if (!window.confirm(`确定删除词表「${list.name}」吗？`)) {
            return;
        }

        setState((current) => removeList(current, listId));
        notify('词表已删除。');
    };

    const handleDeleteWord = (wordId: string) => {
        if (!activeList) {
            return;
        }

        const word = activeList.words.find((item) => item.id === wordId);
        if (!word) {
            return;
        }

        if (!window.confirm(`确定删除单词「${word.term}」吗？`)) {
            return;
        }

        setState((current) => deleteWordFromList(current, activeList.id, wordId));
        notify('单词已删除。');
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

    const handleSeedReset = () => {
        if (!window.confirm('确定清空本地数据并恢复示例词表吗？')) {
            return;
        }

        setState(initialState);
        setSelectedWordId(initialState.lists[0]?.words[0]?.id ?? '');
        setActiveTab('overview');
        setLearnRound((value) => value + 1);
        setQuizRound((value) => value + 1);
        notify('已恢复示例数据。');
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
                    setListView('detail');
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
            <p className="reading-text">
                {parts.map((part, i) =>
                    part.matched ? (
                        <span key={i} className="reading-highlight" title={showTrans && part.wordInfo ? part.wordInfo.meaning : ''}>
                            {part.text}
                            {showTrans && part.wordInfo && (
                                <span className="reading-trans"> ({part.wordInfo.meaning})</span>
                            )}
                        </span>
                    ) : (
                        <span key={i}>{part.text}</span>
                    )
                )}
            </p>
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

    const activeWordCount = activeList?.words.length ?? 0;
    const quizScore = quizSession.questions.length ? Math.round((quizSession.correctCount / quizSession.questions.length) * 100) : 0;
    const learnScore = learnSession.questions.length ? Math.round((learnSession.correctCount / learnSession.questions.length) * 100) : 0;
    const overviewWords = shuffle(state.lists.flatMap((list) => list.words)).slice(0, 8);
    const activityStats = useMemo(() => getActivityStats(), []);

    return (
        <div className="app-shell">
            <div className="background-orb background-orb-left" />
            <div className="background-orb background-orb-right" />

            <main className="app-frame">
                <div className="panel top-bar">
                    <div className="top-bar-left">
                        <span className="brand-mark">WordPecker</span>
                    </div>
                    <div className="top-bar-right">
                        <button className="ghost-button" type="button" onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))} style={{ padding: '6px 10px', fontSize: '0.85rem' }}>
                            {theme === 'light' ? '🌙 暗色' : '☀️ 亮色'}
                        </button>
                        <button className="ghost-button" type="button" onClick={handleSeedReset} style={{ padding: '6px 10px', fontSize: '0.85rem' }}>恢复</button>
                    </div>
                </div>

                <nav className="tab-nav panel">
                    {TABS.map((tab) => (
                        <button
                            key={tab.id}
                            type="button"
                            className={`tab-button ${activeTab === tab.id ? 'active' : ''}`}
                            onClick={() => setActiveTab(tab.id)}
                        >
                            {tab.label}
                        </button>
                    ))}
                </nav>

                {message && <div className="toast">{message}</div>}

                {activeTab === 'overview' && (
                    <section className="dashboard-grid">
                        <div className="panel intro-panel">
                            <p className="eyebrow">快速上手</p>
                            <h2 style={{ fontSize: '1.1rem', margin: '6px 0' }}>词表 → 加词 → 练习</h2>
                            <ol className="roadmap-list">
                                <li>创建词表并选定场景</li>
                                <li>手动或由 AI 生成新单词</li>
                                <li>学习 + 测验 + 阅读 + 语音</li>
                                <li>跟踪每词掌握进度</li>
                            </ol>
                        </div>
                        <div className="panel intro-panel">
                            <p className="eyebrow">当前词表</p>
                            <h2 style={{ fontSize: '1.1rem', margin: '6px 0' }}>{activeList?.name ?? '暂无词表'}</h2>
                            <p className="muted-text">{activeList?.context ?? '先创建一个词表。'}</p>
                            <div className="glass-stat" style={{ marginTop: 12 }}>
                                <span>单词</span>
                                <strong>{activeWordCount}</strong>
                            </div>
                        </div>
                        <div className="panel intro-panel">
                            <p className="eyebrow">统计</p>
                            <h2 style={{ fontSize: '1.1rem', margin: '6px 0' }}>{stats.averageScore}% 平均掌握度</h2>
                            <div className="glass-stat" style={{ marginTop: 12 }}>
                                <span>已掌握 / 总词</span>
                                <strong>{stats.masteredCount} / {stats.wordCount}</strong>
                            </div>
                        </div>
                        <div className="panel intro-panel" style={{ gridColumn: '1 / -1' }}>
                            <p className="eyebrow">最近单词</p>
                            <h2 style={{ fontSize: '1.1rem', margin: '6px 0' }}>点击任意单词跳转详情</h2>
                            <div className="overview-word-grid" style={{ marginTop: 8 }}>
                                {overviewWords.map((word) => (
                                    <button key={word.id} type="button" className="overview-word-card" onClick={() => {
                                        const list = state.lists.find((l) => l.words.some((w) => w.id === word.id));
                                        if (list) {
                                            setState((current) => ({ ...current, activeListId: list.id }));
                                            setSelectedWordId(word.id);
                                            setActiveTab('lists');
                                        }
                                    }}>
                                        <span className="word-tag">{word.mastered ? '已掌握' : '学习中'}</span>
                                        <h3>{word.term}</h3>
                                        <p>{word.meaning}</p>
                                        <small>{word.example}</small>
                                    </button>
                                ))}
                            </div>
                        </div>
                    </section>
                )}

                {activeTab === 'lists' && (
                    <section className="workspace-grid">
                        <aside className="panel sidebar-panel">
                            <div className="panel-head">
                                <div>
                                    <p className="eyebrow">词表列表</p>
                                    <h2>所有词表</h2>
                                </div>
                            </div>
                            <div className="list-stack">
                                {state.lists.map((list) => (
                                    <button
                                        key={list.id}
                                        type="button"
                                        className={`list-card ${activeList?.id === list.id ? 'active' : ''}`}
                                        onClick={() => {
                                            setState((current) => ({ ...current, activeListId: list.id }));
                                            setSelectedWordId(list.words[0]?.id ?? '');
                                            setListView('grid');
                                        }}
                                    >
                                        <span className={`list-color list-${list.color}`} />
                                        <div className="list-card-body">
                                            <strong>{list.name}</strong>
                                            <p>{list.context}</p>
                                            <small>{list.words.length} 个单词</small>
                                        </div>
                                        <span className="delete-chip" onClick={(event) => {
                                            event.stopPropagation();
                                            handleDeleteList(list.id);
                                        }}>删除</span>
                                    </button>
                                ))}
                            </div>
                            <div className="form-card">
                                <p className="eyebrow">新建词表</p>
                                <label>
                                    名称
                                    <input value={listName} onChange={(event) => setListName(event.target.value)} placeholder="例如：咖啡店聊天" />
                                </label>
                                <label>
                                    场景
                                    <input value={listContext} onChange={(event) => setListContext(event.target.value)} placeholder="例如：朋友见面和点单" />
                                </label>
                                <label>
                                    描述
                                    <textarea value={listDescription} onChange={(event) => setListDescription(event.target.value)} placeholder="可选，写一句这个词表为什么存在。" rows={3} />
                                </label>
                                <button className="primary-button" type="button" onClick={handleCreateList}>创建词表</button>
                            </div>
                        </aside>

                        <section className="panel main-panel">
                            {!activeList ? (
                                <div className="empty-state">还没有词表，先从左边创建一个。</div>
                            ) : listView === 'grid' ? (
                                <>
                                    <div className="panel-head">
                                        <div>
                                            <p className="eyebrow">当前词表</p>
                                            <h2>{activeList.name}</h2>
                                            <p className="muted-text">{activeList.description}</p>
                                        </div>
                                        <div className="stats-inline">
                                            <span>{activeList.words.length} 个词</span>
                                            <span>{Math.round(activeList.words.reduce((sum, word) => sum + word.score, 0) / Math.max(1, activeList.words.length))}% 平均掌握度</span>
                                        </div>
                                    </div>

                                    <div className="form-card compact-form">
                                        <p className="eyebrow">添加单词</p>
                                        <div className="inline-form">
                                            <label>
                                                单词
                                                <input value={wordTerm} onChange={(event) => setWordTerm(event.target.value)} placeholder="例如：luggage" />
                                            </label>
                                            <label>
                                                释义（可留空）
                                                <input value={wordMeaning} onChange={(event) => setWordMeaning(event.target.value)} placeholder="留空时使用ai自动生成" />
                                            </label>
                                        </div>
                                        <button className="primary-button" type="button" onClick={handleAddWord}>加入词表</button>
                                    </div>

                                    <div className="form-card compact-form">
                                        <p className="eyebrow">智能发现新单词</p>
                                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                            <label style={{ flex: 1 }}>
                                                数量
                                                <input type="number" min={1} max={20} value={genCount} onChange={(e) => setGenCount(Number(e.target.value))} />
                                            </label>
                                            <label style={{ flex: 2 }}>
                                                难度
                                                <div className="difficulty-pills">
                                                    {(['basic', 'intermediate', 'advanced'] as const).map((d) => (
                                                        <button
                                                            key={d}
                                                            type="button"
                                                            className={`difficulty-pill${genDifficulty === d ? ' active' : ''}`}
                                                            onClick={() => setGenDifficulty(d)}
                                                        >
                                                            {{ basic: '入门', intermediate: '中级', advanced: '高级' }[d]}
                                                        </button>
                                                    ))}
                                                </div>
                                            </label>
                                            <button className="primary-button" type="button" onClick={handleGenerateWords} disabled={genLoading}>
                                                {genLoading ? '生成中…' : '获取新单词'}
                                            </button>
                                        </div>

                                        {genResults.length > 0 && (
                                            <div style={{ marginTop: 12 }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                    <strong>候选单词（{genResults.length}）</strong>
                                                    <div>
                                                        <button className="ghost-button" type="button" onClick={() => setGenResults([])}>清空</button>
                                                        <button className="primary-button" type="button" onClick={handleAddAllGenerated} style={{ marginLeft: 8 }}>全部加入</button>
                                                    </div>
                                                </div>
                                                <div style={{ marginTop: 8 }}>
                                                    {genResults.map((w) => (
                                                        <div key={w.id} className="overview-word-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 10, marginBottom: 8 }}>
                                                            <div>
                                                                <strong>{w.term}</strong>
                                                                <p className="muted-text">{w.meaning}</p>
                                                                <small>{w.example}</small>
                                                            </div>
                                                            <div style={{ display: 'flex', gap: 8 }}>
                                                                <button className="secondary-button" type="button" onClick={() => handleAddGenerated(w)}>加入</button>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    <div className="word-grid">
                                        {activeList.words.map(renderWordCard)}
                                    </div>
                                </>
                            ) : selectedWord ? (
                                <article className="detail-card" style={{ border: 'none', background: 'transparent' }}>
                                    <div className="panel-head" style={{ marginBottom: 8 }}>
                                        <button className="ghost-button" type="button" onClick={() => setListView('grid')} style={{ padding: '6px 12px' }}>← 返回</button>
                                        <span className={`mastery-badge ${selectedWord.mastered ? 'is-mastered' : ''}`}>
                                            {selectedWord.mastered ? '已掌握' : '学习中'}
                                        </span>
                                    </div>
                                    <h2 style={{ fontSize: '1.6rem', margin: '4px 0' }}>{selectedWord.term}</h2>
                                    <p className="detail-meaning">{selectedWord.meaning}</p>
                                    <p className="muted-text">{selectedWord.note}</p>

                                    <div className="detail-example" style={{ marginTop: 14 }}>
                                        <strong>例句</strong>
                                        <p>{selectedWord.example}</p>
                                    </div>

                                    {wordImageUrl && (
                                        <div className="detail-image" style={{ marginTop: 14 }}>
                                            <img src={wordImageUrl} alt={selectedWord.term} className="word-image" />
                                        </div>
                                    )}

                                    <div className="detail-actions" style={{ marginTop: 16 }}>
                                        <button className="ghost-button" type="button" onClick={() => handleGenerateImage(selectedWord.term, activeList?.context || '')} disabled={wordImageLoading}>
                                            {wordImageLoading ? '搜索图片…' : wordImageUrl ? '换一张' : '生成图片'}
                                        </button>
                                        <button className="ghost-button danger" type="button" onClick={() => handleDeleteWord(selectedWord.id)}>删除这个词</button>
                                    </div>
                                </article>
                            ) : (
                                <div className="empty-state">选择左侧词表中一个单词查看详情。</div>
                            )}
                        </section>
                    </section>
                )}

                {activeTab === 'learn' && (
                    <section className="practice-layout">
                        <section className="panel practice-panel">
                            <div className="panel-head">
                                <div>
                                    <p className="eyebrow">学习模式</p>
                                    <h2>{learnSubTab === 'flashcard' ? '刷卡片' : '短文阅读'}</h2>
                                </div>
                                <div className="difficulty-pills" style={{ display: 'inline-flex', gap: 4, background: 'rgba(255,255,255,0.04)', borderRadius: 14, padding: 4 }}>
                                    <button type="button" className={`difficulty-pill ${learnSubTab === 'flashcard' ? 'active' : ''}`} onClick={() => setLearnSubTab('flashcard')}>卡片</button>
                                    <button type="button" className={`difficulty-pill ${learnSubTab === 'reading' ? 'active' : ''}`} onClick={() => setLearnSubTab('reading')}>阅读</button>
                                </div>
                            </div>

                            {learnSubTab === 'flashcard' ? (
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
                                            <input type="checkbox" checked={showTranslation} onChange={(e) => setShowTranslation(e.target.checked)} />
                                            显示翻译
                                        </label>
                                        <button className="primary-button" type="button" onClick={handleGenerateReading} disabled={readingLoading}>
                                            {readingLoading ? '生成中…' : '生成短文'}
                                        </button>
                                    </div>

                                    {!activeList || !activeList.words.length ? (
                                        <div className="empty-state">当前词表还没有单词，先添加几个词再生成阅读短文。</div>
                                    ) : readingPassage ? (
                                        <div className="reading-passage">
                                            {renderHighlightedPassage(readingPassage, activeList?.words ?? [], showTranslation)}
                                        </div>
                                    ) : (
                                        <div className="empty-state">点击「生成短文」，AI 会根据当前词表中的单词创作一段短文。</div>
                                    )}
                                </div>
                            )}
                        </section>
                        <aside className="panel practice-summary">
                            {learnSubTab === 'flashcard' ? (
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

                {activeTab === 'quiz' && (
                    <section className="practice-layout">
                        <section className="panel practice-panel">
                            {quizPhase === 'setup' && (
                                <div style={{ padding: '20px 0', display: 'grid', gap: 20 }}>
                                    <div>
                                        <p className="eyebrow">测验配置</p>
                                        <h2 style={{ fontSize: '1.3rem', margin: '8px 0' }}>{activeList?.name ?? '请选择词表'}</h2>
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
                                            <button className="ghost-button" type="button" onClick={handleQuizReset} style={{ padding: '4px 10px', fontSize: '0.85rem' }}>退出</button>
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
                                    <button className="primary-button" type="button" onClick={handleQuizReset} style={{ marginTop: 12 }}>再来一次</button>
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

                {activeTab === 'voice' && (
                    <section className="practice-layout">
                        <section className="panel practice-panel">
                            <div className="panel-head">
                                <div>
                                    <p className="eyebrow">语音对话</p>
                                    <h2>和 AI 口语练习</h2>
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
                                        <p>{msg.text}</p>
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
                            <p className="muted-text" style={{ marginTop: 16 }}>
                                <strong>角色扮演</strong>：AI 扮演「{activeList?.context ?? '自由对话'}」场景角色，与你进行英语对话练习。多轮对话会自动记忆上下文。
                            </p>
                        </aside>
                    </section>
                )}

                {activeTab === 'progress' && (
                    <section className="dashboard-grid" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
                        <div className="panel progress-panel">
                            <p className="eyebrow">整体进度</p>
                            <h2>{stats.averageScore}% 平均掌握度</h2>
                            <div className="progress-bars">
                                {[...state.lists].sort((a, b) => {
                                    const aAvg = Math.round(a.words.reduce((s, w) => s + w.score, 0) / Math.max(1, a.words.length));
                                    const bAvg = Math.round(b.words.reduce((s, w) => s + w.score, 0) / Math.max(1, b.words.length));
                                    return aAvg - bAvg;
                                }).map((list) => {
                                    const total = list.words.length || 1;
                                    const mastered = list.words.filter((word) => word.mastered).length;
                                    const average = Math.round(list.words.reduce((sum, word) => sum + word.score, 0) / total);

                                    return (
                                        <div key={list.id} className="progress-card">
                                            <div className="progress-card-head">
                                                <strong>{list.name}</strong>
                                                <span>{mastered}/{list.words.length} 已掌握</span>
                                            </div>
                                            <div className="progress-track">
                                                <div className="progress-fill" style={{ width: `${average}%` }} />
                                            </div>
                                            <small>{average}% 平均分</small>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        <div className="panel progress-panel">
                            <p className="eyebrow">需要复习</p>
                            <h2>最薄弱单词</h2>
                            <div className="mini-progress-list">
                                {state.lists.flatMap((l) => l.words).sort((a, b) => a.score - b.score).slice(0, 6).map((word) => (
                                    <div key={word.id} className="mini-progress-item">
                                        <div>
                                            <strong>{word.term}</strong>
                                            <p>{word.meaning}</p>
                                        </div>
                                        <span style={{ color: word.score < 40 ? 'var(--danger)' : 'var(--accent-alt)' }}>{word.score}%</span>
                                    </div>
                                ))}
                                {stats.wordCount === 0 && <div className="empty-state">还没有单词。</div>}
                            </div>
                        </div>

                        <div className="panel progress-panel">
                            <p className="eyebrow">掌握较好</p>
                            <h2>已掌握单词</h2>
                            <div className="mini-progress-list">
                                {state.lists.flatMap((l) => l.words).filter((w) => w.mastered).sort((a, b) => b.score - a.score).slice(0, 6).map((word) => (
                                    <div key={word.id} className="mini-progress-item">
                                        <div>
                                            <strong>{word.term}</strong>
                                            <p>{word.meaning}</p>
                                        </div>
                                        <span style={{ color: 'var(--accent)' }}>{word.score}%</span>
                                    </div>
                                ))}
                                {stats.masteredCount === 0 && <div className="empty-state">暂无已掌握单词，继续练习吧。</div>}
                            </div>
                        </div>

                        <div className="panel progress-panel" style={{ gridColumn: '1 / -1' }}>
                            <p className="eyebrow">打卡日历</p>
                            <h2>练习记录</h2>
                            <div className="activity-header">
                                <div className="activity-stat"><span>连续提交</span><strong>{activityStats.streak} 天</strong></div>
                                <div className="activity-stat"><span>本月解决</span><strong>{activityStats.monthSolved} 题</strong></div>
                                <div className="activity-stat"><span>今日</span><strong>{activityStats.todayCount} 次</strong></div>
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
                            <p className="muted-text" style={{ fontSize: '0.8rem', marginTop: 8 }}>近一年练习热力图 — 颜色越深练习次数越多</p>
                        </div>
                    </section>
                )}
            </main>
        </div>
    );
}

export default App;
