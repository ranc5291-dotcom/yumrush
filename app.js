/* ═══════════════════════════════════════════
   YumRush — Customer App JavaScript v6
   Auth + Voice Commands + SQLite backend
   ═══════════════════════════════════════════ */

const API = window.location.origin;

let allMenuItems   = [];
let cartData       = {};
let favouriteIds   = new Set();
let reviewStars    = {};
let selectedMood   = '';
let myOrders       = [];
let currentFilter  = 'All';
let currentTag     = '';
let isRaining      = false;
let spinFilter     = 'any';
let lastSpinResult = null;
let mediaRecorder  = null;
let isRecording    = false;
let supportOpen    = false;
let supportHistory = [];

// ══ AUTH STATE ════════════════════════════════
let authToken    = localStorage.getItem('yr_token') || '';
let currentUser  = JSON.parse(localStorage.getItem('yr_user') || 'null');
let customerName = currentUser?.name || sessionStorage.getItem('yumrush_customer') || 'guest';

function getAuthHeaders() {
  return authToken
    ? { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` }
    : { 'Content-Type': 'application/json' };
}

function getSession() {
  const name = currentUser?.name || customerName || 'guest';
  return name.toLowerCase().trim().replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'guest';
}

function goToLogin() {
  window.location.href = 'login.html';
}

function doLogout() {
  localStorage.removeItem('yr_token');
  localStorage.removeItem('yr_user');
  sessionStorage.removeItem('yumrush_customer');
  window.location.href = 'login.html';
}

function toggleUserMenu() {
  const dd = document.getElementById('user-dropdown');
  if (dd) dd.style.display = dd.style.display === 'none' ? 'block' : 'none';
}

document.addEventListener('click', (e) => {
  const nu = document.getElementById('nav-user');
  const dd = document.getElementById('user-dropdown');
  if (nu && dd && !nu.contains(e.target)) dd.style.display = 'none';
});

function updateNavUser() {
  if (!currentUser) return;
  const avatar = document.getElementById('nav-avatar');
  const name   = document.getElementById('user-dd-name');
  const email  = document.getElementById('user-dd-email');
  const role   = document.getElementById('user-dd-role');
  if (avatar) avatar.textContent = currentUser.name?.[0]?.toUpperCase() || '?';
  if (name)   name.textContent   = currentUser.name  || 'Guest';
  if (email)  email.textContent  = currentUser.email || '';
  if (role)   role.textContent   = currentUser.role === 'admin' ? '🔐 Admin' : '👤 Customer';
}

// ══ INIT ══════════════════════════════════════
window.addEventListener('DOMContentLoaded', () => {
  authToken    = localStorage.getItem('yr_token') || '';
  currentUser  = JSON.parse(localStorage.getItem('yr_user') || 'null');
  customerName = currentUser?.name || sessionStorage.getItem('yumrush_customer') || 'guest';

  if (!currentUser) {
    window.location.href = 'login.html';
    return;
  }

  document.getElementById('landing').style.display     = 'none';
  document.getElementById('nav-bar').style.display     = 'flex';
  document.getElementById('pricing-bar').style.display = 'block';
  document.getElementById('app-pages').style.display   = 'block';

  updateNavUser();
  loadMenu();
  loadCart();
  checkPricingStatus();
  setInterval(checkPricingStatus, 300000);
  showPage('menu-page', document.querySelector('.tab-btn'));
});

function enterApp() {
  showPage('menu-page', document.querySelector('.tab-btn'));
}

function showPage(pageId, btn) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const page = document.getElementById(pageId);
  if (page) page.classList.add('active');
  if (btn && btn.classList && btn.classList.contains('tab-btn')) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  }
  if (pageId === 'cart-page')    renderCart();
  if (pageId === 'orders-page')  renderMyOrders();
  if (pageId === 'favs-page')    renderFavourites();
  if (pageId === 'recs-page')    loadRecommendations();
  if (pageId === 'health-page')  loadHealthPage();
}

function toast(msg, isError = false) {
  const el = document.getElementById('toast');
  document.getElementById('toast-msg').textContent = msg;
  document.getElementById('t-icon').textContent = isError ? '❌' : '✅';
  el.className = isError ? 'error show' : 'show';
  setTimeout(() => el.classList.remove('show', 'error'), 3000);
}

function catEmoji(cat) {
  return {Pizza:'🍕',Burger:'🍔',Biryani:'🍛',Sandwich:'🥪',Pasta:'🍝',
          Coffee:'☕',Drinks:'🥤',Dessert:'🍰',Healthy:'🥗',Indian:'🍲'}[cat] || '🍽️';
}

// ══ PRICING STATUS BAR ════════════════════════
async function checkPricingStatus() {
  try {
    const res  = await fetch(`${API}/pricing/status?is_raining=${isRaining}`);
    const data = await res.json();
    const bar  = document.getElementById('pricing-bar');
    if (!bar) return;
    let msg = '';
    let cls = 'pricing-bar-normal';
    if (data.is_late_night)       { msg = '🌙 Late night pricing active · Delivery fee includes night surcharge'; cls = 'pricing-bar-late'; }
    else if (data.is_peak_hours)  { msg = '🔥 Peak hour pricing · Menu prices include surge · Order early to save!'; cls = 'pricing-bar-peak'; }
    else                          { msg = '✅ Normal pricing · Free delivery on orders above ₹150'; }
    if (isRaining) msg = '🌧️ Raining! Delivery surcharge of ₹20 applied · ' + msg;
    bar.innerHTML = `<div class="pricing-bar-inner ${cls}">${msg}
      <label style="margin-left:auto;cursor:pointer;display:flex;align-items:center;gap:.4rem;font-size:.78rem">
        <input type="checkbox" onchange="toggleRain(this.checked)" ${isRaining?'checked':''}> 🌧️ It's raining
      </label></div>`;
  } catch {}
}

function toggleRain(val) {
  isRaining = val;
  checkPricingStatus();
  loadMenu();
}

// ══ MOOD AI — FIXED ═══════════════════════════════════════════════
//
// ROOT CAUSE OF BAD RECS:
//   Old code sent only {mood, customer_name} to /ai/recommend.
//   The AI had NO idea what was on the menu so it hallucinated items.
//
// FIX:
//   1. Local mood → category/tag scoring map (instant, no AI needed)
//   2. Score ALL real menu items from allMenuItems against the mood
//   3. Send top matches to AI as context: "pick from THIS list only"
//   4. Render results as actual interactive menu cards
//   5. Graceful fallback if AI/Ollama is offline
// ═════════════════════════════════════════════════════════════════

const MOOD_MAP = {
  'very hungry 😋': {
    categories: ['Biryani','Burger','Pizza','Indian','Pasta'],
    tags:        ['filling','hearty','large','protein','rich'],
    avoid:       ['diet','light','low-calorie'],
    label:       '😋 Very Hungry',
    prompt_hint: 'hearty, filling, high-calorie, satisfying'
  },
  'a bit snacky 🍟': {
    categories: ['Sandwich','Burger','Healthy','Drinks'],
    tags:        ['crispy','light','snack','quick','finger-food'],
    avoid:       ['heavy','large'],
    label:       '🍟 Snacky',
    prompt_hint: 'light snacks, finger food, quick bites'
  },
  'want something sweet 🍰': {
    categories: ['Dessert','Drinks','Coffee'],
    tags:        ['sweet','chocolate','creamy','sugary','dessert'],
    avoid:       ['spicy','salty','savory'],
    label:       '🍰 Sweet Craving',
    prompt_hint: 'sweet, sugary, desserts and sweet drinks'
  },
  'thirsty 🥤': {
    categories: ['Drinks','Coffee'],
    tags:        ['refreshing','cold','fizzy','juice','smoothie','hydrating'],
    avoid:       ['dry','fried','heavy'],
    label:       '🥤 Thirsty',
    prompt_hint: 'cold refreshing drinks, juices, smoothies'
  },
  'want something light and healthy': {
    categories: ['Healthy','Sandwich','Drinks'],
    tags:        ['light','low-calorie','fresh','salad','diet','lean'],
    avoid:       ['fried','heavy','oily','rich'],
    label:       '🥗 Light Bite',
    prompt_hint: 'light, healthy, low-calorie snacks'
  },
  'want comfort food': {
    categories: ['Pizza','Burger','Pasta','Biryani','Dessert'],
    tags:        ['comfort','cheesy','warm','indulgent','creamy','rich'],
    avoid:       ['diet','raw','spicy'],
    label:       '🍕 Comfort Food',
    prompt_hint: 'warm, cheesy, soul-soothing comfort food'
  },
  'want a rice dish': {
    categories: ['Biryani','Indian'],
    tags:        ['rice','biryani','spiced','aromatic','filling'],
    avoid:       ['diet','light','low-calorie'],
    label:       '🍛 Rice Craving',
    prompt_hint: 'rice dishes, biryani, aromatic Indian food'
  },
  'need caffeine boost': {
    categories: ['Coffee','Drinks','Dessert'],
    tags:        ['coffee','caffeine','hot','espresso','latte','mocha'],
    avoid:       ['cold','heavy','spicy'],
    label:       '☕ Need Coffee',
    prompt_hint: 'coffee, hot beverages, caffeine fix'
  },
  'want something spicy and bold': {
    categories: ['Indian','Biryani','Sandwich','Burger'],
    tags:        ['spicy','hot','bold','tangy','chilli','masala'],
    avoid:       ['mild','bland','sweet','plain'],
    label:       '🌶️ Spicy',
    prompt_hint: 'bold, spicy, hot and fiery food'
  },
  'want a protein rich meal for fitness': {
    categories: ['Healthy','Sandwich','Drinks'],
    tags:        ['protein','fresh','energizing','lean','low-calorie','green','smoothie'],
    avoid:       ['fried','sugary','oily','heavy'],
    label:       '💪 Post Workout',
    prompt_hint: 'high protein, nutritious, post-workout recovery food'
  },
  'surprise me 🎲': {
    categories: ['Pizza','Biryani','Burger','Pasta','Dessert','Indian','Sandwich','Coffee','Drinks','Healthy'],
    tags:        ['popular','classic','bestseller','trending','premium','comfort','fresh'],
    avoid:       [],
    label:       '🎲 Surprise Me',
    prompt_hint: 'anything popular, top-rated, bestselling — surprise the customer with the best items'
  },
  'anything 🍽️': {
    categories: ['Pizza','Biryani','Burger','Pasta','Dessert','Indian','Sandwich','Coffee','Drinks','Healthy'],
    tags:        ['popular','classic','bestseller','trending','premium','comfort','fresh'],
    avoid:       [],
    label:       '🍽️ Any Food',
    prompt_hint: 'top-rated popular items from any category — best of everything'
  },
  'want indian food 🇮🇳': {
    categories: ['Indian','Biryani'],
    tags:        ['indian','spiced','masala','curry','aromatic','desi','authentic'],
    avoid:       ['western','bland'],
    label:       '🇮🇳 Indian Food',
    prompt_hint: 'authentic Indian food, curries, biryanis, desi flavours'
  },
  'want something cheesy 🧀': {
    categories: ['Pizza','Burger','Pasta','Sandwich'],
    tags:        ['cheesy','cheese','creamy','loaded','indulgent'],
    avoid:       ['diet','vegan','light'],
    label:       '🧀 Cheesy',
    prompt_hint: 'cheesy, loaded, rich and gooey comfort food'
  },
  'want something veg 🌿': {
    categories: ['Healthy','Indian','Sandwich','Pasta','Dessert','Drinks'],
    tags:        ['veg','vegetarian','vegan','plant-based','fresh','green'],
    avoid:       ['non-veg','chicken','mutton','egg','meat'],
    label:       '🌿 Vegetarian',
    prompt_hint: 'vegetarian or vegan food, plant-based, meat-free'
  },
  'want a quick bite 🏃': {
    categories: ['Sandwich','Burger','Drinks','Healthy'],
    tags:        ['quick','light','snack','easy','fast','simple'],
    avoid:       ['heavy','elaborate','large'],
    label:       '🏃 Quick Bite',
    prompt_hint: 'quick easy snacks, something fast and light'
  },
  'feeling bored 😑': {
    categories: ['Pizza','Burger','Dessert','Drinks','Pasta'],
    tags:        ['fun','indulgent','comfort','cheesy','sweet','trending','popular'],
    avoid:       ['diet','bland','light'],
    label:       '😑 Bored',
    prompt_hint: 'fun indulgent crowd-pleasers that cheer you up'
  }
};

const DEFAULT_MOOD = {
  categories: [],
  tags:        [],
  avoid:       [],
  label:       '🍽️ Any Mood',
  prompt_hint: 'well-balanced, popular, highly rated'
};

function scoreMoodItem(item, signal) {
  let score = 0;
  // If no categories specified (catch-all mood), score everything equally then sort by rating
  if (signal.categories.length === 0) {
    score = 30;
  } else {
    const catIdx = signal.categories.indexOf(item.category);
    if (catIdx !== -1) score += 50 - catIdx * 3;
  }
  const itemTags = (item.tags || []).map(t => t.toLowerCase());
  signal.tags.forEach(t => { if (itemTags.includes(t.toLowerCase())) score += 15; });
  signal.avoid.forEach(t => { if (itemTags.includes(t.toLowerCase())) score -= 25; });
  // Always boost by rating so best items float to top
  if (item.avg_rating >= 4.5)      score += 20;
  else if (item.avg_rating >= 4.0) score += 12;
  else if (item.avg_rating >= 3.5) score += 6;
  // Boost by order count (popularity)
  if (item.order_count > 20)       score += 10;
  else if (item.order_count > 10)  score += 5;
  if (!item.is_available)          score -= 100;
  return score;
}

function selectMood(el, mood) {
  document.querySelectorAll('.ai-chip').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');
  selectedMood = mood;
  const btn = document.getElementById('rec-btn');
  if (btn) { btn.disabled = false; btn.style.opacity = '1'; btn.style.cursor = 'pointer'; }
}

async function getAIRecommendation() {
  if (!selectedMood) return;

  const thinkingEl = document.getElementById('rec-thinking');
  const resultEl   = document.getElementById('rec-result');
  thinkingEl.classList.add('show');
  resultEl.classList.remove('show');
  resultEl.innerHTML = '';

  try {
    // STEP 1 — score all available items locally against the mood
    const signal       = MOOD_MAP[selectedMood.trim()] || MOOD_MAP[selectedMood.trim().toLowerCase()] || DEFAULT_MOOD;
    const scored       = allMenuItems
      .filter(i => i.is_available)
      .map(i => ({ item: i, score: scoreMoodItem(i, signal) }))
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score);

    const topItems     = scored.slice(0, 8).map(x => x.item);
    const displayItems = scored.slice(0, 6).map(x => x.item);

    // STEP 2 — ask AI for a blurb using ONLY the real items as context
    let aiBlurb = '';
    let aiUsed  = false;

    if (topItems.length) {
      const menuContext = topItems.map(i =>
        `• ${i.name} (${i.category}, ₹${i.dynamic_price || i.price}, ${i.calories} cal, rated ${i.avg_rating || 'N/A'}⭐)`
      ).join('\n');

      const prompt = `You are a friendly food recommendation assistant for YumRush, a food delivery app.
A customer says their mood is: "${selectedMood}".
Mood hint: ${signal.prompt_hint}.

From the following REAL menu items available RIGHT NOW, write 2-3 warm, conversational sentences recommending why these items suit their mood.
Do NOT suggest items outside this list. Do NOT use markdown. Just plain friendly text.

Available items:
${menuContext}

Keep it under 60 words. Be specific — mention 2-3 item names from the list.`;

      try {
        const res  = await fetch(`${API}/ai/recommend`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            mood:            selectedMood,
            customer_name:   customerName || null,
            menu_context:    menuContext,
            prompt_override: prompt
          })
        });
        const data = await res.json();
        aiBlurb    = (data.recommendation || '').trim();
        aiUsed     = !!aiBlurb;
      } catch { /* AI down — use fallback */ }
    }

    // STEP 3 — local fallback blurb if AI didn't respond
    if (!aiBlurb) {
      if (displayItems.length) {
        const names = displayItems.slice(0, 3).map(i => i.name).join(', ');
        aiBlurb = `Based on your "${selectedMood}" mood, we think you'd love: ${names}. These are our top picks that perfectly match the vibe! 🍽️`;
      } else {
        aiBlurb = `We couldn't find specific items for that mood right now — browse the full menu below!`;
      }
    }

    thinkingEl.classList.remove('show');

    if (!displayItems.length) {
      resultEl.innerHTML = `<div class="rec-blurb">${aiBlurb}</div>
        <div class="rec-empty">😕 No items matched your mood right now. Try the full menu!</div>`;
      resultEl.classList.add('show');
      return;
    }

    // STEP 4 — render actual menu cards
    const cardsHTML = displayItems.map(item => {
      const dynPrice = item.dynamic_price || item.price;
      const avg      = item.avg_rating || 0;
      const filled   = Math.round(avg);
      const stars    = [1,2,3,4,5].map(i =>
        `<span class="star ${i <= filled ? 'filled' : ''}">★</span>`
      ).join('');
      const tags = (item.tags || []).slice(0, 3).map(t =>
        `<span class="item-tag">${t}</span>`
      ).join('');

      return `
        <div class="menu-card animate-in">
          <div class="card-top-row">
            <div class="cat-pill">${catEmoji(item.category)} ${item.category}</div>
            <button class="btn-fav ${favouriteIds.has(item.id) ? 'active' : ''}"
              onclick="toggleFav(${item.id})">${favouriteIds.has(item.id) ? '❤️' : '🤍'}</button>
          </div>
          <div class="item-name">${item.name}</div>
          ${tags ? `<div class="item-tags">${tags}</div>` : ''}
          <div class="item-price-row">
            <span class="item-price ${dynPrice > item.price ? 'surge' : ''}">₹${dynPrice}</span>
            ${dynPrice > item.price
              ? `<span class="base-price">₹${item.price}</span><span class="surge-badge">⚡ Surge</span>`
              : ''}
          </div>
          <div class="item-meta">
            <span>🔥 ${item.calories} cal</span>
            <span class="avail-dot">
              <span class="dot ${item.is_available ? 'green' : 'red'}"></span>
              ${item.is_available ? 'Available' : 'Out of Stock'}
            </span>
          </div>
          <div class="stars">${stars}
            <span class="star-display">${avg > 0 ? avg + ' (' + (item.reviews || []).length + ')' : 'No reviews'}</span>
          </div>
          <div class="card-footer">
            <input class="qty-input" type="number" id="qty-${item.id}" value="1" min="1" max="20"/>
            <button class="btn-add" onclick="addToCart(${item.id})"
              ${!item.is_available ? 'disabled' : ''}>+ Add</button>
          </div>
        </div>`;
    }).join('');

    resultEl.innerHTML = `
      <div class="rec-blurb">${aiUsed ? '🤖 ' : '✨ '}${aiBlurb}</div>
      <div class="rec-mood-label" style="font-size:.8rem;color:var(--muted);margin:.5rem 0 .75rem">
        Top picks for your <strong>${signal.label || selectedMood}</strong> mood
      </div>
      <div class="menu-grid stagger">${cardsHTML}</div>
      <div style="margin-top:.75rem;display:flex;gap:.5rem;flex-wrap:wrap">
        <button class="btn-coupon"
          onclick="filterByCategoryName('${signal.categories[0] || 'All'}')"
          style="font-size:.78rem">
          🍽️ See all ${signal.categories[0] || ''} items
        </button>
        <button class="btn-coupon"
          onclick="addAllRecsToCart([${displayItems.filter(i => i.is_available).map(i => i.id).join(',')}])"
          style="font-size:.78rem;background:var(--accent)">
          🛒 Add all to cart
        </button>
      </div>`;
    resultEl.classList.add('show');

  } catch {
    thinkingEl.classList.remove('show');
    resultEl.innerHTML = `<div class="rec-blurb" style="color:var(--danger)">
      ⚠️ Could not load recommendations. Make sure the API is running.</div>`;
    resultEl.classList.add('show');
  }
}

