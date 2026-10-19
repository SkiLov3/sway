const path = require('path');
const { version } = require('./package.json');

const rawPort = process.env.PORT || '3000';
const parsedPort = parseInt(rawPort, 10);
const PORT = (!isNaN(parsedPort) && parsedPort >= 1 && parsedPort <= 65535) ? parsedPort : 3000;

module.exports = {
  APP_VERSION: version,
  PORT,
  HOST: process.env.HOST || '0.0.0.0',
  DATA_DIR: process.env.DATA_DIR || path.join(__dirname, 'data'),
  DB_PATH: process.env.DB_PATH || path.join(process.env.DATA_DIR || path.join(__dirname, 'data'), 'sway.db'),
  DB_TIMEOUT_MS: parseInt(process.env.DB_TIMEOUT_MS, 10) || 5000,
  WS_MAX_BYTES: parseInt(process.env.WS_MAX_BYTES, 10) || 16 * 1024,
  WS_PING_INTERVAL_MS: parseInt(process.env.WS_PING_INTERVAL_MS, 10) || 30000,
  SHUTDOWN_TIMEOUT_MS: parseInt(process.env.SHUTDOWN_TIMEOUT_MS, 10) || 5000,
  BODY_LIMIT: '256kb',
  UPLOAD_DIR: process.env.UPLOAD_DIR || path.join(__dirname, 'uploads'),
  MAX_UPLOAD_SIZE_BYTES: 2 * 1024 * 1024 // 2 MB
};
