const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const os = require('os');
const QRCode = require('qrcode');
const { getDb } = require('./db');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.use('/api/meets', require('./routes/meets'));
app.use('/api/lifters', require('./routes/lifters'));
app.use('/api/attempts', require('./routes/attempts'));

// Get local IP for QR code / network access
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

// QR Code endpoint
app.get('/api/qrcode', async (req, res) => {
  const localIP = getLocalIP();
  const port = process.env.PORT || 3000;
  const targetUrl = req.query.path || '/';
  const fullUrl = `http://${localIP}:${port}${targetUrl}`;
  
  try {
    const qrDataUrl = await QRCode.toDataURL(fullUrl, { width: 300, margin: 2 });
    res.json({ url: fullUrl, qr: qrDataUrl, ip: localIP, port });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Network info endpoint
app.get('/api/network', (req, res) => {
  const localIP = getLocalIP();
  const port = process.env.PORT || 3000;
  res.json({ ip: localIP, port, baseUrl: `http://${localIP}:${port}` });
});

// WebSocket handling
const wsClients = new Set();

wss.on('connection', (ws) => {
  wsClients.add(ws);
  
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data);
      // Broadcast to all other clients
      broadcast(message, ws);
    } catch (e) {
      console.error('WS message error:', e);
    }
  });

  ws.on('close', () => {
    wsClients.delete(ws);
  });
});

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

// Initialize DB on startup
getDb();

const PORT = process.env.PORT || 3000;
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