async function addAllRecsToCart(itemIds) {
  if (!itemIds || !itemIds.length) return;
  let added = 0;
  for (const id of itemIds) {
    try {
      const res = await fetch(
        `${API}/cart/add?item_id=${id}&quantity=1&session=${encodeURIComponent(getSession())}&is_raining=${isRaining}`,
        { method: 'POST', headers: getAuthHeaders() }
      );
      const d = await res.json();
      if (!d.error) added++;
    } catch {}
  }
  await loadCart();
  toast(`🛒 ${added} item(s) added to cart!`);
  showPage('cart-page', null);
}

function filterByCategoryName(cat) {
  if (!cat || cat === 'All') return;
  currentFilter = cat;
  document.querySelectorAll('.cat-tab').forEach(b => {
    b.classList.toggle('active', b.textContent.toLowerCase().includes(cat.toLowerCase()));
  });
  applyFilters();
  showPage('menu-page', document.querySelector('.tab-btn'));
  document.querySelector('.tab-btn').classList.add('active');
}

// ══ LOAD MENU ═════════════════════════════════
async function loadMenu() {
  try {
    const res  = await fetch(`${API}/menu?is_raining=${isRaining}`);
    const data = await res.json();
    allMenuItems = data.menu || [];
    buildCatTabs();
    applyFilters();
  } catch {
    const g = document.getElementById('menu-grid');
    if (g) g.innerHTML = `<div class="empty-state"><div class="icon">⚠️</div><p>Cannot connect to API.<br/>Run: <code>uvicorn main:app --reload</code></p></div>`;
  }
}

