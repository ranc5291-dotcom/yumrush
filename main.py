from dotenv import load_dotenv
load_dotenv()
"""
YumRush — FastAPI Backend v6
Groq API replaces Ollama — fast, free, works on any server
  ✅ SQLite database (built into Python, zero install)
  ✅ JWT authentication (built-in libraries only)
  ✅ Groq API (llama3-8b-8192 — free & ultra fast)
  ✅ Dynamic pricing
  ✅ Health-aware ordering
  ✅ Spin wheel
  ✅ Voice order parsing
  ✅ Smart reorder
  ✅ AI recommendations + support chat
  ✅ 65+ menu items
"""


from fastapi import FastAPI, Query, Response, status, Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from datetime import datetime, timedelta
from contextlib import asynccontextmanager
from typing import Optional, List
from collections import defaultdict
from groq import Groq
import os, math, random
import sqlite3, json, hashlib, hmac, base64, secrets, re

# ════════════════════════════════════════════════════════════════════
# ══ CONFIG
# ════════════════════════════════════════════════════════════════════

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GROQ_MODEL = "llama-3.3-70b-versatile"         # free, fast, excellent
groq_client  = Groq(api_key=GROQ_API_KEY) if GROQ_API_KEY else None

DB_PATH    = os.getenv("DB_PATH", "yumrush.db")
JWT_SECRET = os.getenv("JWT_SECRET", "yumrush-secret-key-change-in-production")
TOKEN_DAYS = 30

# ════════════════════════════════════════════════════════════════════
# ══ DATABASE — SQLite
# ════════════════════════════════════════════════════════════════════

def db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn

