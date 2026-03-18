/* ═══════════════════════════════════════════
   YumRush — Admin Panel JavaScript (v3)
   JWT Auth + Database-connected orders
   ═══════════════════════════════════════════ */

const API = 'https://yumrush-20a0.onrender.com';

let allMenuItems = [];
let allReviews   = [];
let charts       = {};
let adminToken   = localStorage.getItem('admin_token') || '';

function authHeaders() {
  return { 'Content-Type':'application/json',
           'Authorization': adminToken ? `Bearer ${adminToken}` : '' };
}

// ══ LOGIN — JWT ════════════════════════════════
async function tryLogin() {
  const email = document.getElementById('pwd-input').value.trim();
  const pwd   = document.getElementById('pwd-pass').value;
  const errEl = document.getElementById('login-error');
  errEl.style.display = 'none';

  if (!email || !pwd) { errEl.textContent = '❌ Enter email and password'; errEl.style.display='block'; return; }

  try {
    const res  = await fetch(`${API}/auth/login`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({email, password: pwd})
    });
    const data = await res.json();
    if (!res.ok) { errEl.textContent = '❌ ' + (data.detail||'Login failed'); errEl.style.display='block'; return; }
    if (data.user.role !== 'admin') {
      errEl.textContent = '❌ Admin access only'; errEl.style.display='block'; return;
    }
    adminToken = data.token;
    localStorage.setItem('admin_token', adminToken);
    document.getElementById('admin-name').textContent = data.user.name;
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('main-app').style.display     = 'block';
    loadAnalytics();
  } catch {
    errEl.textContent = '❌ Cannot connect to API. Is FastAPI running?';
    errEl.style.display = 'block';
  }
}

function logout() {
  adminToken = '';
  localStorage.removeItem('admin_token');
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('main-app').style.display     = 'none';
  document.getElementById('pwd-input').value            = '';
  document.getElementById('pwd-pass').value             = '';
  document.getElementById('login-error').style.display  = 'none';
}

// Auto-login if token saved
window.addEventListener('DOMContentLoaded', () => {
  if (adminToken) {
    fetch(`${API}/auth/me`, {headers: authHeaders()})
      .then(r => r.json())
      .then(data => {
        if (data.user?.role === 'admin') {
          document.getElementById('admin-name').textContent = data.user.name;
          document.getElementById('login-screen').style.display = 'none';
          document.getElementById('main-app').style.display     = 'block';
          loadAnalytics();
        } else { logout(); }
      }).catch(() => { logout(); });
  }
});

// ══ PAGE SWITCH ════════════════════════════════
function showPage(pageId, btn) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(pageId).classList.add('active');
  if (btn) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  }
  if (pageId === 'analytics-page') loadAnalytics();
  if (pageId === 'menu-page')      loadMenuTable();
  if (pageId === 'orders-page')    loadOrders();
  if (pageId === 'reviews-page')   loadReviews();
  if (pageId === 'support-page')   loadSupport();
}

// ══ TOAST ══════════════════════════════════════
function toast(msg, isError = false) {
  const el = document.getElementById('toast');
  document.getElementById('toast-msg').textContent = msg;
  document.getElementById('t-icon').textContent = isError ? '❌' : '✅';
  el.className = isError ? 'error show' : 'show';
  setTimeout(() => el.classList.remove('show', 'error'), 2800);
}

