import { AppState } from './types';

export const initialState: AppState = {
    activeListId: 'list-travel',
    lists: [
        {
            id: 'list-travel',
            name: '旅行文化',
            context: '机场、酒店、城市出行',
            description: '把出行时会高频碰到的词先学会。',
            color: 'sun',
            createdAt: '2026-05-24T08:00:00.000Z',
            words: [
                {
                    id: 'word-checkin',
                    term: 'check-in',
                    meaning: '办理登机或入住手续',
                    example: 'Please check in at the front desk before 3 p.m.',
                    note: '常见于机场和酒店场景。',
                    score: 72,
                    mastered: true,
                    createdAt: '2026-05-24T08:00:00.000Z'
                },
                {
                    id: 'word-board',
                    term: 'boarding',
                    meaning: '登机；上车上船',
                    example: 'Boarding will begin at Gate 12 in ten minutes.',
                    note: '和交通场景高度相关。',
                    score: 58,
                    mastered: false,
                    createdAt: '2026-05-24T08:02:00.000Z'
                },
                {
                    id: 'word-suitcase',
                    term: 'suitcase',
                    meaning: '旅行箱；行李箱',
                    example: 'My suitcase is a little too heavy for one person.',
                    note: '可以和 luggage 一起记忆。',
                    score: 40,
                    mastered: false,
                    createdAt: '2026-05-24T08:03:00.000Z'
                }
            ]
        },
        {
            id: 'list-cafe',
            name: '咖啡店聊天',
            context: '朋友见面、点单、闲聊',
            description: '用最自然的日常对话词汇练习口语。',
            color: 'mint',
            createdAt: '2026-05-24T09:00:00.000Z',
            words: [
                {
                    id: 'word-order',
                    term: 'order',
                    meaning: '点餐；订购',
                    example: 'Can I order an iced latte, please?',
                    note: '在餐饮场景中非常高频。',
                    score: 66,
                    mastered: true,
                    createdAt: '2026-05-24T09:05:00.000Z'
                },
                {
                    id: 'word-recommend',
                    term: 'recommend',
                    meaning: '推荐；建议',
                    example: 'Do you recommend this new coffee blend?',
                    note: '表达建议时非常实用。',
                    score: 54,
                    mastered: false,
                    createdAt: '2026-05-24T09:06:00.000Z'
                },
                {
                    id: 'word-chat',
                    term: 'chat',
                    meaning: '聊天；闲聊',
                    example: 'We had a quick chat about the weekend plans.',
                    note: '偏轻松日常的交流。',
                    score: 81,
                    mastered: true,
                    createdAt: '2026-05-24T09:08:00.000Z'
                }
            ]
        },
        {
            id: 'list-ai',
            name: 'AI 产品讨论',
            context: '产品评审、研发协作、技术表达',
            description: '适合技术团队和产品讨论的核心词。',
            color: 'violet',
            createdAt: '2026-05-24T10:00:00.000Z',
            words: [
                {
                    id: 'word-prompt',
                    term: 'prompt',
                    meaning: '提示词；引导语',
                    example: 'A strong prompt helps the model produce better output.',
                    note: 'AI 场景里非常核心。',
                    score: 88,
                    mastered: true,
                    createdAt: '2026-05-24T10:02:00.000Z'
                },
                {
                    id: 'word-deploy',
                    term: 'deploy',
                    meaning: '部署；上线',
                    example: 'We will deploy the new version after testing.',
                    note: '研发协作中常用。',
                    score: 63,
                    mastered: true,
                    createdAt: '2026-05-24T10:03:00.000Z'
                },
                {
                    id: 'word-iterate',
                    term: 'iterate',
                    meaning: '迭代；反复优化',
                    example: 'We should iterate on the design based on user feedback.',
                    note: '适合产品和研发讨论。',
                    score: 46,
                    mastered: false,
                    createdAt: '2026-05-24T10:04:00.000Z'
                }
            ]
        }
    ]
};
