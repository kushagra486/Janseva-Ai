# Build from the repository root so the curated corpus in data/ is included:
#   docker build -f apps/ai-service/Dockerfile -t janseva-ai-service .
# Hugging Face Spaces (Docker) expects the app on port 7860.
FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      tesseract-ocr tesseract-ocr-hin tesseract-ocr-eng libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

RUN useradd -m -u 1000 app
WORKDIR /srv
COPY apps/ai-service/requirements.txt apps/ai-service/requirements-ocr.txt ./
RUN pip install --no-cache-dir -r requirements.txt -r requirements-ocr.txt

COPY apps/ai-service/app ./app
COPY data ./data
ENV DATA_DIR=/srv/data PORT=7860
USER app
EXPOSE 7860
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