// ══ ANALYTICS ══════════════════════════════════
async function loadAnalytics() {
  document.getElementById('stats-grid').innerHTML =
    `<div class="empty-state" style="grid-column:1/-1"><div class="icon">⏳</div><p>Loading analytics…</p></div>`;
  try {
    const res  = await fetch(`${API}/analytics`, {headers: authHeaders()});

    // If unauthorized, show clear message
    if (res.status === 401 || res.status === 403) {
      document.getElementById('stats-grid').innerHTML =
        `<div class="empty-state" style="grid-column:1/-1"><div class="icon">🔐</div><p>Session expired — please <button onclick="logout()" style="color:var(--accent);background:none;border:none;cursor:pointer;font-family:inherit;font-size:inherit">logout and login again</button>.</p></div>`;
      return;
    }

    const data = await res.json();

    if (!data.total_orders || data.total_orders === 0) {
      document.getElementById('stats-grid').innerHTML =
        `<div class="empty-state" style="grid-column:1/-1"><div class="icon">📊</div><p>No orders yet — place an order from the customer app first!</p></div>`;
      return;
    }

    const rs = data.review_stats || {};

    document.getElementById('stats-grid').innerHTML = `
      <div class="stat-card">
        <div class="stat-label">Total Orders</div>
        <div class="stat-value">${data.total_orders}</div>
        <div class="stat-sub">All time</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Total Revenue</div>
        <div class="stat-value"><span>₹</span>${data.total_revenue.toLocaleString('en-IN')}</div>
        <div class="stat-sub">Including delivery charges</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Avg Order Value</div>
        <div class="stat-value"><span>₹</span>${data.avg_order_value}</div>
        <div class="stat-sub">Per order</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">🏆 Most Ordered</div>
        <div class="stat-value" style="font-size:.95rem;padding-top:.4rem">${data.most_ordered_item}</div>
        <div class="stat-sub">${data.item_order_counts[data.most_ordered_item]} units sold</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Total Reviews</div>
        <div class="stat-value">${rs.total || 0}</div>
        <div class="stat-sub">Avg rating: ⭐ ${rs.avg_rating || 0}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">👍 Positive Reviews</div>
        <div class="stat-value" style="color:var(--green)">${rs.positive || 0}</div>
        <div class="stat-sub">Rating ≥ 4 stars</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">👎 Negative Reviews</div>
        <div class="stat-value" style="color:var(--red)">${rs.negative || 0}</div>
        <div class="stat-sub">Rating ≤ 2 stars</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">😐 Neutral Reviews</div>
        <div class="stat-value" style="color:var(--yellow)">${rs.neutral || 0}</div>
        <div class="stat-sub">3 star reviews</div>
      </div>`;

    // Top customers table
    if (data.top_customers && data.top_customers.length) {
      const tcHTML = `
        <div class="chart-box" style="margin-bottom:1.5rem">
          <h4>👑 Top Customers</h4>
          <table style="width:100%;border-collapse:collapse;font-size:.85rem">
            <thead>
              <tr style="color:var(--muted);font-size:.72rem;letter-spacing:.8px;text-transform:uppercase">
                <th style="text-align:left;padding:.5rem .75rem;border-bottom:1px solid var(--border)">#</th>
                <th style="text-align:left;padding:.5rem .75rem;border-bottom:1px solid var(--border)">Customer</th>
                <th style="text-align:right;padding:.5rem .75rem;border-bottom:1px solid var(--border)">Orders</th>
                <th style="text-align:right;padding:.5rem .75rem;border-bottom:1px solid var(--border)">Total Spent</th>
              </tr>
            </thead>
            <tbody>
              ${data.top_customers.map((c, i) => `
                <tr>
                  <td style="padding:.5rem .75rem;color:var(--muted)">${i+1}</td>
                  <td style="padding:.5rem .75rem;font-weight:600">${c.customer_name}</td>
                  <td style="padding:.5rem .75rem;text-align:right;color:var(--accent2)">${c.order_count}</td>
                  <td style="padding:.5rem .75rem;text-align:right;font-weight:700;color:var(--yellow)">₹${c.total_spent.toLocaleString('en-IN')}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>`;
      document.getElementById('top-customers-box').innerHTML = tcHTML;
    }

    drawCharts(data);
  } catch (e) {
    document.getElementById('stats-grid').innerHTML =
      `<div class="empty-state" style="grid-column:1/-1"><div class="icon">⚠️</div><p>Cannot connect to API. Make sure FastAPI is running.<br/><code>${e.message}</code></p></div>`;
  }
}

function drawCharts(data) {
  const C = ['#6366f1','#a78bfa','#4ade80','#fbbf24','#f472b6','#34d399','#60a5fa','#f97316'];
  Object.values(charts).forEach(c => c.destroy()); charts = {};

  const base = {
    plugins: { legend: { labels: { color: '#6b6b80', font: { family: 'DM Sans' } } } },
    scales: {
      x: { ticks: { color: '#6b6b80' }, grid: { color: '#23232e' } },
      y: { ticks: { color: '#6b6b80' }, grid: { color: '#23232e' } },
    },
  };

  // Items ordered bar
  const iL = Object.keys(data.item_order_counts);
  const iV = Object.values(data.item_order_counts);
  charts.items = new Chart(document.getElementById('itemsChart'), {
    type: 'bar',
    data: { labels: iL, datasets: [{ label: 'Units Ordered', data: iV, backgroundColor: C.slice(0, iL.length), borderRadius: 6 }] },
    options: { ...base, responsive: true, maintainAspectRatio: false },
  });

  // Category doughnut
  const cL = Object.keys(data.orders_by_category);
  const cV = Object.values(data.orders_by_category);
  charts.cat = new Chart(document.getElementById('categoryChart'), {
    type: 'doughnut',
    data: { labels: cL, datasets: [{ data: cV, backgroundColor: C.slice(0, cL.length), borderWidth: 0 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: '#6b6b80', font: { family: 'DM Sans' } } } } },
  });

  // Revenue bar
  const rL = Object.keys(data.item_revenue);
  const rV = Object.values(data.item_revenue);
  charts.rev = new Chart(document.getElementById('revenueChart'), {
    type: 'bar',
    data: { labels: rL, datasets: [{ label: 'Revenue ₹', data: rV, backgroundColor: 'rgba(99,102,241,.7)', borderRadius: 6 }] },
    options: { ...base, responsive: true, maintainAspectRatio: false },
  });

  // Peak hours line
  const hL = Array.from({ length: 24 }, (_, i) => `${i}:00`);
  const hV = hL.map((_, i) => data.peak_hours[String(i)] || 0);
  charts.hours = new Chart(document.getElementById('hoursChart'), {
    type: 'line',
    data: { labels: hL, datasets: [{ label: 'Orders', data: hV, borderColor: '#6366f1', backgroundColor: 'rgba(99,102,241,.12)', pointBackgroundColor: '#6366f1', tension: .4, fill: true }] },
    options: { ...base, responsive: true, maintainAspectRatio: false },
  });

  // Daily trend line (last 14 days)
  if (data.daily_trend && data.daily_trend.length) {
    const dL = data.daily_trend.map(d => d.day);
    const dV = data.daily_trend.map(d => d.orders);
    const drV = data.daily_trend.map(d => d.revenue);
    charts.daily = new Chart(document.getElementById('dailyChart'), {
      type: 'line',
      data: {
        labels: dL,
        datasets: [
          { label: 'Orders', data: dV, borderColor: '#4ade80', backgroundColor: 'rgba(74,222,128,.1)', yAxisID: 'y', tension: .4, fill: true },
          { label: 'Revenue ₹', data: drV, borderColor: '#fbbf24', backgroundColor: 'rgba(251,191,36,.08)', yAxisID: 'y1', tension: .4, fill: false },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#6b6b80', font: { family: 'DM Sans' } } } },
        scales: {
          x:  { ticks: { color: '#6b6b80' }, grid: { color: '#23232e' } },
          y:  { ticks: { color: '#4ade80' }, grid: { color: '#23232e' }, position: 'left' },
          y1: { ticks: { color: '#fbbf24' }, grid: { drawOnChartArea: false }, position: 'right' },
        },
      },
    });
  }

  // Review sentiment pie
  const rs = data.review_stats || {};
  if (rs.total > 0) {
    charts.sentiment = new Chart(document.getElementById('sentimentChart'), {
      type: 'pie',
      data: {
        labels: ['Positive', 'Neutral', 'Negative'],
        datasets: [{ data: [rs.positive, rs.neutral, rs.negative], backgroundColor: ['#4ade80','#60a5fa','#f87171'], borderWidth: 0 }],
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: '#6b6b80', font: { family: 'DM Sans' } } } } },
    });
  }
}

// ══ MENU TABLE ═════════════════════════════════
async function loadMenuTable() {
  try {
    const res  = await fetch(`${API}/menu/sort?sort_by=id&order=asc`, {headers: authHeaders()});
    const data = await res.json();
    allMenuItems = data.menu || [];
    renderMenuTable(allMenuItems);
  } catch {
    document.getElementById('menu-tbody').innerHTML =
      `<tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--red)">Cannot connect to API.</td></tr>`;
  }
}

