"""轻量向量存储 — JSON + NumPy，无外部数据库依赖"""

import json
import logging
import os
from typing import Dict, List, Optional, Tuple

import numpy as np

logger = logging.getLogger(__name__)


class VectorStore:
    """
    纯文件向量存储，用 NumPy 做 cosine similarity 检索。

    文件结构:
      data_dir/
        docs.json    # [{id, text, metadata}, ...]
        vectors.npy  # shape (N, D) 的 float32 矩阵，行顺序与 docs.json 一致
    """

    def __init__(self, data_dir: str):
        self._data_dir = data_dir
        os.makedirs(data_dir, exist_ok=True)

        self._docs_path = os.path.join(data_dir, 'docs.json')
        self._vecs_path = os.path.join(data_dir, 'vectors.npy')

        self._docs: List[Dict] = []
        self._vectors: Optional[np.ndarray] = None
        self._dirty = False

        self._load()

    # ------------------------------------------------------------------ #
    # 公共接口
    # ------------------------------------------------------------------ #

    @property
    def count(self) -> int:
        return len(self._docs)

    def add(self, texts: List[str], metadatas: Optional[List[Dict]] = None):
        """添加文本及其元数据，自动保存"""
        if not texts:
            return

        if metadatas is None:
            metadatas = [{} for _ in texts]

        assert len(texts) == len(metadatas), 'texts 和 metadatas 长度必须一致'

        # 向量化
        from .embedder import Embedder  # 延迟导入避免循环
        # 注意：embedder 需从外部传入，这里只做存储
        # 实际向量化在 RAGEngine 中完成

        for text, meta in zip(texts, metadatas):
            self._docs.append({
                'id': meta.get('id', f'doc_{self.count}_{hash(text) & 0xFFFFFFFF}'),
                'text': text,
                'metadata': meta
            })
        self._dirty = True

    def add_with_vectors(self, texts: List[str], vectors: List[List[float]],
                         metadatas: Optional[List[Dict]] = None):
        """直接添加文本 + 已有向量（由外部生成）"""
        if not texts:
            return
        if metadatas is None:
            metadatas = [{} for _ in texts]

        new_vecs = np.array(vectors, dtype=np.float32)
        for text, meta in zip(texts, metadatas):
            self._docs.append({
                'id': meta.get('id', f'doc_{self.count}_{hash(text) & 0xFFFFFFFF}'),
                'text': text,
                'metadata': meta
            })

        if self._vectors is None:
            self._vectors = new_vecs
        else:
            self._vectors = np.vstack([self._vectors, new_vecs])

        self._dirty = True
        self._save()

    def search(self, query_vec: List[float], top_k: int = 5) -> List[Dict]:
        """余弦相似度检索，返回 [{id, text, metadata, score}, ...]"""
        if self._vectors is None or self._vectors.shape[0] == 0:
            return []

        q = np.array(query_vec, dtype=np.float32).reshape(1, -1)

        # 归一化 -> cosine similarity = dot product
        q_norm = q / (np.linalg.norm(q, axis=1, keepdims=True) + 1e-12)
        v_norm = self._vectors / (np.linalg.norm(self._vectors, axis=1, keepdims=True) + 1e-12)

        scores = np.dot(q_norm, v_norm.T)[0]  # shape (N,)

        top_indices = np.argsort(scores)[-top_k:][::-1]

        results = []
        for idx in top_indices:
            if scores[idx] < 0.1:
                continue  # 太低的分数跳过
            doc = self._docs[idx]
            results.append({
                'id': doc['id'],
                'text': doc['text'],
                'metadata': doc['metadata'],
                'score': float(round(scores[idx], 4))
            })
        return results

    def remove(self, doc_id: str) -> bool:
        """按 id 删除文档"""
        for i, doc in enumerate(self._docs):
            if doc['id'] == doc_id:
                self._docs.pop(i)
                if self._vectors is not None:
                    self._vectors = np.delete(self._vectors, i, axis=0)
                self._dirty = True
                self._save()
                return True
        return False

    def clear(self):
        """清空所有数据"""
        self._docs = []
        self._vectors = None
        self._dirty = True
        self._save()

    def get_all_texts(self) -> List[str]:
        return [d['text'] for d in self._docs]

    def get_all_metadatas(self) -> List[Dict]:
        return [d['metadata'] for d in self._docs]

    # ------------------------------------------------------------------ #
    # 内部：持久化
    # ------------------------------------------------------------------ #

    def _load(self):
        if os.path.exists(self._docs_path):
            try:
                with open(self._docs_path, 'r', encoding='utf-8') as f:
                    self._docs = json.load(f)
            except Exception:
                logger.warning('failed to load docs.json, starting fresh')
                self._docs = []

        if os.path.exists(self._vecs_path):
            try:
                self._vectors = np.load(self._vecs_path)
                # 一致性校验
                if self._vectors.shape[0] != len(self._docs):
                    logger.warning('vectors.npy 数量与 docs.json 不一致，重置')
                    self._vectors = None
                    self._docs = []
            except Exception:
                logger.warning('failed to load vectors.npy, starting fresh')
                self._vectors = None

        logger.info(f'VectorStore loaded: {len(self._docs)} docs')

    def _save(self):
        if not self._dirty:
            return
        try:
            with open(self._docs_path, 'w', encoding='utf-8') as f:
                json.dump(self._docs, f, ensure_ascii=False, indent=2)
            if self._vectors is not None:
                np.save(self._vecs_path, self._vectors)
            self._dirty = False
            logger.info(f'VectorStore saved: {len(self._docs)} docs')
        except Exception as e:
            logger.exception(f'VectorStore save failed: {e}')
