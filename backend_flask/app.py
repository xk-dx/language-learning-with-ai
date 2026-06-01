from flask import Flask, request, jsonify
import os
import json
from dotenv import load_dotenv
from flask_cors import CORS
from openai import OpenAI

from rag.rag_engine import RagEngine

load_dotenv(override=True)  # .env 优先于系统环境变量

app = Flask(__name__)
CORS(app)  # 允许来自前端开发服务器的跨域请求

# 兼容两种环境变量名
OPENAI_API_KEY = os.getenv('OPENAI_API_KEY') or os.getenv('DEEPSEEK_API_KEY')
OPENAI_BASE_URL = os.getenv('OPENAI_BASE_URL', 'https://api.deepseek.com')
DEFAULT_MODEL = os.getenv('DEFAULT_MODEL', 'deepseek-v4-flash')
PEXELS_API_KEY = os.getenv('PEXELS_API_KEY', '')

if not OPENAI_API_KEY:
    app.logger.warning('OPENAI_API_KEY / DEEPSEEK_API_KEY is not set. Remote calls will fail.')

client = OpenAI(
    api_key=OPENAI_API_KEY,
    base_url=OPENAI_BASE_URL
)

# RAG 引擎（初始化在 data/rag_store 目录）
RAG_DATA_DIR = os.getenv('RAG_DATA_DIR', os.path.join(os.path.dirname(__file__), 'data', 'rag_store'))
rag_engine = RagEngine(data_dir=RAG_DATA_DIR)


@app.route('/api/config', methods=['GET'])
def get_config():
    return jsonify({
        'openai_base_url': OPENAI_BASE_URL,
        'default_model': DEFAULT_MODEL
    })


@app.route('/api/text-proxy', methods=['POST'])
def text_proxy():
    """通用文本代理，供语音对话等功能复用"""
    data = request.get_json() or {}
    prompt = data.get('prompt', '')
    model = data.get('model') or DEFAULT_MODEL
    max_tokens = int(data.get('max_tokens', 400))
    temperature = float(data.get('temperature', 0.7))

    if not prompt:
        return jsonify({'error': 'prompt is required'}), 400
    if not OPENAI_API_KEY:
        return jsonify({'error': 'missing API key'}), 500

    try:
        response = client.chat.completions.create(
            model=model,
            messages=[{'role': 'user', 'content': prompt}],
            max_tokens=max_tokens,
            temperature=temperature
        )
        return jsonify({
            'status_code': 200,
            'provider_response': response.to_dict()
        })
    except Exception as e:
        app.logger.exception('text-proxy failed')
        return jsonify({'error': str(e)}), 502


@app.route('/api/chat', methods=['POST'])
def chat():
    """多轮对话端点，接收历史消息和系统提示词"""
    data = request.get_json() or {}
    messages = data.get('messages', [])
    system_prompt = data.get('system', '')

    if not messages or not isinstance(messages, list):
        return jsonify({'error': 'messages array is required'}), 400
    if not OPENAI_API_KEY:
        return jsonify({'error': 'server missing API key'}), 500

    full_messages = []
    if system_prompt:
        full_messages.append({'role': 'system', 'content': system_prompt})
    for msg in messages[-100:]:  # 最多保留 100 条历史（约 50 轮对话）
        if isinstance(msg, dict) and msg.get('role') and msg.get('content'):
            full_messages.append({'role': msg['role'], 'content': msg['content']})

    try:
        response = client.chat.completions.create(
            model=DEFAULT_MODEL,
            messages=full_messages,
            max_tokens=300,
            temperature=0.8
        )
        return jsonify({
            'text': response.choices[0].message.content or '',
            'status_code': 200
        })
    except Exception as e:
        app.logger.exception('chat failed')
        return jsonify({'error': str(e)}), 502


