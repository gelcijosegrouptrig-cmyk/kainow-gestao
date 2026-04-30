FROM node:20-slim

RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    gcc \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY backend/package.json backend/package-lock.json ./
RUN npm ci

COPY backend/ .
COPY frontend/public/ ../frontend/public/

RUN mkdir -p uploads

EXPOSE 8080

CMD ["node", "src/server.js"]
