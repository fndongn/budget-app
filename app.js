// ── Palette ───────────────────────────────────────────────────────────────────
const PALETTE = [
  { dot:'#4f8ef7', bg:'rgba(79,142,247,0.18)',  fg:'#93c5fd' },
  { dot:'#34d399', bg:'rgba(52,211,153,0.16)',  fg:'#6ee7b7' },
  { dot:'#f97066', bg:'rgba(249,112,102,0.16)', fg:'#fca5a5' },
  { dot:'#a78bfa', bg:'rgba(167,139,250,0.16)', fg:'#c4b5fd' },
  { dot:'#fbbf24', bg:'rgba(251,191,36,0.16)',  fg:'#fde68a' },
  { dot:'#22d3ee', bg:'rgba(34,211,238,0.14)',  fg:'#67e8f9' },
  { dot:'#f472b6', bg:'rgba(244,114,182,0.16)', fg:'#f9a8d4' },
  { dot:'#a3e635', bg:'rgba(163,230,53,0.14)',  fg:'#bef264' },
];

const CAT_ICONS = ['🏠','🛒','🚗','💡','🎬','💊','🏋️','✈️','📚','🍽️','👕','💻','🎵','🐾','🎮'];

// ── Google Sheets API ─────────────────────────────────────────────────────────
const SHEETS_URL = 'YOUR_WEB_APP_URL_HERE'; // paste your URL from Step 3
let isSyncing = false;

async function sheetsLoad() {
  try {
    showSyncStatus('loading');
    const res  = await fetch(`${SHEETS_URL}?action=load`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    monthData = {};
    const ensure = key => {
      if (!monthData[key]) monthData[key] = { income:[], expenses:[], savings:[], categories:[] };
    };

    (data.income     || []).forEach(r => { ensure(r.monthKey); monthData[r.monthKey].income.push(r); });
    (data.expenses   || []).forEach(r => { ensure(r.monthKey); monthData[r.monthKey].expenses.push(r); });
    (data.savings    || []).forEach(r => { ensure(r.monthKey); monthData[r.monthKey].savings.push(r); });
    (data.categories || []).forEach(r => { ensure(r.monthKey); monthData[r.monthKey].categories.push(r); });

    const goalRes  = await fetch(`${SHEETS_URL}?action=loadSavingsGoal`);
    const goalData = await goalRes.json();
    savingsGoal = goalData || {};

    showSyncStatus('saved');
    return true;
  } catch(e) {
    console.error('Sheets load error:', e);
    showSyncStatus('error');
    return false;
  }
}

async function sheetsSave() {
  if (isSyncing) return;
  isSyncing = true;
  showSyncStatus('saving');
  try {
    const income = [], expenses = [], savings = [], categories = [];
    Object.entries(monthData).forEach(([key, d]) => {
      d.income.forEach(r     => income.push({ monthKey: key, ...r }));
      d.expenses.forEach(r   => expenses.push({ monthKey: key, ...r }));
      d.savings.forEach(r    => savings.push({ monthKey: key, ...r }));
      d.categories.forEach(r => categories.push({ monthKey: key, ...r }));
    });

    await Promise.all([
      fetch(SHEETS_URL, { method:'POST', body: JSON.stringify({ action:'saveSheet', sheet:'income',     rows: income     }) }),
      fetch(SHEETS_URL, { method:'POST', body: JSON.stringify({ action:'saveSheet', sheet:'expenses',   rows: expenses   }) }),
      fetch(SHEETS_URL, { method:'POST', body: JSON.stringify({ action:'saveSheet', sheet:'savings',    rows: savings    }) }),
      fetch(SHEETS_URL, { method:'POST', body: JSON.stringify({ action:'saveSheet', sheet:'categories', rows: categories }) }),
      fetch(SHEETS_URL, { method:'POST', body: JSON.stringify({ action:'saveSavingsGoal', goals: savingsGoal }) }),
    ]);

    showSyncStatus('saved');
  } catch(e) {
    console.error('Sheets save error:', e);
    showSyncStatus('error');
  }
  isSyncing = false;
}

let _saveTimer = null;
function scheduleSave() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(sheetsSave, 1500);
}

function showSyncStatus(state) {
  const el = document.getElementById('sync-status');
  if (!el) return;
  const states = {
    loading: { icon: '⟳', text: 'Loading...', cls: 'sync-loading' },
    saving:  { icon: '⟳', text: 'Saving...',  cls: 'sync-saving'  },
    saved:   { icon: '✓', text: 'Synced',      cls: 'sync-saved'   },
    error:   { icon: '✕', text: 'Sync error',  cls: 'sync-error'   },
  };
  const s = states[state] || states.saved;
  el.className = `sync-status ${s.cls}`;
  el.innerHTML = `<span class="sync-icon">${s.icon}</span>${s.text}`;
}

// ── State ─────────────────────────────────────────────────────────────────────
let activeKey   = monthKey(new Date());
let monthData   = {};
let savingsGoal = {};
let nextId      = 1000;

// ── Alert tracking (prevent duplicate toasts per session) ─────────────────────
// Keys: "catId-threshold" e.g. "1042-80" or "1042-100"
const _alerted = new Set();