function buildCatTabs() {
  const cats = ['All', ...new Set(allMenuItems.map(i => i.category))];
  const container = document.getElementById('cat-tabs');
  if (!container) return;
  container.innerHTML = cats.map(c =>
    `<button class="cat-tab ${c==='All'?'active':''}" onclick="filterByCategory('${c}',this)">
      ${c==='All'?'🍽️ All':catEmoji(c)+' '+c}
    </button>`
  ).join('');
}

function filterByCategory(cat, btn) {
  currentFilter = cat;
  document.querySelectorAll('.cat-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  applyFilters();
}

function applyFilters() {
  let result = [...allMenuItems];
  const kw   = document.getElementById('search-input')?.value.trim().toLowerCase() || '';
  const av   = document.getElementById('avail-filter')?.value || '';
  const sv   = document.getElementById('sort-filter')?.value || 'price-asc';
  const mp   = document.getElementById('max-price')?.value || '';
  const tag  = document.getElementById('tag-filter')?.value || '';

  if (currentFilter !== 'All') result = result.filter(i => i.category === currentFilter);
  if (kw)  result = result.filter(i => i.name.toLowerCase().includes(kw) ||
                                        i.category.toLowerCase().includes(kw) ||
                                        (i.tags||[]).some(t => t.toLowerCase().includes(kw)));
  if (av)  result = result.filter(i => String(i.is_available) === av);
  if (mp)  result = result.filter(i => i.price <= Number(mp));
  if (tag) result = result.filter(i => (i.tags||[]).map(t=>t.toLowerCase()).includes(tag.toLowerCase()));

  const [sk, sd] = sv.split('-');
  const key = sk === 'calories' ? 'calories' : sk;
  result.sort((a,b) => {
    const av = a[key]||0, bv = b[key]||0;
    return typeof av === 'string'
      ? (sd==='asc'?av.localeCompare(bv):bv.localeCompare(av))
      : (sd==='asc'?av-bv:bv-av);
  });

  const label = document.getElementById('item-count-label');
  if (label) label.textContent = result.length ? `(${result.length} items)` : '';
  renderMenuItems(result);
}

// ══ RENDER MENU CARDS ═════════════════════════
function renderMenuItems(items, containerId = 'menu-grid') {
  const grid = document.getElementById(containerId);
  if (!grid) return;
  if (!items.length) {
    grid.innerHTML = `<div class="empty-state"><div class="icon">🔍</div><p>No items found.</p></div>`;
    return;
  }
  grid.innerHTML = items.map(item => menuCard(item)).join('');
}

function menuCard(item, badge = '') {
  const isFav    = favouriteIds.has(item.id);
  const avg      = item.avg_rating || 0;
  const revs     = item.reviews || [];
  const total    = revs.length;
  const posCount = revs.filter(r => r.sentiment === 'positive').length;
  const negCount = revs.filter(r => r.sentiment === 'negative').length;
  const filled   = Math.round(avg);
  const stars    = [1,2,3,4,5].map(i =>
    `<span class="star ${i<=filled?'filled':''}" onclick="setReviewStar(${item.id},${i})" id="rstar-${item.id}-${i}">★</span>`
  ).join('');
  const dynPrice  = item.dynamic_price || item.price;
  const hasSurge  = dynPrice > item.price;
  const tags      = (item.tags||[]).slice(0,3).map(t =>
    `<span class="item-tag">${t}</span>`).join('');

  return `
  <div class="menu-card animate-in" id="card-${item.id}">
    <div class="card-top-row">
      <div class="cat-pill" onclick="filterByCategoryName('${item.category}')" style="cursor:pointer" title="Filter by ${item.category}">
        ${catEmoji(item.category)} ${item.category}
      </div>
      <button class="btn-fav ${isFav?'active':''}" onclick="toggleFav(${item.id})">${isFav?'❤️':'🤍'}</button>
    </div>
    <div class="item-name">${item.name}</div>
    ${tags ? `<div class="item-tags">${tags}</div>` : ''}
    <div class="item-price-row">
      <span class="item-price ${hasSurge?'surge':''}">₹${dynPrice}</span>
      ${hasSurge ? `<span class="base-price">₹${item.price}</span><span class="surge-badge">⚡ Surge</span>` : ''}
    </div>
    <div class="item-meta">
      <span>🔥 ${item.calories} cal</span>
      <span class="avail-dot">
        <span class="dot ${item.is_available?'green':'red'}"></span>
        ${item.is_available ? 'Available' : 'Out of Stock'}
      </span>
    </div>
    <div class="stars">${stars}
      <span class="star-display">${avg>0?avg+' ('+total+')':'No reviews'}</span>
    </div>
    ${badge?`<div class="trending-badge">${badge}</div>`:''}
    <div class="card-footer">
      <input class="qty-input" type="number" id="qty-${item.id}" value="1" min="1" max="20"/>
      <button class="btn-add" onclick="addToCart(${item.id})" ${!item.is_available?'disabled':''}>+ Add</button>
    </div>
    <div class="card-actions">
      <button class="btn-action" onclick="toggleReviewPanel(${item.id})">💬 ${total}</button>
      ${total>0?`<button class="btn-action" onclick="summarizeReviews(${item.id})">🤖 AI</button>`:''}
      <button class="btn-action" onclick="loadAlsoLiked(${item.id})">🔗 Also Liked</button>
    </div>
    <div class="ai-result" id="summary-${item.id}"></div>
    <div class="also-liked-panel" id="also-liked-${item.id}" style="display:none"></div>
    <div class="review-panel" id="review-panel-${item.id}">
      <h5>Write a Review</h5>
      <div class="stars" style="margin-bottom:.5rem">
        ${[1,2,3,4,5].map(i=>`<span class="star" onclick="setReviewStar(${item.id},${i})" id="rstar-${item.id}-${i}">★</span>`).join('')}
        <span class="star-display">Tap to rate</span>
      </div>
      <input class="review-input" type="text" id="rev-name-${item.id}" placeholder="Your name"/>
      <textarea class="review-input" id="rev-comment-${item.id}" rows="2" placeholder="Your review…"></textarea>
      <button class="btn-coupon" onclick="submitReview(${item.id})">Submit</button>
      ${total>0?`
      <div style="margin-top:.75rem">
        <div class="review-summary">
          <span class="rev-stat pos">👍 ${posCount}</span>
          <span class="rev-stat neg">👎 ${negCount}</span>
          <span class="rev-stat neu">😐 ${total-posCount-negCount}</span>
        </div>
        <div class="review-list" id="rev-list-${item.id}">${renderReviewItems(revs)}</div>
      </div>`:''}
    </div>
  </div>`;
}

function renderReviewItems(revs) {
  return revs.map(r => `
    <div class="review-item ${r.sentiment==='positive'?'pos':r.sentiment==='negative'?'neg':'neu'}">
      <div class="r-name">${'★'.repeat(r.rating)}${'☆'.repeat(5-r.rating)} ${r.customer_name}</div>
      <div class="r-comment">${r.comment}</div>
      <div class="r-date">${r.date||''}</div>
    </div>`).join('');
}

function setReviewStar(itemId, val) {
  reviewStars[itemId] = val;
  for (let i = 1; i <= 5; i++) {
    const el = document.getElementById(`rstar-${itemId}-${i}`);
    if (el) el.className = 'star ' + (i <= val ? 'filled' : '');
  }
}

function toggleReviewPanel(itemId) {
  document.getElementById(`review-panel-${itemId}`)?.classList.toggle('open');
}

async function submitReview(itemId) {
  const name    = document.getElementById(`rev-name-${itemId}`).value.trim();
  const comment = document.getElementById(`rev-comment-${itemId}`).value.trim();
  const rating  = reviewStars[itemId] || 0;
  if (!name)    { toast('Enter your name', true);       return; }
  if (!rating)  { toast('Select a star rating', true);  return; }
  if (!comment) { toast('Write a comment', true);       return; }
  try {
    const res  = await fetch(`${API}/menu/${itemId}/review`, {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({customer_name:name, rating, comment})
    });
    const data = await res.json();
    if (data.error) { toast(data.error, true); return; }
    toast(`Review submitted! Avg: ${data.avg_rating} ⭐`);
    await loadMenu();
  } catch { toast('Failed to connect to API', true); }
}

async function summarizeReviews(itemId) {
  const panel = document.getElementById(`summary-${itemId}`);
  if (panel.classList.contains('show')) { panel.classList.remove('show'); return; }
  panel.textContent = '⏳ AI summarizing…'; panel.classList.add('show');
  try {
    const res  = await fetch(`${API}/ai/summarize-reviews/${itemId}`, {method:'POST'});
    const data = await res.json();
    panel.textContent = '📝 ' + (data.summary || 'No summary.');
  } catch { panel.textContent = '⚠️ AI unavailable.'; }
}

async function loadAlsoLiked(itemId) {
  const panel = document.getElementById(`also-liked-${itemId}`);
  if (!panel) return;
  if (panel.dataset.loaded) { panel.style.display = panel.style.display==='none'?'block':'none'; return; }
  panel.style.display = 'block';
  panel.innerHTML = '<div style="color:var(--muted);font-size:.8rem;padding:.5rem">Loading…</div>';
  try {
    const res  = await fetch(`${API}/recommendations/also-liked/${itemId}`);
    const data = await res.json();
    const items = data.also_liked || [];
    if (!items.length) { panel.innerHTML = '<div style="color:var(--muted);font-size:.78rem;padding:.5rem">No data yet!</div>'; return; }
    panel.innerHTML = `
      <div style="font-size:.72rem;color:var(--accent);font-weight:700;letter-spacing:.8px;text-transform:uppercase;margin-bottom:.5rem">🔗 People also ordered</div>
      ${items.map(i=>`
        <div style="display:flex;justify-content:space-between;padding:.3rem 0;border-bottom:1px dashed var(--border);font-size:.82rem">
          <span>${catEmoji(i.category)} ${i.name}</span>
          <span style="color:var(--accent2);font-weight:600">₹${i.price}</span>
        </div>`).join('')}`;
    panel.dataset.loaded = true;
  } catch { panel.innerHTML = '<div style="color:var(--muted)">Could not load.</div>'; }
}

async function toggleFav(itemId) {
  try {
    const res  = await fetch(`${API}/menu/${itemId}/favourite`, {method:'POST'});
    const data = await res.json();
    if (data.error) { toast(data.error, true); return; }
    if (data.is_favourite) favouriteIds.add(itemId); else favouriteIds.delete(itemId);
    toast(data.message);
    await loadMenu();
  } catch { toast('Failed to connect', true); }
}

async function renderFavourites() {
  try {
    const res  = await fetch(`${API}/menu/favourites`);
    const data = await res.json();
    const grid = document.getElementById('favs-grid');
    if (!grid) return;
    const items = data.favourites || [];
    if (!items.length) {
      grid.innerHTML = `<div class="empty-state"><div class="icon">❤️</div><p>No favourites yet!</p></div>`;
    } else {
      grid.innerHTML = items.map(i => menuCard(i)).join('');
    }
  } catch {}
}

// ══ CART ══════════════════════════════════════
async function addToCart(itemId) {
  const qty = Number(document.getElementById(`qty-${itemId}`)?.value) || 1;
  try {
    const res  = await fetch(`${API}/cart/add?item_id=${itemId}&quantity=${qty}&session=${encodeURIComponent(getSession())}&is_raining=${isRaining}`, {method:'POST', headers: getAuthHeaders()});
    const data = await res.json();
    if (data.error) { toast(data.error, true); return; }
    toast(`${data.cart_item.item_name} added 🛒`);
    await loadCart();
  } catch { toast('Failed to connect', true); }
}

async function loadCart() {
  try {
    const res = await fetch(`${API}/cart?session=${encodeURIComponent(getSession())}&is_raining=${isRaining}`, {headers: getAuthHeaders()});
    cartData  = await res.json();
    document.getElementById('cart-count').textContent = (cartData.items||[]).length;
  } catch {}
}

async function renderCart() {
  await loadCart();
  const container = document.getElementById('cart-content');
  if (!container) return;
  const items = cartData.items || [];
  if (!items.length) {
    container.innerHTML = `<div class="cart-empty"><div class="big-icon">🛒</div><p>Cart is empty!</p></div>`;
    return;
  }

  const subtotal    = cartData.subtotal || 0;
  const discount    = cartData.discount_amount || 0;
  const delivery    = cartData.delivery_charge || 0;
  const grandTotal  = cartData.grand_total || 0;
  const totalCals   = cartData.total_calories || 0;
  const appliedCode = cartData.applied_coupon;
  const discountPct = cartData.discount_percent || 0;

  let couponHTML = '';
  try {
    const cr = await fetch(`${API}/coupons`);
    const cd = await cr.json();
    couponHTML = (cd.coupons||[]).map(c =>
      `<span class="coupon-chip" onclick="quickApplyCoupon('${c.code}')">${c.code} ${c.discount_percent}% off</span>`
    ).join('');
  } catch {}

  const itemListHTML = items.map(item => `
    <div class="cart-item-row">
      <div class="cart-item-left">
        <span class="cart-item-cat">${catEmoji(item.category||'')} ${item.category||''}</span>
        <span class="cart-item-name">${item.item_name}</span>
      </div>
      <div class="cart-item-right">
        <div class="cart-item-qty-ctrl">
          <button onclick="updateCartQty(${item.item_id}, -1)">−</button>
          <span>${item.quantity}</span>
          <button onclick="updateCartQty(${item.item_id}, 1)">+</button>
        </div>
        <span class="cart-item-price">₹${item.unit_price} each</span>
        <button class="btn-del" onclick="removeFromCart(${item.item_id})">🗑</button>
      </div>
    </div>`).join('');

  container.innerHTML = `
    <div class="cart-items-box">${itemListHTML}</div>
    ${totalCals ? `<div class="calorie-bar">🔥 Total: <strong>${totalCals} kcal</strong></div>` : ''}
    <div style="margin-top:1rem">
      <div style="font-size:.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:.8px;margin-bottom:.4rem">Coupons</div>
      <div class="coupon-tags">${couponHTML}</div>
      <div class="coupon-box">
        <input type="text" id="coupon-input" placeholder="Enter coupon code…" value="${appliedCode||''}"/>
        ${appliedCode
          ? `<button class="btn-coupon remove" onclick="removeCoupon()">✕ Remove</button>`
          : `<button class="btn-coupon" onclick="applyCoupon()">Apply</button>`}
      </div>
      ${appliedCode ? `<div style="font-size:.82rem;color:var(--success);margin-bottom:.4rem">✅ ${appliedCode} — ${discountPct}% off</div>` : ''}
    </div>
    <div class="price-breakdown">
      <div class="price-row"><span>Order Total</span><span>₹${subtotal}</span></div>
      ${discount > 0 ? `<div class="price-row discount"><span>Discount (${discountPct}% off)</span><span>− ₹${discount}</span></div>` : ''}
      <div class="price-row">
        <span>Delivery</span>
        <span>${delivery === 0 ? '<span style="color:var(--success)">FREE 🎉</span>' : '₹' + delivery}</span>
      </div>
      ${delivery > 0 && subtotal < 150 ? `<div style="font-size:.74rem;color:var(--muted);text-align:right;margin-top:-.25rem">Add ₹${150-subtotal} more for free delivery</div>` : ''}
      <div class="price-row total"><span>You Pay</span><span style="color:var(--accent)">₹${grandTotal}</span></div>
    </div>
    <div class="checkout-box">
      <h3>📦 Delivery Details</h3>
      <div class="form-row">
        <div class="form-group">
          <label>Your Name</label>
          <input type="text" id="co-name" placeholder="e.g. Arjun Sharma" value="${currentUser?.name || customerName || ''}"/>
        </div>
        <div class="form-group">
          <label>Delivery Address</label>
          <input type="text" id="co-addr" placeholder="e.g. 42 MG Road, Bengaluru"/>
        </div>
      </div>
      <button class="btn-primary" onclick="checkout()">🚀 Place Order</button>
    </div>`;
}

async function updateCartQty(itemId, delta) {
  const item = (cartData.items||[]).find(i => i.item_id === itemId);
  if (!item) return;
  const newQty = item.quantity + delta;
  if (newQty <= 0) { await removeFromCart(itemId); return; }
  if (newQty > 20)  return;
  try {
    await fetch(`${API}/cart/${itemId}?session=${encodeURIComponent(getSession())}`, {method:'DELETE', headers:getAuthHeaders()});
    await fetch(`${API}/cart/add?item_id=${itemId}&quantity=${newQty}&session=${encodeURIComponent(getSession())}&is_raining=${isRaining}`, {method:'POST', headers:getAuthHeaders()});
    await loadCart();
    await renderCart();
  } catch { toast('Failed to update', true); }
}

async function removeFromCart(itemId) {
  try {
    const res  = await fetch(`${API}/cart/${itemId}?session=${encodeURIComponent(getSession())}`, {method:'DELETE', headers: getAuthHeaders()});
    const data = await res.json();
    if (data.error) { toast(data.error, true); return; }
    toast(data.message); renderCart();
  } catch { toast('Failed to connect', true); }
}

async function applyCoupon() {
  const code = document.getElementById('coupon-input').value.trim();
  if (!code) { toast('Enter a coupon code', true); return; }
  try {
    const res  = await fetch(`${API}/cart/apply-coupon?code=${encodeURIComponent(code)}&session=${encodeURIComponent(getSession())}`, {method:'POST', headers: getAuthHeaders()});
    const data = await res.json();
    if (data.error) { toast(data.error, true); return; }
    toast(data.message); renderCart();
  } catch { toast('Failed to connect', true); }
}

function quickApplyCoupon(code) {
  document.getElementById('coupon-input').value = code;
  applyCoupon();
}

async function removeCoupon() {
  await fetch(`${API}/cart/remove-coupon?session=${encodeURIComponent(getSession())}`, {method:'POST', headers: getAuthHeaders()});
  toast('Coupon removed'); renderCart();
}

async function checkout() {
  const name = document.getElementById('co-name').value.trim();
  const addr = document.getElementById('co-addr').value.trim();
  if (name.length < 2)  { toast('Enter your name (min 2 chars)', true); return; }
  if (addr.length < 10) { toast('Enter full delivery address', true);    return; }
  try {
    const res  = await fetch(`${API}/cart/checkout?is_raining=${isRaining}&session=${encodeURIComponent(getSession())}`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({customer_name:name, delivery_address:addr})
    });
    const data = await res.json();
    if (data.error) { toast(data.error, true); return; }
    sessionStorage.setItem('yumrush_customer', name);
    customerName = name;
    myOrders.push(data.order);
    toast(`🎉 Order placed! Total ₹${data.grand_total}`);
    await loadCart();
    setTimeout(() => {
      showPage('orders-page', document.querySelectorAll('.tab-btn')[5]);
      renderReceipt(data.order);
    }, 800);
  } catch { toast('Failed to connect', true); }
}