def init_db():
    with db() as c:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            name       TEXT NOT NULL,
            email      TEXT UNIQUE NOT NULL,
            password   TEXT NOT NULL,
            role       TEXT DEFAULT 'customer',
            created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS menu_items (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            name         TEXT UNIQUE NOT NULL,
            price        INTEGER NOT NULL,
            category     TEXT NOT NULL,
            is_available INTEGER DEFAULT 1,
            calories     INTEGER DEFAULT 300,
            tags         TEXT DEFAULT '[]',
            order_count  INTEGER DEFAULT 0,
            avg_rating   REAL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS reviews (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            item_id       INTEGER REFERENCES menu_items(id) ON DELETE CASCADE,
            customer_name TEXT NOT NULL,
            rating        INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
            comment       TEXT NOT NULL,
            sentiment     TEXT,
            created_at    TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS orders (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            customer_name    TEXT NOT NULL,
            customer_email   TEXT,
            items_json       TEXT NOT NULL,
            subtotal         INTEGER NOT NULL,
            discount_amount  INTEGER DEFAULT 0,
            discount_percent INTEGER DEFAULT 0,
            coupon_applied   TEXT,
            delivery_charge  INTEGER DEFAULT 30,
            delivery_address TEXT NOT NULL,
            grand_total      INTEGER NOT NULL,
            total_calories   INTEGER DEFAULT 0,
            status           TEXT DEFAULT 'confirmed',
            hour             INTEGER,
            created_at       TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS cart (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            session_key TEXT NOT NULL,
            item_id     INTEGER REFERENCES menu_items(id) ON DELETE CASCADE,
            quantity    INTEGER NOT NULL DEFAULT 1,
            unit_price  INTEGER NOT NULL,
            added_at    TEXT DEFAULT (datetime('now')),
            UNIQUE(session_key, item_id)
        );
        CREATE TABLE IF NOT EXISTS applied_coupons (
            session_key      TEXT PRIMARY KEY,
            code             TEXT,
            discount_percent INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS favourites (
            session_key TEXT NOT NULL,
            item_id     INTEGER REFERENCES menu_items(id) ON DELETE CASCADE,
            PRIMARY KEY (session_key, item_id)
        );
        CREATE TABLE IF NOT EXISTS coupons (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            code             TEXT UNIQUE NOT NULL,
            discount_percent INTEGER NOT NULL,
            is_active        INTEGER DEFAULT 1
        );
        CREATE TABLE IF NOT EXISTS health_profiles (
            customer_name TEXT PRIMARY KEY,
            calorie_goal  INTEGER DEFAULT 2000,
            diet_type     TEXT DEFAULT 'any',
            health_goal   TEXT DEFAULT 'balanced',
            allergies     TEXT DEFAULT '[]',
            updated_at    TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS support_queries (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            customer_name TEXT,
            message       TEXT NOT NULL,
            reply         TEXT,
            created_at    TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_name);
        CREATE INDEX IF NOT EXISTS idx_reviews_item    ON reviews(item_id);
        CREATE INDEX IF NOT EXISTS idx_cart_session    ON cart(session_key);
        """)
        c.commit()
    print("✅ Database ready →", DB_PATH)

def seed_db():
    with db() as c:
        if c.execute("SELECT COUNT(*) FROM menu_items").fetchone()[0] > 0:
            return
        items = [
            # Pizza
            ("Margherita Pizza",        299, "Pizza",   1, 820,  '["veg","classic"]'),
            ("Pepperoni Pizza",          349, "Pizza",   1, 950,  '["non-veg"]'),
            ("BBQ Chicken Pizza",        379, "Pizza",   1, 990,  '["non-veg","high-protein"]'),
            ("Paneer Tikka Pizza",       329, "Pizza",   1, 860,  '["veg","spicy"]'),
            ("Farm Fresh Veggie Pizza",  319, "Pizza",   1, 720,  '["veg","healthy"]'),
            ("Double Cheese Pizza",      359, "Pizza",   1, 1050, '["veg","indulgent"]'),
            ("Mushroom Truffle Pizza",   399, "Pizza",   1, 780,  '["veg","premium"]'),
            ("Chicken Tikka Pizza",      369, "Pizza",   0, 920,  '["non-veg","spicy"]'),
            # Burger
            ("Classic Burger",           199, "Burger",  1, 540,  '["non-veg","classic"]'),
            ("Cheese Burger",            229, "Burger",  1, 620,  '["non-veg","indulgent"]'),
            ("Spicy Chicken Burger",     249, "Burger",  1, 590,  '["non-veg","spicy"]'),
            ("Mushroom Swiss Burger",    259, "Burger",  1, 560,  '["veg"]'),
            ("Veggie Delight Burger",    189, "Burger",  1, 420,  '["veg","healthy","low-cal"]'),
            ("Double Smash Burger",      299, "Burger",  1, 850,  '["non-veg","high-protein"]'),
            ("Crispy Chicken Burger",    239, "Burger",  1, 610,  '["non-veg"]'),
            ("Paneer Tikka Burger",      219, "Burger",  1, 480,  '["veg","spicy"]'),
            # Biryani
            ("Chicken Biryani",          279, "Biryani", 1, 680,  '["non-veg","classic","high-protein"]'),
            ("Veg Biryani",              229, "Biryani", 1, 520,  '["veg","classic"]'),
            ("Mutton Biryani",           349, "Biryani", 1, 780,  '["non-veg","premium","high-protein"]'),
            ("Egg Biryani",              249, "Biryani", 1, 580,  '["non-veg"]'),
            ("Prawn Biryani",            379, "Biryani", 1, 640,  '["non-veg","seafood","premium"]'),
            ("Paneer Biryani",           269, "Biryani", 1, 560,  '["veg","premium"]'),
            ("Hyderabadi Dum Biryani",   319, "Biryani", 1, 710,  '["non-veg","spicy","classic"]'),
            ("Mushroom Biryani",         239, "Biryani", 1, 490,  '["veg","healthy"]'),
            # Sandwich
            ("Grilled Veg Sandwich",     149, "Sandwich",1, 320,  '["veg","low-cal","healthy"]'),
            ("Club Sandwich",            189, "Sandwich",1, 480,  '["non-veg"]'),
            ("BLT Sandwich",             179, "Sandwich",1, 430,  '["non-veg","classic"]'),
            ("Chicken Caesar Wrap",      199, "Sandwich",1, 520,  '["non-veg","high-protein"]'),
            ("Avocado Toast",            169, "Sandwich",1, 290,  '["veg","healthy","keto"]'),
            ("Egg Mayo Sandwich",        149, "Sandwich",1, 380,  '["non-veg","classic"]'),
            # Pasta
            ("Pasta Arrabbiata",         249, "Pasta",   1, 480,  '["veg","spicy"]'),
            ("Pasta Alfredo",            279, "Pasta",   1, 620,  '["veg","indulgent"]'),
            ("Pasta Pesto",              269, "Pasta",   1, 510,  '["veg","healthy"]'),
            ("Chicken Carbonara",        299, "Pasta",   1, 720,  '["non-veg","high-protein"]'),
            ("Prawn Aglio Olio",         329, "Pasta",   1, 540,  '["non-veg","seafood","keto"]'),
            ("Mac and Cheese",           219, "Pasta",   1, 680,  '["veg","indulgent"]'),
            # Coffee
            ("Cappuccino",                99, "Coffee",  1,  90,  '["veg","classic"]'),
            ("Cold Coffee",              119, "Coffee",  1, 180,  '["veg"]'),
            ("Espresso",                  79, "Coffee",  1,  10,  '["veg","keto","low-cal"]'),
            ("Caramel Macchiato",        149, "Coffee",  1, 250,  '["veg","sweet"]'),
            ("Dalgona Coffee",           139, "Coffee",  1, 210,  '["veg","trending"]'),
            ("Filter Coffee",             89, "Coffee",  1,  60,  '["veg","classic"]'),
            # Drinks
            ("Coke",                      59, "Drinks",  1, 140,  '["veg"]'),
            ("Mango Shake",               89, "Drinks",  1, 280,  '["veg"]'),
            ("Fresh Lime Soda",           69, "Drinks",  1,  40,  '["veg","low-cal","healthy"]'),
            ("Watermelon Juice",          79, "Drinks",  1,  80,  '["veg","healthy","low-cal"]'),
            ("Protein Shake",            149, "Drinks",  1, 240,  '["non-veg","high-protein","keto"]'),
            ("Masala Chaas",              59, "Drinks",  1,  70,  '["veg","healthy","probiotic"]'),
            # Dessert
            ("Chocolate Brownie",         99, "Dessert", 1, 380,  '["veg","sweet","indulgent"]'),
            ("Gulab Jamun",               79, "Dessert", 1, 310,  '["veg","classic","sweet"]'),
            ("Ice Cream Sundae",         129, "Dessert", 1, 420,  '["veg","sweet","indulgent"]'),
            ("Tiramisu",                 169, "Dessert", 1, 460,  '["veg","premium","sweet"]'),
            ("Rasgulla",                  89, "Dessert", 1, 260,  '["veg","classic","sweet"]'),
            ("Cheesecake Slice",         149, "Dessert", 1, 490,  '["veg","premium"]'),
            ("Fruit Salad Bowl",          99, "Dessert", 1, 180,  '["veg","healthy","low-cal"]'),
            # Healthy
            ("Quinoa Protein Bowl",      299, "Healthy", 1, 420,  '["veg","high-protein","keto","healthy"]'),
            ("Grilled Chicken Salad",    279, "Healthy", 1, 380,  '["non-veg","high-protein","keto","low-cal"]'),
            ("Acai Berry Bowl",          249, "Healthy", 1, 310,  '["veg","antioxidant","healthy"]'),
            ("Egg White Omelette",       189, "Healthy", 1, 210,  '["non-veg","keto","high-protein","low-cal"]'),
            ("Buddha Bowl",              269, "Healthy", 1, 450,  '["veg","vegan","balanced"]'),
            ("Detox Green Salad",        199, "Healthy", 1, 160,  '["veg","vegan","low-cal","detox"]'),
            # Indian
            ("Butter Chicken Naan",      319, "Indian",  1, 720,  '["non-veg","classic","high-protein"]'),
            ("Dal Makhani Rice",         249, "Indian",  1, 580,  '["veg","classic","protein"]'),
            ("Palak Paneer Roti",        269, "Indian",  1, 490,  '["veg","iron-rich","healthy"]'),
            ("Chole Bhature",            199, "Indian",  1, 680,  '["veg","classic","indulgent"]'),
            ("Fish Curry Rice",          299, "Indian",  1, 610,  '["non-veg","seafood","omega3"]'),
            ("Pav Bhaji",                169, "Indian",  1, 440,  '["veg","street-food","classic"]'),
        ]
        c.executemany(
            "INSERT OR IGNORE INTO menu_items (name,price,category,is_available,calories,tags) VALUES (?,?,?,?,?,?)",
            items
        )
        c.executemany(
            "INSERT OR IGNORE INTO coupons (code,discount_percent) VALUES (?,?)",
            [("SAVE10",10),("WELCOME20",20),("FLAT30",30),("YUMRUSH",15),("HEALTHY15",15),("NIGHT10",10)]
        )
        c.execute(
            "INSERT OR IGNORE INTO users (name,email,password,role) VALUES (?,?,?,?)",
            ("Admin","admin@yumrush.com", _hash_pw("admin123"), "admin")
        )
        c.commit()
    print("✅ Database seeded — 65 menu items, 6 coupons, 1 admin")

# ════════════════════════════════════════════════════════════════════
# ══ JWT AUTH
# ════════════════════════════════════════════════════════════════════

def _b64u(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()

def _b64u_dec(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (4 - len(s) % 4) % 4)

def _hash_pw(password: str) -> str:
    salt = secrets.token_hex(16)
    h    = hashlib.sha256(f"{salt}{password}".encode()).hexdigest()
    return f"{salt}:{h}"

def _check_pw(password: str, stored: str) -> bool:
    try:
        salt, h = stored.split(":")
        return hashlib.sha256(f"{salt}{password}".encode()).hexdigest() == h
    except Exception:
        return False

def _make_jwt(user_id: int, email: str, role: str) -> str:
    header  = _b64u(json.dumps({"alg":"HS256","typ":"JWT"}, separators=(",",":")).encode())
    payload = _b64u(json.dumps({
        "user_id": user_id, "email": email, "role": role,
        "exp": (datetime.utcnow() + timedelta(days=TOKEN_DAYS)).timestamp(),
        "iat": datetime.utcnow().timestamp(),
    }, separators=(",",":")).encode())
    sig_in = f"{header}.{payload}".encode()
    sig    = _b64u(hmac.new(JWT_SECRET.encode(), sig_in, hashlib.sha256).digest())
    return f"{header}.{payload}.{sig}"

def _verify_jwt(token: str) -> Optional[dict]:
    try:
        h, p, s = token.split(".")
        sig_in   = f"{h}.{p}".encode()
        expected = _b64u(hmac.new(JWT_SECRET.encode(), sig_in, hashlib.sha256).digest())
        if not secrets.compare_digest(s, expected):
            return None
        payload = json.loads(_b64u_dec(p))
        if payload.get("exp") and datetime.utcnow().timestamp() > payload["exp"]:
            return None
        return payload
    except Exception:
        return None

_bearer = HTTPBearer(auto_error=False)

def current_user(creds: HTTPAuthorizationCredentials = Depends(_bearer)):
    if not creds:
        raise HTTPException(401, "Not authenticated — please login")
    data = _verify_jwt(creds.credentials)
    if not data:
        raise HTTPException(401, "Token invalid or expired — please login again")
    return data

def admin_user(user=Depends(current_user)):
    if user.get("role") != "admin":
        raise HTTPException(403, "Admin access required")
    return user

def optional_user(creds: HTTPAuthorizationCredentials = Depends(_bearer)):
    if not creds:
        return None
    return _verify_jwt(creds.credentials)

# ════════════════════════════════════════════════════════════════════
# ══ LIFESPAN
# ════════════════════════════════════════════════════════════════════

@asynccontextmanager
async def lifespan(app):
    print("⚡ YumRush starting…")
    init_db()
    seed_db()
    if GROQ_API_KEY:
        print(f"✅ Groq AI ready — model: {GROQ_MODEL}")
    else:
        print("⚠️  GROQ_API_KEY not set — AI features will return fallback messages")
    yield
    print("🔻 YumRush shutting down…")

# ════════════════════════════════════════════════════════════════════
# ══ APP
# ════════════════════════════════════════════════════════════════════

app = FastAPI(title="YumRush API v6", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"]
)

# ════════════════════════════════════════════════════════════════════
# ══ PYDANTIC MODELS
# ════════════════════════════════════════════════════════════════════

class RegisterRequest(BaseModel):
    name:     str = Field(..., min_length=2)
    email:    str = Field(..., min_length=5)
    password: str = Field(..., min_length=6)

class LoginRequest(BaseModel):
    email:    str
    password: str

class NewMenuItem(BaseModel):
    name:         str       = Field(..., min_length=2, max_length=100)
    price:        int       = Field(..., gt=0)
    category:     str       = Field(..., min_length=2)
    is_available: bool      = True
    calories:     int       = Field(default=300)
    tags:         List[str] = []

class CheckoutRequest(BaseModel):
    customer_name:    str = Field(..., min_length=2)
    delivery_address: str = Field(..., min_length=10)
    customer_email:   Optional[str] = None

class ReviewRequest(BaseModel):
    customer_name: str = Field(..., min_length=2)
    rating:        int = Field(..., ge=1, le=5)
    comment:       str = Field(..., min_length=3)

class AIRecommendRequest(BaseModel):
    mood:            str
    customer_name:   Optional[str] = None
    menu_context:    Optional[str] = None
    prompt_override: Optional[str] = None

class SupportRequest(BaseModel):
    message: str
    history: list = []

class SupportSaveRequest(BaseModel):
    customer_name: str
    message:       str
    reply:         str

class HealthProfileRequest(BaseModel):
    customer_name: str
    calorie_goal:  int       = Field(default=2000, ge=500, le=5000)
    diet_type:     str       = "any"
    health_goal:   str       = "balanced"
    allergies:     List[str] = []

class SpinWheelRequest(BaseModel):
    filter_type: str = "any"

class VoiceOrderRequest(BaseModel):
    transcript:    str
    customer_name: Optional[str] = None

# ════════════════════════════════════════════════════════════════════
# ══ HELPERS
# ════════════════════════════════════════════════════════════════════

def _get_item(item_id: int) -> Optional[dict]:
    with db() as c:
        r = c.execute("SELECT * FROM menu_items WHERE id=?", (item_id,)).fetchone()
    if not r: return None
    item = dict(r)
    item["tags"]    = _parse_tags(item.get("tags","[]"))
    item["reviews"] = _get_reviews(item_id)
    return item

def _get_all_menu(is_raining=False) -> List[dict]:
    with db() as c:
        rs = c.execute("SELECT * FROM menu_items ORDER BY category, name").fetchall()
    items = []
    for r in rs:
        i = dict(r)
        i["tags"]          = _parse_tags(i.get("tags","[]"))
        i["reviews"]       = _get_reviews(i["id"])
        i["dynamic_price"] = _dynamic_price(i, is_raining)
        i["price_surge"]   = i["dynamic_price"] > i["price"]
        items.append(i)
    return items

def _get_reviews(item_id: int) -> List[dict]:
    with db() as c:
        rs = c.execute(
            "SELECT * FROM reviews WHERE item_id=? ORDER BY created_at DESC", (item_id,)
        ).fetchall()
    revs = [dict(r) for r in rs]
    for r in revs:
        r["date"] = r.get("created_at","")[:10]
    return revs

def _parse_tags(s: str) -> list:
    try:    return json.loads(s)
    except: return []

def _dynamic_price(item: dict, is_raining: bool = False) -> int:
    base  = item["price"]
    hour  = datetime.now().hour
    surge = 1.0
    if 12 <= hour <= 14 or 19 <= hour <= 21: surge += 0.10
    if hour >= 23 or hour < 4:               surge += 0.08
    if item.get("order_count", 0) > 20:      surge += 0.12
    elif item.get("order_count", 0) > 10:    surge += 0.06
    if is_raining:                           surge += 0.05
    return int(base * surge)

def _delivery_charge(subtotal: int, is_raining: bool = False) -> int:
    hour = datetime.now().hour
    late = hour >= 23 or hour < 5
    base = 0 if subtotal >= 150 else 30
    if is_raining: base += 20
    if late:       base = max(base, 20)
    return base

def _delivery_notes(subtotal: int, is_raining: bool = False) -> List[str]:
    hour  = datetime.now().hour
    late  = hour >= 23 or hour < 5
    notes = []
    if subtotal >= 150 and not is_raining and not late:
        notes.append("🎉 Free delivery!")
    elif subtotal < 150:
        notes.append(f"Add ₹{150 - subtotal} more for free delivery")
    if is_raining: notes.append("🌧️ Rain surcharge +₹20")
    if late:       notes.append("🌙 Late night fee applied")
    return notes

def _get_cart(session_key: str) -> List[dict]:
    with db() as c:
        rs = c.execute(
            """SELECT c.item_id, m.name AS item_name, m.category,
                      c.quantity, c.unit_price,
                      (c.quantity * c.unit_price) AS subtotal,
                      m.calories AS calories_per
               FROM cart c JOIN menu_items m ON c.item_id=m.id
               WHERE c.session_key=? ORDER BY c.added_at""",
            (session_key,)
        ).fetchall()
    return [dict(r) for r in rs]

def _get_applied_coupon(session_key: str) -> dict:
    with db() as c:
        r = c.execute(
            "SELECT code, discount_percent FROM applied_coupons WHERE session_key=?",
            (session_key,)
        ).fetchone()
    return dict(r) if r else {"code": None, "discount_percent": 0}

def _session(customer_name: str = "guest") -> str:
    key = customer_name.lower().strip()
    key = re.sub(r"[^a-z0-9_]", "_", key)
    key = re.sub(r"_+", "_", key).strip("_")
    return key or "guest"

# ════════════════════════════════════════════════════════════════════
# ══ GROQ AI HELPER
# ════════════════════════════════════════════════════════════════════

async def ollama(prompt: str, tokens: int = 300) -> str:
    """
    Drop-in Groq replacement for the old ollama() function.
    Same name keeps all AI routes unchanged.
    """
    if not groq_client:
        return "⚠️ AI unavailable — GROQ_API_KEY not set."
    try:
        response = groq_client.chat.completions.create(
            model=GROQ_MODEL,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=tokens,
            temperature=0.7,
        )
        return response.choices[0].message.content.strip()
    except Exception as e:
        return f"⚠️ Groq AI error: {e}"

# ════════════════════════════════════════════════════════════════════
# ══ AUTH ROUTES
# ════════════════════════════════════════════════════════════════════

@app.post("/auth/register", tags=["Auth"])
def register(req: RegisterRequest):
    with db() as c:
        if c.execute("SELECT id FROM users WHERE email=?", (req.email.lower(),)).fetchone():
            raise HTTPException(400, "Email already registered")
        cur = c.execute(
            "INSERT INTO users (name,email,password,role) VALUES (?,?,?,?)",
            (req.name.strip(), req.email.lower(), _hash_pw(req.password), "customer")
        )
        user_id = cur.lastrowid
        c.commit()
    token = _make_jwt(user_id, req.email.lower(), "customer")
    return {
        "message": "Account created!",
        "token":   token,
        "user":    {"id": user_id, "name": req.name, "email": req.email.lower(), "role": "customer"},
    }

@app.post("/auth/login", tags=["Auth"])
def login(req: LoginRequest):
    with db() as c:
        u = c.execute("SELECT * FROM users WHERE email=?", (req.email.lower(),)).fetchone()
    if not u or not _check_pw(req.password, u["password"]):
        raise HTTPException(401, "Invalid email or password")
    token = _make_jwt(u["id"], u["email"], u["role"])
    return {
        "message": "Login successful!",
        "token":   token,
        "user":    {"id": u["id"], "name": u["name"], "email": u["email"], "role": u["role"]},
    }

@app.get("/auth/me", tags=["Auth"])
def get_me(user=Depends(current_user)):
    with db() as c:
        u = c.execute(
            "SELECT id,name,email,role,created_at FROM users WHERE id=?",
            (user["user_id"],)
        ).fetchone()
    if not u: raise HTTPException(404, "User not found")
    return {"user": dict(u)}

@app.post("/auth/change-password", tags=["Auth"])
def change_password(
    old_password: str = Query(...),
    new_password: str = Query(..., min_length=6),
    user=Depends(current_user)
):
    with db() as c:
        u = c.execute("SELECT password FROM users WHERE id=?", (user["user_id"],)).fetchone()
        if not u or not _check_pw(old_password, u["password"]):
            raise HTTPException(401, "Old password incorrect")
        c.execute("UPDATE users SET password=? WHERE id=?",
                  (_hash_pw(new_password), user["user_id"]))
        c.commit()
    return {"message": "Password changed!"}

@app.get("/auth/users", tags=["Auth"])
def list_users(admin=Depends(admin_user)):
    with db() as c:
        us = c.execute("SELECT id,name,email,role,created_at FROM users").fetchall()
    return {"users": [dict(u) for u in us], "total": len(us)}

# ════════════════════════════════════════════════════════════════════
# ══ MENU ROUTES
# ════════════════════════════════════════════════════════════════════

@app.get("/")
def home():
    return {"message": "YumRush API v6 — SQLite + JWT + Groq AI"}

@app.get("/menu")
def get_menu(is_raining: bool = Query(False)):
    menu = _get_all_menu(is_raining)
    return {"menu": menu, "total": len(menu)}

@app.get("/menu/summary")
def menu_summary():
    with db() as c:
        total = c.execute("SELECT COUNT(*) FROM menu_items").fetchone()[0]
        avail = c.execute("SELECT COUNT(*) FROM menu_items WHERE is_available=1").fetchone()[0]
        cats  = [r[0] for r in c.execute("SELECT DISTINCT category FROM menu_items").fetchall()]
    return {"total_items": total, "available_count": avail,
            "unavailable_count": total - avail, "categories": cats}

@app.get("/menu/search")
def search_menu(keyword: str = Query(...)):
    kw = f"%{keyword.lower()}%"
    with db() as c:
        rs = c.execute(
            "SELECT * FROM menu_items WHERE LOWER(name) LIKE ? OR LOWER(category) LIKE ? OR LOWER(tags) LIKE ?",
            (kw, kw, kw)
        ).fetchall()
    items = []
    for r in rs:
        i = dict(r)
        i["tags"]          = _parse_tags(i.get("tags","[]"))
        i["reviews"]       = _get_reviews(i["id"])
        i["dynamic_price"] = _dynamic_price(i)
        items.append(i)
    return {"keyword": keyword, "total_found": len(items), "results": items}

@app.get("/menu/filter")
def filter_menu(
    category:     str  = Query(None),
    max_price:    int  = Query(None),
    is_available: bool = Query(None),
    tag:          str  = Query(None),
    is_raining:   bool = Query(False)
):
    sql, params = "SELECT * FROM menu_items WHERE 1=1", []
    if category     is not None: sql += " AND LOWER(category)=LOWER(?)"; params.append(category)
    if max_price    is not None: sql += " AND price<=?";                  params.append(max_price)
    if is_available is not None: sql += " AND is_available=?";            params.append(1 if is_available else 0)
    if tag          is not None: sql += " AND LOWER(tags) LIKE ?";        params.append(f"%{tag.lower()}%")
    with db() as c:
        rs = c.execute(sql + " ORDER BY category,name", params).fetchall()
    items = []
    for r in rs:
        i = dict(r)
        i["tags"]          = _parse_tags(i.get("tags","[]"))
        i["reviews"]       = _get_reviews(i["id"])
        i["dynamic_price"] = _dynamic_price(i, is_raining)
        items.append(i)
    return {"filtered_items": items, "count": len(items)}

@app.get("/menu/sort")
def sort_menu(sort_by: str = Query("price"), order: str = Query("asc")):
    allowed = ["price","name","category","calories","id","order_count","avg_rating"]
    if sort_by not in allowed:
        sort_by = "id"
    direction = "DESC" if order == "desc" else "ASC"
    with db() as c:
        rs = c.execute(f"SELECT * FROM menu_items ORDER BY {sort_by} {direction}").fetchall()
    items = []
    for r in rs:
        i = dict(r)
        i["tags"]          = _parse_tags(i.get("tags","[]"))
        i["reviews"]       = _get_reviews(i["id"])
        i["dynamic_price"] = _dynamic_price(i)
        items.append(i)
    return {"menu": items, "total": len(items)}

@app.get("/menu/favourites")
def get_favourites(session: str = Query("guest")):
    key = _session(session)
    with db() as c:
        rs = c.execute(
            "SELECT m.* FROM menu_items m JOIN favourites f ON m.id=f.item_id WHERE f.session_key=?",
            (key,)
        ).fetchall()
    items = []
    for r in rs:
        i = dict(r)
        i["tags"]    = _parse_tags(i.get("tags","[]"))
        i["reviews"] = _get_reviews(i["id"])
        items.append(i)
    return {"favourites": items, "total": len(items)}

@app.post("/menu/{item_id}/favourite")
def toggle_favourite(item_id: int, session: str = Query("guest"), response: Response = None):
    item = _get_item(item_id)
    if not item:
        response.status_code = 404; return {"error": "Item not found"}
    key = _session(session)
    with db() as c:
        exists = c.execute(
            "SELECT 1 FROM favourites WHERE session_key=? AND item_id=?", (key, item_id)
        ).fetchone()
        if exists:
            c.execute("DELETE FROM favourites WHERE session_key=? AND item_id=?", (key, item_id))
            c.commit()
            return {"message": f"'{item['name']}' removed from favourites", "is_favourite": False}
        c.execute("INSERT OR IGNORE INTO favourites (session_key,item_id) VALUES (?,?)", (key, item_id))
        c.commit()
    return {"message": f"'{item['name']}' added to favourites", "is_favourite": True}

@app.post("/menu/{item_id}/review")
def add_review(item_id: int, rev: ReviewRequest, response: Response):
    item = _get_item(item_id)
    if not item:
        response.status_code = 404; return {"error": "Item not found"}
    sentiment = "positive" if rev.rating >= 4 else ("negative" if rev.rating <= 2 else "neutral")
    with db() as c:
        c.execute(
            "INSERT INTO reviews (item_id,customer_name,rating,comment,sentiment) VALUES (?,?,?,?,?)",
            (item_id, rev.customer_name, rev.rating, rev.comment, sentiment)
        )
        avg = c.execute("SELECT AVG(rating) FROM reviews WHERE item_id=?", (item_id,)).fetchone()[0]
        c.execute("UPDATE menu_items SET avg_rating=? WHERE id=?", (round(avg,1), item_id))
        c.commit()
    response.status_code = 201
    return {"message": "Review added!", "sentiment": sentiment, "avg_rating": round(avg,1)}

@app.get("/menu/{item_id}/reviews")
def get_item_reviews(item_id: int, response: Response):
    item = _get_item(item_id)
    if not item:
        response.status_code = 404; return {"error": "Item not found"}
    revs = _get_reviews(item_id)
    pos  = [r for r in revs if r["sentiment"]=="positive"]
    neg  = [r for r in revs if r["sentiment"]=="negative"]
    neu  = [r for r in revs if r["sentiment"]=="neutral"]
    return {"item_name": item["name"], "avg_rating": item["avg_rating"],
            "total_reviews": len(revs), "positive_count": len(pos),
            "negative_count": len(neg), "neutral_count": len(neu),
            "all_reviews": revs}

@app.post("/menu", tags=["Admin"])
def add_menu_item(item: NewMenuItem, admin=Depends(admin_user)):
    with db() as c:
        if c.execute("SELECT id FROM menu_items WHERE LOWER(name)=LOWER(?)",(item.name,)).fetchone():
            raise HTTPException(400, "Item already exists")
        cur = c.execute(
            "INSERT INTO menu_items (name,price,category,is_available,calories,tags) VALUES (?,?,?,?,?,?)",
            (item.name, item.price, item.category, 1 if item.is_available else 0,
             item.calories, json.dumps(item.tags))
        )
        c.commit()
    return {"message": "Item added", "item": _get_item(cur.lastrowid)}

@app.put("/menu/{item_id}", tags=["Admin"])
def update_menu_item(
    item_id: int, response: Response,
    price: int = Query(None), is_available: bool = Query(None),
    admin=Depends(admin_user)
):
    if not _get_item(item_id):
        response.status_code = 404; return {"error": "Not found"}
    with db() as c:
        if price        is not None: c.execute("UPDATE menu_items SET price=? WHERE id=?",        (price, item_id))
        if is_available is not None: c.execute("UPDATE menu_items SET is_available=? WHERE id=?", (1 if is_available else 0, item_id))
        c.commit()
    return {"message": "Updated", "item": _get_item(item_id)}

@app.delete("/menu/{item_id}", tags=["Admin"])
def delete_menu_item(item_id: int, response: Response, admin=Depends(admin_user)):
    item = _get_item(item_id)
    if not item:
        response.status_code = 404; return {"error": "Not found"}
    with db() as c:
        c.execute("DELETE FROM menu_items WHERE id=?", (item_id,))
        c.commit()
    return {"message": f"'{item['name']}' deleted"}

@app.get("/menu/{item_id}")
def get_menu_item(item_id: int, is_raining: bool = Query(False)):
    item = _get_item(item_id)
    if not item: return {"error": "Item not found"}
    item["dynamic_price"] = _dynamic_price(item, is_raining)
    return {"item": item}

# ════════════════════════════════════════════════════════════════════
# ══ CART ROUTES
# ════════════════════════════════════════════════════════════════════

@app.post("/cart/add")
def add_to_cart(
    item_id:    int  = Query(...),
    quantity:   int  = Query(1),
    session:    str  = Query("guest"),
    is_raining: bool = Query(False)
):
    item = _get_item(item_id)
    if not item:               return {"error": "Item not found"}
    if not item["is_available"]: return {"error": f"'{item['name']}' is unavailable"}
    price = _dynamic_price(item, is_raining)
    key   = _session(session)
    with db() as c:
        existing = c.execute(
            "SELECT quantity FROM cart WHERE session_key=? AND item_id=?", (key, item_id)
        ).fetchone()
        if existing:
            new_qty = min(existing["quantity"] + quantity, 20)
            c.execute("UPDATE cart SET quantity=?, unit_price=? WHERE session_key=? AND item_id=?",
                      (new_qty, price, key, item_id))
        else:
            c.execute("INSERT INTO cart (session_key,item_id,quantity,unit_price) VALUES (?,?,?,?)",
                      (key, item_id, min(quantity, 20), price))
        c.commit()
    return {"message": f"'{item['name']}' added to cart",
            "cart_item": {"item_id": item_id, "item_name": item["name"],
                          "quantity": quantity, "unit_price": price,
                          "subtotal": price * quantity}}

@app.get("/cart")
def view_cart(session: str = Query("guest"), is_raining: bool = Query(False)):
    key   = _session(session)
    items = _get_cart(key)
    if not items:
        return {"message": "Cart is empty", "items": [], "grand_total": 0,
                "applied_coupon": None, "discount_amount": 0}
    coupon     = _get_applied_coupon(key)
    subtotal   = sum(i["subtotal"] for i in items)
    discount   = round(subtotal * coupon["discount_percent"] / 100)
    after_disc = subtotal - discount
    delivery   = _delivery_charge(after_disc, is_raining)
    total_cals = sum(i["calories_per"] * i["quantity"] for i in items)
    return {
        "items": items, "item_count": len(items),
        "subtotal": subtotal, "discount_amount": discount,
        "after_discount": after_disc, "delivery_charge": delivery,
        "delivery_notes": _delivery_notes(after_disc, is_raining),
        "grand_total": after_disc + delivery, "total_calories": total_cals,
        "applied_coupon": coupon["code"], "discount_percent": coupon["discount_percent"],
    }

@app.delete("/cart/{item_id}")
def remove_from_cart(item_id: int, session: str = Query("guest"), response: Response = None):
    key = _session(session)
    with db() as c:
        r = c.execute(
            "SELECT m.name FROM cart c JOIN menu_items m ON c.item_id=m.id WHERE c.session_key=? AND c.item_id=?",
            (key, item_id)
        ).fetchone()
        if not r:
            response.status_code = 404; return {"error": "Item not in cart"}
        c.execute("DELETE FROM cart WHERE session_key=? AND item_id=?", (key, item_id))
        c.commit()
    return {"message": f"'{r['name']}' removed from cart"}

@app.post("/cart/apply-coupon")
def apply_coupon(code: str = Query(...), session: str = Query("guest")):
    with db() as c:
        cp = c.execute(
            "SELECT * FROM coupons WHERE UPPER(code)=UPPER(?) AND is_active=1", (code,)
        ).fetchone()
    if not cp: return {"error": f"Coupon '{code}' is invalid or expired"}
    key = _session(session)
    with db() as c:
        c.execute(
            "INSERT OR REPLACE INTO applied_coupons (session_key,code,discount_percent) VALUES (?,?,?)",
            (key, cp["code"], cp["discount_percent"])
        )
        c.commit()
    items    = _get_cart(key)
    subtotal = sum(i["subtotal"] for i in items)
    discount = round(subtotal * cp["discount_percent"] / 100)
    return {"message": f"Coupon '{cp['code']}' applied! You save ₹{discount}",
            "discount_percent": cp["discount_percent"], "discount_amount": discount}

@app.post("/cart/remove-coupon")
def remove_coupon(session: str = Query("guest")):
    key = _session(session)
    with db() as c:
        c.execute("DELETE FROM applied_coupons WHERE session_key=?", (key,))
        c.commit()
    return {"message": "Coupon removed"}

@app.get("/coupons")
def list_coupons():
    with db() as c:
        rs = c.execute("SELECT * FROM coupons WHERE is_active=1").fetchall()
    return {"coupons": [dict(r) for r in rs]}

@app.post("/cart/checkout")
def checkout(req: CheckoutRequest, is_raining: bool = Query(False), response: Response = None):
    key   = _session(req.customer_name)
    items = _get_cart(key)
    if not items:
        response.status_code = 400; return {"error": "Cart is empty"}
    coupon     = _get_applied_coupon(key)
    subtotal   = sum(i["subtotal"] for i in items)
    discount   = round(subtotal * coupon["discount_percent"] / 100)
    after_disc = subtotal - discount
    delivery   = _delivery_charge(after_disc, is_raining)
    grand      = after_disc + delivery
    total_cals = sum(i["calories_per"] * i["quantity"] for i in items)
    items_snapshot = [
        {"item_id": i["item_id"], "item_name": i["item_name"], "category": i["category"],
         "quantity": i["quantity"], "unit_price": i["unit_price"], "subtotal": i["subtotal"]}
        for i in items
    ]
    with db() as c:
        cur = c.execute(
            """INSERT INTO orders
               (customer_name,customer_email,items_json,subtotal,discount_amount,
                discount_percent,coupon_applied,delivery_charge,delivery_address,
                grand_total,total_calories,hour)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
            (req.customer_name, req.customer_email, json.dumps(items_snapshot),
             subtotal, discount, coupon["discount_percent"], coupon["code"],
             delivery, req.delivery_address, grand, total_cals, datetime.now().hour)
        )
        order_id = cur.lastrowid
        for i in items:
            c.execute("UPDATE menu_items SET order_count=order_count+? WHERE id=?",
                      (i["quantity"], i["item_id"]))
        c.execute("DELETE FROM cart WHERE session_key=?", (key,))
        c.execute("DELETE FROM applied_coupons WHERE session_key=?", (key,))
        c.commit()
    order = {
        "order_id": order_id, "customer_name": req.customer_name,
        "items": items_snapshot, "subtotal": subtotal,
        "discount_amount": discount, "discount_percent": coupon["discount_percent"],
        "coupon_applied": coupon["code"], "delivery_charge": delivery,
        "delivery_address": req.delivery_address, "grand_total": grand,
        "total_calories": total_cals, "status": "confirmed",
        "date": datetime.now().strftime("%d %b %Y %H:%M"),
    }
    response.status_code = 201
    return {"message": "Order placed!", "order": order, "grand_total": grand}

# ════════════════════════════════════════════════════════════════════
# ══ ORDER ROUTES
# ════════════════════════════════════════════════════════════════════

def _fmt_order(r: dict) -> dict:
    try:    r["items"] = json.loads(r.get("items_json","[]"))
    except: r["items"] = []
    r["date"] = r.get("created_at","")[:16]
    return r

@app.get("/orders")
def get_orders(user=Depends(optional_user)):
    with db() as c:
        rs = c.execute("SELECT * FROM orders ORDER BY id DESC").fetchall()
    return {"orders": [_fmt_order(dict(r)) for r in rs], "total": len(rs)}

@app.get("/orders/my")
def my_orders(customer_name: str = Query(...)):
    with db() as c:
        rs = c.execute(
            "SELECT * FROM orders WHERE LOWER(customer_name)=LOWER(?) ORDER BY id DESC",
            (customer_name,)
        ).fetchall()
    orders = [_fmt_order(dict(r)) for r in rs]
    return {"orders": orders, "total": len(orders)}

@app.get("/orders/sort")
def sort_orders(order: str = Query("desc"), user=Depends(optional_user)):
    direction = "DESC" if order == "desc" else "ASC"
    with db() as c:
        rs = c.execute(f"SELECT * FROM orders ORDER BY id {direction}").fetchall()
    return {"orders": [_fmt_order(dict(r)) for r in rs], "total": len(rs)}

# ════════════════════════════════════════════════════════════════════
# ══ HEALTH PROFILE
# ════════════════════════════════════════════════════════════════════

@app.post("/health/profile")
def set_health_profile(req: HealthProfileRequest):
    with db() as c:
        c.execute(
            """INSERT OR REPLACE INTO health_profiles
               (customer_name,calorie_goal,diet_type,health_goal,allergies,updated_at)
               VALUES (?,?,?,?,?,datetime('now'))""",
            (req.customer_name, req.calorie_goal, req.diet_type,
             req.health_goal, json.dumps(req.allergies))
        )
        c.commit()
    return {"message": "Health profile saved"}

@app.get("/health/profile/{customer_name}")
def get_health_profile(customer_name: str):
    with db() as c:
        r = c.execute(
            "SELECT * FROM health_profiles WHERE customer_name=?", (customer_name,)
        ).fetchone()
    if not r: return {"has_profile": False}
    p = dict(r)
    p["allergies"] = _parse_tags(p.get("allergies","[]"))
    return {"has_profile": True, "profile": p}

@app.get("/health/suggestions/{customer_name}")
def health_suggestions(customer_name: str):
    with db() as c:
        r = c.execute(
            "SELECT * FROM health_profiles WHERE customer_name=?", (customer_name,)
        ).fetchone()
    if not r:
        top = _get_all_menu()
        top.sort(key=lambda x: x["calories"])
        return {"has_profile": False, "suggestions": top[:8],
                "message": "Set a health profile for personalized suggestions!"}
    profile     = dict(r)
    diet        = profile["diet_type"]
    goal        = profile["health_goal"]
    meal_budget = profile["calorie_goal"] // 3

    def score(item):
        s    = 0
        tags = [t.lower() for t in item.get("tags", [])]
        if diet == "veg"          and "veg"         in tags: s += 30
        if diet == "vegan"        and "vegan"        in tags: s += 30
        if diet == "keto"         and "keto"         in tags: s += 30
        if diet == "high-protein" and "high-protein" in tags: s += 30
        if diet == "any":                                      s += 15
        if item["calories"] <= meal_budget:                    s += 20
        if goal == "weight-loss" and "low-cal"      in tags: s += 20
        if goal == "muscle-gain" and "high-protein" in tags: s += 20
        if goal == "diabetic"    and "low-cal"      in tags: s += 25
        if goal == "balanced"    and "healthy"      in tags: s += 10
        if item["is_available"]:                               s += 5
        return s

    menu   = _get_all_menu()
    scored = [(i, score(i)) for i in menu if score(i) > 0 and i["is_available"]]
    scored.sort(key=lambda x: x[1], reverse=True)
    suggestions = [{**i, "health_score": s, "calorie_fit": i["calories"] <= meal_budget}
                   for i, s in scored[:10]]
    return {"has_profile": True, "profile": profile,
            "meal_calorie_budget": meal_budget, "suggestions": suggestions}

# ════════════════════════════════════════════════════════════════════
# ══ SPIN WHEEL
# ════════════════════════════════════════════════════════════════════

@app.post("/spin")
def spin_wheel(req: SpinWheelRequest):
    menu  = _get_all_menu()
    avail = [i for i in menu if i["is_available"]]
    f     = req.filter_type.lower()

    def has_tag(item, tag): return tag in [t.lower() for t in item.get("tags",[])]

    pool_map = {
        "veg":          [i for i in avail if has_tag(i,"veg")],
        "non-veg":      [i for i in avail if has_tag(i,"non-veg")],
        "cheap":        [i for i in avail if i["price"] <= 150],
        "healthy":      [i for i in avail if has_tag(i,"healthy") or has_tag(i,"low-cal")],
        "spicy":        [i for i in avail if has_tag(i,"spicy")],
        "premium":      [i for i in avail if has_tag(i,"premium")],
        "sweet":        [i for i in avail if has_tag(i,"sweet")],
        "high-protein": [i for i in avail if has_tag(i,"high-protein")],
    }
    pool     = pool_map.get(f, avail) or avail
    main     = random.choice(pool)
    drinks   = [i for i in avail if i["category"] in ("Drinks","Coffee") and i["id"] != main["id"]]
    desserts = [i for i in avail if i["category"] == "Dessert"           and i["id"] != main["id"]]
    combo    = [main]
    if drinks:   combo.append(random.choice(drinks))
    if desserts: combo.append(random.choice(desserts))
    return {"spin_result": main, "combo": combo,
            "combo_total": sum(i["price"] for i in combo),
            "fun_message": f"🎯 The wheel chose {main['name']} for you!"}

# ════════════════════════════════════════════════════════════════════
# ══ RECOMMENDATIONS
# ════════════════════════════════════════════════════════════════════

@app.get("/recommendations/trending")
def trending():
    with db() as c:
        rs = c.execute(
            "SELECT * FROM menu_items WHERE is_available=1 ORDER BY order_count DESC LIMIT 8"
        ).fetchall()
    items = []
    for r in rs:
        i = dict(r)
        i["tags"]              = _parse_tags(i.get("tags","[]"))
        i["reviews"]           = _get_reviews(i["id"])
        i["orders_this_week"]  = i.get("order_count", 0)
        i["dynamic_price"]     = _dynamic_price(i)
        items.append(i)
    return {"trending": items}

@app.get("/recommendations/personalized/{customer_name}")
def personalized(customer_name: str):
    with db() as c:
        rs = c.execute(
            "SELECT items_json FROM orders WHERE LOWER(customer_name)=LOWER(?)",
            (customer_name,)
        ).fetchall()
    if not rs:
        menu = _get_all_menu()
        top  = sorted([i for i in menu if i["is_available"] and i["avg_rating"] > 0],
                      key=lambda x: x["avg_rating"], reverse=True)[:8]
        return {"has_history": False, "top_categories": [],
                "recommendations": top or [i for i in menu if i["is_available"]][:8]}
    cat_counts  = defaultdict(int)
    ordered_ids = set()
    for r in rs:
        try:
            for it in json.loads(r["items_json"]):
                cat_counts[it.get("category","")] += 1
                ordered_ids.add(it.get("item_id"))
        except: pass
    top_cats = [k for k,_ in sorted(cat_counts.items(), key=lambda x:x[1], reverse=True)][:3]
    menu     = _get_all_menu()
    recs     = [i for i in menu if i["category"] in top_cats and i["is_available"] and i["id"] not in ordered_ids]
    if len(recs) < 4:
        extra = sorted([i for i in menu if i["is_available"] and i["id"] not in ordered_ids and i not in recs],
                       key=lambda x: x["avg_rating"], reverse=True)
        recs += extra[:max(0, 8-len(recs))]
    return {"has_history": True, "top_categories": top_cats, "recommendations": recs[:8]}

@app.get("/recommendations/also-liked/{item_id}")
def also_liked(item_id: int):
    with db() as c:
        rs = c.execute(
            "SELECT items_json FROM orders WHERE items_json LIKE ?",
            (f'%"item_id": {item_id}%',)
        ).fetchall()
    if not rs: return {"item_id": item_id, "also_liked": []}
    counts = defaultdict(int)
    for r in rs:
        try:
            for it in json.loads(r["items_json"]):
                if it.get("item_id") != item_id:
                    counts[it["item_id"]] += 1
        except: pass
    result = []
    for iid, cnt in sorted(counts.items(), key=lambda x:x[1], reverse=True)[:5]:
        item = _get_item(iid)
        if item and item["is_available"]:
            item["order_count_together"] = cnt
            result.append(item)
    return {"item_id": item_id, "also_liked": result}

@app.get("/reorder/{customer_name}")
def smart_reorder(customer_name: str):
    with db() as c:
        rs = c.execute(
            "SELECT items_json FROM orders WHERE LOWER(customer_name)=LOWER(?) ORDER BY id DESC LIMIT 10",
            (customer_name,)
        ).fetchall()
    if not rs: return {"has_history": False, "suggestions": []}
    freq = defaultdict(int)
    for r in rs:
        try:
            for it in json.loads(r["items_json"]):
                freq[it["item_id"]] += it.get("quantity",1)
        except: pass
    suggestions = []
    for iid, cnt in sorted(freq.items(), key=lambda x:x[1], reverse=True)[:6]:
        item = _get_item(iid)
        if item and item["is_available"]:
            item["times_ordered"] = cnt
            item["dynamic_price"] = _dynamic_price(item)
            suggestions.append(item)
    return {"has_history": True, "suggestions": suggestions}

# ════════════════════════════════════════════════════════════════════
# ══ ANALYTICS
# ════════════════════════════════════════════════════════════════════

@app.get("/analytics")
def analytics(user=Depends(optional_user)):
    with db() as c:
        total = c.execute("SELECT COUNT(*) FROM orders").fetchone()[0]
        if not total:
            return {"message":"No orders yet","total_orders":0,"total_revenue":0}
        rev    = c.execute("SELECT COALESCE(SUM(grand_total),0) FROM orders").fetchone()[0]
        hours  = c.execute("SELECT hour, COUNT(*) cnt FROM orders GROUP BY hour").fetchall()
        top_cx = c.execute(
            "SELECT customer_name, COUNT(*) order_count, SUM(grand_total) total_spent "
            "FROM orders GROUP BY customer_name ORDER BY total_spent DESC LIMIT 5"
        ).fetchall()
        rev_st = c.execute(
            "SELECT COUNT(*) total, "
            "SUM(CASE WHEN sentiment='positive' THEN 1 ELSE 0 END) pos, "
            "SUM(CASE WHEN sentiment='negative' THEN 1 ELSE 0 END) neg, "
            "SUM(CASE WHEN sentiment='neutral'  THEN 1 ELSE 0 END) neu, "
            "AVG(rating) avg_r FROM reviews"
        ).fetchone()
        orders_raw = c.execute("SELECT items_json FROM orders").fetchall()

    item_counts = defaultdict(int)
    item_rev    = defaultdict(int)
    cat_counts  = defaultdict(int)
    for r in orders_raw:
        try:
            for it in json.loads(r["items_json"]):
                item_counts[it.get("item_name","")] += it.get("quantity",1)
                item_rev[it.get("item_name","")]    += it.get("subtotal",0)
                cat_counts[it.get("category","")]   += it.get("quantity",1)
        except: pass

    return {
        "total_orders":       total,
        "total_revenue":      int(rev),
        "avg_order_value":    round(int(rev)/total),
        "most_ordered_item":  max(item_counts, key=item_counts.get) if item_counts else "N/A",
        "item_order_counts":  dict(item_counts),
        "item_revenue":       dict(item_rev),
        "orders_by_category": dict(cat_counts),
        "peak_hours":         {str(r["hour"]): r["cnt"] for r in hours},
        "top_customers":      [dict(r) for r in top_cx],
        "top_items":          sorted([{"item_name":k,"qty":v} for k,v in item_counts.items()],
                                     key=lambda x:x["qty"], reverse=True)[:5],
        "review_stats": {
            "total":      int(rev_st["total"] or 0),
            "positive":   int(rev_st["pos"]   or 0),
            "negative":   int(rev_st["neg"]   or 0),
            "neutral":    int(rev_st["neu"]    or 0),
            "avg_rating": round(float(rev_st["avg_r"] or 0), 1),
        },
    }

# ════════════════════════════════════════════════════════════════════
# ══ DYNAMIC PRICING STATUS
# ════════════════════════════════════════════════════════════════════

@app.get("/pricing/status")
def pricing_status(is_raining: bool = Query(False)):
    hour    = datetime.now().hour
    is_peak = (12 <= hour <= 14) or (19 <= hour <= 21)
    is_late = hour >= 23 or hour < 5
    return {
        "hour": hour, "is_peak_hours": is_peak,
        "is_late_night": is_late, "is_raining": is_raining,
        "delivery_base": 30, "rain_surcharge": 20 if is_raining else 0,
        "late_fee": 15 if is_late else 0,
        "message": ("🌙 Late night pricing" if is_late else
                    "🔥 Peak hour surge"   if is_peak else "✅ Normal pricing"),
    }

# ════════════════════════════════════════════════════════════════════
# ══ AI ROUTES
# ════════════════════════════════════════════════════════════════════

@app.post("/ai/recommend")
async def ai_recommend(req: AIRecommendRequest):
    # If frontend sends a ready-made prompt, use it directly
    if req.prompt_override:
        return {"recommendation": await ollama(req.prompt_override, 200)}

    # Build menu context from real available items
    menu  = _get_all_menu()
    avail = [i for i in menu if i["is_available"]]
    mlist = "\n".join(
        f"• {i['name']} ({i['category']}, ₹{i['dynamic_price'] or i['price']}, "
        f"{i['calories']} cal, ⭐{i['avg_rating'] or 'N/A'})"
        for i in avail
    )

    # Optional health context
    ctx = ""
    if req.customer_name:
        p = get_health_profile(req.customer_name)
        if p.get("has_profile"):
            pr  = p["profile"]
            ctx = f"\nCustomer follows {pr['diet_type']} diet, goal: {pr['health_goal']}, {pr['calorie_goal']} cal/day."

    prompt = (
        f"You are a friendly food recommender for YumRush, a food delivery app.\n"
        f"Customer mood: {req.mood}.{ctx}\n\n"
        f"REAL MENU (only recommend from this list):\n{mlist}\n\n"
        f"Recommend 2-3 specific items from the list above that best match the mood. "
        f"Be warm and friendly. Under 60 words. Mention item names exactly as listed."
    )
    return {"recommendation": await ollama(prompt, 200)}

@app.post("/ai/mood-analyze")
async def mood_analyze(req: AIRecommendRequest):
    prompt = (
        f"Analyze this food mood: '{req.mood}'\n"
        f"Reply ONLY as valid JSON with no extra text:\n"
        f'{{ "category": "Pizza|Burger|Biryani|Sandwich|Pasta|Coffee|Drinks|Dessert|Healthy|Indian|any", '
        f'"tags": ["veg", "spicy"], "reasoning": "one sentence" }}'
    )
    reply = await ollama(prompt, 150)
    try:
        clean = re.sub(r"```[a-z]*|```", "", reply).strip()
        m     = re.search(r"\{.*?\}", clean, re.DOTALL)
        return {"success": True, "analysis": json.loads(m.group())} if m else \
               {"success": False, "analysis": {"category": "any", "tags": []}}
    except:
        return {"success": False, "analysis": {"category": "any", "tags": []}}

@app.post("/ai/summarize-reviews/{item_id}")
async def summarize_reviews(item_id: int):
    item = _get_item(item_id)
    if not item: return {"error": "Not found"}
    revs = item.get("reviews", [])
    if not revs: return {"summary": "No reviews yet."}
    text   = "\n".join(f"{r['customer_name']} ({r['rating']}/5): \"{r['comment']}\"" for r in revs)
    prompt = f"Summarize these customer reviews for '{item['name']}' in 2-3 sentences. Under 60 words.\n\n{text}"
    return {"summary": await ollama(prompt, 150)}

@app.post("/ai/health-advice/{customer_name}")
async def health_advice(customer_name: str):
    with db() as c:
        p = c.execute(
            "SELECT * FROM health_profiles WHERE customer_name=?", (customer_name,)
        ).fetchone()
    if not p:
        return {"advice": "Set up your health profile to get personalized advice!"}
    profile = dict(p)
    with db() as c:
        orders_today = c.execute(
            "SELECT COALESCE(SUM(total_calories),0) FROM orders "
            "WHERE LOWER(customer_name)=LOWER(?) AND DATE(created_at)=DATE('now')",
            (customer_name,)
        ).fetchone()[0]
    remaining = profile["calorie_goal"] - int(orders_today)
    prompt = (
        f"Customer: diet={profile['diet_type']}, goal={profile['health_goal']}, "
        f"target={profile['calorie_goal']} cal/day. "
        f"Today consumed: {int(orders_today)} cal, remaining: {remaining} cal. "
        f"Give friendly nutrition advice and suggest 1-2 light items. Under 80 words."
    )
    return {
        "advice":            await ollama(prompt, 150),
        "calories_today":    int(orders_today),
        "calorie_goal":      profile["calorie_goal"],
        "remaining_calories": remaining
    }

@app.post("/ai/voice-order")
async def voice_order(req: VoiceOrderRequest):
    menu_items = _get_all_menu()
    transcript = req.transcript.strip()
    if not transcript:
        return {"success": False, "resolved_items": [], "message": "Empty transcript"}

    _NUM_WORDS = {
        "one":1,"two":2,"three":3,"four":4,"five":5,
        "six":6,"seven":7,"eight":8,"nine":9,"ten":10,
        "a":1,"an":1,"couple":2,"few":3
    }

    def _norm(text):
        text = text.lower()
        text = re.sub(r"[^a-z0-9\s]"," ",text)
        for w,n in _NUM_WORDS.items():
            text = re.sub(rf"\b{w}\b", str(n), text)
        return re.sub(r"\s+"," ",text).strip()

    def _token_overlap(a, b):
        sa, sb = set(a.split()), set(b.split())
        return len(sa & sb) / len(sa | sb) if sa and sb else 0.0

    def _fuzzy_find(query):
        q = _norm(query)
        best, bscore = None, 0.0
        for item in menu_items:
            if not item["is_available"]: continue
            name  = _norm(item["name"])
            cat   = _norm(item["category"])
            tags  = _norm(" ".join(item.get("tags",[])))
            score = 1.0 if q in name or name in q else _token_overlap(q, f"{name} {cat} {tags}")
            for w in q.split():
                if len(w) >= 3 and w in name: score += 0.25
            if score > bscore: bscore, best = score, item
        return (best, bscore) if bscore >= 0.15 else (None, 0.0)

    text    = _norm(transcript)
    fillers = ["i want","i would like","give me","get me","add","order",
               "please","can i have","i need","bring me","and also"]
    for f in fillers:
        text = text.replace(f," ")
    text = re.sub(r"\s+"," ",text).strip()

    resolved = []
    seen_ids = set()
    parts    = re.split(r"\band\b|\bwith\b|\balso\b|\bplus\b|,", text)

    for part in parts:
        part  = part.strip()
        if not part: continue
        m     = re.match(r"^(\d+)\s*", part)
        qty   = min(int(m.group(1)), 20) if m else 1
        clean = re.sub(r"^\d+\s*","",part).strip()
        item, score = _fuzzy_find(clean)
        if item and item["id"] not in seen_ids:
            seen_ids.add(item["id"])
            resolved.append({
                "item_id": item["id"], "item_name": item["name"],
                "category": item["category"], "quantity": qty,
                "price": item["price"], "confidence": round(min(score,1.0),2)
            })

    avg_conf = sum(r["confidence"] for r in resolved)/len(resolved) if resolved else 0.0
    return {
        "success": len(resolved) > 0, "transcript": transcript,
        "resolved_items": resolved, "avg_confidence": round(avg_conf, 2),
        "message": f"Found {len(resolved)} item(s)" if resolved else "No match found"
    }

SUPPORT_SYS = """You are YumRush customer support AI. Help customers with:
- Menu: 65 items across Pizza, Burger, Biryani, Sandwich, Pasta, Coffee, Drinks, Dessert, Healthy, Indian
- Delivery: FREE above ₹150, ₹30 below. Rain +₹20. Late night (11pm–5am) +₹15
- Dynamic pricing: 10% surge during peak hours (12–2pm, 7–9pm), extra for high-demand items
- Coupons: SAVE10, WELCOME20, FLAT30, YUMRUSH, HEALTHY15, NIGHT10
- Features: AI mood recommender, health profile, spin wheel, voice ordering, smart reorder
Be helpful, concise, and friendly. Under 80 words per reply."""

@app.post("/ai/support")
async def ai_support(req: SupportRequest):
    history = "\n".join(
        f"{'Customer' if h.get('role')=='user' else 'Support'}: {h.get('content','')}"
        for h in req.history[-6:]
    )
    prompt = f"{SUPPORT_SYS}\n\nConversation so far:\n{history}\n\nCustomer: {req.message}\nSupport:"
    return {"reply": await ollama(prompt, 200) or "Sorry, I couldn't process that."}

@app.post("/support/save")
async def save_support(req: SupportSaveRequest):
    with db() as c:
        c.execute(
            "INSERT INTO support_queries (customer_name,message,reply) VALUES (?,?,?)",
            (req.customer_name, req.message, req.reply)
        )
        c.commit()
    return {"message": "Saved"}

@app.get("/support/queries")
def get_support_queries(user=Depends(optional_user)):
    with db() as c:
        rs = c.execute(
            "SELECT * FROM support_queries ORDER BY id DESC LIMIT 100"
        ).fetchall()
    return {"total": len(rs), "queries": [dict(r) for r in rs]}

@app.get("/groq/status")
def groq_status():
    """Check if Groq API key is configured."""
    return {
        "configured": bool(GROQ_API_KEY),
        "model": GROQ_MODEL,
        "message": "✅ Groq ready" if GROQ_API_KEY else "⚠️ Set GROQ_API_KEY environment variable"
    }

# ════════════════════════════════════════════════════════════════════
# ══ SERVE FRONTEND — must be LAST after all API routes
# ════════════════════════════════════════════════════════════════════

app.mount("/", StaticFiles(directory=".", html=True), name="static")
