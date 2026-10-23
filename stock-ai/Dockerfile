FROM python:3.11-slim

WORKDIR /app

# Install system dependencies (OpenMP for LightGBM/XGBoost, curl)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libgomp1 \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip setuptools wheel && \
    pip install --no-cache-dir -r requirements.txt

# Copy stock-ai source code and pre-trained models
COPY . /app

# Hugging Face Spaces and standard cloud containers default to port 7860
EXPOSE 7860
ENV PORT=7860
ENV PYTHONUNBUFFERED=1

CMD ["python", "app.py"]