// ══ RECEIPT & ORDERS ══════════════════════════
function renderReceipt(order) {
  const container = document.getElementById('orders-container');
  if (!container) return;
  const itemLines = (order.items||[]).map(it =>
    `<div class="receipt-item"><span class="ri-name">${catEmoji(it.category||'')} ${it.item_name} × ${it.quantity}</span></div>`
  ).join('');
  const receiptHTML = `
    <div class="order-receipt">
      <div class="receipt-header">
        <div class="receipt-icon">🎉</div>
        <div>
          <div class="receipt-title">Order Confirmed!</div>
          <div class="receipt-sub">Estimated delivery: 30–45 mins · Order #${String(order.id||order.order_id||'').padStart(3,'0')}</div>
        </div>
      </div>
      <div class="receipt-items-list">${itemLines}</div>
      <div class="receipt-summary">
        <div class="receipt-row"><span>Order Total</span><span>₹${order.subtotal||0}</span></div>
        ${order.discount_amount>0?`<div class="receipt-row" style="color:var(--success)"><span>Discount (${order.coupon_applied})</span><span>−₹${order.discount_amount}</span></div>`:''}
        <div class="receipt-row"><span>Delivery</span><span>${order.delivery_charge===0?'FREE 🎉':'₹'+(order.delivery_charge||30)}</span></div>
        <div class="receipt-row total"><span>You Paid</span><span>₹${order.grand_total}</span></div>
      </div>
    </div>`;
  container.innerHTML = receiptHTML + renderMyOrdersHTML();
}

