"""Embedding 生成封装 — 使用本地 sentence-transformers（无需 API）"""

import logging
from typing import List, Optional

logger = logging.getLogger(__name__)

# 全局共享模型实例（避免每次重新加载）
_model_instance = None


def _get_model(model_name: str = 'all-MiniLM-L6-v2'):
    """懒加载 sentence-transformers 模型"""
    global _model_instance
    if _model_instance is None:
        from sentence_transformers import SentenceTransformer
        logger.info(f'Loading embedding model: {model_name}...')
        _model_instance = SentenceTransformer(model_name)
        logger.info('Embedding model loaded')
    return _model_instance


class Embedder:
    """
    本地 embedding 生成，使用 sentence-transformers。

    默认使用 all-MiniLM-L6-v2（384 维，~80MB），
    对英语学习资料的语义区分足够好。完全离线运行，零 API 成本。
    """

    def __init__(self, client=None, model: str = 'all-MiniLM-L6-v2'):
        """
        Args:
            client: 兼容参数，不使用（之前为 OpenAI client）
            model: sentence-transformers 模型名
        """
        self._model_name = model

    @property
    def model(self) -> str:
        return self._model_name

    def embed(self, text: str) -> List[float]:
        """为单段文本生成向量"""
        model = _get_model(self._model_name)
        return model.encode(text, normalize_embeddings=True).tolist()

    def embed_batch(self, texts: List[str]) -> List[List[float]]:
        """为一批文本生成向量"""
        if not texts:
            return []

        # 过滤空文本
        valid = [(i, t) for i, t in enumerate(texts) if t and t.strip()]
        if not valid:
            return [[] for _ in texts]

        indices, clean_texts = zip(*valid)

        try:
            model = _get_model(self._model_name)
            embeddings = model.encode(
                list(clean_texts),
                normalize_embeddings=True,
                show_progress_bar=False
            )

            result = [None] * len(texts)
            for idx, emb in zip(indices, embeddings):
                result[idx] = emb.tolist()
            return result
        except Exception as e:
            logger.exception(f'embedding failed for {len(texts)} texts')
            raise
