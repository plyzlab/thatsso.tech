const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

// Clean URL route map
const ROUTES = {
  '/': 'index.html',
  '/index': 'index.html',
  '/login': 'login/index.html',
  '/signup': 'signup/index.html',
};

function sendFile(res, filename, statusCode = 200) {
  const filePath = path.join(ROOT, filename);
  const ext = path.extname(filePath);

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`404 Not Found (missing ${filename})`);
      return;
    }
    res.writeHead(statusCode, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(content);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let pathname = url.pathname.replace(/\/+$/, '') || '/';

  // Ignore favicon spam
  if (pathname === '/favicon.ico') {
    res.writeHead(204);
    return res.end();
  }

  // Redirect .html URLs to clean URLs (e.g. /login.html -> /login)
  if (pathname.endsWith('.html') && pathname !== '/404.html') {
    const clean = pathname.replace(/(\/index)?\.html$/, '') || '/';
    res.writeHead(301, { Location: clean + url.search });
    return res.end();
  }

  // Mock API endpoints so form submissions return real JSON instead of 404s
  if (req.method === 'POST' && pathname.startsWith('/api/')) {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      console.log(`[API POST] ${pathname}`);
      console.log('  Headers:', req.headers);
      console.log('  Body:', body);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, endpoint: pathname, received: body }));
    });
    return;
  }

  // Clean HTML routes
  if (ROUTES[pathname]) {
    return sendFile(res, ROUTES[pathname], 200);
  }

  // Static JS/CSS files in root folder (e.g. /tester.js)
  const safeFile = path.basename(pathname);
  if ((safeFile.endsWith('.js') || safeFile.endsWith('.css')) && fs.existsSync(path.join(ROOT, safeFile))) {
    return sendFile(res, safeFile, 200);
  }

  // Everything else -> 404.html
  sendFile(res, '404.html', 404);
});

server.listen(PORT, () => {
  console.log(`Test server running at http://localhost:${PORT}`);
  console.log(`Routes: /  |  /login  |  /signup  |  (anything else -> 404)`);
});