function renderMenuTable(items) {
  const tbody = document.getElementById('menu-tbody');
  if (!items.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--muted)">No items found.</td></tr>`;
    return;
  }
  tbody.innerHTML = items.map(item => `
    <tr>
      <td style="color:var(--muted);font-size:.8rem">#${item.id}</td>
      <td><strong>${item.name}</strong></td>
      <td><span class="cat-pill">${item.category}</span></td>
      <td style="font-weight:600;color:var(--yellow)">₹${item.price}</td>
      <td><span class="avail-badge ${item.is_available?'yes':'no'}">${item.is_available?'✅ Yes':'❌ No'}</span></td>
      <td style="color:var(--yellow)">
        ${item.avg_rating>0?'⭐ '+item.avg_rating+' ('+(item.reviews||[]).length+')':'<span style="color:var(--muted)">No reviews</span>'}
      </td>
      <td>
        <div class="action-btns">
          <button class="btn-edit" onclick="openEditModal(${item.id},${item.price},${item.is_available})">✏️ Edit</button>
          <button class="btn-toggle ${item.is_available?'on':'off'}" onclick="toggleAvailability(${item.id},${item.is_available})">
            ${item.is_available?'🔴 Disable':'🟢 Enable'}
          </button>
          <button class="btn-del" onclick="deleteItem(${item.id},'${item.name.replace(/'/g,"\\'")}')">🗑️ Delete</button>
        </div>
      </td>
    </tr>`).join('');
}