async function renderMyOrders() {
  const container = document.getElementById('orders-container');
  if (!container) return;
  container.innerHTML = `<div class="empty-state"><div class="icon">⏳</div><p>Loading your orders…</p></div>`;
  try {
    const res    = await fetch(`${API}/orders/my?customer_name=${encodeURIComponent(customerName)}`, {headers: getAuthHeaders()});
    const data   = await res.json();
    const orders = data.orders || [];
    if (!orders.length) {
      container.innerHTML = `<div class="empty-state"><div class="icon">📋</div><p>No orders yet! Go explore the menu 🍕</p></div>`;
      return;
    }
    const dbIds      = new Set(orders.map(o => o.id));
    const sessionOnly = myOrders.filter(o => !dbIds.has(o.id) && !dbIds.has(o.order_id));
    const allOrders   = [...orders, ...sessionOnly];
    container.innerHTML = renderMyOrdersHTML(allOrders);
    if (customerName) loadSmartReorder();
  } catch {
    if (!myOrders.length) {
      container.innerHTML = `<div class="empty-state"><div class="icon">📋</div><p>No orders yet!</p></div>`;
      return;
    }
    container.innerHTML = renderMyOrdersHTML(myOrders);
  }
}

function renderMyOrdersHTML(ordersArg) {
  const list = ordersArg || myOrders;
  if (!list.length) return '';
  return list.slice().reverse().map(o => {
    const items        = o.items || [];
    const itemsSummary = items.map(it => `${it.item_name} ×${it.quantity}`).join(', ');
    const delivery     = o.delivery_charge !== undefined ? o.delivery_charge : 30;
    return `
    <div class="order-card">
      <div class="order-card-header">
        <div class="order-num">Order #${String(o.id||o.order_id||'').padStart(3,'0')}</div>
        <div class="order-date">${o.date||o.created_at||''}</div>
      </div>
      <div class="order-items-summary">${itemsSummary || 'Items unavailable'}</div>
      <div class="order-simple-breakdown">
        <span>Subtotal ₹${o.subtotal||0}</span>
        ${o.discount_amount>0?`<span style="color:var(--success)"> − ₹${o.discount_amount} (${o.coupon_applied})</span>`:''}
        <span> + ${delivery===0?'Free delivery':'₹'+delivery+' delivery'}</span>
      </div>
      <div class="order-total-line">
        Total: <strong>₹${o.grand_total||o.total_price||0}</strong>
        <span class="status-chip">${o.status}</span>
      </div>
      <div class="order-address">📍 ${o.delivery_address||''}</div>
    </div>`;
  }).join('');
}

async function loadSmartReorder() {
  if (!customerName) return;
  try {
    const res  = await fetch(`${API}/reorder/${encodeURIComponent(customerName)}`);
    const data = await res.json();
    if (!data.has_history || !data.suggestions.length) return;
    const container = document.getElementById('orders-container');
    if (!container) return;
    const reorderHTML = `
      <div class="reorder-box">
        <div class="reorder-title">🔄 Quick Reorder — Your Favourites</div>
        <div class="reorder-grid">${data.suggestions.map(i => `
          <div class="reorder-item">
            <div class="reorder-name">${catEmoji(i.category)} ${i.name}</div>
            <div class="reorder-meta">₹${i.dynamic_price||i.price} · Ordered ${i.times_ordered}×</div>
            <button class="btn-add" style="margin-top:.4rem;font-size:.75rem;padding:.4rem"
              onclick="addToCart(${i.id})">+ Add</button>
          </div>`).join('')}
        </div>
      </div>`;
    container.insertAdjacentHTML('afterbegin', reorderHTML);
  } catch {}
}

// ══ RECOMMENDATIONS ═══════════════════════════
async function loadRecommendations() {
  const container = document.getElementById('recs-content');
  if (!container) return;
  container.innerHTML = '<div class="empty-state"><div class="icon">⏳</div><p>Loading…</p></div>';
  try {
    const [trendRes, persRes] = await Promise.all([
      fetch(`${API}/recommendations/trending`),
      customerName ? fetch(`${API}/recommendations/personalized/${encodeURIComponent(customerName)}`) : Promise.resolve(null)
    ]);
    const trendData = await trendRes.json();
    let html = '';
    if (persRes) {
      const persData = await persRes.json();
      if (persData.recommendations?.length) {
        const tag = persData.has_history
          ? `Based on your love for ${persData.top_categories.join(', ')}`
          : 'Top rated picks for you';
        html += `<div class="recs-section">
          <div class="recs-label">✨ Just For You — ${tag}</div>
          <div class="menu-grid stagger">${persData.recommendations.map(i=>menuCard(i)).join('')}</div>
        </div>`;
      }
    } else {
      html += `<div class="recs-section"><div class="recs-label" style="color:var(--muted)">💡 Place an order to unlock your personalized feed!</div></div>`;
    }
    if (trendData.trending?.length) {
      html += `<div class="recs-section">
        <div class="recs-label">🔥 Trending Now</div>
        <div class="menu-grid stagger">${trendData.trending.map(i=>menuCard(i,`🔥 ${i.orders_this_week} orders`)).join('')}</div>
      </div>`;
    }
    container.innerHTML = html || '<div class="empty-state"><div class="icon">🍽️</div><p>Nothing yet!</p></div>';
  } catch {
    container.innerHTML = '<div class="empty-state"><div class="icon">⚠️</div><p>Cannot connect.</p></div>';
  }
}

// ══ HEALTH PAGE ═══════════════════════════════
async function loadHealthPage() {
  if (customerName) {
    document.getElementById('h-name').value = customerName;
    try {
      const res  = await fetch(`${API}/health/profile/${encodeURIComponent(customerName)}`);
      const data = await res.json();
      if (data.has_profile) {
        const p = data.profile;
        document.getElementById('h-calories').value = p.calorie_goal;
        document.getElementById('h-diet').value     = p.diet_type;
        document.getElementById('h-goal').value     = p.health_goal;
        await loadHealthSuggestions();
        await loadHealthAdvice();
      }
    } catch {}
  }
}

async function saveHealthProfile() {
  const name = document.getElementById('h-name').value.trim();
  const cals = Number(document.getElementById('h-calories').value) || 2000;
  const diet = document.getElementById('h-diet').value;
  const goal = document.getElementById('h-goal').value;
  if (!name) { toast('Enter your name', true); return; }
  sessionStorage.setItem('yumrush_customer', name);
  customerName = name;
  try {
    await fetch(`${API}/health/profile`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({customer_name:name, calorie_goal:cals, diet_type:diet, health_goal:goal})
    });
    toast('Health profile saved! 🥗');
    await loadHealthSuggestions();
    await loadHealthAdvice();
  } catch { toast('Failed to save', true); }
}

async function loadHealthSuggestions() {
  if (!customerName) return;
  const container = document.getElementById('health-suggestions');
  if (!container) return;
  container.innerHTML = '<div class="empty-state"><div class="icon">⏳</div><p>Loading suggestions…</p></div>';
  try {
    const res  = await fetch(`${API}/health/suggestions/${encodeURIComponent(customerName)}`);
    const data = await res.json();
    if (!data.suggestions?.length) { container.innerHTML = ''; return; }
    const profile = data.profile || {};
    container.innerHTML = `
      <div class="health-profile-badge">
        🥗 ${profile.diet_type||'Any'} · 🎯 ${profile.health_goal||'Balanced'} · 🔥 ${data.meal_calorie_budget||0} cal/meal budget
      </div>
      <div class="recs-label" style="margin-bottom:1rem">Best Picks For Your Health Goals</div>
      <div class="menu-grid stagger">
        ${data.suggestions.map(i=>`
          <div class="menu-card animate-in">
            <div class="cat-pill">${catEmoji(i.category)} ${i.category}</div>
            <div class="item-name">${i.name}</div>
            <div class="item-tags">${(i.tags||[]).slice(0,3).map(t=>`<span class="item-tag">${t}</span>`).join('')}</div>
            <div class="item-price-row"><span class="item-price">₹${i.dynamic_price||i.price}</span></div>
            <div class="item-meta"><span>🔥 ${i.calories} cal</span>
              <span class="${i.calorie_fit?'cal-fit':'cal-over'}">${i.calorie_fit?'✅ Fits goal':'⚠️ Over budget'}</span>
            </div>
            <div class="health-score-bar"><div class="health-score-fill" style="width:${Math.min(100,i.health_score)}%"></div></div>
            <div class="card-footer">
              <input class="qty-input" type="number" id="qty-${i.id}" value="1" min="1" max="20"/>
              <button class="btn-add" onclick="addToCart(${i.id})" ${!i.is_available?'disabled':''}>+ Add</button>
            </div>
          </div>`).join('')}
      </div>`;
  } catch { container.innerHTML = ''; }
}

async function loadHealthAdvice() {
  if (!customerName) return;
  const container = document.getElementById('health-advice-box');
  if (!container) return;
  try {
    const res  = await fetch(`${API}/ai/health-advice/${encodeURIComponent(customerName)}`, {method:'POST'});
    const data = await res.json();
    if (!data.advice || data.advice.startsWith('Set up')) return;
    container.innerHTML = `
      <div class="ai-box">
        <div class="ai-label">🤖 AI Nutrition Advice</div>
        <div style="font-size:.88rem;line-height:1.7;color:var(--text)">${data.advice}</div>
        ${data.remaining_calories!==undefined?`
        <div style="margin-top:.75rem;display:flex;gap:1rem;flex-wrap:wrap">
          <div class="health-mini-stat"><div class="hms-val">${data.calorie_goal}</div><div class="hms-label">Goal</div></div>
          <div class="health-mini-stat"><div class="hms-val">${data.calories_today}</div><div class="hms-label">Today</div></div>
          <div class="health-mini-stat" style="color:${data.remaining_calories>0?'var(--success)':'var(--danger)'}">
            <div class="hms-val">${data.remaining_calories}</div><div class="hms-label">Remaining</div>
          </div>
        </div>`:''}
      </div>`;
  } catch {}
}

