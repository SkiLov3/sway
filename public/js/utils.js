// ── Sway Utilities ──

// Standard plate sets (kg)
const PLATE_SETS = {
  kg: [25, 20, 15, 10, 5, 2.5, 1.25, 0.5],
  lbs: [45, 35, 25, 10, 5, 2.5]
};

const BAR_WEIGHT = { kg: 25, lbs: 45 };

/**
 * Calculate plates needed per side for a given weight
 */
function calculatePlates(totalWeight, unit = 'kg') {
  const barWeight = BAR_WEIGHT[unit];
  const plates = PLATE_SETS[unit];
  let remaining = (totalWeight - barWeight) / 2;
  const result = [];
  
  if (remaining <= 0) return result;
  
  for (const plate of plates) {
    while (remaining >= plate - 0.001) {
      result.push(plate);
      remaining -= plate;
    }
  }
  
  return result;
}

/**
 * Generate plate loader HTML (one side)
 */
function renderPlateLoader(totalWeight, unit = 'kg') {
  const plates = calculatePlates(totalWeight, unit);
  if (totalWeight <= 0) return '<div class="plate-loader"><span style="color:var(--text-muted)">No weight set</span></div>';
  
  const plateHtml = plates.map(p => {
    const cls = `plate-${String(p).replace('.', '_')}`;
    return `<div class="plate ${cls}">${p}</div>`;
  }).join('');
  
  const plateHtmlReversed = plates.slice().reverse().map(p => {
    const cls = `plate-${String(p).replace('.', '_')}`;
    return `<div class="plate ${cls}">${p}</div>`;
  }).join('');
  
  return `
    <div class="plate-loader">
      <div class="collar"></div>
      ${plateHtmlReversed}
      <div class="bar bar-sleeve"></div>
      <div class="bar bar-center"></div>
      <div class="bar bar-sleeve"></div>
      ${plateHtml}
      <div class="collar"></div>
    </div>
  `;
}

/**
 * Format weight display
 */
function formatWeight(weight, unit = 'kg') {
  if (!weight) return '-';
  const num = parseFloat(weight);
  return num % 1 === 0 ? num.toString() : num.toFixed(1);
}

/**
 * Get attempt CSS class based on result
 */
function getAttemptClass(attempt) {
  if (!attempt || !attempt.weight) return '';
  switch (attempt.result) {
    case 'good': return 'attempt-good';
    case 'no_good': return 'attempt-no-good';
    case 'pending': return attempt.weight ? 'attempt-pending' : '';
    default: return '';
  }
}

/**
 * Get the best successful attempt for a lift type
 */
function getBestAttempt(attempts, liftType) {
  const good = (attempts || []).filter(a => a.lift_type === liftType && a.result === 'good');
  if (good.length === 0) return null;
  return good.reduce((best, a) => (a.weight > best.weight ? a : best));
}

/**
 * Calculate total from best lifts
 */
function calculateTotal(attempts) {
  const bestSquat = getBestAttempt(attempts, 'squat');
  const bestBench = getBestAttempt(attempts, 'bench');
  const bestDead = getBestAttempt(attempts, 'deadlift');
  
  if (!bestSquat || !bestBench || !bestDead) return 0;
  return bestSquat.weight + bestBench.weight + bestDead.weight;
}

/**
 * Lift type display names
 */
const LIFT_NAMES = {
  squat: 'Squat',
  bench: 'Bench',
  deadlift: 'Deadlift'
};

/**
 * Create a sidebar for a page
 */
