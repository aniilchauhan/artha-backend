# ==============================================================================
# AXION BACKEND PRODUCTION DOCKERFILE
# Ultra-lightweight Node 22 runtime for 54 API routes & background jobs
# ==============================================================================

FROM node:22-bookworm-slim

WORKDIR /app

# 1. Install minimal system utilities
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    python3 \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# 2. Install Node.js dependencies
COPY package*.json ./
RUN npm install --legacy-peer-deps

# 3. Copy backend source code
COPY . .

# 4. Build Next.js backend bundle
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_OPTIONS="--max-old-space-size=1536"
RUN npm run build

# 5. Expose port and healthcheck
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:${PORT}/api/health || exit 1

# 6. Start Next.js backend server
CMD ["npm", "run", "start"]