// ══ SPIN WHEEL ════════════════════════════════
function setSpinFilter(filter, btn) {
  spinFilter = filter;
  document.querySelectorAll('.spin-filter').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

async function doSpin() {
  const btn   = document.getElementById('spin-btn');
  const wheel = document.getElementById('spin-wheel');
  const emoji = document.getElementById('wheel-emoji');
  btn.disabled = true;
  document.getElementById('spin-result').style.display = 'none';

  const spinEmojis = ['🍕','🍔','🍛','🥗','🍝','☕','🍰','🥤','🍲','🥪'];
  let count = 0;
  const spinAnim = setInterval(() => {
    emoji.textContent = spinEmojis[count % spinEmojis.length];
    count++;
  }, 100);
  wheel.classList.add('spinning');

  try {
    const res  = await fetch(`${API}/spin`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({filter_type: spinFilter})
    });
    const data = await res.json();
    await new Promise(r => setTimeout(r, 2000));
    clearInterval(spinAnim);
    wheel.classList.remove('spinning');

    const main = data.spin_result;
    emoji.textContent = catEmoji(main.category);
    lastSpinResult = data;

    document.getElementById('spin-main-item').innerHTML = `
      <div class="spin-main-card">
        <div class="spin-item-cat">${catEmoji(main.category)} ${main.category}</div>
        <div class="spin-item-name">${main.name}</div>
        <div class="spin-item-price">₹${main.price} · 🔥 ${main.calories} cal</div>
      </div>`;

    document.getElementById('spin-combo').innerHTML = data.combo.map(i => `
      <div class="spin-combo-item">
        <span>${catEmoji(i.category)} ${i.name}</span>
        <span>₹${i.price}</span>
      </div>`).join('');

    document.getElementById('spin-total').innerHTML =
      `<div class="spin-combo-total">Combo Total: <strong>₹${data.combo_total}</strong></div>`;

    document.getElementById('spin-result').style.display = 'block';
    document.getElementById('spin-result').classList.add('slide-in');
    toast(data.fun_message);
  } catch {
    clearInterval(spinAnim);
    wheel.classList.remove('spinning');
    emoji.textContent = '⚠️';
    toast('Spin failed — API not reachable', true);
  }
  btn.disabled = false;
}

async function addSpinToCart() {
  if (!lastSpinResult) return;
  let added = 0;
  for (const item of lastSpinResult.combo) {
    if (item.is_available) {
      try {
        const res = await fetch(
          `${API}/cart/add?item_id=${item.id}&quantity=1&session=${encodeURIComponent(getSession())}&is_raining=${isRaining}`,
          { method: 'POST', headers: getAuthHeaders() }
        );
        const d = await res.json();
        if (!d.error) added++;
      } catch {}
    }
  }
  await loadCart();
  toast(`🎯 ${added} combo items added to cart!`);
  setTimeout(() => showPage('cart-page', null), 800);
}

// ══ VOICE ORDER — FIXED ══════════════════════════════════════════
//
// ROOT CAUSE OF MULTI-ITEM BUG:
//   1. vmParsedQty / vmParsedRemove called parseVoiceOrder() again
//      → re-ran NLP parse → wiped qty edits back to parsed defaults
//   2. Filler stripping ran before qty extraction
//      → "a", "an" (qty words) got deleted before being read as numbers
//   3. No debounce on mic — partial results triggered premature parse
//
// FIX:
//   • Separate renderParsedItems() from parseVoiceOrder()
//     so qty edits only redraw, never re-parse
//   • Strip fillers AFTER splitting parts so qty words survive
//   • Smarter multi-item splitting handles:
//       "two burgers and a pizza and three coffees"
//       "biryani, pasta and a coke"
//       "give me one sandwich two samosas and mango lassi"
// ═════════════════════════════════════════════════════════════════

let voiceBasket   = [];
let vmRecognition = null;
let vmRecording   = false;
let parsedItems   = [];

// ── Open / Close ───────────────────────────────────────────────
function startVoiceOrder() {
  document.getElementById('voice-modal').classList.add('open');
  voiceBasket = [];
  parsedItems = [];
  resetVoiceModal();
  renderVoiceBasket();
  renderVmQuickPicks();
  setTimeout(() => document.getElementById('vm-search')?.focus(), 200);
}

function closeVoiceModal() {
  document.getElementById('voice-modal').classList.remove('open');
  stopVoiceMic();
}

function resetVoiceModal() {
  document.getElementById('vm-search').value                          = '';
  document.getElementById('vm-search-results').style.display         = 'none';
  document.getElementById('vm-heard-box').style.display              = 'none';
  document.getElementById('vm-parsed-box').style.display             = 'none';
  document.getElementById('vm-quick').style.display                  = 'block';
  document.getElementById('vm-clear').style.display                  = 'none';
  document.getElementById('vm-mic-label').textContent                = 'Tap to speak your order';
  document.getElementById('vm-mic-icon').textContent                 = '🎙️';
  document.getElementById('vm-mic-btn').classList.remove('recording');
}

// ── Mic ─────────────────────────────────────────────────────────
function toggleVoiceMic() {
  if (vmRecording) { stopVoiceMic(); return; }

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    alert('Voice not supported in this browser. Please type in the search box.');
    return;
  }

  vmRecognition                = new SR();
  vmRecognition.lang           = 'en-IN';
  vmRecognition.continuous     = false;
  vmRecognition.interimResults = true;
  vmRecording                  = true;

  const btn   = document.getElementById('vm-mic-btn');
  const icon  = document.getElementById('vm-mic-icon');
  const label = document.getElementById('vm-mic-label');
  btn.classList.add('recording');
  icon.textContent  = '⏹️';
  label.textContent = 'Listening… speak now';

  let finalText = '';

  vmRecognition.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) finalText += e.results[i][0].transcript + ' ';
      else interim = e.results[i][0].transcript;
    }
    label.textContent = '"' + (finalText || interim).trim() + '"';
  };

  vmRecognition.onerror = (e) => {
    label.textContent = 'Error: ' + e.error + ' — please type instead';
    stopVoiceMic();
  };

  vmRecognition.onend = () => {
    stopVoiceMic();
    const heard = finalText.trim();
    if (heard) parseVoiceOrder(heard);
  };

  vmRecognition.start();
}

function stopVoiceMic() {
  vmRecording = false;
  if (vmRecognition) { try { vmRecognition.stop(); } catch (e) {} vmRecognition = null; }
  const btn   = document.getElementById('vm-mic-btn');
  const icon  = document.getElementById('vm-mic-icon');
  const label = document.getElementById('vm-mic-label');
  if (btn)   btn.classList.remove('recording');
  if (icon)  icon.textContent  = '🎙️';
  if (label) label.textContent = 'Tap to speak your order';
}

// ── Parse voice transcript into multiple items ──────────────────
//
// Handles all these naturally:
//   "two burgers and a pizza and three coffees"
//   "I want biryani, pasta and a coke"
//   "give me one sandwich two samosas and mango lassi"
//   "burger"  (single item, no qty)
//
function parseVoiceOrder(transcript) {
  document.getElementById('vm-heard-box').style.display = 'block';
  document.getElementById('vm-heard-text').textContent  = '"' + transcript + '"';
  document.getElementById('vm-quick').style.display     = 'none';

  // Word → number map (kept broad)
  const NUM_MAP = {
    one:1, two:2, three:3, four:4, five:5,
    six:6, seven:7, eight:8, nine:9, ten:10,
    a:1, an:1, couple:2, few:3, some:2, half:1
  };

  // ── Step 1: lowercase, strip sentence-level filler ─────────────
  //    DO NOT strip "a"/"an" here — they are quantity words.
  //    Only strip multi-word openers that can never be quantities.
  let text = transcript.toLowerCase();
  const sentenceFillers = [
    "i would like to order", "i'd like to order",
    "i would like",          "i'd like",
    "i want to order",       "i want",
    "i need",                "can i have",
    "can i get",             "may i have",
    "give me",               "get me",
    "order me",              "bring me",
    "please get me",         "please give me",
    "for me",                "for us",
    "please"
  ];
  // Sort longest first so longer matches take priority
  sentenceFillers.sort((a, b) => b.length - a.length);
  sentenceFillers.forEach(f => {
    text = text.split(f).join(' ');
  });
  text = text.replace(/\s+/g, ' ').trim();

  // ── Step 2: split on item separators ───────────────────────────
  //    Split on: "and", "with", "also", "plus", "as well as", ","
  //    But NOT on "and" that's inside a name like "fish and chips"
  //    Strategy: split greedily, then fuzzy-match each chunk;
  //    if a chunk alone scores badly, try merging with neighbours.
  const rawParts = text
    .split(/,|(?:\band\b)|(?:\bwith\b)|(?:\balso\b)|(?:\bplus\b)|(?:\bas well as\b)/)
    .map(p => p.trim())
    .filter(p => p.length > 0);

  // ── Step 3: for each chunk, extract qty then fuzzy-find item ───
  parsedItems = [];
  const notFound  = [];
  const mergeBuffer = [];  // holds chunks that scored 0 for neighbour-merge

  function processChunk(chunk) {
    if (!chunk || chunk.length < 1) return;

    let remaining = chunk.trim();
    let qty = 1;

    // Try leading word-number: "two burgers", "a pizza", "an orange juice"
    const wordMatch = remaining.match(
      /^(one|two|three|four|five|six|seven|eight|nine|ten|a|an|couple|few|some)\b/i
    );
    if (wordMatch) {
      qty       = NUM_MAP[wordMatch[1].toLowerCase()] || 1;
      remaining = remaining.slice(wordMatch[0].length).trim();
    } else {
      // Try leading digit: "3 burgers", "2 coffees"
      const digitMatch = remaining.match(/^(\d+)\s+/);
      if (digitMatch) {
        qty       = Math.min(parseInt(digitMatch[1]), 10);
        remaining = remaining.slice(digitMatch[0].length).trim();
      }
    }

    // Strip trailing noise words
    remaining = remaining
      .replace(/\bplease\b/g, '')
      .replace(/\bof(\s+the)?\b/g, '')
      .replace(/\bsome\b/g, '')
      .trim();

    if (remaining.length < 2) return;

    const item = fuzzyFindItem(remaining);
    if (item) {
      const existing = parsedItems.find(p => p.item.id === item.id);
      if (existing) existing.qty = Math.min(existing.qty + qty, 10);
      else parsedItems.push({ item, qty });
    } else {
      notFound.push(remaining);
    }
  }

  // ── Step 4: try each raw part; if fails try merging consecutive ─
  //    e.g. "fish" + "chips" → "fish chips" (from "fish and chips")
  for (let i = 0; i < rawParts.length; i++) {
    const part  = rawParts[i];
    let   found = false;

    // Quick-check: does this part alone produce a match?
    let testRemaining = part.trim();
    const wm = testRemaining.match(/^(one|two|three|four|five|six|seven|eight|nine|ten|a|an|couple|few|some)\b/i);
    if (wm) testRemaining = testRemaining.slice(wm[0].length).trim();
    else {
      const dm = testRemaining.match(/^(\d+)\s+/);
      if (dm) testRemaining = testRemaining.slice(dm[0].length).trim();
    }
    testRemaining = testRemaining.replace(/\bplease\b/g,'').replace(/\bof(\s+the)?\b/g,'').trim();

    if (testRemaining.length >= 2 && fuzzyFindItem(testRemaining)) {
      processChunk(part);
      found = true;
    }

    if (!found) {
      // Try merging with next part to handle "fish and chips" split
      if (i + 1 < rawParts.length) {
        const merged = part + ' ' + rawParts[i + 1];
        let mergedTest = merged.trim();
        const wmm = mergedTest.match(/^(one|two|three|four|five|six|seven|eight|nine|ten|a|an|couple|few|some)\b/i);
        if (wmm) mergedTest = mergedTest.slice(wmm[0].length).trim();
        mergedTest = mergedTest.replace(/\bplease\b/g,'').replace(/\bof(\s+the)?\b/g,'').trim();

        if (mergedTest.length >= 2 && fuzzyFindItem(mergedTest)) {
          processChunk(merged);
          i++; // skip next part since we consumed it
          found = true;
        }
      }
    }

    if (!found) {
      // Process anyway (will go to notFound if no match)
      processChunk(part);
    }
  }

  if (!parsedItems.length) {
    document.getElementById('vm-heard-text').textContent =
      '"' + transcript + '" — nothing matched. Try typing below 👇';
    return;
  }

  document.getElementById('vm-parsed-box').style.display = 'block';
  renderParsedItems(notFound);
}

