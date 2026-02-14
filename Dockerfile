# ============================================
# Stage 1: Build
# ============================================
FROM node:20-slim AS builder

RUN apt-get update && \
    apt-get install -y python3 make g++ git git-lfs && \
    rm -rf /var/lib/apt/lists/* && \
    git lfs install

WORKDIR /app

# Copy package files first for better caching
COPY package.json package-lock.json ./
RUN npm ci

# Copy source code
COPY . .

# Pull LFS files if available
RUN git lfs pull || echo "LFS pull skipped"

# Build client + server
RUN npm run build

# ============================================
# Stage 2: Production
# ============================================
FROM node:20-slim

# Install build tools needed for better-sqlite3 native addon
RUN apt-get update && \
    apt-get install -y python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy built files
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/data.db ./data.db
COPY --from=builder /app/client/public ./client/public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/package-lock.json ./package-lock.json

# Install production deps only (need native build for better-sqlite3)
RUN npm ci --omit=dev && \
    # Clean up build tools after native compilation
    apt-get purge -y python3 make g++ && \
    apt-get autoremove -y && \
    rm -rf /var/lib/apt/lists/* && \
    npm cache clean --force

# Environment
ENV NODE_ENV=production
ENV PORT=3002

EXPOSE 3002

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3002/api/auth/user').then(r => process.exit(r.status === 401 ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/index.cjs"]
