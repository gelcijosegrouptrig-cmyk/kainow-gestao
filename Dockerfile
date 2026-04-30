FROM node:20-slim
# cache-bust: 2026-04-30T21:30

RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    gcc \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY backend/package.json backend/package-lock.json ./

# Install dependencies (compiles better-sqlite3 natively for Node 20)
RUN npm ci

# Copy backend source
COPY backend/ .

# Copy frontend static files into backend/public so Express can serve them
COPY frontend/public/ public/

# Create uploads directory
RUN mkdir -p uploads

EXPOSE 8080

CMD ["node", "src/server.js"]