@app.route('/api/generate-words', methods=['POST'])
@app.route('/api/generate-words', methods=['POST'])
def generate_words():
    """使用 AI 为指定场景生成词汇"""
    data = request.get_json() or {}
    context = data.get('context', '')
    count = int(data.get('count', 6))
    difficulty = data.get('difficulty', 'intermediate')

    if not context:
        return jsonify({'error': 'context is required'}), 400
    if not OPENAI_API_KEY:
        return jsonify({'error': 'server missing API key'}), 500

    count = max(1, min(count, 20))

    difficulty_desc = {'basic': '初级（常见简单词）', 'intermediate': '中级（日常使用）', 'advanced': '高级（学术/专业）'}
    difficulty_text = difficulty_desc.get(difficulty, '中级（日常使用）')

    prompt = f"""你是一个英语词汇助手。请为以下场景生成 {count} 个{difficulty_text}的英语词汇。

场景：{context}

要求：
- 每个词必须是真实的英语单词，与场景强相关
- 返回纯粹的 JSON 数组，不要 Markdown 包裹，不要多余文字
- 格式：[{{"term": "单词", "meaning": "中文释义", "example": "英语例句", "note": "简短记忆提示"}}]
"""

    try:
        response = client.chat.completions.create(
            model=DEFAULT_MODEL,
            messages=[{'role': 'user', 'content': prompt}],
            max_tokens=2000,
            temperature=0.8
        )

        raw_text = response.choices[0].message.content or ''
        cleaned = raw_text.strip()
        if cleaned.startswith('```'):
            cleaned = cleaned.split('\n', 1)[-1]
            cleaned = cleaned.rsplit('```', 1)[0].strip()
        words = json.loads(cleaned)

        return jsonify({'words': words, 'count': len(words)})
    except json.JSONDecodeError as e:
        app.logger.exception('failed to parse AI response')
        return jsonify({'error': 'failed to parse AI response', 'detail': str(e), 'raw': raw_text}), 502
    except Exception as e:
        app.logger.exception('generate-words request failed')
        return jsonify({'error': str(e)}), 502


@app.route('/api/complete-word', methods=['POST'])
def complete_word():
    """AI 补全单词的释义、例句和记忆提示"""
    data = request.get_json() or {}
    term = data.get('term', '').strip()
    context = data.get('context', '').strip()

    if not term:
        return jsonify({'error': 'term is required'}), 400
    if not OPENAI_API_KEY:
        return jsonify({'error': 'server missing API key'}), 500

    prompt = f"""You are an English vocabulary assistant. Provide info for the word "{term}" (context: {context or 'General'}).

Return a JSON object:
{{"meaning": "中文释义", "example": "English example sentence using this word", "note": "中文记忆提示"}}
"""

    try:
        response = client.chat.completions.create(
            model=DEFAULT_MODEL,
            messages=[{'role': 'user', 'content': prompt}],
            response_format={'type': 'json_object'},
            max_tokens=300,
            temperature=0.3
        )

        raw = response.choices[0].message.content or ''
        cleaned = raw.strip()
        if cleaned.startswith('```'):
            cleaned = cleaned.split('\n', 1)[-1]
            cleaned = cleaned.rsplit('```', 1)[0].strip()
        if not cleaned:
            raise ValueError('empty AI response')
        result = json.loads(cleaned)

        return jsonify({
            'meaning': result.get('meaning', ''),
            'example': result.get('example', ''),
            'note': result.get('note', '')
        })
    except Exception as e:
        app.logger.exception('complete-word failed')
        return jsonify({'meaning': term, 'example': '', 'note': ''})


@app.route('/api/generate-reading', methods=['POST'])
def generate_reading():
    """AI 根据词表中的单词生成一段短文"""
    data = request.get_json() or {}
    words = data.get('words', [])
    context = data.get('context', '')
    target_language = data.get('language', 'en')

    if not words or not isinstance(words, list) or len(words) == 0:
        return jsonify({'error': 'words array is required'}), 400
    if not OPENAI_API_KEY:
        return jsonify({'error': 'server missing API key'}), 500

    word_list = ', '.join(w.get('term', w) if isinstance(w, dict) else w for w in words)
    word_count = len(words)
    app.logger.info(f'generate-reading: {word_count} words, context="{context}"')

    prompt = f"""You are a language learning assistant. Write a short passage in {target_language} (about {word_count * 15} words) that naturally includes ALL of the following vocabulary words: {word_list}.

Context: {context or 'General'}

Requirements:
- Every vocabulary word must appear at least once
- The passage should be natural and coherent
- Return ONLY the passage text, no extra explanation
- Make it suitable for language learners"""

    try:
        response = client.chat.completions.create(
            model=DEFAULT_MODEL,
            messages=[{'role': 'user', 'content': prompt}],
            max_tokens=1500,
            temperature=0.8
        )

        passage = response.choices[0].message.content or ''
        app.logger.info(f'generate-reading OK: {len(passage)} chars, first 60: {passage[:60]}')

        return jsonify({
            'passage': passage.strip(),
            'word_count': word_count
        })
    except Exception as e:
        app.logger.exception('generate-reading failed')
        app.logger.error(f'generate-reading error detail: {str(e)}')
        return jsonify({'error': str(e)}), 502