function filterMenuTable() {
  const kw    = document.getElementById('menu-search').value.trim().toLowerCase();
  const cat   = document.getElementById('menu-cat-filter').value;
  const avail = document.getElementById('menu-avail-filter').value;
  let result  = [...allMenuItems];
  if (kw)    result = result.filter(i => i.name.toLowerCase().includes(kw));
  if (cat)   result = result.filter(i => i.category === cat);
  if (avail) result = result.filter(i => String(i.is_available) === avail);
  renderMenuTable(result);
}

async function addMenuItem() {
  const name     = document.getElementById('new-name').value.trim();
  const price    = Number(document.getElementById('new-price').value);
  const category = document.getElementById('new-category').value;
  const avail    = document.getElementById('new-avail').value === 'true';
  if (!name)  { toast('Enter item name', true);     return; }
  if (!price) { toast('Enter a valid price', true); return; }
  try {
    const res  = await fetch(`${API}/menu`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, price, category, is_available: avail }),
    });
    const data = await res.json();
    if (data.error) { toast(data.error, true); return; }
    toast(`✅ "${data.item.name}" added!`);
    document.getElementById('new-name').value  = '';
    document.getElementById('new-price').value = '';
    await loadMenuTable();
  } catch { toast('Failed to connect to API', true); }
}

function openEditModal(id, price, isAvail) {
  document.getElementById('edit-id').value    = id;
  document.getElementById('edit-price').value = price;
  document.getElementById('edit-avail').value = String(isAvail);
  document.getElementById('edit-modal').classList.add('open');
}

function closeModal() { document.getElementById('edit-modal').classList.remove('open'); }

async function saveEdit() {
  const id      = document.getElementById('edit-id').value;
  const price   = document.getElementById('edit-price').value;
  const isAvail = document.getElementById('edit-avail').value;
  try {
    const res  = await fetch(`${API}/menu/${id}?price=${price}&is_available=${isAvail}`, { method: 'PUT' });
    const data = await res.json();
    if (data.error) { toast(data.error, true); return; }
    toast('✅ Item updated!');
    closeModal();
    await loadMenuTable();
  } catch { toast('Failed to connect to API', true); }
}

async function toggleAvailability(id, currentStatus) {
  try {
    const res  = await fetch(`${API}/menu/${id}?is_available=${!currentStatus}`, { method: 'PUT' });
    const data = await res.json();
    if (data.error) { toast(data.error, true); return; }
    toast(`✅ "${data.item.name}" is now ${!currentStatus?'available':'unavailable'}`);
    await loadMenuTable();
  } catch { toast('Failed to connect to API', true); }
}

