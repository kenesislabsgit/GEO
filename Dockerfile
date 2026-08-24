# Container setup for GEO (Next.js + Python Engine)
FROM node:22-slim

# Install Python 3 and pip
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 1. Install Python dependencies
COPY GEO/requirements.txt ./GEO/requirements.txt
RUN pip3 install --no-cache-dir -r ./GEO/requirements.txt --break-system-packages || \
    pip3 install --no-cache-dir -r ./GEO/requirements.txt

# 2. Install Node dependencies
COPY frontend/ranking/package.json frontend/ranking/package-lock.json ./frontend/ranking/
WORKDIR /app/frontend/ranking
RUN npm install

# 3. Copy application files
WORKDIR /app
COPY GEO ./GEO
COPY frontend/ranking ./frontend/ranking

# 4. Build Next.js web application
WORKDIR /app/frontend/ranking
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATABASE_URL="postgres://postgres:postgres@localhost:5432/geo_dev"
ENV BETTER_AUTH_SECRET="geo-build-secret-1234567890-key-build"
RUN npm run build

# Configure runtime environment
ENV NODE_ENV=production
ENV PORT=3000
ENV GEO_AUDIT_ROOT=/app/GEO
ENV GEO_AUDIT_PYTHON=python3

EXPOSE 3000

CMD ["npm", "start"]
