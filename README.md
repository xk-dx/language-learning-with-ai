# ai智能英语学习平台

基于原 [wordpecker-app](https://github.com/your-org/wordpecker-app) 概念简化复刻，前端 React + 后端 Flask，专注词汇学习的核心闭环。

## 功能

| 模块           | 说明                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------ |
| 📋 词表管理     | 创建/删除词表，设置场景说明                                                                |
| 📝 单词管理     | 添加/删除单词，AI 自动补全释义与例句                                                       |
| 🧠 学习（题目） | 选择题练习，答完显示解析与例句                                                             |
| 📖 学习（阅读） | AI 根据词表单词生成短文，高亮词表单词，可切换显示翻译                                      |
| 🎯 测验         | 点击「生成测验题」一键生成全部题目（本地词义匹配 + AI 完形填空），答题后需主动点击显示解析 |
| 📊 进度         | 整体与逐词掌握度追踪（答对 +28，答错 +6，≥60 标记已掌握）                                  |
| 🤖 智能发现     | AI 根据场景生成真实英语词汇候选，可逐个或批量加入词表                                      |
| 🖼️ 单词配图     | 在单词详情页搜索 Pexels 免费图库配图（需配置 API Key）                                     |
| 🎤 语音对话     | 浏览器原生语音识别 → DeepSeek AI → 语音合成，零额外依赖，免费使用                          |

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
│   │   └── styles.css      # 全局样式（支持暗色/亮色主题）
│   └── index.html
│
├── backend_flask/      # Flask AI 代理服务
│   ├── app.py              # 端点：config / text-proxy / generate-words /
│   │                       #  complete-word / generate-reading / find-image
│   ├── requirements.txt
│   ├── .env.example
│   └── README.md
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

# 首次
python -m venv venv
# Windows
venv\Scripts\activate
# macOS / Linux
source venv/bin/activate
pip install -r requirements.txt

# 配置环境变量
cp .env.example .env
# 编辑 .env，填入 API Key

# 启动
python app.py
```

后端默认运行在 `http://localhost:5001`，前端会自动检测并优先调用；若后端不可用，自动降级为本地生成器。

## 环境变量

| 变量                                   | 必需 | 默认值                     | 说明                                |
| -------------------------------------- | ---- | -------------------------- | ----------------------------------- |
| `OPENAI_API_KEY` 或 `DEEPSEEK_API_KEY` | 是   | —                          | OpenAI/DeepSeek 兼容的 API Key      |
| `OPENAI_BASE_URL`                      | 否   | `https://api.deepseek.com` | API 端点 base URL                   |
| `DEFAULT_MODEL`                        | 否   | `deepseek-v4-flash`        | 聊天模型名                          |
| `PEXELS_API_KEY`                       | 否   | —                          | Pexels 免费图库 Key（用于单词配图） |
| `PORT`                                 | 否   | `5001`                     | Flask 服务端口                      |

## 主题切换

点击顶部导航栏的「☀️ 亮色」/「🌙 暗色」按钮切换主题，选择会持久化到 localStorage。

## 技术栈

- **前端**: React 18 + Vite + TypeScript
- **后端**: Flask + OpenAI SDK + Pexels API
- **数据**: 前端 localStorage（无后端依赖）
- **AI 提供商**: 兼容 OpenAI / DeepSeek 等任何 OpenAI 兼容接口

## License

MIT