// ── Render parsed items WITHOUT re-parsing ──────────────────────
//    Called by vmParsedQty + vmParsedRemove — never re-runs NLP
function renderParsedItems(notFoundArg) {
  const notFound = notFoundArg || [];
  const total    = parsedItems.reduce(
    (s, p) => s + (p.item.dynamic_price || p.item.price) * p.qty, 0
  );

  document.getElementById('vm-parsed-items').innerHTML =
    parsedItems.map((p, idx) => `
      <div class="vm-parsed-row">
        <div class="vm-parsed-info">
          <span class="vm-parsed-name">${catEmoji(p.item.category)} ${p.item.name}</span>
          <span class="vm-parsed-cat">${p.item.category} · ₹${p.item.dynamic_price || p.item.price} each</span>
        </div>
        <div style="display:flex;align-items:center;gap:.5rem">
          <div class="vm-parsed-qty">
            <button onclick="vmParsedQty(${idx}, -1)">−</button>
            <span id="pqty-${idx}">${p.qty}</span>
            <button onclick="vmParsedQty(${idx},  1)">+</button>
          </div>
          <span class="vm-parsed-price">₹${(p.item.dynamic_price || p.item.price) * p.qty}</span>
          <button class="vm-parsed-remove" onclick="vmParsedRemove(${idx})">✕</button>
        </div>
      </div>`
    ).join('') +
    (notFound.length
      ? `<div class="vm-not-found">❓ Not found: ${notFound.join(', ')} — try searching below</div>`
      : '') +
    `<div class="vm-parsed-total">Estimated Total: ₹${total}</div>`;
}

// ── Qty / remove on parsed list — redraw only, NO re-parse ──────
function vmParsedQty(idx, delta) {
  if (!parsedItems[idx]) return;
  parsedItems[idx].qty = Math.max(1, Math.min(10, parsedItems[idx].qty + delta));
  renderParsedItems();   // ← only redraws, does NOT call parseVoiceOrder
}

function vmParsedRemove(idx) {
  parsedItems.splice(idx, 1);
  if (!parsedItems.length) {
    document.getElementById('vm-parsed-box').style.display = 'none';
    return;
  }
  renderParsedItems();   // ← only redraws, does NOT call parseVoiceOrder
}

// ── Add ALL parsed items to cart at once ────────────────────────
async function addAllParsedToCart() {
  if (!parsedItems.length) return;

  const btn = document.getElementById('vm-add-all-btn');
  btn.disabled    = true;
  btn.textContent = '⏳ Adding…';

  const toAdd = [...parsedItems];   // snapshot before async loop
  let added   = 0;

  for (const { item, qty } of toAdd) {
    try {
      const res = await fetch(
        `${API}/cart/add?item_id=${item.id}&quantity=${qty}` +
        `&session=${encodeURIComponent(getSession())}&is_raining=${isRaining}`,
        { method: 'POST', headers: getAuthHeaders() }
      );
      const d = await res.json();
      if (!d.error) {
        added++;
        const existing = voiceBasket.find(b => b.item.id === item.id);
        if (existing) existing.qty += qty;
        else voiceBasket.push({ item, qty });
      } else {
        toast(`⚠️ ${item.name}: ${d.error}`, true);
      }
    } catch {
      toast(`⚠️ Could not add ${item.name}`, true);
    }
  }

  await loadCart();
  renderVoiceBasket();

  btn.textContent = `✅ ${added} item(s) added!`;
  parsedItems = [];

  setTimeout(() => {
    document.getElementById('vm-parsed-box').style.display = 'none';
    document.getElementById('vm-heard-box').style.display  = 'none';
    document.getElementById('vm-quick').style.display      = 'block';
    btn.textContent = '🛒 Add All to Cart';
    btn.disabled    = false;
    const confBtn = document.getElementById('vm-confirm-btn');
    if (confBtn) confBtn.disabled = false;
  }, 1200);

  toast(`🛒 ${added} item(s) added to cart!`);
}

