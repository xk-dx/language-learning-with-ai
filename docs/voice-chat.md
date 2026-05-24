# 语音对话功能说明

使用浏览器原生 API + DeepSeek AI 实现零成本语音对话练习，无需 OpenAI Realtime、无需额外付费。

## 技术原理

```
你说话 → 浏览器 SpeechRecognition (STT, 免费)
       → DeepSeek AI (/api/text-proxy, 已有)
       → 浏览器 speechSynthesis (TTS, 免费) → AI 语音回复
```

| 环节             | 技术                                             | 成本                |
| ---------------- | ------------------------------------------------ | ------------------- |
| 语音转文字 (STT) | 浏览器 `SpeechRecognition` API（Web Speech API） | **免费**，离线可用  |
| AI 对话          | DeepSeek（通过 `/api/text-proxy`）               | 已有，按 token 计费 |
| 文字转语音 (TTS) | 浏览器 `speechSynthesis` API（Web Speech API）   | **免费**，离线可用  |

## 前置条件

- **浏览器**：Chrome / Edge（推荐，完整支持 Web Speech API）
- **后端**：Flask 服务运行中（`python app.py`），语音功能复用 `/api/text-proxy` 端点
- **麦克风**：浏览器需获取麦克风权限

## 使用方式

1. 打开前端 → 切换到「语音」Tab
2. 点击 **「🎤 开始对话」**
3. 浏览器弹出麦克风权限请求 → 点击「允许」
4. 对着麦克风说话（支持中英文）
5. 说完自动静音 → AI 处理并语音回复
6. 可继续对话，或点击 **「⏹ 结束对话」** 停止

## 界面说明

| 元素       | 说明                                       |
| ---------- | ------------------------------------------ |
| 状态指示灯 | 🟡 待机 → 🔴 聆听中 → 🟠 思考中 → 🟢 播报中    |
| 对话记录   | 用户消息（绿色气泡） / AI 回复（蓝色气泡） |
| 当前词表   | 右侧边栏显示，AI 会基于词表内容与你对话    |
| 清空记录   | 清除当前会话的所有对话记录                 |

## 实现文件

- `frontend/src/App.tsx` — 语音对话 UI 组件（`startVoiceChat` / `stopVoiceChat` / `clearVoiceChat`）
- `frontend/src/styles.css` — 语音对话样式（`.voice-messages` / `.voice-msg` / `.voice-status-dot`）
- `backend_flask/app.py` — 复用 `/api/text-proxy` 端点，不需要额外改动

## 自定义 AI 提示词

语音对话的提示词在 `App.tsx` 的 `startVoiceChat` 函数中：

```ts
prompt: `你是一个英语词汇学习助手。用户正在学习单词，用中文回答，帮助用户练习。用户说：${transcript}`
```

你可以修改这个提示词来改变 AI 的角色和行为，例如：
- 让 AI 只说英语、纠正发音
- 让 AI 扮演特定场景角色（咖啡店员、导游等）
- 让 AI 根据当前词表出题

## 注意事项

- **首次使用**：浏览器会请求麦克风权限，需要在弹窗中点击「允许」
- **HTTPS**：`SpeechRecognition` 在非 localhost 环境下需要 HTTPS 才能工作
- **语音识别语言**：当前设为 `zh-CN`（中文），可改为 `en-US` 等
- **语音合成语言**：当前设为 `zh-CN`，可改为 `en-US` 让 AI 用英语朗读
- 一次只说一句话即可，说完等待 AI 回复后再继续