// ── Toast notification system ─────────────────────────────────────────────────
function showToast(type, title, message, duration = 6000) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const icons = { warning: '⚡', danger: '🚨', success: '✓' };
  toast.innerHTML = `
    <div class="toast-icon">${icons[type] || '!'}</div>
    <div class="toast-body">
      <div class="toast-title">${title}</div>
      <div class="toast-msg">${message}</div>
    </div>
    <button class="toast-close" onclick="dismissToast(this.parentElement)">✕</button>
    <div class="toast-progress" style="animation-duration:${duration}ms"></div>
  `;

  container.appendChild(toast);

  // Auto-dismiss
  setTimeout(() => dismissToast(toast), duration);
}

function dismissToast(toast) {
  if (!toast || toast.classList.contains('toast-out')) return;
  toast.classList.add('toast-out');
  setTimeout(() => toast.remove(), 350);
}

// ── Check budget thresholds after adding an expense ───────────────────────────
function checkBudgetAlerts(data) {
  const spentByCat = {};
  data.expenses.forEach(e => { spentByCat[e.catId] = (spentByCat[e.catId] || 0) + e.amount; });

  data.categories.forEach(cat => {
    if (!cat.budget || cat.budget <= 0) return;
    const spent = spentByCat[cat.id] || 0;
    const pct   = (spent / cat.budget) * 100;

    // 80% warning — fires once per category per session
    const key80  = `${cat.id}-80-${activeKey}`;
    const key100 = `${cat.id}-100-${activeKey}`;

    if (pct >= 100 && !_alerted.has(key100)) {
      _alerted.add(key100);
      showToast(
        'danger',
        `Over Budget — ${cat.name}`,
        `You've spent ${fmt(spent)} — that's ${Math.round(pct)}% of your ${fmt(cat.budget)} budget.`,
        8000
      );
    } else if (pct >= 80 && !_alerted.has(key80)) {
      _alerted.add(key80);
      showToast(
        'warning',
        `80% Budget Warning — ${cat.name}`,
        `You've used ${Math.round(pct)}% of your ${fmt(cat.budget)} budget. ${fmt(cat.budget - spent)} remaining.`,
        7000
      );
    }
  });

  // Overall budget check
  const totalBudget = data.categories.reduce((s, c) => s + c.budget, 0);
  const totalSpent  = data.expenses.reduce((s, e) => s + e.amount, 0);
  if (totalBudget > 0) {
    const totalPct = (totalSpent / totalBudget) * 100;
    const keyTotal80  = `total-80-${activeKey}`;
    const keyTotal100 = `total-100-${activeKey}`;

    if (totalPct >= 100 && !_alerted.has(keyTotal100)) {
      _alerted.add(keyTotal100);
      showToast(
        'danger',
        'Total Budget Exceeded!',
        `Overall spending of ${fmt(totalSpent)} has exceeded your total budget of ${fmt(totalBudget)}.`,
        9000
      );
    } else if (totalPct >= 80 && !_alerted.has(keyTotal80)) {
      _alerted.add(keyTotal80);
      showToast(
        'warning',
        'Total Budget at 80%',
        `You've used ${Math.round(totalPct)}% of your total budget. ${fmt(totalBudget - totalSpent)} left across all categories.`,
        7000
      );
    }
  }
}

