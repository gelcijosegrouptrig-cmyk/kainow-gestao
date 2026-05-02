FROM node:20-slim

# Dependências para compilar better-sqlite3
RUN apt-get update && apt-get install -y \
    python3 make g++ gcc \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 1. Instalar dependências (só produção)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# 2. Copiar código backend
COPY src/ ./src/

# 3. Copiar frontend → /app/public (servidor busca em ../public = /app/public)
COPY public/ ./public/

# 4. Diretório de uploads
RUN mkdir -p uploads

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8080/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "src/server.js"]
