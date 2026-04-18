// ── Sway Powerlifting Meet Management Server ──
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const os = require('os');
const QRCode = require('qrcode');
const helmet = require('helmet');
const { getDb } = require('./db');

// ── PORT validation ────────────────────────────────────────────────────────────
const rawPort = process.env.PORT || '3000';
const PORT = parseInt(rawPort, 10);
if (isNaN(PORT) || PORT < 1 || PORT > 65535) {
  console.error(`[SWAY] Invalid PORT value: "${rawPort}". Must be a number between 1–65535.`);
  process.exit(1);
}

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// ── Security headers ──────────────────────────────────────────────────────────
app.use(helmet({
  // Allow inline scripts/styles needed for the single-file HTML pages
  contentSecurityPolicy: false,
  // Don't block loading from same origin in iframes (display page)
  frameguard: false,
}));

// ── Middleware ─────────────────────────────────────────────────────────────────
app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: true, limit: '256kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Routes ─────────────────────────────────────────────────────────────────────
app.use('/api/meets', require('./routes/meets'));
app.use('/api/lifters', require('./routes/lifters'));
app.use('/api/attempts', require('./routes/attempts'));

// ── Short-code redirects ───────────────────────────────────────────────────────
app.get('/join/:code', (req, res) => {
  try {
    const db = getDb();
    const code = req.params.code.toUpperCase();
    const meet = db.prepare("SELECT id FROM meets WHERE short_code = ? AND short_code != ''").get(code);
    if (!meet) return res.status(404).send(`<h2>Meet code "${code}" not found.</h2><p>Ask your meet director for the correct code.</p>`);
    res.redirect(`/referee.html?meetId=${meet.id}&platform=1`);
  } catch (err) {
    res.status(500).send('Server error');
  }
});

app.get('/tv/:code', (req, res) => {
  try {
    const db = getDb();
    const code = req.params.code.toUpperCase();
    const meet = db.prepare("SELECT id FROM meets WHERE short_code = ? AND short_code != ''").get(code);
    if (!meet) return res.status(404).send(`<h2>Meet code "${code}" not found.</h2><p>Ask your meet director for the correct code.</p>`);
    res.redirect(`/display.html?meetId=${meet.id}&platform=1`);
  } catch (err) {
    res.status(500).send('Server error');
  }
});

app.get('/run/:code', (req, res) => {
  try {
    const db = getDb();
    const code = req.params.code.toUpperCase();
    const meet = db.prepare("SELECT id FROM meets WHERE short_code = ? AND short_code != ''").get(code);
    if (!meet) return res.status(404).send(`<h2>Meet code "${code}" not found.</h2><p>Ask your meet director for the correct code.</p>`);
    res.redirect(`/run.html?meetId=${meet.id}&platform=1`);
  } catch (err) {
    res.status(500).send('Server error');
  }
});

app.get('/lifter/:code', (req, res) => {
  try {
    const db = getDb();
    const code = req.params.code.toUpperCase();
    const meet = db.prepare("SELECT id FROM meets WHERE short_code = ? AND short_code != ''").get(code);
    if (!meet) return res.status(404).send(`<h2>Meet code "${code}" not found.</h2><p>Ask your meet director for the correct code.</p>`);
    res.redirect(`/lifter.html?meetId=${meet.id}`);
  } catch (err) {
    res.status(500).send('Server error');
  }
});

app.get('/r/:code', (req, res) => {
  try {
    const db = getDb();
    const code = req.params.code.toUpperCase();
    const meet = db.prepare("SELECT id FROM meets WHERE short_code = ? AND short_code != ''").get(code);
    if (!meet) return res.status(404).send(`<h2>Meet code "${code}" not found.</h2><p>Ask your meet director for the correct code.</p>`);
    res.redirect(`/results.html?meetId=${meet.id}`);
  } catch (err) {
    res.status(500).send('Server error');
  }
});

// ── Network helpers ────────────────────────────────────────────────────────────
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  const candidates = [];

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        // Prioritize physical interfaces like eth0 or en0
        if (name.startsWith('eth') || name.startsWith('en') || name.startsWith('wlan')) {
          return iface.address;
        }
        candidates.push(iface.address);
      }
    }
  }
  return candidates[0] || '127.0.0.1';
}