async function deleteItem(id, name) {
  if (!confirm(`Are you sure you want to delete "${name}"?`)) return;
  try {
    const res  = await fetch(`${API}/menu/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.error) { toast(data.error, true); return; }
    toast(`🗑️ "${name}" deleted`);
    await loadMenuTable();
  } catch { toast('Failed to connect to API', true); }
}

// ══ ORDERS ═════════════════════════════════════
async function loadOrders() {
  const sortDir = document.getElementById('order-sort').value;
  const keyword = document.getElementById('order-search').value.trim();
  const container = document.getElementById('orders-container');
  container.innerHTML = `<div class="empty-state"><div class="icon">⏳</div><p>Loading orders…</p></div>`;
  try {
    const res  = await fetch(`${API}/orders/sort?order=${sortDir}`, {headers: authHeaders()});
    const data = await res.json();
    let list   = data.orders || [];
    if (keyword) list = list.filter(o => o.customer_name?.toLowerCase().includes(keyword.toLowerCase()));
    if (!list.length) {
      container.innerHTML = `<div class="empty-state"><div class="icon">📋</div><p>No orders yet. Place an order from the customer app!</p></div>`;
      return;
    }
    container.innerHTML = list.map(o => {
      // New format has items array; old format has single item fields
      const items = o.items || [];
      const itemsHTML = items.length
        ? items.map(it => `<div style="font-size:.85rem;padding:.2rem 0">• ${it.item_name} × ${it.quantity} = ₹${it.subtotal}</div>`).join('')
        : `<div style="font-size:.85rem">• ${o.item_name||'Unknown'} × ${o.quantity||1}</div>`;
      return `
      <div class="order-card-admin">
        <div class="oca-header">
          <div class="oca-id">Order #${String(o.id||o.order_id||'').padStart(3,'0')}</div>
          <div class="oca-date">${o.date||o.created_at||''}</div>
        </div>
        <div class="oca-body">
          <div class="oca-info">
            ${itemsHTML}
            <p style="margin-top:.5rem">👤 <strong>${o.customer_name}</strong></p>
            <p>📍 ${o.delivery_address}</p>
            ${o.coupon_applied?`<p style="color:var(--green);font-size:.75rem">🎟️ ${o.coupon_applied} (${o.discount_percent||0}% off)</p>`:''}
            <div style="margin-top:.4rem"><span class="status-chip">${o.status}</span></div>
          </div>
          <div style="text-align:right">
            <div class="oca-price">₹${o.grand_total||o.total_price||0}</div>
            <div class="oca-breakdown">
              Subtotal: ₹${o.subtotal||0}<br/>
              ${o.discount_amount>0?`Discount: −₹${o.discount_amount}<br/>`:''}
              Delivery: ₹${o.delivery_charge||30}
            </div>
          </div>
        </div>
      </div>`;
    }).join('');
  } catch(e) {
    container.innerHTML =
      `<div class="empty-state"><div class="icon">⚠️</div><p>Cannot load orders. Make sure you're logged in as admin.<br/><small>${e.message}</small></p></div>`;
  }
}

// ══ REVIEWS ════════════════════════════════════
async function loadReviews(filterType = 'all') {
  try {
    const res   = await fetch(`${API}/menu`);
    const data  = await res.json();
    const items = data.menu || [];
    allReviews  = [];
    items.forEach(item => {
      (item.reviews || []).forEach(r => {
        allReviews.push({ ...r, item_name: item.name, item_id: item.id });
      });
    });
    const posCount = allReviews.filter(r => r.sentiment==='positive').length;
    const negCount = allReviews.filter(r => r.sentiment==='negative').length;
    const neuCount = allReviews.filter(r => r.sentiment==='neutral').length;
    document.getElementById('rev-stats').innerHTML = `
      <div class="rev-stat-card">
        <div class="rv-val">${allReviews.length}</div>
        <div class="rv-label">Total Reviews</div>
      </div>
      <div class="rev-stat-card pos">
        <div class="rv-val">${posCount}</div>
        <div class="rv-label">👍 Positive (4–5 ⭐)</div>
      </div>
      <div class="rev-stat-card neg">
        <div class="rv-val">${negCount}</div>
        <div class="rv-label">👎 Negative (1–2 ⭐)</div>
      </div>
      <div class="rev-stat-card neu">
        <div class="rv-val">${neuCount}</div>
        <div class="rv-label">😐 Neutral (3 ⭐)</div>
      </div>`;
    renderReviews(filterType);
  } catch {
    document.getElementById('rev-list').innerHTML =
      `<div class="empty-state"><div class="icon">⚠️</div><p>Cannot connect to API.</p></div>`;
  }
}

function renderReviews(type = 'all') {
  const filtered = type==='all' ? allReviews : allReviews.filter(r => r.sentiment===type);
  const container = document.getElementById('rev-list');
  document.querySelectorAll('.rev-filter-btn').forEach(b => b.className='rev-filter-btn');
  const activeBtn = document.getElementById(`rev-tab-${type}`);
  if (activeBtn) activeBtn.className=`rev-filter-btn active-${type}`;
  if (!filtered.length) {
    container.innerHTML=`<div class="empty-state"><div class="icon">📝</div><p>No ${type==='all'?'':type} reviews yet.</p></div>`;
    return;
  }
  container.innerHTML = filtered.map(r => `
    <div class="review-item-admin ${r.sentiment==='positive'?'pos':r.sentiment==='negative'?'neg':'neu'}">
      <div class="ri-top">
        <div>
          <span class="ri-name">${'★'.repeat(r.rating)}${'☆'.repeat(5-r.rating)} ${r.customer_name}</span>
          <span style="margin:0 .4rem;color:var(--border)">·</span>
          <span class="ri-item">${r.item_name}</span>
        </div>
        <span class="sentiment-badge ${r.sentiment==='positive'?'pos':r.sentiment==='negative'?'neg':'neu'}">
          ${r.sentiment==='positive'?'👍 Positive':r.sentiment==='negative'?'👎 Negative':'😐 Neutral'}
        </span>
      </div>
      <div class="ri-comment">"${r.comment}"</div>
      <div class="ri-date">${r.date||''}</div>
    </div>`).join('');
}

document.addEventListener('DOMContentLoaded', () => {
  const modal = document.getElementById('edit-modal');
  if (modal) modal.addEventListener('click', e => { if (e.target===modal) closeModal(); });
});

// ══ SUPPORT QUERIES ════════════════════════════
let allSupportQueries = [];

async function loadSupport() {
  try {
    const res  = await fetch(`${API}/support/queries`);
    const data = await res.json();
    allSupportQueries = data.queries || [];

    // Stats bar
    document.getElementById('support-stats').innerHTML = `
      <div class="stat-card" style="flex:1;min-width:0">
        <div class="stat-label">Total Queries</div>
        <div class="stat-value" style="font-size:1.5rem">${data.total}</div>
      </div>
      <div class="stat-card" style="flex:1;min-width:0">
        <div class="stat-label">Unique Customers</div>
        <div class="stat-value" style="font-size:1.5rem">
          ${new Set(allSupportQueries.map(q => q.customer_name)).size}
        </div>
      </div>`;

    renderSupportList(allSupportQueries);
  } catch {
    document.getElementById('support-list').innerHTML =
      `<div class="empty-state"><div class="icon">⚠️</div><p>Cannot connect to API.</p></div>`;
  }
}

function filterSupport() {
  const kw = document.getElementById('support-search').value.trim().toLowerCase();
  const filtered = kw
    ? allSupportQueries.filter(q =>
        q.customer_name.toLowerCase().includes(kw) ||
        q.message.toLowerCase().includes(kw) ||
        q.reply.toLowerCase().includes(kw))
    : allSupportQueries;
  renderSupportList(filtered);
}

function renderSupportList(queries) {
  const container = document.getElementById('support-list');
  if (!queries.length) {
    container.innerHTML = `<div class="empty-state"><div class="icon">🎧</div><p>No support queries found.</p></div>`;
    return;
  }
  container.innerHTML = queries.map(q => `
    <div class="support-query-card">
      <div class="sq-header">
        <div style="display:flex;align-items:center;gap:.6rem">
          <span class="sq-avatar">🎧</span>
          <div>
            <div class="sq-name">${q.customer_name}</div>
            <div class="sq-date">${q.date}</div>
          </div>
        </div>
        <span class="sq-id">#${String(q.id).padStart(3,'0')}</span>
      </div>
      <div class="sq-row">
        <div class="sq-label">Customer asked:</div>
        <div class="sq-msg user">${q.message}</div>
      </div>
      <div class="sq-row">
        <div class="sq-label">AI replied:</div>
        <div class="sq-msg bot">${q.reply}</div>
      </div>
    </div>`).join('');
}