// ── Manual search (single item) ─────────────────────────────────
function voiceSearch(query) {
  const q      = query.trim().toLowerCase();
  const clrBtn = document.getElementById('vm-clear');
  if (clrBtn) clrBtn.style.display = q ? 'flex' : 'none';

  const resultsBox = document.getElementById('vm-search-results');
  const quickBox   = document.getElementById('vm-quick');

  if (!q) { resultsBox.style.display = 'none'; quickBox.style.display = 'block'; return; }

  const scored = allMenuItems
    .filter(i => i.is_available)
    .map(i => {
      const name  = i.name.toLowerCase();
      const cat   = i.category.toLowerCase();
      const tags  = (i.tags || []).join(' ').toLowerCase();
      let score   = 0;
      if (name === q)              score = 100;
      else if (name.startsWith(q)) score = 80;
      else if (name.includes(q))   score = 60;
      else if (cat.includes(q))    score = 40;
      else if (tags.includes(q))   score = 30;
      else {
        q.split(' ').filter(w => w.length >= 2).forEach(w => {
          if (name.includes(w)) score += 20;
          if (cat.includes(w))  score += 10;
        });
      }
      return { item: i, score };
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  quickBox.style.display = 'none';

  if (!scored.length) {
    resultsBox.style.display = 'block';
    resultsBox.innerHTML = `<div class="vm-no-results">😕 No items found for "<strong>${query}</strong>"</div>`;
    return;
  }

  resultsBox.style.display = 'block';
  resultsBox.innerHTML = scored.map(({ item }) => {
    const inBasket = voiceBasket.find(b => b.item.id === item.id);
    return `
      <div class="vm-result-item" data-item-id="${item.id}">
        <div class="vm-result-left">
          <div class="vm-result-name">${item.name}</div>
          <div class="vm-result-meta">${catEmoji(item.category)} ${item.category} · 🔥${item.calories} cal</div>
        </div>
        <div class="vm-result-right">
          <div class="vm-result-price">₹${item.dynamic_price || item.price}</div>
          ${inBasket
            ? `<div class="vm-result-added">✓ ×${inBasket.qty}</div>`
            : `<button class="vm-result-btn" onclick="vmAddItem(${item.id})">+ Add</button>`}
        </div>
      </div>`;
  }).join('');
}

function voiceSearchKey(e) { if (e.key === 'Escape') clearVoiceSearch(); }

function clearVoiceSearch() {
  document.getElementById('vm-search').value                  = '';
  document.getElementById('vm-search-results').style.display = 'none';
  document.getElementById('vm-quick').style.display          = 'block';
  document.getElementById('vm-clear').style.display          = 'none';
}

// ── Add single item from search results ─────────────────────────
async function vmAddItem(itemId) {
  const item = allMenuItems.find(i => i.id === itemId);
  if (!item || !item.is_available) return;

  const btn = document.querySelector(`[data-item-id="${itemId}"] .vm-result-btn`);
  if (btn) { btn.disabled = true; btn.textContent = '…'; }

  try {
    const res = await fetch(
      `${API}/cart/add?item_id=${itemId}&quantity=1` +
      `&session=${encodeURIComponent(getSession())}&is_raining=${isRaining}`,
      { method: 'POST', headers: getAuthHeaders() }
    );
    const d = await res.json();
    if (d.error) {
      toast(d.error, true);
      if (btn) { btn.disabled = false; btn.textContent = '+ Add'; }
      return;
    }

    const existing = voiceBasket.find(b => b.item.id === itemId);
    if (existing) existing.qty++;
    else voiceBasket.push({ item, qty: 1 });

    await loadCart();
    toast(`✅ ${item.name} added!`);
    renderVoiceBasket();

    const row = document.querySelector(`[data-item-id="${itemId}"]`);
    if (row) {
      const right = row.querySelector('.vm-result-right');
      const entry = voiceBasket.find(b => b.item.id === itemId);
      if (right && entry) {
        right.innerHTML = `
          <div class="vm-result-price">₹${item.dynamic_price || item.price}</div>
          <div class="vm-result-added">✓ ×${entry.qty}</div>`;
      }
    }
  } catch {
    toast('Cannot connect to API', true);
    if (btn) { btn.disabled = false; btn.textContent = '+ Add'; }
  }
}

function vmChangeQty(itemId, delta) {
  const entry = voiceBasket.find(b => b.item.id === itemId);
  if (!entry) return;
  entry.qty = Math.max(1, Math.min(20, entry.qty + delta));
  renderVoiceBasket();
}

async function vmRemoveItem(itemId) {
  voiceBasket = voiceBasket.filter(b => b.item.id !== itemId);
  try {
    await fetch(
      `${API}/cart/${itemId}?session=${encodeURIComponent(getSession())}`,
      { method: 'DELETE', headers: getAuthHeaders() }
    );
    await loadCart();
  } catch {}
  renderVoiceBasket();
}

function renderVoiceBasket() {
  const el      = document.getElementById('vm-basket');
  const labelEl = document.getElementById('vm-basket-label');
  const totalEl = document.getElementById('vm-total');
  const confBtn = document.getElementById('vm-confirm-btn');
  const countEl = document.getElementById('vm-confirm-count');

  if (!voiceBasket.length) {
    el.innerHTML = '';
    if (labelEl) labelEl.style.display = 'none';
    if (totalEl) totalEl.style.display = 'none';
    if (confBtn) confBtn.disabled = true;
    if (countEl) countEl.textContent = '';
    return;
  }

  if (labelEl) labelEl.style.display = 'block';
  const total = voiceBasket.reduce(
    (s, b) => s + (b.item.dynamic_price || b.item.price) * b.qty, 0
  );

  el.innerHTML = voiceBasket.map(({ item, qty }) => `
    <div class="vm-basket-item">
      <div class="vm-basket-info">
        <div class="vm-basket-name">${catEmoji(item.category)} ${item.name}</div>
        <div class="vm-basket-price">₹${(item.dynamic_price || item.price) * qty}</div>
      </div>
      <div class="vm-basket-qty">
        <button class="vm-qty-btn"    onclick="vmChangeQty(${item.id}, -1)">−</button>
        <span class="vm-qty-val">${qty}</span>
        <button class="vm-qty-btn"    onclick="vmChangeQty(${item.id},  1)">+</button>
        <button class="vm-qty-remove" onclick="vmRemoveItem(${item.id})">🗑</button>
      </div>
    </div>`).join('');

  if (totalEl) { totalEl.style.display = 'flex'; totalEl.innerHTML = `<span>Cart Total</span><strong>₹${total}</strong>`; }
  if (confBtn) confBtn.disabled = false;
  if (countEl) countEl.textContent = `(${voiceBasket.length})`;
}

function renderVmQuickPicks() {
  const grid = document.getElementById('vm-quick-grid');
  if (!grid) return;
  const picks = [...allMenuItems]
    .filter(i => i.is_available)
    .sort((a, b) => (b.order_count || 0) - (a.order_count || 0))
    .slice(0, 12);
  grid.innerHTML = picks.map(i => `
    <button class="vm-quick-chip" onclick="vmAddItem(${i.id})">
      ${catEmoji(i.category)} ${i.name} <span>₹${i.dynamic_price || i.price}</span>
    </button>`).join('');
}

async function confirmVoiceBasket() {
  closeVoiceModal();
  await loadCart();
  showPage('cart-page', null);
  const total = voiceBasket.reduce((s, b) => s + b.qty, 0);
  toast(`🛒 ${total} item(s) in cart — fill address and place order!`);
}

// ══ COMMAND MIC (⚡ navbar button) ═══════════════════════════════
let cmdRecognition = null;
let cmdRecording   = false;

function startCommandMic() {
  if (cmdRecording) { stopCommandMic(); return; }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { toast('Voice not supported — use the 🎙️ modal instead', true); return; }

  cmdRecognition                = new SR();
  cmdRecognition.lang           = 'en-IN';
  cmdRecognition.continuous     = false;
  cmdRecognition.interimResults = false;
  cmdRecording = true;

  const btn = document.getElementById('voice-btn');
  if (btn) { btn.style.background = 'var(--danger)'; btn.textContent = '⏹️'; }
  toast('🔴 Listening… speak your command');

  cmdRecognition.onresult = (e) => {
    const heard = e.results[0][0].transcript.trim();
    toast('🎙️ Heard: "' + heard + '"');
    handleVoiceCommand(heard);
  };
  cmdRecognition.onerror = (e) => { toast('Mic error: ' + e.error, true); stopCommandMic(); };
  cmdRecognition.onend   = stopCommandMic;
  cmdRecognition.start();
}

function stopCommandMic() {
  cmdRecording = false;
  if (cmdRecognition) { try { cmdRecognition.stop(); } catch (e) {} cmdRecognition = null; }
  const btn = document.getElementById('voice-btn');
  if (btn) { btn.style.background = ''; btn.textContent = '⚡'; }
}

async function handleVoiceCommand(rawHeard) {
  const h = rawHeard.toLowerCase().trim();

  if (/\b(show|open|go to)\b.*\bcart\b/.test(h))  { showPage('cart-page', null);  toast('🛒 Cart opened'); return; }
  if (/\b(show|open|go to)\b.*\bmenu\b/.test(h))  { showPage('menu-page', document.querySelector('.tab-btn')); toast('🍽️ Menu'); return; }
  if (/\b(show|open)\b.*\borders?\b/.test(h))     { showPage('orders-page', null); toast('📋 Orders'); return; }
  if (/\bspin\b/.test(h))                          { showPage('spin-page', null);   toast('🎯 Spin!'); return; }

  if (/\b(checkout|place order|place my order|confirm order|order now|buy now)\b/.test(h)) {
    if (!(cartData.items || []).length) { toast('Cart is empty — add items first!', true); return; }
    showPage('cart-page', null);
    await renderCart();
    await new Promise(r => setTimeout(r, 600));
    const nameEl = document.getElementById('co-name');
    const addrEl = document.getElementById('co-addr');
    if (nameEl && !nameEl.value) nameEl.value = currentUser?.name || customerName || '';
    const name = nameEl?.value?.trim() || '';
    const addr = addrEl?.value?.trim() || '';
    if (name.length < 2)  { toast('Please type your name in the form', true); return; }
    if (addr.length < 10) { toast('Please type your delivery address', true); return; }
    toast('🚀 Placing order…');
    await checkout();
    return;
  }

  if (/\b(remove|delete|cancel)\b/.test(h)) {
    const raw   = h.replace(/\b(remove|delete|cancel|from cart|from my cart)\b/g, ' ').trim();
    const found = fuzzyFindItem(raw);
    if (found) {
      const inCart = (cartData.items||[]).find(ci => ci.item_id === found.id);
      if (inCart) { await removeFromCart(found.id); toast('🗑️ ' + found.name + ' removed'); }
      else toast(found.name + ' is not in cart', true);
    } else toast('Could not find that item', true);
    return;
  }

  const fillers = /\b(please|add|order|get|give|me|i|want|would|like|need|bring|can|have|to|cart|my|for|a|an|the)\b/g;
  const cleaned = h.replace(fillers, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) { toast('Try: "add biryani" or "checkout"', true); return; }

  const qty   = extractQtyFromText(cleaned);
  const query = cleaned.replace(/^\d+\s*/, '')
    .replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten)\b/gi, '').trim();
  const found = fuzzyFindItem(query || cleaned);

  if (found) {
    if (!found.is_available) { toast(found.name + ' is unavailable', true); return; }
    try {
      const res = await fetch(
        `${API}/cart/add?item_id=${found.id}&quantity=${qty}` +
        `&session=${encodeURIComponent(getSession())}&is_raining=${isRaining}`,
        { method: 'POST', headers: getAuthHeaders() }
      );
      const d = await res.json();
      if (d.error) { toast(d.error, true); return; }
      await loadCart();
      toast('✅ ' + found.name + ' ×' + qty + ' added to cart!');
    } catch { toast('API not reachable', true); }
  } else {
    startVoiceOrder();
    setTimeout(() => {
      const inp = document.getElementById('vm-search');
      if (inp) { inp.value = query || cleaned; voiceSearch(inp.value); }
    }, 400);
    toast('🔍 Searching for "' + (query || cleaned) + '"');
  }
}

// ══ FUZZY MATCH HELPERS ══════════════════════════════════════════

const NUM_WORDS = {
  one:1, two:2, three:3, four:4, five:5,
  six:6, seven:7, eight:8, nine:9, ten:10,
  a:1, an:1, couple:2, few:3
};

function extractQtyFromText(text) {
  const t = text.toLowerCase().trim();
  for (const [word, num] of Object.entries(NUM_WORDS)) {
    if (new RegExp('^' + word + '\\b').test(t)) return num;
  }
  const m = t.match(/^(\d+)/);
  return m ? Math.min(parseInt(m[1]), 10) : 1;
}

function fuzzyFindItem(query) {
  if (!query || !allMenuItems.length) return null;
  const q = query.toLowerCase().trim();
  if (!q || q.length < 2) return null;

  let best = null, bestScore = 0;

  for (const item of allMenuItems) {
    if (!item.is_available) continue;
    const name = item.name.toLowerCase();
    const cat  = item.category.toLowerCase();
    const tags = (item.tags || []).join(' ').toLowerCase();
    let score  = 0;

    if (name === q)              score = 100;
    else if (name.startsWith(q)) score = 85;
    else if (name.includes(q))   score = 65;
    else if (cat === q)          score = 50;
    else if (cat.includes(q))    score = 35;
    else if (tags.includes(q))   score = 25;
    else {
      const words = q.split(/\s+/).filter(w => w.length >= 3);
      for (const w of words) {
        if (name.includes(w))  score += 30;
        if (cat.includes(w))   score += 15;
        if (tags.includes(w))  score += 10;
      }
    }

    if (score > bestScore) { bestScore = score; best = item; }
  }

  return bestScore >= 20 ? best : null;
}

// ══ SUPPORT CHAT ══════════════════════════════
function toggleSupport() {
  supportOpen = !supportOpen;
  document.getElementById('support-window').classList.toggle('open', supportOpen);
  if (supportOpen) document.getElementById('support-input').focus();
}

function quickSupport(msg) {
  document.getElementById('support-input').value = msg;
  document.getElementById('support-quick').style.display = 'none';
  sendSupportMsg();
}

async function sendSupportMsg() {
  const input = document.getElementById('support-input');
  const msg   = input.value.trim();
  if (!msg) return;
  input.value = '';
  appendSupportMsg(msg, 'user');
  supportHistory.push({role:'user', content:msg});
  const typingId = appendSupportTyping();
  try {
    const res  = await fetch(`${API}/ai/support`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({message:msg, history:supportHistory})
    });
    const data = await res.json();
    removeTyping(typingId);
    const reply = data.reply || 'Sorry, I could not process that.';
    appendSupportMsg(reply, 'bot');
    supportHistory.push({role:'assistant', content:reply});
    await fetch(`${API}/support/save`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({customer_name:customerName||'Guest', message:msg, reply})
    }).catch(() => {});
  } catch {
    removeTyping(typingId);
    appendSupportMsg('⚠️ Support AI not reachable right now.', 'bot');
  }
}

function appendSupportMsg(text, role) {
  const c   = document.getElementById('support-messages');
  const div = document.createElement('div');
  div.className = `support-msg ${role}`;
  div.innerHTML = role === 'bot'
    ? `<span class="msg-avatar">🎧</span><div class="msg-bubble">${text}</div>`
    : `<div class="msg-bubble">${text}</div>`;
  c.appendChild(div);
  c.scrollTop = c.scrollHeight;
}

function appendSupportTyping() {
  const c   = document.getElementById('support-messages');
  const id  = 'typing-' + Date.now();
  const div = document.createElement('div');
  div.className = 'support-msg bot';
  div.id        = id;
  div.innerHTML = `<span class="msg-avatar">🎧</span><div class="msg-bubble typing-bubble"><span></span><span></span><span></span></div>`;
  c.appendChild(div);
  c.scrollTop = c.scrollHeight;
  return id;
}

function removeTyping(id) { document.getElementById(id)?.remove(); }
