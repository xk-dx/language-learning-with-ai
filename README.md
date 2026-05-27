# ai智能英语学习平台

基于原 wordpecker-app 概念简化复刻，前端 React + 后端 Flask，专注词汇学习的核心闭环。

## 功能

| 模块           | 说明                                                                                  |
| -------------- | ------------------------------------------------------------------------------------- |
| 📋 词表管理     | 创建/删除词表，设置场景说明，渐进式披露（卡片网格 → 点击进入详情）                    |
| 📝 单词管理     | 添加/删除单词，AI 自动补全释义与例句                                                  |
| 🃏 学习（卡片） | 刷卡片 Flashcard 模式：看英文想中文 → 翻转看答案 → ✅认识(+28分) / ❌不认识(-15分)      |
| 📖 学习（阅读） | AI 根据词表单词生成短文，高亮词表单词，可切换显示翻译                                 |
| 🎯 测验         | 渐进式披露（配置页 → 答题 → 结果），三种题型混合：词义匹配 + 拼写题 + 完形填空        |
| 📊 进度         | 整体进度条、最薄弱单词排行、已掌握单词排行、按分数排序的词表明细                      |
| 🤖 智能发现     | AI 根据场景生成真实英语词汇候选，可逐个或批量加入词表                                 |
| 🖼️ 单词配图     | 在单词详情页搜索 Pexels 免费图库配图（需配置 API Key）                                |
| 🤖 Agent        | 双模式 AI 助手：🎤 语音角色扮演（多轮英语对话，自动记忆上下文）+ 📄 PDF 知识问答（RAG） |

## Agent 智能助手

Agent 页面提供两种交互模式，可在顶部一键切换：

### 🎤 语音对话模式
- 根据词表场景自动生成 AI 角色提示词
- 浏览器原生语音识别 (STT) + 语音合成 (TTS)，**零成本**
- 多轮对话自动记忆上下文（最近 100 条）
- AI 全英文角色扮演（店员、导游、朋友等）

### 📄 PDF 问答模式（RAG）
- 上传 PDF 学习资料，自动切片 + 向量化
- 基于 DeepSeek Embedding + NumPy 向量检索
- 提问时自动检索相关段落，AI 结合资料回答
- 支持多份 PDF 同时检索，保留上传历史

## 项目结构

```
my_wordpecker/
├── frontend/           # React + Vite + TypeScript
│   ├── src/
│   │   ├── App.tsx         # 主应用（路由、状态、渲染）
│   │   ├── apiService.ts   # 后端 API 调用层（含本地 fallback）
│   │   ├── utils.ts        # 工具函数、本地生成器
│   │   ├── types.ts        # TypeScript 类型定义
│   │   ├── data.ts         # 示例数据
│   │   └── styles.css      # 全局样式（紧凑布局、暗色/亮色主题）
│   └── index.html
│
├── backend_flask/      # Flask AI 代理服务
│   ├── app.py              # 端点：config, text-proxy, chat, generate-words,
│   │                       #  complete-word, generate-reading, find-image,
│   │                       #  generate-quiz-extra, rag/upload-pdf, rag/search,
│   │                       #  rag/context, rag/stats, rag/clear
│   ├── rag/                # RAG 引擎模块
│   │   ├── __init__.py
│   │   ├── rag_engine.py   # RAG 顶层封装
│   │   ├── embedder.py     # DeepSeek Embedding 封装
│   │   ├── vector_store.py # NumPy 向量存储（JSON + .npy）
│   │   └── pdf_processor.py# PDF 切片解析
│   ├── data/rag_store/     # 向量数据持久化目录
│   ├── requirements.txt
│   ├── .env.example
│   └── README.md
│
├── docs/
│   ├── voice-chat.md    # 语音对话功能详细说明
│   └── rag.md           # RAG 知识问答功能详细说明
│
└── README.md           # 本文件
```

## 快速开始

### 前端

```bash
cd my_wordpecker/frontend
npm install
npm run dev
```

### 后端

```bash
cd my_wordpecker/backend_flask

python -m venv venv
# Windows
venv\Scripts\activate
# macOS / Linux
source venv/bin/activate
pip install -r requirements.txt

cp .env.example .env
# 编辑 .env，填入 API Key

python app.py
```

后端默认运行在 `http://localhost:5001`，前端自动检测并优先调用后端；若后端不可用，自动降级为本地生成器。

## 环境变量

| 变量                                   | 必需 | 默认值                     | 说明                                |
| -------------------------------------- | ---- | -------------------------- | ----------------------------------- |
| `OPENAI_API_KEY` 或 `DEEPSEEK_API_KEY` | 是   | —                          | OpenAI/DeepSeek 兼容的 API Key      |
| `OPENAI_BASE_URL`                      | 否   | `https://api.deepseek.com` | API 端点 base URL                   |
| `DEFAULT_MODEL`                        | 否   | `deepseek-v4-flash`        | 聊天模型名                          |
| `PEXELS_API_KEY`                       | 否   | —                          | Pexels 免费图库 Key（用于单词配图） |
| `PORT`                                 | 否   | `5001`                     | Flask 服务端口                      |
| `RAG_DATA_DIR`                         | 否   | `data/rag_store/`          | RAG 向量数据存储目录                |

## 特色

- **紧凑布局**：顶栏 + 标签导航 + 浮动 Toast 通知，最大化内容展示空间
- **渐进式披露**：词表页（网格 → 详情）、测验页（配置 → 答题 → 结果），信息逐步展开
- **主题切换**：顶部一键切换暗色/亮色，持久化到 localStorage
- **多题型测验**：词义匹配 + 拼写题 + 完形填空 ，每题先给反馈再选择是否查看解析
- **语音角色扮演**：根据词表场景自动生成 AI 角色提示词，多轮英语对话，自动记忆上下文
- **RAG 知识问答**：上传 PDF 资料，AI 自动检索相关内容回答问题，支持多文档

## 技术栈

- **前端**: React 18 + Vite + TypeScript
- **后端**: Flask + OpenAI SDK + Pexels API
- **RAG**: 本地 `sentence-transformers`（`all-MiniLM-L6-v2`）+ NumPy 向量检索 + PyMuPDF 解析
- **数据**: 前端 localStorage + 后端 JSON/NumPy 文件持久化
- **AI 提供商**: 兼容 OpenAI / DeepSeek 等任何 OpenAI 兼容接口
- **语音**: 浏览器 Web Speech API — `SpeechRecognition`（语音识别 STT）+ `speechSynthesis`（语音合成 TTS），纯浏览器端，零额外依赖，无需 API Key
- **语音对话 Agent**: 多轮记忆（最近 20 轮）+ 动态角色提示词（根据词表场景自动生成）+ 全英文角色扮演

## License

MIT
