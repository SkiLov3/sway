// ── Sway API Client + WebSocket Manager ──

const API_BASE = '/api';

// ── REST API ──
async function api(path, options = {}) {
  const url = `${API_BASE}${path}`;
  const config = {
    headers: { 'Content-Type': 'application/json' },
    ...options
  };
  if (config.body && typeof config.body === 'object' && !(config.body instanceof FormData)) {
    config.body = JSON.stringify(config.body);
  }
  if (config.body instanceof FormData) {
    delete config.headers['Content-Type'];
  }
  const res = await fetch(url, config);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'API request failed');
  }
  return res.json();
}

const API = {
  // Meets
  getMeets: () => api('/meets'),
  getMeet: (id) => api(`/meets/${id}`),
  createMeet: (data) => api('/meets', { method: 'POST', body: data }),
  updateMeet: (id, data) => api(`/meets/${id}`, { method: 'PUT', body: data }),
  deleteMeet: (id) => api(`/meets/${id}`, { method: 'DELETE' }),
  resetMeet: (id) => api(`/meets/${id}/reset`, { method: 'POST' }),
  
  // Divisions
  getDivisions: (meetId) => api(`/meets/${meetId}/divisions`),
  createDivision: (meetId, data) => api(`/meets/${meetId}/divisions`, { method: 'POST', body: data }),
  updateDivision: (divId, data) => api(`/meets/divisions/${divId}`, { method: 'PUT', body: data }),
  deleteDivision: (divId) => api(`/meets/divisions/${divId}`, { method: 'DELETE' }),
  
  // Weight Classes
  createWeightClass: (divId, data) => api(`/meets/divisions/${divId}/weight-classes`, { method: 'POST', body: data }),
  updateWeightClass: (wcId, data) => api(`/meets/weight-classes/${wcId}`, { method: 'PUT', body: data }),
  deleteWeightClass: (wcId) => api(`/meets/weight-classes/${wcId}`, { method: 'DELETE' }),
  
  // Lifters
  getLifters: (meetId) => api(`/lifters/meet/${meetId}`),
  getLifter: (id) => api(`/lifters/${id}`),
  createLifter: (data) => api('/lifters', { method: 'POST', body: data }),
  updateLifter: (id, data) => api(`/lifters/${id}`, { method: 'PUT', body: data }),
  deleteLifter: (id) => api(`/lifters/${id}`, { method: 'DELETE' }),
  importCSV: (meetId, formData) => api(`/lifters/import/${meetId}`, { method: 'POST', body: formData }),
  
  // Attempts
  getAttempts: (lifterId) => api(`/attempts/lifter/${lifterId}`),
  updateAttempt: (id, data) => api(`/attempts/${id}`, { method: 'PUT', body: data }),
  setAttemptWeight: (lifterId, liftType, num, weight) => api(`/attempts/set/${lifterId}/${liftType}/${num}`, { method: 'PUT', body: { weight } }),
  recordDecision: (lifterId, liftType, num, data) => api(`/attempts/decision/${lifterId}/${liftType}/${num}`, { method: 'PUT', body: data }),
  getLiftingOrder: (meetId, platform, flight, liftType, attemptNumber) => api(`/attempts/order/${meetId}/${platform}/${flight}/${liftType}/${attemptNumber}`),
  
  // Meet State
  getMeetState: (meetId) => api(`/meets/${meetId}/state`),
  updateMeetState: (meetId, data) => api(`/meets/${meetId}/state`, { method: 'PUT', body: data }),
  
  // Results
  getResults: (meetId) => api(`/meets/${meetId}/results`),
  
  // Network
  getNetworkInfo: () => api('/network'),
  getQRCode: (path) => api(`/qrcode?path=${encodeURIComponent(path || '/')}`),
};

// ── WebSocket ──
class SwaySocket {
  constructor() {
    this.ws = null;
    this.listeners = {};
    this.reconnectDelay = 1000;
    this.maxReconnectDelay = 10000;
  }

  connect() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.ws = new WebSocket(`${proto}//${location.host}`);
    
    this.ws.onopen = () => {
      console.log('[SWAY] WebSocket connected');
      this.reconnectDelay = 1000;
      this.emit('connected');
    };
    
    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        this.emit(msg.type, msg.data);
        this.emit('message', msg);
      } catch (e) {
        console.error('[SWAY] WS parse error:', e);
      }
    };
    
    this.ws.onclose = () => {
      console.log('[SWAY] WebSocket disconnected, reconnecting...');
      this.emit('disconnected');
      setTimeout(() => this.connect(), this.reconnectDelay);
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
    };
    
    this.ws.onerror = (err) => {
      console.error('[SWAY] WebSocket error:', err);
    };
  }

  send(type, data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, data }));
    }
  }

  on(event, callback) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(callback);
  }

  off(event, callback) {
    if (this.listeners[event]) {
      this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
    }
  }

  emit(event, data) {
    (this.listeners[event] || []).forEach(cb => cb(data));
  }
}

const socket = new SwaySocket();

// ── Toast Notifications ──
function showToast(message, type = 'success') {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    toast.style.transition = 'all 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ── URL Params Helper ──
function getParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

function setParam(name, value) {
  const url = new URL(window.location);
  url.searchParams.set(name, value);
  window.history.replaceState({}, '', url);
}
