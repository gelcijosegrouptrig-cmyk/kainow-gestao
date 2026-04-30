const express = require('express');
const path = require('path');
const http = require('http');

const app = express();
const PORT = 3000;
const BACKEND_PORT = 3001;

// Proxy manual para /api
app.use('/api', (req, res) => {
  const options = {
    hostname: 'localhost',
    port: BACKEND_PORT,
    path: '/api' + req.url,
    method: req.method,
    headers: {
      ...req.headers,
      host: `localhost:${BACKEND_PORT}`
    }
  };

  const proxy = http.request(options, (backendRes) => {
    res.status(backendRes.statusCode);
    Object.entries(backendRes.headers).forEach(([k, v]) => res.setHeader(k, v));
    backendRes.pipe(res, { end: true });
  });

  proxy.on('error', (err) => {
    console.error('Proxy error:', err.message);
    res.status(502).json({ erro: 'Backend indisponível' });
  });

  if (req.body) {
    const body = JSON.stringify(req.body);
    proxy.setHeader('Content-Length', Buffer.byteLength(body));
    proxy.write(body);
  } else {
    req.pipe(proxy, { end: true });
  }
});

// Servir arquivos estáticos
app.use(express.static(path.join(__dirname, 'public')));

// Rotas SPA
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🌐 AverbaTech Frontend na porta ${PORT}`);
  console.log(`🔗 Proxy API -> localhost:${BACKEND_PORT}`);
});
