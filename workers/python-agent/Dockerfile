FROM python:3.12-slim

WORKDIR /app

# System deps:
#   - libreoffice + libreoffice-impress: PPTX → PDF conversion
#   - poppler-utils: pdf2image (PDF → per-page PNGs)
#   - tesseract-ocr: pytesseract (OCR text inside diagram/screenshot images)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    libreoffice \
    libreoffice-impress \
    poppler-utils \
    tesseract-ocr \
    && rm -rf /var/lib/apt/lists/*

ENV LIBREOFFICE_PATH=/usr/bin/soffice

COPY workers/python-agent/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download Find models (BGE base + CLIP ViT-B-32) so first request
# after pod start doesn't block on a 600 MB download.
ENV HF_HOME=/root/.cache/huggingface
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('BAAI/bge-base-en-v1.5')"
RUN python -c "import open_clip; open_clip.create_model_and_transforms('ViT-B-32', pretrained='laion2b_s34b_b79k')"

COPY workers/python-agent/ .

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
