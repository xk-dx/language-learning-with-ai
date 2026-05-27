"""PDF 解析 + 切片工具"""

import logging
import os
import tempfile
from typing import List, Tuple

logger = logging.getLogger(__name__)


class PdfProcessor:
    """将 PDF 按页+段落切片，返回可向量化的文本块"""

    CHUNK_MIN_CHARS = 50      # 少于该字符数的块会被丢弃
    CHUNK_MAX_CHARS = 800     # 超过此长度会进一步拆分

    @staticmethod
    def extract_chunks(file_bytes: bytes, filename: str = '') -> List[dict]:
        """
        从 PDF 字节数据中提取文本块。

        返回:
            [{text, metadata: {source, page, chunk_index}}, ...]
        """
        try:
            import fitz  # PyMuPDF
        except ImportError:
            raise ImportError('请安装 PyMuPDF: pip install pymupdf')

        chunks: List[dict] = []
        # 用临时文件保存 PDF
        suffix = '.pdf'
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(file_bytes)
            tmp_path = tmp.name

        try:
            doc = fitz.open(tmp_path)
            for page_num in range(len(doc)):
                page = doc[page_num]
                blocks = page.get_text('blocks')  # [(x0,y0,x1,y1,text,block_no,block_type), ...]

                for block in blocks:
                    text = block[4].strip() if len(block) > 4 else ''
                    if not text or len(text) < PdfProcessor.CHUNK_MIN_CHARS:
                        continue

                    # 如果块太长，按句子拆分
                    if len(text) > PdfProcessor.CHUNK_MAX_CHARS:
                        sub_chunks = PdfProcessor._split_sentences(text)
                        for i, sub in enumerate(sub_chunks):
                            if len(sub) >= PdfProcessor.CHUNK_MIN_CHARS:
                                chunks.append({
                                    'text': sub,
                                    'metadata': {
                                        'source': filename or tmp_path,
                                        'page': page_num + 1,
                                        'chunk_index': len(chunks)
                                    }
                                })
                    else:
                        chunks.append({
                            'text': text,
                            'metadata': {
                                'source': filename or tmp_path,
                                'page': page_num + 1,
                                'chunk_index': len(chunks)
                            }
                        })

            page_count = len(doc)
            doc.close()
            logger.info(f'PDF processed: {len(chunks)} chunks from {page_count} pages')
        except Exception as e:
            logger.exception(f'PDF processing failed: {e}')
            raise
        finally:
            try:
                os.unlink(tmp_path)
            except Exception:
                pass

        return chunks

    @staticmethod
    def _split_sentences(text: str) -> List[str]:
        """按句子边界拆分长文本"""
        import re
        # 匹配句号、问号、感叹号、换行
        parts = re.split(r'(?<=[.?!])\s+', text)
        merged = []
        buf = ''
        for part in parts:
            if len(buf) + len(part) < PdfProcessor.CHUNK_MAX_CHARS:
                buf = (buf + ' ' + part).strip()
            else:
                if buf:
                    merged.append(buf)
                buf = part
        if buf:
            merged.append(buf)
        return merged if merged else [text]
