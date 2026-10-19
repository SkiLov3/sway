// ── Sway Powerlifting Meet Management Server ──
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const os = require('os');
const QRCode = require('qrcode');
const helmet = require('helmet');
const multer = require('multer');

const config = require('./config');
const { getDb } = require('./db');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// ── Security headers ──────────────────────────────────────────────────────────
app.use(helmet({
  // Allow inline scripts/styles needed for the single-file HTML pages
  contentSecurityPolicy: false,
  // Don't block loading from same origin in iframes (display page)
  frameguard: { action: 'sameorigin' },
}));

// ── Standard Middleware ────────────────────────────────────────────────────────
app.use(express.json({ limit: config.BODY_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: config.BODY_LIMIT }));
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  maxAge: 0,
  setHeaders: (res, _filePath) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
}));

// ── HTML Escape Helper ─────────────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str || '').replace(/[&<>'"]/g, 
    tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag));
}

// ── Routes ─────────────────────────────────────────────────────────────────────
app.use('/api/meets', require('./routes/meets'));
app.use('/api/lifters', require('./routes/lifters'));
app.use('/api/attempts', require('./routes/attempts'));

const REDIRECT_TARGETS = {
  referee: (id) => `/referee.html?meetId=${encodeURIComponent(id)}&platform=1`,
  display: (id) => `/display.html?meetId=${encodeURIComponent(id)}&platform=1`,
  run: (id) => `/run.html?meetId=${encodeURIComponent(id)}&platform=1`,
  lifter: (id) => `/lifter.html?meetId=${encodeURIComponent(id)}`,
  results: (id) => `/results.html?meetId=${encodeURIComponent(id)}`
};

// ── Short-code redirects (XSS Safe) ───────────────────────────────────────────
function handleShortCodeRedirect(req, res, targetKey) {
  const getPath = REDIRECT_TARGETS[targetKey];
  if (!getPath) {
    return res.status(400).send('Invalid redirect destination');
  }
  try {
    const db = getDb();
    const rawCode = String(req.params.code || '').trim().toUpperCase();
    const meet = db.prepare("SELECT id FROM meets WHERE short_code = ? AND short_code != ''").get(rawCode);
    if (!meet) {
      return res.status(404).send(
        `<h2>Meet code "${escapeHtml(rawCode)}" not found.</h2><p>Ask your meet director for the correct code.</p>`
      );
    }
    const safePath = getPath(meet.id);
    if (typeof safePath === 'string' && safePath.startsWith('/') && !safePath.startsWith('//')) {
      res.setHeader('Location', safePath);
      return res.status(302).end();
    }
    return res.status(400).send('Invalid redirect destination');
  } catch (err) {
    console.error('[ShortCode Error]', err.message);
    return res.status(500).send('Server error');
  }
}

app.get('/join/:code',   (req, res) => handleShortCodeRedirect(req, res, 'referee'));
app.get('/tv/:code',     (req, res) => handleShortCodeRedirect(req, res, 'display'));
app.get('/run/:code',    (req, res) => handleShortCodeRedirect(req, res, 'run'));
app.get('/lifter/:code', (req, res) => handleShortCodeRedirect(req, res, 'lifter'));
app.get('/r/:code',      (req, res) => handleShortCodeRedirect(req, res, 'results'));

// ── Network & QR Helpers ───────────────────────────────────────────────────────
function getLocalIP(req = null) {
  if (process.env.HOST_IP && process.env.HOST_IP.trim() !== '') {
    return process.env.HOST_IP.trim();
  }
  if (req) {
    const rawHost = (req.get('x-forwarded-host') || req.get('host') || '').split(':')[0].trim();
    if (rawHost && rawHost !== 'localhost' && rawHost !== '127.0.0.1' && !rawHost.startsWith('172.')) {
      return rawHost;
    }
  }

  const interfaces = os.networkInterfaces();
  const candidates = [];

  for (const name of Object.keys(interfaces)) {
    const ifaceList = interfaces[name] || [];
    for (const iface of ifaceList) {
      if (iface.family === 'IPv4' && !iface.internal) {
        // Prioritize local Wi-Fi/LAN subnets (192.168.x.x, 10.x.x.x) over container bridge interfaces
        if (iface.address.startsWith('192.168.') || iface.address.startsWith('10.')) {
          return iface.address;
        }
        candidates.push(iface.address);
      }
    }
  }
  return candidates[0] || '127.0.0.1';
}

// QR Code endpoint (Safely bounded path and host)
app.get('/api/qrcode', async (req, res) => {
  let targetUrl = req.query.path || '/';
  if (typeof targetUrl !== 'string' || !targetUrl.startsWith('/') || targetUrl.startsWith('//') || targetUrl.includes('@') || targetUrl.length > 512) {
    targetUrl = '/';
  }

  let fullUrl;
  const customBase = req.query.baseUrl ? String(req.query.baseUrl).trim() : null;
  if (customBase && (customBase.startsWith('http://') || customBase.startsWith('https://')) && !customBase.includes('@') && customBase.length <= 512) {
    const cleanBase = customBase.replace(/\/+$/, '');
    fullUrl = `${cleanBase}${targetUrl}`;
  } else {
    const localIP = getLocalIP(req);
    const port = config.PORT;
    const hostWithPort = localIP.includes(':') ? localIP : `${localIP}:${port}`;
    fullUrl = `http://${hostWithPort}${targetUrl}`;
  }
  
  try {
    const qrDataUrl = await QRCode.toDataURL(fullUrl, { width: 300, margin: 2 });
    res.json({ url: fullUrl, qr: qrDataUrl, baseUrl: fullUrl.replace(targetUrl, '') });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Network info endpoint
app.get('/api/network', (req, res) => {
  const localIP = getLocalIP(req);
  res.json({ 
    ip: localIP, 
    port: config.PORT, 
    baseUrl: `http://${localIP}:${config.PORT}`,
    version: config.APP_VERSION
  });
});

// ── Centralized Error Handler (Mounted After All Routes) ───────────────────────
app.use((err, _req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: `Upload error: ${err.message}` });
  }
  if (err) {
    console.error('[HTTP Error]', err);
    return res.status(err.status || 500).json({ 
      error: process.env.NODE_ENV === 'production' ? 'Internal Server Error' : (err.message || 'Internal Server Error')
    });
  }
  next();
});