// ── Render persistent alert panel ─────────────────────────────────────────────
function renderAlerts(data) {
  const panel = document.getElementById('alerts-panel');
  if (!panel) return;

  const spentByCat = {};
  data.expenses.forEach(e => { spentByCat[e.catId] = (spentByCat[e.catId] || 0) + e.amount; });

  const alerts = [];
  data.categories.forEach((cat, idx) => {
    if (!cat.budget || cat.budget <= 0) return;
    const spent = spentByCat[cat.id] || 0;
    const pct   = (spent / cat.budget) * 100;
    if (pct >= 80) {
      alerts.push({ cat, idx, spent, pct, over: pct >= 100 });
    }
  });

  if (alerts.length === 0) {
    panel.style.display = 'none';
    return;
  }

  panel.style.display = 'flex';
  panel.innerHTML = `
    <div class="alerts-header">
      <span class="alerts-title">Budget Alerts</span>
      <span class="alerts-count">${alerts.length} alert${alerts.length > 1 ? 's' : ''}</span>
    </div>
    ${alerts.map(a => `
      <div class="alert-item ${a.over ? 'alert-danger' : 'alert-warning'}">
        <span class="alert-icon">${a.over ? '🚨' : '⚡'}</span>
        <div class="alert-text">
          <strong>${a.cat.name}</strong> — ${a.over ? 'Over budget!' : 'Approaching limit'}<br>
          <span>Spent ${fmt(a.spent)} of ${fmt(a.cat.budget)} budget</span>
        </div>
        <span class="alert-pct">${Math.round(a.pct)}%</span>
      </div>`).join('')}
  `;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function monthKey(date) {
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0');
}
function monthLabel(key) {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}
function monthShort(key) {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
}
function fmt(n) {
  const abs = Math.abs(n);
  const s = '$' + abs.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return n < 0 ? '-' + s : s;
}
function today() {
  const d = new Date();
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}
function fmtDate(iso) {
  if (!iso) return '';
  if (iso.includes('/')) return iso; // legacy MM/DD passthrough
  const [, m, d] = iso.split('-');
  return m + '/' + d;
}
function colorFor(idx) { return PALETTE[idx % PALETTE.length]; }
function iconFor(idx)  { return CAT_ICONS[idx % CAT_ICONS.length]; }

// ── Count-up animation ────────────────────────────────────────────────────────
const _prev = {};
function animateNum(id, target) {
  const el = document.getElementById(id);
  if (!el) return;
  const prev = _prev[id] ?? 0;
  _prev[id] = target;
  if (prev === target) return;

  const dur = 500, steps = 24, step = (target - prev) / steps;
  let cur = prev, i = 0;
  el.classList.add('counting');
  const tick = () => {
    i++;
    cur += step;
    const done = i >= steps;
    el.textContent = fmt(done ? target : Math.round(cur));
    if (done) { el.classList.remove('counting'); return; }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// ── Month data ────────────────────────────────────────────────────────────────
function getMonth(key) {
  if (!monthData[key]) {
    monthData[key] = { income: [], expenses: [], savings: [], categories: seedCats(key) };
  }
  return monthData[key];
}
function seedCats(key) {
  // Copy categories from previous month if it exists, otherwise start empty
  const [y, m] = key.split('-').map(Number);
  const prev = monthKey(new Date(y, m - 2, 1));
  if (monthData[prev] && monthData[prev].categories.length > 0) {
    return monthData[prev].categories.map(c => ({ ...c }));
  }
  return [];
}

// ── Persistence ───────────────────────────────────────────────────────────────
function save() {
  localStorage.setItem('budgtr_data',  JSON.stringify(monthData));
  localStorage.setItem('budgtr_goals', JSON.stringify(savingsGoal));
  localStorage.setItem('budgtr_id',    String(nextId));
  scheduleSave();
}
function load() {
  try {
    const d = localStorage.getItem('budgtr_data');
    const g = localStorage.getItem('budgtr_goals');
    const n = localStorage.getItem('budgtr_nextId');
    if (d) monthData    = JSON.parse(d);
    if (g) savingsGoal  = JSON.parse(g);
    if (n) nextId       = parseInt(n);
  } catch(e) { console.warn(e); }
  sheetsLoad().then(ok => { if (ok) render(); });
}

// ── Month nav ─────────────────────────────────────────────────────────────────
function changeMonth(delta) {
  const [y, m] = activeKey.split('-').map(Number);
  activeKey = monthKey(new Date(y, m - 1 + delta, 1));
  render();
}

// ── Donut ─────────────────────────────────────────────────────────────────────
function drawDonut(data, spentByCat) {
  const canvas = document.getElementById('donut-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  const total = Object.values(spentByCat).reduce((s, v) => s + v, 0);
  const cx = W / 2, cy = H / 2, R = W * 0.43, r = R * 0.62;

  if (total === 0) {
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.arc(cx, cy, r, 0, Math.PI * 2, true);
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    ctx.fill('evenodd');
    return;
  }

  let angle = -Math.PI / 2;
  data.categories.forEach((cat, idx) => {
    const spent = spentByCat[cat.id] || 0;
    if (spent <= 0) return;
    const slice = (spent / total) * Math.PI * 2;
    const col = colorFor(idx);

    // Glow
    ctx.save();
    ctx.shadowColor = col.dot;
    ctx.shadowBlur = 12;

    ctx.beginPath();
    ctx.moveTo(cx + r * Math.cos(angle), cy + r * Math.sin(angle));
    ctx.arc(cx, cy, R, angle, angle + slice);
    ctx.arc(cx, cy, r, angle + slice, angle, true);
    ctx.closePath();
    ctx.fillStyle = col.dot;
    ctx.fill();
    ctx.restore();

    angle += slice + 0.018;
  });
}


// ── Budget Progress Bar ───────────────────────────────────────────────────────
function renderBudgetProgress(data, spentByCat, totalBudgeted, totalSpent, totalSaved, totalIncome) {
  // Total income = 100% — split into expenses, savings, remaining
  const base        = totalIncome > 0 ? totalIncome : 1;
  const spentPct    = Math.min((totalSpent  / base) * 100, 100);
  const savedPct    = Math.min((totalSaved  / base) * 100, Math.max(0, 100 - spentPct));
  const totalUsed   = totalSpent + totalSaved;
  const usedPct     = totalIncome > 0 ? Math.round((totalUsed / totalIncome) * 100) : 0;

  const spentBar = document.getElementById('bp-bar-spent');
  const savedBar = document.getElementById('bp-bar-saved');
  if (spentBar) spentBar.style.width = spentPct + '%';
  if (savedBar) savedBar.style.width = savedPct + '%';

  // Labels: "Expenses + Savings  of  Total Income"
  const bpSpent  = document.getElementById('bp-spent');
  const bpBudget = document.getElementById('bp-budget');
  if (bpSpent)  bpSpent.textContent  = fmt(totalUsed);
  if (bpBudget) bpBudget.textContent = fmt(totalIncome);

  const pctEl = document.getElementById('bp-pct');
  if (pctEl) {
    pctEl.textContent = usedPct + '%';
    pctEl.className = 'bp-pct-val' + (usedPct > 100 ? ' over' : usedPct >= 80 ? ' warning' : '');
  }

  const badge = document.getElementById('bp-status-badge');
  if (badge) {
    if (totalIncome === 0) {
      badge.textContent = 'No Income Set';
      badge.className = 'bp-status-badge warning';
    } else if (totalUsed > totalIncome) {
      badge.textContent = '⚠ Over Budget';
      badge.className = 'bp-status-badge over';
    } else if (usedPct >= 80) {
      badge.textContent = '⚡ Nearly Full';
      badge.className = 'bp-status-badge warning';
    } else {
      badge.textContent = '✓ On Track';
      badge.className = 'bp-status-badge on-track';
    }
  }

  const catsEl = document.getElementById('bp-cats');
  if (!catsEl) return;
  if (data.categories.length === 0) {
    catsEl.innerHTML = '<div class="empty-note" style="padding:4px 0">Add budget categories to see per-category tracking</div>';
    return;
  }

  catsEl.innerHTML = data.categories.map((cat, idx) => {
    const col    = colorFor(idx);
    const spent  = spentByCat[cat.id] || 0;
    const budget = cat.budget;
    const pct    = budget > 0 ? Math.min(Math.round((spent / budget) * 100), 999) : 0;
    const over   = spent > budget;
    const warn   = !over && pct >= 75;
    const fillColor = over ? 'var(--coral)' : warn ? 'var(--amber)' : col.dot;
    const glowColor = over ? 'rgba(249,112,102,0.45)' : warn ? 'rgba(251,191,36,0.35)' : 'transparent';
    const pctClass  = over ? 'over' : warn ? 'warning' : 'safe';
    const barWidth  = budget > 0 ? Math.min((spent / budget) * 100, 100) : 0;
    return `
      <div class="bp-cat-row">
        <div class="bp-cat-icon" style="background:${col.bg}">${iconFor(idx)}</div>
        <div>
          <div class="bp-cat-name">${cat.name}</div>
          <div class="bp-cat-track">
            <div class="bp-cat-fill" style="width:${barWidth}%;background:${fillColor};box-shadow:0 0 8px ${glowColor}"></div>
          </div>
        </div>
        <div class="bp-cat-meta">
          <span class="bp-cat-spent-val">${fmt(spent)}</span>
          <span class="bp-cat-budget-val">of ${fmt(budget)}</span>
        </div>
        <span class="bp-cat-pct ${pctClass}">${pct}%</span>
      </div>`;
  }).join('');
}

// ── Main render ───────────────────────────────────────────────────────────────
function render() {
  const data = getMonth(activeKey);
  document.getElementById('month-label').textContent = monthLabel(activeKey);

  const totalIncome   = data.income.reduce((s, i) => s + i.amount, 0);
  const totalBudgeted = data.categories.reduce((s, c) => s + c.budget, 0);
  const totalSpent    = data.expenses.reduce((s, e) => s + e.amount, 0);
  const totalSaved    = data.savings.reduce((s, v) => s + v.amount, 0);
  // Remaining = total income minus all outflows (expenses + savings)
  const remaining     = totalIncome - totalSpent - totalSaved;

  const spentByCat = {};
  data.expenses.forEach(e => { spentByCat[e.catId] = (spentByCat[e.catId] || 0) + e.amount; });

  // ── Budget progress bar ──
  renderBudgetProgress(data, spentByCat, totalBudgeted, totalSpent, totalSaved, totalIncome);

  // ── Persistent alert panel ──
  renderAlerts(data);

  // ── Hero numbers (animated) ──
  animateNum('sum-income', totalIncome);
  animateNum('sum-budgeted', totalBudgeted);
  animateNum('sum-spent', totalSpent);
  animateNum('sum-saved', totalSaved);
  animateNum('sum-remaining', remaining);
  animateNum('donut-val', totalSpent);
  animateNum('income-badge', totalIncome);
  animateNum('cat-badge', totalBudgeted);
  animateNum('exp-badge', totalSpent);
  animateNum('savings-badge', totalSaved);

  // sub-text
  const srcCount = data.income.length;
  document.getElementById('income-sub').textContent =
    srcCount === 0 ? 'Add income sources below'
    : srcCount === 1 ? '1 income source' : `${srcCount} income sources`;

  // remaining color + sub-label
  const remEl = document.getElementById('sum-remaining');
  if (remEl) remEl.style.color = remaining < 0 ? 'var(--coral)' : remaining > 0 ? 'var(--emerald)' : 'var(--t1)';
  const remPill = document.getElementById('hpill-remaining');
  if (remPill) {
    remPill.className = 'hpill ' + (remaining < 0 ? 'hpill-coral' : remaining > 0 ? 'hpill-emerald' : 'hpill-amber');
  }
  const remLblEl = document.getElementById('remaining-sub-lbl');
  if (remLblEl) {
    if (totalIncome === 0) {
      remLblEl.textContent = 'Add income first';
    } else if (remaining > 0) {
      remLblEl.textContent = 'Left after expenses & savings';
    } else if (remaining < 0) {
      remLblEl.textContent = 'Overspent by ' + fmt(Math.abs(remaining));
    } else {
      remLblEl.textContent = 'Fully accounted for';
    }
  }

  // ── Donut ──
  drawDonut(data, spentByCat);

  // Legend
  const legendEl = document.getElementById('donut-legend');
  const active = data.categories.filter(c => (spentByCat[c.id] || 0) > 0);
  legendEl.innerHTML = active.length === 0
    ? '<span class="empty-note">No expenses yet</span>'
    : active.map(c => {
        const idx = data.categories.indexOf(c);
        return `<div class="legend-row">
          <span class="legend-dot" style="background:${colorFor(idx).dot}"></span>
          <span class="legend-name">${c.name}</span>
          <span class="legend-amt">${fmt(spentByCat[c.id] || 0)}</span>
        </div>`;
      }).join('');

  // ── Income list ──
  document.getElementById('income-list').innerHTML = data.income.length === 0
    ? '<div class="empty-note">No sources added yet.</div>'
    : data.income.map(i => `
        <div class="item-row">
          <span class="item-dot" style="background:var(--blue)"></span>
          <span class="item-name">${i.name}</span>
          <span class="item-date">${fmtDate(i.date)}</span>
          <span class="item-amt">${fmt(i.amount)}</span>
          <button class="del-btn" onclick="delIncome(${i.id})">✕</button>
        </div>`).join('');

  // ── Categories ──
  document.getElementById('cat-grid').innerHTML = data.categories.length === 0
    ? '<div class="empty-note" style="grid-column:1/-1">No categories yet.</div>'
    : data.categories.map((c, idx) => {
        const col   = colorFor(idx);
        const spent = spentByCat[c.id] || 0;
        const pct   = c.budget > 0 ? Math.min((spent / c.budget) * 100, 100) : 0;
        const over  = spent > c.budget;
        return `
        <div class="cat-tile">
          <div class="cat-top">
            <div class="cat-icon" style="background:${col.bg}">${iconFor(idx)}</div>
            <span class="cat-name-lbl">${c.name}</span>
            <button class="del-sm" onclick="delCategory(${c.id})">✕</button>
          </div>
          <div class="cat-bar-bg">
            <div class="cat-bar-fill" style="width:${pct}%;background:${over ? 'var(--coral)' : col.dot}"></div>
          </div>
          <div class="cat-meta">
            <span>${fmt(c.budget)}</span>
            <span class="${over ? 'over' : ''}">${fmt(spent)}</span>
          </div>
        </div>`;
      }).join('');

  // ── Expense dropdown ──
  const sel = document.getElementById('exp-cat');
  const cur = sel.value;
  sel.innerHTML = '<option value="">Category</option>' +
    data.categories.map(c => `<option value="${c.id}" ${cur == c.id ? 'selected' : ''}>${c.name}</option>`).join('');

  // ── Expenses ──
  document.getElementById('exp-list').innerHTML = data.expenses.length === 0
    ? '<div class="empty-note">No expenses logged yet.</div>'
    : [...data.expenses].reverse().map(e => {
        const cat   = data.categories.find(c => c.id === e.catId);
        const idx   = cat ? data.categories.indexOf(cat) : 0;
        return `
        <div class="exp-row">
          <span class="item-dot" style="background:${colorFor(idx).dot}"></span>
          <span class="exp-desc">${e.desc}</span>
          ${cat ? `<span class="exp-tag">${cat.name}</span>` : ''}
          <span class="exp-date">${fmtDate(e.date)}</span>
          <span class="exp-amt">${fmt(e.amount)}</span>
          <button class="del-btn" onclick="delExpense(${e.id})">✕</button>
        </div>`;
      }).join('');

  // ── Savings ring ──
  const goal = savingsGoal[activeKey] || 0;
  const pct  = goal > 0 ? Math.min(Math.round((totalSaved / goal) * 100), 100) : 0;
  const circ = 301.59;
  document.getElementById('savings-goal').value = goal || '';
  document.getElementById('ring-progress').style.strokeDashoffset = circ - (circ * pct / 100);
  document.getElementById('ring-pct').textContent = pct + '%';
  document.getElementById('ring-status').textContent = goal > 0
    ? `${fmt(totalSaved)} saved of ${fmt(goal)}`
    : 'Set a goal to track progress';

  // Savings list
  document.getElementById('savings-list').innerHTML = data.savings.length === 0
    ? '<div class="empty-note">No savings logged yet.</div>'
    : data.savings.map(s => `
        <div class="item-row">
          <span class="item-dot" style="background:var(--emerald)"></span>
          <span class="item-name">${s.desc}</span>
          <span class="item-date">${fmtDate(s.date)}</span>
          <span class="item-amt green">${fmt(s.amount)}</span>
          <button class="del-btn" onclick="delSaving(${s.id})">✕</button>
        </div>`).join('');

  // All-time
  const lifetime = Object.values(monthData).flatMap(d => d.savings).reduce((s, v) => s + v.amount, 0);
  document.getElementById('lifetime-val').textContent = fmt(lifetime);

  // ── History ──
  const keys = [...new Set([...Object.keys(monthData), activeKey])].sort().reverse();
  document.getElementById('history-body').innerHTML = keys.map(key => {
    const d      = getMonth(key);
    const inc    = d.income.reduce((s, i) => s + i.amount, 0);
    const spt    = d.expenses.reduce((s, e) => s + e.amount, 0);
    const sav    = d.savings.reduce((s, v) => s + v.amount, 0);
    const budget = d.categories.reduce((s, c) => s + c.budget, 0);
    const over   = spt > budget;
    return `<tr class="${key === activeKey ? 'cur-row' : ''}">
      <td>${monthShort(key)}${key === activeKey ? ' ◀' : ''}</td>
      <td>${fmt(inc)}</td>
      <td class="${over ? 'td-red' : ''}">${fmt(spt)}</td>
      <td class="td-green">${fmt(sav)}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="4" class="empty-note" style="padding:1rem;text-align:center">No history yet</td></tr>';

  // ── Calendar ──
  renderCalendar(data);
}

// ── Calendar ──────────────────────────────────────────────────────────────────
let calSelectedDay = null;

function renderCalendar(data) {
  const gridEl = document.getElementById('cal-grid');
  if (!gridEl) return;

  const [y, m] = activeKey.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const firstDow    = new Date(y, m - 1, 1).getDay(); // 0=Sun
  const todayISO    = today();

  // Build lookup: date -> { expenses: [], income: [], savings: [] }
  const byDay = {};
  const ensure = d => { if (!byDay[d]) byDay[d] = { expenses: [], income: [], savings: [] }; };

  data.expenses.forEach(e => {
    const key = normaliseDate(e.date, y, m);
    ensure(key);
    byDay[key].expenses.push(e);
  });
  data.income.forEach(i => {
    const key = normaliseDate(i.date, y, m);
    ensure(key);
    byDay[key].income.push(i);
  });
  data.savings.forEach(s => {
    const key = normaliseDate(s.date, y, m);
    ensure(key);
    byDay[key].savings.push(s);
  });

  // Max daily spend for heat scaling
  const maxSpend = Math.max(1, ...Object.values(byDay).map(d =>
    d.expenses.reduce((s, e) => s + e.amount, 0)
  ));

  // Active days count for badge
  const activeDays = Object.keys(byDay).length;
  const badgeEl = document.getElementById('cal-badge');
  if (badgeEl) badgeEl.textContent = activeDays + (activeDays === 1 ? ' day' : ' days');

  // Build HTML
  let html = '<div class="cal-dow-row">';
  ['S','M','T','W','T','F','S'].forEach(d => {
    html += `<div class="cal-dow">${d}</div>`;
  });
  html += '</div>';

  // Weeks
  let day = 1;
  const totalCells = Math.ceil((firstDow + daysInMonth) / 7) * 7;

  for (let cell = 0; cell < totalCells; cell++) {
    if (cell % 7 === 0) html += '<div class="cal-week">';

    if (cell < firstDow || day > daysInMonth) {
      html += '<div class="cal-day empty"></div>';
    } else {
      const iso    = `${y}-${String(m).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
      const txData = byDay[iso];
      const isToday   = iso === todayISO;
      const hasTx     = !!txData && (txData.expenses.length + txData.income.length + txData.savings.length) > 0;
      const hasExp    = txData?.expenses?.length > 0;
      const hasIncome = txData?.income?.length > 0;
      const daySpend  = txData?.expenses?.reduce((s, e) => s + e.amount, 0) || 0;
      const selected  = iso === calSelectedDay;

      // Heat level 1–4
      let heatClass = '';
      if (hasExp) {
        const ratio = daySpend / maxSpend;
        heatClass = ratio < 0.25 ? 'heat-1' : ratio < 0.5 ? 'heat-2' : ratio < 0.75 ? 'heat-3' : 'heat-4';
      }

      const classes = [
        'cal-day',
        'clickable',                      // all valid days are now clickable
        hasTx     ? 'has-tx'      : '',
        hasExp    ? heatClass      : '',
        hasIncome ? 'has-income'   : '',
        isToday   ? 'today'        : '',
        selected  ? 'selected'     : '',
      ].filter(Boolean).join(' ');

      html += `<div class="${classes}" onclick="selectDay('${iso}')" title="Click to add or view transactions">
        <span class="cal-day-num">${day}</span>
        ${hasTx ? `<span class="cal-day-dot"></span>` : ''}
        ${hasExp ? `<span class="cal-day-bar"></span>` : ''}
      </div>`;
      day++;
    }

    if ((cell + 1) % 7 === 0) html += '</div>';
  }

  // Legend
  html += `<div class="cal-legend">
    <div class="cal-leg-item"><div class="cal-leg-swatch expense"></div>Expense</div>
    <div class="cal-leg-item"><div class="cal-leg-swatch income"></div>Income / Saving</div>
    <div class="cal-leg-item"><div class="cal-leg-swatch today"></div>Today</div>
    <div class="cal-leg-item" style="margin-left:auto;color:var(--t3);font-size:10px">Click a day to view</div>
  </div>`;

  gridEl.innerHTML = html;

  // Re-show detail if a day was selected
  if (calSelectedDay) showDayDetail(calSelectedDay, data);
}

// Convert legacy MM/DD dates to YYYY-MM-DD for the current month
function normaliseDate(date, y, m) {
  if (!date) return `${y}-${String(m).padStart(2,'0')}-01`;
  if (date.match(/^\d{4}-\d{2}-\d{2}$/)) return date;
  // Legacy MM/DD
  const [mm, dd] = date.split('/');
  return `${y}-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}`;
}

function selectDay(iso) {
  if (calSelectedDay === iso) {
    calSelectedDay = null;
    closeDayDetail();
    document.querySelectorAll('.cal-day.selected').forEach(el => el.classList.remove('selected'));
    return;
  }
  calSelectedDay = iso;
  document.querySelectorAll('.cal-day.selected').forEach(el => el.classList.remove('selected'));
  document.querySelectorAll(`.cal-day[onclick="selectDay('${iso}')"]`).forEach(el => el.classList.add('selected'));
  showDayDetail(iso, getMonth(activeKey));
}

function showDayDetail(iso, data) {
  const detailEl = document.getElementById('cal-detail');
  const dateEl   = document.getElementById('cal-detail-date');
  const listEl   = document.getElementById('cal-detail-list');
  const totalEl  = document.getElementById('cal-detail-total');
  if (!detailEl) return;

  const [y, m, d] = iso.split('-').map(Number);
  const dateObj = new Date(y, m - 1, d);
  const label   = dateObj.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const isToday = iso === today();
  const isPast  = dateObj < new Date(new Date().setHours(0,0,0,0));

  // Header: date label + chip
  const chipClass = isToday ? '' : isPast ? 'past' : '';
  const chipLabel = isToday ? 'Today' : isPast ? 'Past' : 'Future';
  dateEl.innerHTML = `${label} <span class="cal-detail-date-chip ${chipClass}">${chipLabel}</span>`;

  // Populate the category dropdowns in the form
  const catSel = document.getElementById('cal-exp-cat');
  if (catSel) {
    catSel.innerHTML = '<option value="">Category</option>' +
      data.categories.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  }

  // Gather transactions for this day
  const txs = [];
  data.expenses.forEach(e => {
    const k = normaliseDate(e.date, y, m);
    if (k === iso) {
      const cat = data.categories.find(c => c.id === e.catId);
      txs.push({ id: e.id, type: 'expense', name: e.desc, cat: cat?.name || '', amount: e.amount, icon: cat ? iconFor(data.categories.indexOf(cat)) : '💸' });
    }
  });
  data.income.forEach(i => {
    const k = normaliseDate(i.date, y, m);
    if (k === iso) txs.push({ id: i.id, type: 'income', name: i.name, cat: 'Income', amount: i.amount, icon: '💰' });
  });
  data.savings.forEach(s => {
    const k = normaliseDate(s.date, y, m);
    if (k === iso) txs.push({ id: s.id, type: 'saving', name: s.desc, cat: 'Savings', amount: s.amount, icon: '🏦' });
  });

  // Render transaction list (or empty state)
  if (txs.length === 0) {
    listEl.innerHTML = '<div class="empty-note" style="padding:4px 0">No transactions on this day yet.</div>';
    totalEl.innerHTML = '';
  } else {
    listEl.innerHTML = txs.map(tx => `
      <div class="cal-tx-row">
        <span class="cal-tx-icon">${tx.icon}</span>
        <div class="cal-tx-info">
          <div class="cal-tx-name">${tx.name}</div>
          <div class="cal-tx-cat">${tx.cat}</div>
        </div>
        <span class="cal-tx-type ${tx.type}">${tx.type}</span>
        <span class="cal-tx-amt ${tx.type}">${tx.type === 'expense' ? '-' : '+'}${fmt(tx.amount)}</span>
        <button class="del-btn" onclick="calDelTx('${tx.type}', ${tx.id})">✕</button>
      </div>`).join('');

    const totalExp = txs.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    totalEl.innerHTML = `<span>${txs.length} transaction${txs.length > 1 ? 's' : ''}</span><span>Total spent <strong>${fmt(totalExp)}</strong></span>`;
  }

  detailEl.style.display = 'block';
  // Scroll into view
  setTimeout(() => detailEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
}

function closeDayDetail() {
  const el = document.getElementById('cal-detail');
  if (el) el.style.display = 'none';
  calSelectedDay = null;
  document.querySelectorAll('.cal-day.selected').forEach(el => el.classList.remove('selected'));
}

// ── Tab switcher ──────────────────────────────────────────────────────────────
function switchCalTab(type) {
  ['expense','income','saving'].forEach(t => {
    document.getElementById(`cal-form-${t}`).style.display  = t === type ? 'block' : 'none';
    document.getElementById(`cal-tab-${t}`).classList.toggle('active', t === type);
  });
}

// ── Calendar add actions (use calSelectedDay as the date) ─────────────────────
function calAddExpense() {
  if (!calSelectedDay) return;
  const desc  = document.getElementById('cal-exp-desc').value.trim();
  const amt   = parseFloat(document.getElementById('cal-exp-amt').value);
  const catId = parseInt(document.getElementById('cal-exp-cat').value);
  if (!desc || isNaN(amt) || amt <= 0 || !catId) return shake('cal-exp-amt');
  getMonth(activeKey).expenses.push({ id: nextId++, desc, amount: amt, catId, date: calSelectedDay });
  document.getElementById('cal-exp-desc').value = '';
  document.getElementById('cal-exp-amt').value  = '';
  save();
  checkBudgetAlerts(getMonth(activeKey));
  render();
  // Re-open the same day panel after re-render
  setTimeout(() => {
    calSelectedDay = calSelectedDay; // keep it
    showDayDetail(calSelectedDay, getMonth(activeKey));
    document.querySelectorAll(`.cal-day[onclick="selectDay('${calSelectedDay}')"]`).forEach(el => el.classList.add('selected'));
  }, 50);
}

function calAddIncome() {
  if (!calSelectedDay) return;
  const name = document.getElementById('cal-inc-name').value.trim();
  const amt  = parseFloat(document.getElementById('cal-inc-amt').value);
  if (!name || isNaN(amt) || amt <= 0) return shake('cal-inc-amt');
  getMonth(activeKey).income.push({ id: nextId++, name, amount: amt, date: calSelectedDay });
  document.getElementById('cal-inc-name').value = '';
  document.getElementById('cal-inc-amt').value  = '';
  save(); render();
  setTimeout(() => {
    showDayDetail(calSelectedDay, getMonth(activeKey));
    document.querySelectorAll(`.cal-day[onclick="selectDay('${calSelectedDay}')"]`).forEach(el => el.classList.add('selected'));
  }, 50);
}

function calAddSaving() {
  if (!calSelectedDay) return;
  const desc = document.getElementById('cal-sav-desc').value.trim();
  const amt  = parseFloat(document.getElementById('cal-sav-amt').value);
  if (!desc || isNaN(amt) || amt <= 0) return shake('cal-sav-amt');
  getMonth(activeKey).savings.push({ id: nextId++, desc, amount: amt, date: calSelectedDay });
  document.getElementById('cal-sav-desc').value = '';
  document.getElementById('cal-sav-amt').value  = '';
  save(); render();
  setTimeout(() => {
    showDayDetail(calSelectedDay, getMonth(activeKey));
    document.querySelectorAll(`.cal-day[onclick="selectDay('${calSelectedDay}')"]`).forEach(el => el.classList.add('selected'));
  }, 50);
}

function calDelTx(type, id) {
  const data = getMonth(activeKey);
  const iso  = calSelectedDay;
  if (type === 'expense') data.expenses = data.expenses.filter(e => e.id !== id);
  if (type === 'income')  data.income   = data.income.filter(i => i.id !== id);
  if (type === 'saving')  data.savings  = data.savings.filter(s => s.id !== id);
  save(); render();
  setTimeout(() => {
    if (iso) {
      showDayDetail(iso, getMonth(activeKey));
      document.querySelectorAll(`.cal-day[onclick="selectDay('${iso}')"]`).forEach(el => el.classList.add('selected'));
    }
  }, 50);
}

// ── Actions ───────────────────────────────────────────────────────────────────
function addIncome() {
  const name = document.getElementById('inc-name').value.trim();
  const amt  = parseFloat(document.getElementById('inc-amt').value);
  if (!name || isNaN(amt) || amt <= 0) return shake('inc-amt');
  getMonth(activeKey).income.push({ id: nextId++, name, amount: amt, date: today() });
  document.getElementById('inc-name').value = '';
  document.getElementById('inc-amt').value  = '';
  save(); render();
}
function delIncome(id) {
  getMonth(activeKey).income = getMonth(activeKey).income.filter(i => i.id !== id);
  save(); render();
}

function addCategory() {
  const name   = document.getElementById('cat-name').value.trim();
  const budget = parseFloat(document.getElementById('cat-budget').value);
  if (!name || isNaN(budget) || budget < 0) return shake('cat-budget');
  getMonth(activeKey).categories.push({ id: nextId++, name, budget });
  document.getElementById('cat-name').value   = '';
  document.getElementById('cat-budget').value = '';
  save(); render();
}
function delCategory(id) {
  const data = getMonth(activeKey);
  data.categories = data.categories.filter(c => c.id !== id);
  data.expenses   = data.expenses.filter(e => e.catId !== id);
  save(); render();
}

function addExpense() {
  const desc  = document.getElementById('exp-desc').value.trim();
  const amt   = parseFloat(document.getElementById('exp-amt').value);
  const catId = parseInt(document.getElementById('exp-cat').value);
  if (!desc || isNaN(amt) || amt <= 0 || !catId) return shake('exp-amt');
  getMonth(activeKey).expenses.push({ id: nextId++, desc, amount: amt, catId, date: today() });
  document.getElementById('exp-desc').value = '';
  document.getElementById('exp-amt').value  = '';
  save();
  checkBudgetAlerts(getMonth(activeKey));
  render();
}
function delExpense(id) {
  getMonth(activeKey).expenses = getMonth(activeKey).expenses.filter(e => e.id !== id);
  save(); render();
}

function addSaving() {
  const desc = document.getElementById('sav-desc').value.trim();
  const amt  = parseFloat(document.getElementById('sav-amt').value);
  if (!desc || isNaN(amt) || amt <= 0) return shake('sav-amt');
  getMonth(activeKey).savings.push({ id: nextId++, desc, amount: amt, date: today() });
  document.getElementById('sav-desc').value = '';
  document.getElementById('sav-amt').value  = '';
  save(); render();
}
function delSaving(id) {
  getMonth(activeKey).savings = getMonth(activeKey).savings.filter(s => s.id !== id);
  save(); render();
}

function saveSavingsGoal() {
  const val = parseFloat(document.getElementById('savings-goal').value);
  savingsGoal[activeKey] = isNaN(val) ? 0 : val;
  save(); render();
}

// ── Shake feedback on invalid input ──────────────────────────────────────────
function shake(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.animation = 'none';
  el.style.borderColor = 'var(--coral)';
  el.style.boxShadow = '0 0 0 3px var(--coral-dim)';
  setTimeout(() => {
    el.style.borderColor = '';
    el.style.boxShadow = '';
  }, 800);
}

// ── Keyboard shortcuts ────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'ArrowLeft'  && (e.ctrlKey || e.metaKey)) changeMonth(-1);
  if (e.key === 'ArrowRight' && (e.ctrlKey || e.metaKey)) changeMonth(1);
});

// ── Theme toggle ──────────────────────────────────────────────────────────────
function toggleTheme() {
  const isLight = document.documentElement.classList.toggle('light');
  localStorage.setItem('budgtr_theme', isLight ? 'light' : 'dark');
  const label = document.getElementById('theme-label');
  if (label) label.textContent = isLight ? 'Light' : 'Dark';
}

function loadTheme() {
  const saved = localStorage.getItem('budgtr_theme');
  // Also respect OS preference if no saved preference
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const useLight = saved === 'light' || (!saved && !prefersDark);
  if (useLight) {
    document.documentElement.classList.add('light');
    const label = document.getElementById('theme-label');
    if (label) label.textContent = 'Light';
  }
}

// ── Boot ──────────────────────────────────────────────────────────────────────
loadTheme();
load();
render();
