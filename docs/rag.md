# RAG 知识问答功能说明

基于 PDF 学习资料的 Retrieval-Augmented Generation（检索增强生成）问答系统。上传英语学习资料后，AI 自动检索相关内容并回答问题。

## 技术架构

```
用户提问
  │
  ├─ ① 调 POST /api/rag/context     ← 向量检索
  │     ├─ DeepSeek Embedding → 问题向量
  │     ├─ NumPy cosine similarity → 找 top-3 相关段落
  │     └─ 返回 "[来源: 第3页] 段落内容..."
  │
  ├─ ② 拼接 system prompt
  │     你是一个英语学习助手。
  │     【学习资料】 ← 检索到的段落
  │     [来源: 第3页] ...
  │     [来源: 第5页] ...
  │     请用中文回答...
  │
  ├─ ③ POST /api/chat              ← LLM 调用
  │     system + 资料 + 对话历史 → DeepSeek
  │     → 返回含资料引用的回答
  │
  └─ ④ 显示在消息列表
```

## 核心组件

### 后端模块（`backend_flask/rag/`）

| 文件 | 说明 |
|------|------|
| `embedder.py` | 本地 `sentence-transformers` 封装（`all-MiniLM-L6-v2`，384 维，离线运行） |
| `vector_store.py` | 轻量向量存储：`docs.json` 存文本，`vectors.npy` 存向量矩阵，NumPy 做 cosine similarity 检索 |
| `pdf_processor.py` | PDF 切片引擎：按页→按块→超长块按句子拆分，保留页码元数据 |
| `rag_engine.py` | 顶层封装：`ingest_pdf()` → `search()` → `search_with_prompt()` |

### 存储结构

```
backend_flask/data/rag_store/
├── docs.json      # [{id, text, metadata}, ...]  文本库
├── vectors.npy    # float32 矩阵，行与 docs.json 一一对应  向量库
└── files.json     # [{filename, chunks, pages, uploaded_at}]  上传历史
```

### 向量检索原理

```python
# 归一化 → cosine similarity
q_norm = query_vec / ||query_vec||
v_norm = vectors / ||vectors||
scores = dot(q_norm, v_norm.T)      # 一次性计算所有相似度
top_k = argsort(scores)[-5:]        # 取 top-5
```

纯 NumPy 运算，千条级别数据查询 < 1ms，无需数据库服务。

## API 端点

| 路由 | 方法 | 功能 |
|------|------|------|
| `/api/rag/upload-pdf` | POST | 上传 PDF（multipart/form-data），自动切片+向量化+入库 |
| `/api/rag/search` | POST | 向量检索，返回 `[{id, text, metadata, score}]` |
| `/api/rag/context` | POST | 检索并返回可直接拼入 prompt 的上下文字符串 |
| `/api/rag/stats` | GET | 查看知识库统计（段落数 + 文件列表） |
| `/api/rag/clear` | POST | 清空所有数据 |

### 请求示例

```bash
# 上传 PDF
curl -X POST http://localhost:5001/api/rag/upload-pdf \
  -F "file=@english_grammar.pdf"

# 检索
curl -X POST http://localhost:5001/api/rag/search \
  -H "Content-Type: application/json" \
  -d '{"query": "present perfect tense", "top_k": 3}'

# 获取上下文
curl -X POST http://localhost:5001/api/rag/context \
  -H "Content-Type: application/json" \
  -d '{"query": "present perfect tense"}'

# 查看状态
curl http://localhost:5001/api/rag/stats
```

## 使用方式

1. 切换到 **Agent** Tab
2. 点击顶部 **「📄 PDF 问答」** 切换模式
3. 点击右侧 **「📄 上传 PDF」** 选择英语学习资料
4. 上传完成后，在输入框中输入问题，按 Enter 或点击发送
5. AI 会自动检索 PDF 中相关内容并回答

### 支持的资料类型

- 英语语法教材
- 词汇书 / 单词表 PDF
- 阅读理解文章
- 英语学习笔记
- 任何包含英语文本的 PDF 文档

## 配置参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| Embedding 模型 | `all-MiniLM-L6-v2` | 本地 sentence-transformers，384 维，离线运行 |
| 切片最小字符 | 50 | 少于该长度的文本块丢弃 |
| 切片最大字符 | 800 | 超长块按句子拆分 |
| 检索 top-k | 3 | 每次检索返回的最相关段落数 |
| 最大上下文长度 | 1200 chars | 拼入 prompt 的检索内容上限 |
| 对话历史 | 100 条 | 保留最近 100 条消息（约 50 轮） |
| 相似度阈值 | 0.1 | 低于此分数的结果不返回 |

## 文件依赖

相比基础功能，RAG 新增依赖：

```
# requirements.txt
numpy>=1.24          # 向量运算
PyMuPDF>=1.23        # PDF 解析
sentence-transformers>=2.2  # 本地 embedding 模型
```

## 实现文件

| 文件 | 职责 |
|------|------|
| `backend_flask/rag/embedder.py` | Embedding API 调用 |
| `backend_flask/rag/vector_store.py` | 向量存储 + 检索 |
| `backend_flask/rag/pdf_processor.py` | PDF 切片 |
| `backend_flask/rag/rag_engine.py` | 顶层引擎 |
| `backend_flask/app.py` | RAG 路由（`/api/rag/*`） |
| `frontend/src/App.tsx` | `uploadPdf()` / `sendRagMessage()` / `fetchRagStats()` |
| `frontend/src/styles.css` | Agent 模式切换 / RAG 输入框样式 |

## 注意事项

- **首次启动**：第一次使用时需要下载 `all-MiniLM-L6-v2` 模型（~80MB），后续离线运行
- **首次上传**：大 PDF（>50 页）可能需要 10-20 秒处理时间
- **检索质量**：PDF 文本质量直接影响检索效果，扫描版 PDF 需先 OCR
- **数据持久化**：向量数据存储在 `data/rag_store/`，重启后端不会丢失
- **隐私**：所有数据在本地处理，不上传至第三方