@app.route('/api/find-image', methods=['POST'])
def find_image():
    """从 Pexels 搜索与查询相关的图片"""
    data = request.get_json() or {}
    query = data.get('query', '').strip()

    if not query:
        return jsonify({'error': 'query is required'}), 400
    if not PEXELS_API_KEY:
        return jsonify({'error': 'PEXELS_API_KEY not configured', 'hint': 'Set PEXELS_API_KEY in .env'}), 501

    try:
        import requests as req
        resp = req.get(
            'https://api.pexels.com/v1/search',
            headers={'Authorization': PEXELS_API_KEY},
            params={'query': query, 'per_page': 5, 'locale': 'en-US'},
            timeout=8
        )
        if not resp.ok:
            return jsonify({'error': 'Pexels API error', 'detail': resp.text}), 502

        data = resp.json()
        photos = data.get('photos', [])
        if not photos:
            return jsonify({'error': 'no photos found'}), 404

        import random
        photo = random.choice(photos)
        src = photo.get('src', {})
        return jsonify({
            'url': src.get('medium', src.get('original', '')),
            'alt': photo.get('alt', query),
            'photographer': photo.get('photographer', ''),
            'photographer_url': photo.get('photographer_url', ''),
            'source': 'pexels'
        })
    except Exception as e:
        app.logger.exception('find-image failed')
        return jsonify({'error': str(e)}), 502


@app.route('/api/generate-quiz-extra', methods=['POST'])
def generate_quiz_extra():
    """AI 根据词表单词生成额外综合题"""
    data = request.get_json() or {}
    words = data.get('words', [])
    context = data.get('context', '')

    if not words or not isinstance(words, list) or len(words) == 0:
        return jsonify({'error': 'words array is required'}), 400
    if not OPENAI_API_KEY:
        return jsonify({'error': 'server missing API key'}), 500

    term_list = []
    for w in words:
        if isinstance(w, dict):
            term_list.append(f"{w.get('term','')}: {w.get('meaning','')}")
        else:
            term_list.append(str(w))

    prompt = f"""Generate exactly 1 cloze question using these words: {', '.join(term_list)}
Context: {context}

Respond with EXACTLY this format (no extra text):
WORD: <correct word>
SENTENCE: <English sentence with ___ for the blank>
OPTIONS: <option1>|<option2>|<option3>|<option4>
NOTE: <why this word fits>
"""
    try:
        questions = []
        for i in range(3):
            try:
                response = client.chat.completions.create(
                    model=DEFAULT_MODEL,
                    messages=[{'role': 'user', 'content': prompt}],
                    max_tokens=300,
                    temperature=0.7
                )
                raw = (response.choices[0].message.content or '').strip()
                lines = raw.split('\n')
                q = {}
                for line in lines:
                    if line.startswith('WORD:'):
                        q['term'] = line[5:].strip()
                    elif line.startswith('SENTENCE:'):
                        q['questionText'] = line[9:].strip()
                    elif line.startswith('OPTIONS:'):
                        parts = line[8:].strip().split('|')
                        q['options'] = [p.strip() for p in parts if p.strip()]
                    elif line.startswith('NOTE:'):
                        q['note'] = line[5:].strip()
                if q.get('term') and q.get('questionText') and len(q.get('options', [])) == 4:
                    q['type'] = 'cloze'
                    q['correctMeaning'] = q['term']
                    q['example'] = q['questionText'].replace('___', q['term'])
                    q['contextNote'] = '选择适合空格的单词'
                    questions.append(q)
            except Exception:
                continue

        return jsonify({'questions': questions, 'count': len(questions)})
    except Exception as e:
        app.logger.exception('generate-quiz-extra failed')
        return jsonify({'questions': [], 'count': 0}), 200


# ================================================================== #
#  RAG 相关路由
# ================================================================== #