// ── WebSocket Lifecycle & Broadcasting ─────────────────────────────────────────
const ALLOWED_WS_TYPES = new Set([
  'current_lifter', 'attempt_updated', 'decision_made', 'state_changed',
  'timer', 'timer_start', 'timer_stop', 'timer_reset', 'timer_expired',
]);

wss.on('error', (err) => {
  console.error('[WSS Error]', err.message);
});

wss.on('connection', (ws) => {
  ws.isAlive = true;

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('error', (err) => {
    console.warn('[WS Client Error]', err.message);
  });

  ws.on('message', (data) => {
    if (data.length > config.WS_MAX_BYTES) {
      console.warn(`[WS] Dropped oversized message (${data.length} bytes)`);
      return;
    }

    try {
      const message = JSON.parse(data);
      if (!message.type || !ALLOWED_WS_TYPES.has(message.type)) {
        return;
      }

      // Persist timer state with validation & safe constraints
      if (message.type === 'timer' && message.data?.meetId && typeof message.data.seconds === 'number') {
        const secs = Math.max(0, Math.min(86400, Math.floor(message.data.seconds)));
        try {
          const db = getDb();
          db.prepare('UPDATE meet_state SET clock_seconds = ? WHERE meet_id = ?').run(secs, message.data.meetId);
        } catch (e) {
          console.error('[WS] Failed to persist timer state:', e.message);
        }
      }

      broadcast(message, ws);
    } catch (e) {
      console.error('[WS] Message parse error:', e.message);
    }
  });
});

let pingInterval;
if (process.env.NODE_ENV !== 'test') {
  pingInterval = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      try {
        ws.ping();
      } catch (err) {
        console.warn('[WS Ping Error]', err.message);
        ws.terminate();
      }
    }
  }, config.WS_PING_INTERVAL_MS);

  if (pingInterval.unref) pingInterval.unref();

  wss.on('close', () => {
    if (pingInterval) clearInterval(pingInterval);
  });
}

function broadcast(message, excludeWs = null) {
  const data = JSON.stringify(message);
  for (const client of wss.clients) {
    if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
      client.send(data, (err) => {
        if (err) {
          console.warn('[WS Broadcast send error]:', err.message);
        }
      });
    }
  }
}

// Make broadcast available to routes
app.set('broadcast', broadcast);

// ── Initialize DB ──────────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
  getDb();
}

// ── Start server ───────────────────────────────────────────────────────────────
if (require.main === module) {
  server.listen(config.PORT, config.HOST, () => {
    const localIP = getLocalIP();
    console.log('');
    console.log('╔══════════════════════════════════════════════╗');
    console.log(`║              ⚡ SWAY v${config.APP_VERSION} is running ⚡         ║`);
    console.log('╠══════════════════════════════════════════════╣');
    console.log(`║  Local:   http://localhost:${config.PORT}              ║`);
    console.log(`║  Network: http://${localIP}:${config.PORT}       ║`);
    console.log('╠══════════════════════════════════════════════╣');
    console.log('║  Open Display view on TV via HDMI            ║');
    console.log('║  Open Referee page on phones                 ║');
    console.log('╚══════════════════════════════════════════════╝');
    console.log('');
  });
}

// ── Graceful shutdown ──────────────────────────────────────────────────────────
let isShuttingDown = false;
function shutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`\n[SWAY] ${signal} received — shutting down gracefully...`);

  if (pingInterval) clearInterval(pingInterval);

  // Terminate all WebSocket connections so HTTP server can drain
  for (const ws of wss.clients) {
    try {
      ws.close(1001, 'Server shutting down');
      ws.terminate();
    } catch (err) {
      console.warn('[WS Shutdown Error]', err.message);
    }
  }

  wss.close(() => {
    server.close(() => {
      try {
        const db = getDb();
        if (db && db.open) {
          db.pragma('wal_checkpoint(TRUNCATE)');
          db.close();
          console.log('[SWAY] Database checkpointed and closed cleanly.');
        }
      } catch (err) {
        console.error('[DB Close Error]', err.message);
      }
      process.exit(0);
    });
  });

  // Force exit after configured timeout if connections don't drain
  setTimeout(() => {
    console.error('[SWAY] Forceful shutdown timeout exceeded.');
    process.exit(1);
  }, config.SHUTDOWN_TIMEOUT_MS).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  console.error('[SWAY Fatal] Unhandled Promise Rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[SWAY Fatal] Uncaught Exception:', err);
  shutdown('UNCAUGHT_EXCEPTION');
});

module.exports = { app, server, wss, escapeHtml };
