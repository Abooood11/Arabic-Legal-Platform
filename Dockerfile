FROM node:20-slim AS builder

# Install git-lfs
RUN apt-get update && \
    apt-get install -y git git-lfs && \
    rm -rf /var/lib/apt/lists/* && \
    git lfs install

WORKDIR /app

# Copy everything (Railway clones the repo, .git should be available)
COPY . .

# Pull LFS files
RUN git lfs pull || echo "LFS pull skipped - files may already be present"

# Install dependencies
RUN npm ci

# Build
RUN npm run build

# --- Production stage ---
FROM node:20-slim

WORKDIR /app

# Copy built files
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/data.db ./data.db
COPY --from=builder /app/client/public ./client/public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/package-lock.json ./package-lock.json

# Install production deps only
RUN npm ci --omit=dev

EXPOSE 3005

ENV NODE_ENV=production

CMD ["node", "dist/index.cjs"]
