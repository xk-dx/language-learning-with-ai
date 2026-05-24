import { useEffect, useMemo, useRef, useState } from 'react';
import { initialState } from './data';
import { AppState, PracticeSession, TabId, WordItem, WordList } from './types';
import {
    buildAutoContent,
    calculateStats,
    createId,
    createPracticeSession,
    getActiveList,
    shuffle,
    updateWordProgress,
    generateSmartWords
} from './utils';

const STORAGE_KEY = 'wordpecker-mini-state-v1';
const THEME_KEY = 'wordpecker-theme-v1';
const TABS: Array<{ id: TabId; label: string; hint: string }> = [
    { id: 'overview', label: '总览', hint: '看整体状态' },
    { id: 'lists', label: '词表', hint: '管理词汇' },
    { id: 'learn', label: '学习', hint: '单词学习' },
    { id: 'quiz', label: '测验', hint: '快速检验' },
    { id: 'progress', label: '进度', hint: '查看掌握度' }
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

        setLearnSession(buildSession(activeList.words, Math.min(6, activeList.words.length || 1)));
        setQuizSession(buildSession(activeList.words, Math.min(5, activeList.words.length || 1)));
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

    const handleAddWord = () => {
        if (!activeList) {
            notify('先选择一个词表。');
            return;
        }

        const term = wordTerm.trim();
        if (!term) {
            notify('请输入要添加的单词。');
            return;
        }

        setState((current) => addWordToList(current, activeList.id, term, wordMeaning));
        setWordTerm('');
        setWordMeaning('');
        notify('单词已加入词表。');
    };

    // Smart generation state
    const [genCount, setGenCount] = useState(6);
    const [genDifficulty, setGenDifficulty] = useState<'basic' | 'intermediate' | 'advanced'>('intermediate');
    const [genResults, setGenResults] = useState<Array<any>>([]);

    const handleGenerateWords = () => {
        if (!activeList) return notify('先选择一个词表以生成新词。');
        const results = generateSmartWords(activeList.context || activeList.name, Math.min(Math.max(1, genCount), 20), genDifficulty);
        setGenResults(results);
        notify(`已生成 ${results.length} 个候选单词`);
    };

    const handleAddGenerated = (word: any) => {
        if (!activeList) return;
        setState((current) => addWordToList(current, activeList.id, word.term, word.meaning));
        notify('已加入词表');
        setGenResults((cur) => cur.filter((w) => w.id !== word.id));
    };

    const handleAddAllGenerated = () => {
        if (!activeList) return;
        setState((current) => {
            let next = current;
            genResults.forEach((w) => {
                next = addWordToList(next, activeList.id, w.term, w.meaning);
            });
            return next;
        });
        notify(`已加入 ${genResults.length} 个单词`);
        setGenResults([]);
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

    const handleQuizAnswer = (answer: string) => {
        if (!activeList || quizSession.answered || quizSession.finished) {
            return;
        }

        const currentQuestion = quizSession.questions[quizSession.currentIndex];
        const isCorrect = answer === currentQuestion.correctMeaning;

        setQuizSession((current) => ({
            ...current,
            answered: true,
            selectedAnswer: answer,
            correctCount: current.correctCount + (isCorrect ? 1 : 0)
        }));
        setState((current) => scoreWord(current, activeList.id, currentQuestion.wordId, isCorrect));
        notify(isCorrect ? '答对了。' : '这题先记住正确含义。');
    };

    const handleQuizNext = () => {
        setQuizSession((current) => {
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
        setQuizShowExplanationIndex(null);
    };

    const resetLearnSession = () => {
        setLearnRound((value) => value + 1);
        notify('学习轮次已重置。');
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
                onClick={() => setSelectedWordId(word.id)}
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

    const renderPracticePanel = (
        title: string,
        session: PracticeSession,
        onAnswer: (answer: string) => void,
        onNext: () => void,
        onReset: () => void,
        showExplanationImmediate: boolean = true,
        explanationVisible: boolean = true,
        onRequestShowExplanation: () => void = () => {}
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
                <p className="question-text">这个词在当前词表里的中文意思是什么？</p>
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
    const overviewWords = shuffle(state.lists.flatMap((list) => list.words)).slice(0, 4);

    return (
        <div className="app-shell">
            <div className="background-orb background-orb-left" />
            <div className="background-orb background-orb-right" />

            <main className="app-frame">
                <section className="hero-panel panel">
                    <div className="hero-topline">
                        <span className="brand-mark">WordPecker</span>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                            <button
                                className="ghost-button"
                                type="button"
                                onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
                                aria-label="切换亮/暗模式"
                            >
                                {theme === 'light' ? '🌙 暗色' : '☀️ 亮色'}
                            </button>
                            <button className="ghost-button" type="button" onClick={handleSeedReset}>恢复示例数据</button>
                        </div>
                    </div>
                    <div className="hero-copy">
                        <div>
                            <p className="eyebrow">中文最小版词汇学习应用</p>
                            <h1>打开就能用的词表、学习和测验。</h1>
                            <p className="hero-text">
                                这个版本只保留最核心的闭环：创建词表、添加单词、自动生成基础释义、做简单练习、查看进度。
                            </p>
                        </div>
                        <div className="hero-stats">
                            <div className="glass-stat">
                                <span>词表</span>
                                <strong>{stats.listCount}</strong>
                            </div>
                            <div className="glass-stat">
                                <span>单词</span>
                                <strong>{stats.wordCount}</strong>
                            </div>
                            <div className="glass-stat">
                                <span>已掌握</span>
                                <strong>{stats.masteredCount}</strong>
                            </div>
                        </div>
                    </div>
                    <div className="message-line">{message || '本地存储已开启，刷新页面也会保留数据。'}</div>
                </section>

                <nav className="tab-nav panel">
                    {TABS.map((tab) => (
                        <button
                            key={tab.id}
                            type="button"
                            className={`tab-button ${activeTab === tab.id ? 'active' : ''}`}
                            onClick={() => setActiveTab(tab.id)}
                        >
                            <span>{tab.label}</span>
                            <small>{tab.hint}</small>
                        </button>
                    ))}
                </nav>

                {activeTab === 'overview' && (
                    <section className="dashboard-grid">
                        <div className="panel intro-panel">
                            <p className="eyebrow">项目节奏</p>
                            <h2>先做最有价值的 4 件事</h2>
                            <ol className="roadmap-list">
                                <li>词表管理：创建词表、加词、删词</li>
                                <li>自动释义：先用本地规则占位，后面接后端 AI</li>
                                <li>学习练习：把单词记一遍、做一轮测验</li>
                                <li>进度反馈：看每个词和每个词表的掌握度</li>
                            </ol>
                        </div>
                        <div className="panel intro-panel">
                            <p className="eyebrow">当前词表</p>
                            <h2>{activeList?.name ?? '暂无词表'}</h2>
                            <p className="muted-text">{activeList?.context ?? '先创建一个词表，再开始录入单词。'}</p>
                            <div className="compact-pills">
                                {difficultyPills.map((pill) => (
                                    <span key={pill} className="mini-pill">{pill}</span>
                                ))}
                            </div>
                        </div>
                        <div className="panel intro-panel wide-panel">
                            <div className="panel-head">
                                <div>
                                    <p className="eyebrow">最近单词</p>
                                    <h2>可以直接拿来练习</h2>
                                </div>
                            </div>
                            <div className="overview-word-grid">
                                {overviewWords.map((word) => (
                                    <article key={word.id} className="overview-word-card">
                                        <span className="word-tag">{word.mastered ? '已掌握' : '学习中'}</span>
                                        <h3>{word.term}</h3>
                                        <p>{word.meaning}</p>
                                        <small>{word.example}</small>
                                    </article>
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
                            {activeList ? (
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
                                                <input value={wordMeaning} onChange={(event) => setWordMeaning(event.target.value)} placeholder="留空时使用本地自动生成" />
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
                                                <select value={genDifficulty} onChange={(e) => setGenDifficulty(e.target.value as any)}>
                                                    <option value="basic">入门</option>
                                                    <option value="intermediate">中级</option>
                                                    <option value="advanced">高级</option>
                                                </select>
                                            </label>
                                            <button className="primary-button" type="button" onClick={handleGenerateWords}>获取新单词</button>
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

                                    {selectedWord && (
                                        <article className="detail-card">
                                            <div className="panel-head">
                                                <div>
                                                    <p className="eyebrow">单词详情</p>
                                                    <h2>{selectedWord.term}</h2>
                                                </div>
                                                <span className={`mastery-badge ${selectedWord.mastered ? 'is-mastered' : ''}`}>
                                                    {selectedWord.mastered ? '已掌握' : '学习中'}
                                                </span>
                                            </div>
                                            <p className="detail-meaning">{selectedWord.meaning}</p>
                                            <p className="muted-text">{selectedWord.note}</p>
                                            <div className="detail-example">
                                                <strong>例句</strong>
                                                <p>{selectedWord.example}</p>
                                            </div>
                                            <div className="detail-actions">
                                                <button className="ghost-button" type="button" onClick={() => setSelectedWordId(activeList.words[0]?.id ?? '')}>切换到第一个词</button>
                                                <button className="ghost-button danger" type="button" onClick={() => handleDeleteWord(selectedWord.id)}>删除这个词</button>
                                            </div>
                                        </article>
                                    )}
                                </>
                            ) : (
                                <div className="empty-state">还没有词表，先从左边创建一个。</div>
                            )}
                        </section>
                    </section>
                )}

                {activeTab === 'learn' && (
                    <section className="practice-layout">
                            {renderPracticePanel('学习模式', learnSession, handleLearnAnswer, handleLearnNext, resetLearnSession, true, true, () => setLearnShowExplanationIndex(learnSession.currentIndex))}
                        <aside className="panel practice-summary">
                            <p className="eyebrow">学习进度</p>
                            <h2>{learnScore}%</h2>
                            <div className="summary-card wide">
                                <span>正确数</span>
                                <strong>{learnSession.correctCount}</strong>
                            </div>
                            <div className="summary-card wide">
                                <span>题目数</span>
                                <strong>{learnSession.questions.length}</strong>
                            </div>
                            <div className="summary-card wide">
                                <span>当前词表</span>
                                <strong>{activeList?.name ?? '无'}</strong>
                            </div>
                            <button className="primary-button" type="button" onClick={resetLearnSession}>重新生成学习题</button>
                        </aside>
                    </section>
                )}

                {activeTab === 'quiz' && (
                    <section className="practice-layout">
                        {renderPracticePanel('测验模式', quizSession, handleQuizAnswer, handleQuizNext, resetQuizSession, false, quizShowExplanationIndex === quizSession.currentIndex, () => setQuizShowExplanationIndex(quizSession.currentIndex))}
                        <aside className="panel practice-summary">
                            <p className="eyebrow">测验成绩</p>
                            <h2>{quizScore}%</h2>
                            <div className="summary-card wide">
                                <span>答对</span>
                                <strong>{quizSession.correctCount}</strong>
                            </div>
                            <div className="summary-card wide">
                                <span>题目数</span>
                                <strong>{quizSession.questions.length}</strong>
                            </div>
                            <div className="summary-card wide">
                                <span>建议</span>
                                <strong>优先复习低分词</strong>
                            </div>
                            <button className="primary-button" type="button" onClick={resetQuizSession}>重新开始测验</button>
                        </aside>
                    </section>
                )}

                {activeTab === 'progress' && (
                    <section className="dashboard-grid">
                        <div className="panel progress-panel">
                            <p className="eyebrow">整体进度</p>
                            <h2>{stats.averageScore}% 平均掌握度</h2>
                            <div className="progress-bars">
                                {state.lists.map((list) => {
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
                            <p className="eyebrow">当前词表明细</p>
                            <h2>{activeList?.name ?? '无词表'}</h2>
                            <div className="summary-grid">
                                <div className="summary-card">
                                    <span>单词数</span>
                                    <strong>{activeWordCount}</strong>
                                </div>
                                <div className="summary-card">
                                    <span>已掌握</span>
                                    <strong>{activeList?.words.filter((word) => word.mastered).length ?? 0}</strong>
                                </div>
                                <div className="summary-card">
                                    <span>平均分</span>
                                    <strong>{activeList ? Math.round(activeList.words.reduce((sum, word) => sum + word.score, 0) / Math.max(1, activeList.words.length)) : 0}%</strong>
                                </div>
                            </div>
                            <div className="mini-progress-list">
                                {activeList?.words.map((word) => (
                                    <div key={word.id} className="mini-progress-item">
                                        <div>
                                            <strong>{word.term}</strong>
                                            <p>{word.meaning}</p>
                                        </div>
                                        <span>{word.score}%</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </section>
                )}
            </main>
        </div>
    );
}

export default App;