@app.route('/api/rag/upload-pdf', methods=['POST'])
def rag_upload_pdf():
    """上传 PDF 文件，切片并存入向量存储"""
    if 'file' not in request.files:
        return jsonify({'error': '缺少 file 字段'}), 400

    file = request.files['file']
    if not file or not file.filename:
        return jsonify({'error': '文件为空'}), 400

    if not file.filename.lower().endswith('.pdf'):
        return jsonify({'error': '仅支持 PDF 文件'}), 400

    try:
        file_bytes = file.read()
        result = rag_engine.ingest_pdf(file_bytes, filename=file.filename)
        return jsonify(result)
    except Exception as e:
        app.logger.exception('rag upload-pdf failed')
        return jsonify({'error': str(e)}), 502


@app.route('/api/rag/search', methods=['POST'])
def rag_search():
    """文本检索 — 在已导入的 PDF 资料中查找相关内容"""
    data = request.get_json() or {}
    query = data.get('query', '').strip()
    top_k = int(data.get('top_k', 5))

    if not query:
        return jsonify({'error': 'query is required'}), 400

    try:
        results = rag_engine.search(query, top_k=top_k)
        return jsonify({'results': results, 'count': len(results)})
    except Exception as e:
        app.logger.exception('rag search failed')
        return jsonify({'error': str(e)}), 502


@app.route('/api/rag/context', methods=['POST'])
def rag_context():
    """检索并返回可直接拼入 prompt 的上下文字符串"""
    data = request.get_json() or {}
    query = data.get('query', '').strip()
    top_k = int(data.get('top_k', 3))
    max_chars = int(data.get('max_chars', 1500))

    if not query:
        return jsonify({'error': 'query is required'}), 400

    try:
        context = rag_engine.search_with_prompt(query, top_k=top_k, max_chars=max_chars)
        return jsonify({'context': context, 'has_context': bool(context)})
    except Exception as e:
        app.logger.exception('rag context failed')
        return jsonify({'error': str(e)}), 502


@app.route('/api/rag/stats', methods=['GET'])
def rag_stats():
    """查看 RAG 知识库状态"""
    return jsonify(rag_engine.stats)


@app.route('/api/rag/clear', methods=['POST'])
def rag_clear():
    """清空 RAG 知识库"""
    rag_engine.clear()
    return jsonify({'ok': True})


@app.route('/api/rag/extract-words', methods=['POST'])
def rag_extract_words():
    """从已上传的 PDF 资料中提取重要英语词汇"""
    if rag_engine.store.count == 0:
        return jsonify({'error': 'RAG 知识库为空，请先上传 PDF'}), 400

    if not OPENAI_API_KEY:
        return jsonify({'error': 'server missing API key'}), 500

    try:
        text = rag_engine.get_all_texts_for_extraction(max_chars=8000)
        if not text:
            return jsonify({'error': '知识库中没有可提取的文本'}), 400

        prompt = f'''Extract 10 important English vocabulary words from the following learning material.

For each word, provide:
- term: the word itself
- meaning: 中文释义 (Chinese definition)
- example: the original sentence from the material where this word appears (exact quote)
- note: 记忆提示 (memory tip in Chinese)

Output as a JSON object with a "words" array.

Material:
{text[:6000]}'''

        import re
        response = client.chat.completions.create(
            model=DEFAULT_MODEL,
            messages=[{'role': 'user', 'content': prompt}],
            response_format={'type': 'json_object'},
            max_tokens=2500,
            temperature=0.3
        )

        raw = (response.choices[0].message.content or '').strip()
        # 处理模型可能包裹的 markdown
        if raw.startswith('```'):
            raw = raw.split('\n', 1)[-1]
            raw = raw.rsplit('```', 1)[0].strip()

        parsed = json.loads(raw)
        words = parsed.get('words', []) if isinstance(parsed, dict) else []
        if isinstance(parsed, list):
            words = parsed

        if not words:
            return jsonify({'error': 'AI 未能提取出有效单词，请检查 PDF 内容'}), 502

        return jsonify({'words': words, 'count': len(words)})
    except json.JSONDecodeError as e:
        return jsonify({'error': 'AI 返回格式异常，请重试'}), 502
    except Exception as e:
        app.logger.exception('extract-words failed')
        return jsonify({'error': str(e)}), 502


if __name__ == '__main__':
    port = int(os.getenv('PORT', 5001))
    app.run(host='0.0.0.0', port=port, debug=(os.getenv('FLASK_ENV') == 'development'))
