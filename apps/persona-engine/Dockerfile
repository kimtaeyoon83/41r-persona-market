# persona-engine Dockerfile — Python 3.11 + Chromium for browser mode
#
# Build context is the repo ROOT (set by railway.toml's dockerfilePath).
# So all COPY paths are relative to the repo root, not this file's dir.
FROM python:3.11-slim

# System deps for playwright chromium
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget gnupg ca-certificates fonts-noto-cjk fonts-liberation \
    libasound2 libatk-bridge2.0-0 libatk1.0-0 libcups2 libdbus-1-3 \
    libdrm2 libgbm1 libgtk-3-0 libnspr4 libnss3 libx11-xcb1 libxcomposite1 \
    libxdamage1 libxfixes3 libxrandr2 libxkbcommon0 libxshmfence1 \
    git \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# persona_agent lives in a sibling public repo. Install from git so pip
# considers the dep satisfied when persona-engine's pyproject.toml is
# processed (whose file:// path is only valid on the author's laptop).
ARG PERSONA_AGENT_REF=main
RUN pip install --no-cache-dir \
    "persona_agent[browser,analysis,benchmark] @ git+https://github.com/kimtaeyoon83/41r-advisor.git@${PERSONA_AGENT_REF}#subdirectory=persona_agent"

# persona-engine's pyproject — strip the broken file:// line before installing
COPY apps/persona-engine/pyproject.toml ./
RUN sed -i '/persona_agent\[/d' pyproject.toml \
 && pip install --no-cache-dir -e .

# Install playwright chromium for browser-mode runs
RUN python -m playwright install --with-deps chromium

# Copy persona-engine source
COPY apps/persona-engine /app

ENV PYTHONUNBUFFERED=1
ENV PORT=4200
ENV PERSONA_ENGINE_WORKSPACE=/var/persona_jobs
RUN mkdir -p /var/persona_jobs

EXPOSE 4200
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "4200"]
