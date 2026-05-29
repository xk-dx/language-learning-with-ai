"""RAG 引擎 — 整合 Embedder + VectorStore + PdfProcessor"""

import json
import logging
import os
import time
from typing import List, Optional

from .embedder import Embedder
from .pdf_processor import PdfProcessor
from .vector_store import VectorStore

logger = logging.getLogger(__name__)


class RagEngine:
    """RAG 顶层封装，提供一站式 PDF 导入、检索接口"""

    def __init__(self, client=None, data_dir: str = 'data/rag_store',
                 embedding_model: str = 'all-MiniLM-L6-v2'):
        self.embedder = Embedder(model=embedding_model)
        self.store = VectorStore(data_dir)
        self.pdf_processor = PdfProcessor()
        self._data_dir = data_dir

        # 文件上传历史
        self._files_path = os.path.join(data_dir, 'files.json')
        self._files: List[dict] = []
        self._load_files()

    def _load_files(self):
        if os.path.exists(self._files_path):
            try:
                with open(self._files_path, 'r', encoding='utf-8') as f:
                    self._files = json.load(f)
            except Exception:
                self._files = []

    def _save_files(self):
        try:
            with open(self._files_path, 'w', encoding='utf-8') as f:
                json.dump(self._files, f, ensure_ascii=False, indent=2)
        except Exception as e:
            logger.exception(f'save files.json failed: {e}')

    # ------------------------------------------------------------------ #
    # PDF 导入
    # ------------------------------------------------------------------ #

    def ingest_pdf(self, file_bytes: bytes, filename: str = '') -> dict:
        """处理 PDF 文件，切片 → 向量化 → 存入向量存储"""
        chunks = self.pdf_processor.extract_chunks(file_bytes, filename=filename)
        if not chunks:
            return {'chunks': 0, 'error': '未能从 PDF 提取到有效文本'}

        texts = [c['text'] for c in chunks]
        metadatas = [c['metadata'] for c in chunks]

        logger.info(f'Embedding {len(texts)} chunks...')
        vectors = self.embedder.embed_batch(texts)

        self.store.add_with_vectors(texts, vectors, metadatas)

        # 记录文件
        file_info = {
            'filename': filename or 'uploaded.pdf',
            'chunks': len(chunks),
                'pages': max(m.get('page', 0) for m in metadatas) if metadatas else 0,
            'uploaded_at': time.strftime('%Y-%m-%d %H:%M:%S')
        }
        self._files.append(file_info)
        self._save_files()

        return {
            'chunks': len(chunks),
            'filename': filename or 'uploaded.pdf'
        }

    # ------------------------------------------------------------------ #
    # 检索
    # ------------------------------------------------------------------ #

    def search(self, query: str, top_k: int = 5) -> List[dict]:
        """文本查询 → embedding → 向量检索"""
        if self.store.count == 0:
            return []

        query_vec = self.embedder.embed(query)
        return self.store.search(query_vec, top_k=top_k)

    def search_with_prompt(self, query: str, top_k: int = 3,
                           max_chars: int = 1500) -> str:
        """
        检索相关文本，拼接成一段可直接注入 prompt 的上下文字符串。
        如果无结果返回空字符串。
        """
        results = self.search(query, top_k=top_k)
        if not results:
            return ''

        parts = []
        char_count = 0
        for r in results:
            snippet = f"[来源: 第{r['metadata'].get('page','?')}页] {r['text']}"
            if char_count + len(snippet) > max_chars:
                break
            parts.append(snippet)
            char_count += len(snippet)

        context = '\n\n'.join(parts)
        return f"以下是从学习资料中检索到的相关段落：\n\n{context}"

    # ------------------------------------------------------------------ #
    # 管理
    # ------------------------------------------------------------------ #

    @property
    def stats(self) -> dict:
        return {
            'chunks': self.store.count,
            'files': self._files
        }

    def clear(self):
        self.store.clear()
        self._files = []
        self._save_files()

    # ------------------------------------------------------------------ #
    # 词汇提取
    # ------------------------------------------------------------------ #

    def get_all_texts_for_extraction(self, max_chars: int = 8000) -> str:
        """
        从向量存储中取出所有文本，拼接成一段连续文本，
        供 LLM 提取重要词汇。限制 max_chars 避免 token 超限。
        """
        texts = self.store.get_all_texts()
        if not texts:
            return ''

        result = []
        total = 0
        for t in texts:
            if total + len(t) > max_chars:
                break
            result.append(t)
            total += len(t)
        return '\n\n'.join(result)
        self._files = []
        self._save_files()
