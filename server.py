"""Auth + Billing Service — Central auth gateway for all MCP services."""

import os
import logging
import secrets
import time
from datetime import datetime, timezone, timedelta

import jwt
import stripe
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request, Response, Depends, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, RedirectResponse, JSONResponse
from pydantic import BaseModel, EmailStr
from contextlib import asynccontextmanager

import db
import stripe_billing

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(levelname)s: %(message)s")
logger = logging.getLogger("auth-service")

JWT_SECRET = os.environ.get("JWT_SECRET", "changeme")
JWT_ALGO = "HS256"
JWT_EXPIRY_HOURS = 72
STRIPE_WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET", "")
BASE_URL = os.environ.get("BASE_URL", "https://auth.rjctdlabs.xyz")

stripe.api_key = os.environ.get("STRIPE_SECRET_KEY", "")
STRIPE_PK = os.environ.get("STRIPE_PUBLISHABLE_KEY", "")

SERVICE_URLS = {
    "screenshot": "https://api.rjctdlabs.xyz",
    "mailbox": "https://mail.rjctdlabs.xyz",
    "changelog": "https://changelog.rjctdlabs.xyz",
    "feedforge": "https://feeds.rjctdlabs.xyz",
    "cronpilot": "https://cron.rjctdlabs.xyz",
    "waitlist": "https://waitlist.rjctdlabs.xyz",
    "invoice": "https://invoice.rjctdlabs.xyz",
}

SERVICE_NAMES = {
    "screenshot": "ScreenshotAPI",
    "mailbox": "TestMailbox",
    "changelog": "ChangelogHQ",
    "feedforge": "FeedForge",
    "cronpilot": "CronPilot",
    "waitlist": "WaitlistKit",
    "invoice": "InvoicePilot",
}


@asynccontextmanager
async def lifespan(app):
    db.init_db()
    logger.info("Auth service started")
    yield

app = FastAPI(title="RJCTD Labs Auth", version="1.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


# ── JWT Helpers ──────────────────────────────────────────────

def _create_token(user_id: str, email: str) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "exp": datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRY_HOURS),
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGO)

def _decode_token(token: str) -> dict | None:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO])
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError):
        return None

def _get_current_user(request: Request) -> dict:
    """Extract user from cookie or Authorization header."""
    token = request.cookies.get("auth_token")
    if not token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
    if not token:
        raise HTTPException(401, "Not authenticated")
    payload = _decode_token(token)
    if not payload:
        raise HTTPException(401, "Invalid or expired token")
    user = db.get_user(payload["sub"])
    if not user:
        raise HTTPException(401, "User not found")
    return user


# ── Schemas ──────────────────────────────────────────────────

class SignupRequest(BaseModel):
    email: EmailStr
    password: str
    name: str = ""

class LoginRequest(BaseModel):
    email: EmailStr
    password: str

class CreateKeyRequest(BaseModel):
    service: str
    label: str = ""


# ── Rate Limiting (IP-based for signup/login) ───────────────

_ip_attempts: dict[str, list[float]] = {}  # ip -> [timestamps]
SIGNUP_LIMIT = 3       # max signups per IP per hour
LOGIN_FAIL_LIMIT = 10  # max failed logins per IP per hour

def _check_ip_rate(ip: str, limit: int) -> bool:
    now = time.time()
    cutoff = now - 3600
    attempts = _ip_attempts.get(ip, [])
    attempts = [t for t in attempts if t > cutoff]
    _ip_attempts[ip] = attempts
    if len(attempts) >= limit:
        return False
    attempts.append(now)
    _ip_attempts[ip] = attempts
    return True


# ── Auth Endpoints ───────────────────────────────────────────

