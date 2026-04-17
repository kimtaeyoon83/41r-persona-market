# persona-engine Dockerfile — Python 3.11 + Chromium for browser mode
FROM python:3.11-slim

# System deps for playwright chromium
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget gnupg ca-certificates fonts-noto-cjk fonts-liberation \
    libasound2 libatk-bridge2.0-0 libatk1.0-0 libcups2 libdbus-1-3 \
    libdrm2 libgbm1 libgtk-3-0 libnspr4 libnss3 libx11-xcb1 libxcomposite1 \
    libxdamage1 libxfixes3 libxrandr2 libxkbcommon0 libxshmfence1 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install persona-engine deps. In Railway deploy, swap the persona_agent
# dep in pyproject.toml to the git+ssh form (or pre-install a wheel)
# because the monorepo file:// path doesn't exist in the container.
COPY pyproject.toml ./
RUN pip install --no-cache-dir -e .

# Install playwright chromium
RUN python -m playwright install --with-deps chromium

# Copy source
COPY . /app

ENV PYTHONUNBUFFERED=1
ENV PORT=4200
ENV PERSONA_ENGINE_WORKSPACE=/var/persona_jobs
RUN mkdir -p /var/persona_jobs

EXPOSE 4200
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "4200"]