function createSidebar(meetId, meetName, activePage) {
  const sidebarHtml = `
    <div class="sidebar-overlay" id="sidebarOverlay"></div>
    <nav class="sidebar" id="sidebar">
      <div class="sidebar-header">
        <a href="/" class="header-brand">
          <span class="lightning">⚡</span> SWAY
        </a>
        <button class="menu-btn" onclick="toggleSidebar()">✕</button>
      </div>
      <a href="/" class="sidebar-link ${activePage === 'home' ? 'active' : ''}">🏠 Home</a>
      ${meetId ? `
        <div class="sidebar-section">Meet</div>
        <a href="/setup.html?meetId=${meetId}" class="sidebar-link ${activePage === 'setup' ? 'active' : ''}">⚙️ Setup</a>
        <a href="/results.html?meetId=${meetId}" class="sidebar-link ${activePage === 'results' ? 'active' : ''}">📊 Results</a>
        <div class="sidebar-section">Platform 1</div>
        <a href="/run.html?meetId=${meetId}&platform=1" class="sidebar-link ${activePage === 'run' ? 'active' : ''}">🏋️ Run / Board</a>
        <a href="/display.html?meetId=${meetId}&platform=1" class="sidebar-link ${activePage === 'display' ? 'active' : ''}">📺 Display (TV)</a>
        <a href="/referee.html?meetId=${meetId}&platform=1" class="sidebar-link ${activePage === 'referee' ? 'active' : ''}">🔴 Referee</a>
        <div class="sidebar-section">Tools</div>
        <a href="#" class="sidebar-link" onclick="showQRCode(event)">📱 QR Codes</a>
      ` : ''}
    </nav>
  `;
  
  document.body.insertAdjacentHTML('afterbegin', sidebarHtml);
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('active');
  document.getElementById('sidebarOverlay').classList.toggle('active');
}

async function showQRCode(e) {
  e.preventDefault();
  const meetId = getParam('meetId');
  try {
    const info = await API.getNetworkInfo();
    const paths = [
      { name: 'Display (TV)', path: `/display.html?meetId=${meetId}&platform=1` },
      { name: 'Referee', path: `/referee.html?meetId=${meetId}&platform=1` },
      { name: 'Results', path: `/results.html?meetId=${meetId}` },
    ];
    
    let html = '<div class="modal-title">📱 QR Codes for Device Access</div>';
    html += `<p style="color:var(--text-secondary);margin-bottom:16px">Base URL: <strong>${info.baseUrl}</strong></p>`;
    
    for (const p of paths) {
      const qr = await API.getQRCode(p.path);
      html += `
        <div style="margin-bottom:20px;text-align:center">
          <h3 style="margin-bottom:8px">${p.name}</h3>
          <img src="${qr.qr}" alt="${p.name} QR" style="border-radius:8px">
          <p style="font-size:0.85rem;color:var(--text-muted);margin-top:4px">${qr.url}</p>
        </div>
      `;
    }
    
    html += '<div class="modal-actions"><button class="btn btn-outline" onclick="closeModal()">Close</button></div>';
    openModal(html);
  } catch (err) {
    showToast('Failed to generate QR codes: ' + err.message, 'error');
  }
}

/**
 * Simple Modal
 */
function openModal(contentHtml) {
  let overlay = document.querySelector('.modal-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = '<div class="modal"></div>';
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    });
    document.body.appendChild(overlay);
  }
  overlay.querySelector('.modal').innerHTML = contentHtml;
  requestAnimationFrame(() => overlay.classList.add('active'));
}

function closeModal() {
  const overlay = document.querySelector('.modal-overlay');
  if (overlay) overlay.classList.remove('active');
}

/**
 * Competition timer
 */
class CompetitionTimer {
  constructor(displayEl, onTick, onExpire) {
    this.displayEl = displayEl;
    this.onTick = onTick;
    this.onExpire = onExpire;
    this.seconds = 60;
    this.interval = null;
    this.running = false;
  }

  start(seconds = null) {
    if (seconds !== null) this.seconds = seconds;
    this.running = true;
    this.interval = setInterval(() => {
      this.seconds--;
      this.render();
      if (this.onTick) this.onTick(this.seconds);
      if (this.seconds <= 0) {
        this.stop();
        if (this.onExpire) this.onExpire();
      }
    }, 1000);
    this.render();
  }

  stop() {
    this.running = false;
    clearInterval(this.interval);
    this.interval = null;
  }

  reset(seconds = 60) {
    this.stop();
    this.seconds = seconds;
    this.render();
  }

  render() {
    if (!this.displayEl) return;
    const min = Math.floor(this.seconds / 60);
    const sec = this.seconds % 60;
    this.displayEl.textContent = `${min}:${sec.toString().padStart(2, '0')}`;
    
    this.displayEl.classList.remove('warning', 'danger');
    if (this.seconds <= 10) {
      this.displayEl.classList.add('danger');
    } else if (this.seconds <= 30) {
      this.displayEl.classList.add('warning');
    }
  }
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
  if (text === null || text === undefined) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Escape string for CSV format
 */
function escapeCSV(text) {
  if (text === null || text === undefined) return '';
  const str = String(text);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}