@app.post("/auth/signup")
async def signup(req: SignupRequest, request: Request):
    client_ip = request.headers.get("CF-Connecting-IP", request.client.host if request.client else "unknown")
    if not _check_ip_rate(f"signup:{client_ip}", SIGNUP_LIMIT):
        raise HTTPException(429, "Too many signups from this IP. Try again later.")
    if len(req.password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters")
    try:
        user = db.create_user(req.email, req.password, req.name)
    except ValueError as e:
        raise HTTPException(409, str(e))
    token = _create_token(user["id"], user["email"])
    resp = JSONResponse({"user": user, "token": token})
    resp.set_cookie("auth_token", token, httponly=True, secure=True, samesite="lax", max_age=JWT_EXPIRY_HOURS * 3600)
    return resp

@app.post("/auth/login")
async def login(req: LoginRequest, request: Request):
    client_ip = request.headers.get("CF-Connecting-IP", request.client.host if request.client else "unknown")
    user = db.authenticate(req.email, req.password)
    if not user:
        if not _check_ip_rate(f"login:{client_ip}", LOGIN_FAIL_LIMIT):
            raise HTTPException(429, "Too many failed login attempts. Try again later.")
        raise HTTPException(401, "Invalid email or password")
    token = _create_token(user["id"], user["email"])
    resp = JSONResponse({"user": {"id": user["id"], "email": user["email"], "name": user["name"]}, "token": token})
    resp.set_cookie("auth_token", token, httponly=True, secure=True, samesite="lax", max_age=JWT_EXPIRY_HOURS * 3600)
    return resp

@app.post("/auth/logout")
async def logout():
    resp = JSONResponse({"ok": True})
    resp.delete_cookie("auth_token")
    return resp

@app.get("/auth/me")
async def get_me(request: Request):
    user = _get_current_user(request)
    return {"id": user["id"], "email": user["email"], "name": user["name"]}


# ── API Key Management ───────────────────────────────────────

@app.post("/keys")
async def create_key(req: CreateKeyRequest, request: Request):
    user = _get_current_user(request)
    try:
        key = db.create_api_key(user["id"], req.service, req.label)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return key

@app.get("/keys")
async def list_keys(request: Request):
    user = _get_current_user(request)
    return db.get_user_keys(user["id"])

@app.delete("/keys/{key_id}")
async def revoke_key(key_id: str, request: Request):
    user = _get_current_user(request)
    if not db.revoke_api_key(key_id, user["id"]):
        raise HTTPException(404, "Key not found")
    return {"ok": True}


# ── Validation Endpoint (called by services) ────────────────

@app.post("/validate")
async def validate_key(request: Request):
    body = await request.json()
    raw_key = body.get("api_key", "")
    if not raw_key:
        return {"valid": False, "error": "No key provided"}

    info = db.validate_api_key(raw_key)
    if not info:
        return {"valid": False, "error": "Invalid key"}

    rate = db.check_rate_limit(info["key_id"], info["tier"])
    if not rate["allowed"]:
        return {"valid": False, "error": "Rate limit exceeded", "rate_limit": rate}

    db.record_usage(info["key_id"])
    return {
        "valid": True,
        "user_id": info["user_id"],
        "tier": info["tier"],
        "service": info["service"],
        "rate_limit": rate,
    }


# ── Billing ──────────────────────────────────────────────────

@app.get("/billing")
async def get_billing(request: Request):
    user = _get_current_user(request)
    subs = db.get_user_subscriptions(user["id"])
    usage = db.get_usage_stats(user["id"])
    return {"subscriptions": subs, "usage": usage}

@app.post("/billing/checkout")
async def create_checkout(request: Request):
    user = _get_current_user(request)
    body = await request.json()
    service = body.get("service")
    if not service or service not in db.SERVICES:
        raise HTTPException(400, "Invalid service")
    url = stripe_billing.create_checkout_session(
        user_id=user["id"],
        email=user["email"],
        service=service,
        success_url=f"{BASE_URL}/dashboard?checkout=success&service={service}",
        cancel_url=f"{BASE_URL}/dashboard?checkout=cancel",
    )
    return {"url": url}

@app.post("/billing/portal")
async def billing_portal(request: Request):
    user = _get_current_user(request)
    url = stripe_billing.create_portal_session(
        user_id=user["id"],
        email=user["email"],
        return_url=f"{BASE_URL}/dashboard",
    )
    return {"url": url}

@app.post("/stripe/webhook")
async def stripe_webhook(request: Request):
    payload = await request.body()
    sig = request.headers.get("stripe-signature", "")
    try:
        if STRIPE_WEBHOOK_SECRET:
            event = stripe.Webhook.construct_event(payload, sig, STRIPE_WEBHOOK_SECRET)
        else:
            event = stripe.Event.construct_from(
                stripe.util.convert_to_stripe_object(await request.json(), stripe.api_key), stripe.api_key
            )
    except Exception as e:
        logger.error(f"Webhook error: {e}")
        raise HTTPException(400, str(e))

    logger.info(f"Stripe event: {event['type']}")
    stripe_billing.handle_webhook_event(event)
    return {"ok": True}


# ── Health ───────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok", "service": "auth"}


# ── Dashboard UI ─────────────────────────────────────────────

DASHBOARD_HTML = """\
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>RJCTD Labs - Developer Dashboard</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    .tab-active { border-color: #6366f1; color: #6366f1; }
    .tier-free { background: #1e293b; border-color: #334155; }
    .tier-pro { background: #1e1b4b; border-color: #6366f1; }
  </style>
</head>
<body class="bg-gray-950 text-gray-100 font-sans antialiased min-h-screen">
  <div id="app">
    <!-- Auth Screen -->
    <div id="auth-screen" class="min-h-screen flex items-center justify-center px-4">
      <div class="bg-gray-900 border border-gray-800 rounded-2xl p-8 w-full max-w-md shadow-2xl">
        <h1 class="text-2xl font-bold text-center mb-2">RJCTD Labs</h1>
        <p class="text-gray-400 text-center text-sm mb-8">Developer Dashboard</p>
        <div class="flex mb-6 border-b border-gray-800">
          <button onclick="showAuthTab('login')" id="tab-login" class="flex-1 pb-3 text-sm font-medium border-b-2 tab-active">Log In</button>
          <button onclick="showAuthTab('signup')" id="tab-signup" class="flex-1 pb-3 text-sm font-medium border-b-2 border-transparent text-gray-500">Sign Up</button>
        </div>
        <form id="auth-form" onsubmit="handleAuth(event)">
          <div id="name-field" class="hidden mb-4">
            <label class="block text-xs text-gray-400 mb-1">Name</label>
            <input name="name" type="text" class="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-sm focus:border-indigo-500 focus:outline-none" placeholder="Your name"/>
          </div>
          <div class="mb-4">
            <label class="block text-xs text-gray-400 mb-1">Email</label>
            <input name="email" type="email" required class="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-sm focus:border-indigo-500 focus:outline-none" placeholder="you@example.com"/>
          </div>
          <div class="mb-6">
            <label class="block text-xs text-gray-400 mb-1">Password</label>
            <input name="password" type="password" required minlength="8" class="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-sm focus:border-indigo-500 focus:outline-none" placeholder="Min 8 characters"/>
          </div>
          <div id="auth-error" class="hidden mb-4 p-3 bg-red-900/30 border border-red-800 rounded-lg text-red-400 text-sm"></div>
          <button type="submit" class="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 rounded-lg font-semibold text-sm transition">
            <span id="auth-btn-text">Log In</span>
          </button>
        </form>
      </div>
    </div>

    <!-- Dashboard Screen -->
    <div id="dash-screen" class="hidden">
      <nav class="border-b border-gray-800 bg-gray-900/80 backdrop-blur sticky top-0 z-50">
        <div class="max-w-6xl mx-auto flex items-center justify-between px-6 py-4">
          <span class="text-lg font-bold text-indigo-400">RJCTD Labs</span>
          <div class="flex items-center gap-4">
            <span id="user-email" class="text-sm text-gray-400"></span>
            <button onclick="logout()" class="text-sm text-gray-500 hover:text-red-400 transition">Logout</button>
          </div>
        </div>
      </nav>

      <div class="max-w-6xl mx-auto px-6 py-8">
        <!-- Tabs -->
        <div class="flex gap-1 mb-8 border-b border-gray-800">
          <button onclick="showDashTab('keys')" class="dash-tab px-5 py-3 text-sm font-medium border-b-2 tab-active" data-tab="keys">API Keys</button>
          <button onclick="showDashTab('billing')" class="dash-tab px-5 py-3 text-sm font-medium border-b-2 border-transparent text-gray-500" data-tab="billing">Billing</button>
          <button onclick="showDashTab('usage')" class="dash-tab px-5 py-3 text-sm font-medium border-b-2 border-transparent text-gray-500" data-tab="usage">Usage</button>
        </div>

        <!-- Keys Tab -->
        <div id="panel-keys" class="dash-panel">
          <div class="flex items-center justify-between mb-6">
            <h2 class="text-xl font-bold">API Keys</h2>
            <button onclick="showCreateKey()" class="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm font-medium transition">+ New Key</button>
          </div>
          <div id="create-key-form" class="hidden mb-6 bg-gray-900 border border-gray-800 rounded-xl p-6">
            <h3 class="font-medium mb-4">Generate New API Key</h3>
            <div class="grid md:grid-cols-3 gap-4">
              <div>
                <label class="block text-xs text-gray-400 mb-1">Service</label>
                <select id="new-key-service" class="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm">
                  <option value="screenshot">ScreenshotAPI</option>
                  <option value="mailbox">TestMailbox</option>
                  <option value="changelog">ChangelogHQ</option>
                  <option value="feedforge">FeedForge</option>
                  <option value="cronpilot">CronPilot</option>
                  <option value="waitlist">WaitlistKit</option>
                  <option value="invoice">InvoicePilot</option>
                </select>
              </div>
              <div>
                <label class="block text-xs text-gray-400 mb-1">Label (optional)</label>
                <input id="new-key-label" type="text" class="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm" placeholder="e.g. Production"/>
              </div>
              <div class="flex items-end">
                <button onclick="createKey()" class="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-sm font-medium transition">Generate</button>
              </div>
            </div>
            <div id="new-key-result" class="hidden mt-4 p-4 bg-emerald-900/20 border border-emerald-800 rounded-lg">
              <p class="text-xs text-emerald-400 mb-1">Your API key (copy it now — you won't see it again):</p>
              <code id="new-key-value" class="block text-sm text-emerald-300 font-mono break-all select-all"></code>
            </div>
          </div>
          <div id="keys-list" class="space-y-3"></div>
          <div id="keys-empty" class="hidden text-center py-12 text-gray-500">
            <p>No API keys yet. Create one to get started.</p>
          </div>
        </div>

        <!-- Billing Tab -->
        <div id="panel-billing" class="dash-panel hidden">
          <h2 class="text-xl font-bold mb-6">Subscriptions</h2>
          <div id="billing-grid" class="grid md:grid-cols-2 lg:grid-cols-3 gap-4"></div>
          <div class="mt-8">
            <button onclick="openPortal()" class="px-5 py-2.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-sm font-medium transition">
              Manage Billing on Stripe
            </button>
          </div>
        </div>

        <!-- Usage Tab -->
        <div id="panel-usage" class="dash-panel hidden">
          <h2 class="text-xl font-bold mb-6">Usage</h2>
          <div id="usage-list" class="space-y-3"></div>
        </div>
      </div>
    </div>
  </div>

  <script>
    const API = '';  // same origin
    let authMode = 'login';
    let token = localStorage.getItem('auth_token') || '';

    // Check stored auth
    if (token) { loadDashboard(); }

    function headers() { return { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }; }

    function showAuthTab(mode) {
      authMode = mode;
      document.getElementById('tab-login').classList.toggle('tab-active', mode === 'login');
      document.getElementById('tab-signup').classList.toggle('tab-active', mode === 'signup');
      document.getElementById('tab-login').classList.toggle('text-gray-500', mode !== 'login');
      document.getElementById('tab-signup').classList.toggle('text-gray-500', mode !== 'signup');
      document.getElementById('tab-login').classList.toggle('border-transparent', mode !== 'login');
      document.getElementById('tab-signup').classList.toggle('border-transparent', mode !== 'signup');
      document.getElementById('name-field').classList.toggle('hidden', mode === 'login');
      document.getElementById('auth-btn-text').textContent = mode === 'login' ? 'Log In' : 'Sign Up';
      document.getElementById('auth-error').classList.add('hidden');
    }

    async function handleAuth(e) {
      e.preventDefault();
      const form = new FormData(e.target);
      const body = { email: form.get('email'), password: form.get('password') };
      if (authMode === 'signup') body.name = form.get('name') || '';

      try {
        const res = await fetch(API + '/auth/' + authMode, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Auth failed');
        token = data.token;
        localStorage.setItem('auth_token', token);
        loadDashboard();
      } catch (err) {
        const el = document.getElementById('auth-error');
        el.textContent = err.message;
        el.classList.remove('hidden');
      }
    }

    function logout() {
      token = '';
      localStorage.removeItem('auth_token');
      document.getElementById('auth-screen').classList.remove('hidden');
      document.getElementById('dash-screen').classList.add('hidden');
    }

    async function loadDashboard() {
      try {
        const res = await fetch(API + '/auth/me', { headers: headers() });
        if (!res.ok) { logout(); return; }
        const user = await res.json();
        document.getElementById('user-email').textContent = user.email;
        document.getElementById('auth-screen').classList.add('hidden');
        document.getElementById('dash-screen').classList.remove('hidden');
        loadKeys();
        loadBilling();
      } catch { logout(); }
    }

    function showDashTab(tab) {
      document.querySelectorAll('.dash-tab').forEach(t => {
        t.classList.toggle('tab-active', t.dataset.tab === tab);
        t.classList.toggle('border-transparent', t.dataset.tab !== tab);
        t.classList.toggle('text-gray-500', t.dataset.tab !== tab);
      });
      document.querySelectorAll('.dash-panel').forEach(p => p.classList.add('hidden'));
      document.getElementById('panel-' + tab).classList.remove('hidden');
      if (tab === 'usage') loadUsage();
    }

    function showCreateKey() { document.getElementById('create-key-form').classList.toggle('hidden'); }

    async function createKey() {
      const service = document.getElementById('new-key-service').value;
      const label = document.getElementById('new-key-label').value;
      const res = await fetch(API + '/keys', { method: 'POST', headers: headers(), body: JSON.stringify({ service, label }) });
      const data = await res.json();
      if (res.ok) {
        document.getElementById('new-key-value').textContent = data.key;
        document.getElementById('new-key-result').classList.remove('hidden');
        loadKeys();
      }
    }

    const SERVICE_NAMES = """ + str({k: v for k, v in SERVICE_NAMES.items()}).replace("'", '"') + """;
    const SERVICE_PRICES = """ + str({k: f"${v['price']//100}/mo" for k, v in stripe_billing.SERVICE_PRICES.items()}).replace("'", '"') + """;

    async function loadKeys() {
      const res = await fetch(API + '/keys', { headers: headers() });
      const keys = await res.json();
      const list = document.getElementById('keys-list');
      const empty = document.getElementById('keys-empty');
      if (!keys.length) { list.innerHTML = ''; empty.classList.remove('hidden'); return; }
      empty.classList.add('hidden');
      list.innerHTML = keys.filter(k => k.active).map(k => `
        <div class="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center justify-between">
          <div>
            <div class="flex items-center gap-2 mb-1">
              <span class="px-2 py-0.5 rounded text-xs font-bold bg-indigo-900 text-indigo-300">${SERVICE_NAMES[k.service] || k.service}</span>
              <code class="text-sm text-gray-400 font-mono">${k.key_prefix}...</code>
              ${k.label ? '<span class="text-xs text-gray-500">' + k.label + '</span>' : ''}
            </div>
            <div class="text-xs text-gray-500">Created ${k.created_at} ${k.last_used ? '· Last used ' + k.last_used : ''}</div>
          </div>
          <button onclick="revokeKey('${k.id}')" class="text-xs text-red-500 hover:text-red-400 transition">Revoke</button>
        </div>
      `).join('');
    }

    async function revokeKey(id) {
      if (!confirm('Revoke this API key?')) return;
      await fetch(API + '/keys/' + id, { method: 'DELETE', headers: headers() });
      loadKeys();
    }

    async function loadBilling() {
      const res = await fetch(API + '/billing', { headers: headers() });
      const data = await res.json();
      const grid = document.getElementById('billing-grid');
      const subs = data.subscriptions || [];
      const subMap = {};
      subs.forEach(s => subMap[s.service] = s);

      grid.innerHTML = Object.keys(SERVICE_NAMES).map(svc => {
        const sub = subMap[svc];
        const tier = sub ? sub.tier : 'free';
        const isPro = tier === 'pro';
        return `
          <div class="${isPro ? 'tier-pro' : 'tier-free'} border rounded-xl p-5">
            <div class="flex items-center justify-between mb-3">
              <h3 class="font-semibold">${SERVICE_NAMES[svc]}</h3>
              <span class="px-2 py-0.5 rounded text-xs font-bold ${isPro ? 'bg-indigo-600 text-white' : 'bg-gray-700 text-gray-300'}">${tier.toUpperCase()}</span>
            </div>
            <p class="text-sm text-gray-400 mb-4">${isPro ? SERVICE_PRICES[svc] : 'Free tier'}</p>
            ${isPro ? '' : '<button onclick="upgrade(\\'' + svc + '\\')" class="w-full py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm font-medium transition">Upgrade to Pro</button>'}
          </div>
        `;
      }).join('');
    }

    async function upgrade(service) {
      const res = await fetch(API + '/billing/checkout', { method: 'POST', headers: headers(), body: JSON.stringify({ service }) });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
    }

    async function openPortal() {
      const res = await fetch(API + '/billing/portal', { method: 'POST', headers: headers() });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
    }

    async function loadUsage() {
      const res = await fetch(API + '/billing', { headers: headers() });
      const data = await res.json();
      const list = document.getElementById('usage-list');
      const usage = data.usage || [];
      if (!usage.length) { list.innerHTML = '<p class="text-center text-gray-500 py-12">No usage data yet.</p>'; return; }
      list.innerHTML = usage.map(u => `
        <div class="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center justify-between">
          <div>
            <span class="px-2 py-0.5 rounded text-xs font-bold bg-indigo-900 text-indigo-300">${SERVICE_NAMES[u.service] || u.service}</span>
            <code class="text-sm text-gray-400 ml-2">${u.key_prefix}...</code>
          </div>
          <div class="text-right">
            <div class="text-sm font-medium">${u.total || 0} requests</div>
            <div class="text-xs text-gray-500">${u.last_date ? 'Last: ' + u.last_date : 'No usage'}</div>
          </div>
        </div>
      `).join('');
    }

    // Check URL params for checkout result
    const params = new URLSearchParams(window.location.search);
    if (params.get('checkout') === 'success') {
      setTimeout(() => { alert('Subscription activated! Your API key tier has been upgraded to Pro.'); loadBilling(); }, 500);
    }
  </script>
</body>
</html>
"""

@app.get("/", response_class=HTMLResponse)
async def landing():
    return RedirectResponse("/dashboard")

@app.get("/dashboard", response_class=HTMLResponse)
async def dashboard():
    return HTMLResponse(content=DASHBOARD_HTML)


# ── Run ──────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", "8499"))
    uvicorn.run(app, host="0.0.0.0", port=port)
