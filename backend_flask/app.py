from flask import Flask, request, jsonify
import os
import json
from dotenv import load_dotenv
from flask_cors import CORS
from openai import OpenAI

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


@app.route('/api/config', methods=['GET'])
def get_config():
    return jsonify({
        'openai_base_url': OPENAI_BASE_URL,
        'default_model': DEFAULT_MODEL
    })


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

    prompt = f"""你是一个英语词汇助手。请为单词 "{term}" 提供以下信息（场景：{context or '通用'})。

返回纯 JSON，不要 Markdown 包裹：
{{"meaning": "中文释义", "example": "包含该词的英语例句", "note": "简短记忆提示"}}
"""

    try:
        response = client.chat.completions.create(
            model=DEFAULT_MODEL,
            messages=[{'role': 'user', 'content': prompt}],
            max_tokens=300,
            temperature=0.5
        )

        raw = response.choices[0].message.content or ''
        cleaned = raw.strip()
        if cleaned.startswith('```'):
            cleaned = cleaned.split('\n', 1)[-1]
            cleaned = cleaned.rsplit('```', 1)[0].strip()
        result = json.loads(cleaned)

        return jsonify({
            'meaning': result.get('meaning', ''),
            'example': result.get('example', ''),
            'note': result.get('note', '')
        })
    except Exception as e:
        app.logger.exception('complete-word failed')
        return jsonify({'error': str(e)}), 502


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

    prompt = f"""Create 3 English cloze questions using these words: {', '.join(term_list)}

Context: {context}

Each question: write an English sentence with a blank ___, and list 4 word options (one correct answer from the list, 3 distractors from the list).

Return ONLY this JSON format (no markdown, no extra text):
[{{"type": "cloze", "term": "correct word", "correctMeaning": "its meaning", "options": ["opt1","opt2","opt3","opt4"], "note": "explanation", "example": "the full sentence", "questionText": "sentence with ___"}}]
"""
    try:
        response = client.chat.completions.create(
            model=DEFAULT_MODEL,
            messages=[{'role': 'user', 'content': prompt}],
            max_tokens=1200,
            temperature=0.7
        )

        raw = (response.choices[0].message.content or '').strip()
        app.logger.info(f'quiz-extra raw: "{raw[:200]}"')
        if not raw:
            return jsonify({'questions': [], 'count': 0})

        # Remove markdown code fences if present
        if raw.startswith('```'):
            raw = raw.split('\n', 1)[-1]
            raw = raw.rsplit('```', 1)[0].strip()
        extra = json.loads(raw)
        if not isinstance(extra, list):
            extra = [extra]
        return jsonify({'questions': extra, 'count': len(extra)})
    except json.JSONDecodeError as e:
        app.logger.exception('quiz-extra JSON parse failed')
        return jsonify({'questions': [], 'count': 0, 'raw': raw[:300]}), 200
    except Exception as e:
        app.logger.exception('quiz-extra failed')
        return jsonify({'questions': [], 'count': 0}), 200


if __name__ == '__main__':
    port = int(os.getenv('PORT', 5001))
    app.run(host='0.0.0.0', port=port, debug=(os.getenv('FLASK_ENV') == 'development'))