// QR Code endpoint
app.get('/api/qrcode', async (req, res) => {
  const localIP = getLocalIP();
  const port = PORT;
  const targetUrl = req.query.path || '/';
  const fullUrl = `http://${localIP}:${port}${targetUrl}`;
  
  try {
    const qrDataUrl = await QRCode.toDataURL(fullUrl, { width: 300, margin: 2 });
    res.json({ url: fullUrl, qr: qrDataUrl, ip: localIP, port });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const { APP_VERSION } = require('./config');

// Network info endpoint
app.get('/api/network', (req, res) => {
  const localIP = getLocalIP();
  res.json({ 
    ip: localIP, 
    port: PORT, 
    baseUrl: `http://${localIP}:${PORT}`,
    version: APP_VERSION
  });
});

// ── WebSocket ──────────────────────────────────────────────────────────────────
const ALLOWED_WS_TYPES = new Set([
  'current_lifter', 'attempt_updated', 'decision_made', 'state_changed',
  'timer', 'timer_start', 'timer_stop', 'timer_reset', 'timer_expired',
]);
const WS_MAX_BYTES = 16 * 1024; // 16 KB

const wsClients = new Set();

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  wsClients.add(ws);
  
  ws.on('message', (data) => {
    // Reject oversized messages
    if (data.length > WS_MAX_BYTES) {
      console.warn(`[WS] Dropped oversized message (${data.length} bytes)`);
      return;
    }
    try {
      const message = JSON.parse(data);
      // Only relay known message types
      if (!message.type || !ALLOWED_WS_TYPES.has(message.type)) {
        console.warn(`[WS] Dropped unknown message type: ${message.type}`);
        return;
      }

      // Persist timer state for meet synchronization
      if (message.type === 'timer' && message.data?.meetId && message.data?.seconds !== undefined) {
        try {
          const db = getDb();
          // Ensure the meet exists before updating state
          const meet = db.prepare('SELECT id FROM meets WHERE id = ?').get(message.data.meetId);
          if (meet) {
            db.prepare('UPDATE meet_state SET clock_seconds = ? WHERE meet_id = ?').run(message.data.seconds, message.data.meetId);
          }
        } catch (e) {
          console.error('[WS] Failed to persist timer state:', e.message);
        }
      }

      broadcast(message, ws);
    } catch (e) {
      console.error('[WS] message parse error:', e.message);
    }
  });

  ws.on('close', () => {
    wsClients.delete(ws);
  });
});

let pingInterval;
if (process.env.NODE_ENV !== 'test') {
  pingInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) {
        wsClients.delete(ws);
        return ws.terminate();
      }
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on('close', () => {
    clearInterval(pingInterval);
  });
}

function broadcast(message, excludeWs = null) {
  const data = JSON.stringify(message);
  wsClients.forEach(client => {
    if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

// Make broadcast available to routes
app.set('broadcast', broadcast);

// ── Initialize DB ──────────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
  getDb();
}

// ── Start server ───────────────────────────────────────────────────────────────
if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => {
    const localIP = getLocalIP();
    console.log('');
    console.log('╔══════════════════════════════════════════════╗');
    console.log('║              ⚡ SWAY is running ⚡            ║');
    console.log('╠══════════════════════════════════════════════╣');
    console.log(`║  Local:   http://localhost:${PORT}              ║`);
    console.log(`║  Network: http://${localIP}:${PORT}       ║`);
    console.log('╠══════════════════════════════════════════════╣');
    console.log('║  Open Display view on TV via HDMI            ║');
    console.log('║  Open Referee page on phones                 ║');
    console.log('╚══════════════════════════════════════════════╝');
    console.log('');
  });
}

// ── Graceful shutdown ──────────────────────────────────────────────────────────
function shutdown(signal) {
  console.log(`\n[SWAY] ${signal} received — shutting down gracefully...`);
  server.close(() => {
    try {
      const db = getDb();
      db.close();
      console.log('[SWAY] Database closed cleanly.');
    } catch (_) {}
    process.exit(0);
  });
  // Force exit after 5s if connections don't drain
  setTimeout(() => process.exit(1), 5000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

module.exports = { app, server, wss };
