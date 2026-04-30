FROM node:20-slim

# Install Python, build tools needed for better-sqlite3
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    make \
    g++ \
    gcc \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files from backend
COPY backend/package.json backend/package-lock.json ./

# Install dependencies (will compile better-sqlite3 natively for Node 20)
RUN npm ci

# Copy backend source code
COPY backend/ .

# Copy frontend static files (served by Express)
COPY frontend/public/ ../frontend/public/

# Create uploads directory
RUN mkdir -p uploads

EXPOSE 8080

CMD ["node", "src/server.js"]
