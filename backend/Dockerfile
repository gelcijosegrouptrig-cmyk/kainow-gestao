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

# Copy package files
COPY package.json package-lock.json ./

# Install dependencies (will compile better-sqlite3 natively for Node 20)
RUN npm ci

# Copy source code
COPY . .

# Create uploads directory
RUN mkdir -p uploads

EXPOSE 8080

CMD ["node", "src/server.js"]
