"""SQLite database for auth service."""

import os
import secrets
import sqlite3
import hashlib
import time
from datetime import datetime, timezone

DB_PATH = os.environ.get("AUTH_DB_PATH", "/data/auth.db")

def _conn():
    c = sqlite3.connect(DB_PATH)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("PRAGMA foreign_keys=ON")
    return c

def init_db():
    c = _conn()
    c.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            name TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now')),
            verified INTEGER DEFAULT 0,
            stripe_customer_id TEXT
        );

        CREATE TABLE IF NOT EXISTS api_keys (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id),
            key_hash TEXT UNIQUE NOT NULL,
            key_prefix TEXT NOT NULL,
            service TEXT NOT NULL,
            tier TEXT DEFAULT 'free',
            label TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now')),
            last_used TEXT,
            active INTEGER DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS subscriptions (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id),
            service TEXT NOT NULL,
            stripe_subscription_id TEXT,
            stripe_price_id TEXT,
            tier TEXT DEFAULT 'free',
            status TEXT DEFAULT 'active',
            current_period_start TEXT,
            current_period_end TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            UNIQUE(user_id, service)
        );

        CREATE TABLE IF NOT EXISTS usage (
            api_key_id TEXT NOT NULL,
            date TEXT NOT NULL,
            count INTEGER DEFAULT 0,
            PRIMARY KEY (api_key_id, date)
        );

        CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
        CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);
        CREATE INDEX IF NOT EXISTS idx_subs_user ON subscriptions(user_id);
        CREATE INDEX IF NOT EXISTS idx_subs_stripe ON subscriptions(stripe_subscription_id);
    """)
    c.close()


def _hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 100000)
    return f"{salt}:{h.hex()}"

def _verify_password(password: str, stored: str) -> bool:
    salt, h = stored.split(":")
    check = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 100000)
    return check.hex() == h

def _hash_key(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


# ── Users ────────────────────────────────────────────────────

def create_user(email: str, password: str, name: str = "") -> dict:
    uid = secrets.token_urlsafe(16)
    c = _conn()
    try:
        c.execute(
            "INSERT INTO users (id, email, password_hash, name) VALUES (?, ?, ?, ?)",
            (uid, email.lower().strip(), _hash_password(password), name),
        )
        c.commit()
    except sqlite3.IntegrityError:
        c.close()
        raise ValueError("Email already registered")
    c.close()
    return {"id": uid, "email": email.lower().strip(), "name": name}

def authenticate(email: str, password: str) -> dict | None:
    c = _conn()
    row = c.execute("SELECT * FROM users WHERE email = ?", (email.lower().strip(),)).fetchone()
    c.close()
    if not row or not _verify_password(password, row["password_hash"]):
        return None
    return dict(row)

def get_user(user_id: str) -> dict | None:
    c = _conn()
    row = c.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    c.close()
    return dict(row) if row else None

def get_user_by_email(email: str) -> dict | None:
    c = _conn()
    row = c.execute("SELECT * FROM users WHERE email = ?", (email.lower().strip(),)).fetchone()
    c.close()
    return dict(row) if row else None

def update_user_stripe(user_id: str, stripe_customer_id: str):
    c = _conn()
    c.execute("UPDATE users SET stripe_customer_id = ? WHERE id = ?", (stripe_customer_id, user_id))
    c.commit()
    c.close()


# ── API Keys ─────────────────────────────────────────────────

SERVICES = ["screenshot", "mailbox", "changelog", "feedforge", "cronpilot", "waitlist", "invoice"]

TIER_LIMITS = {
    "free":       {"daily": 100,   "monthly": 1000},
    "pro":        {"daily": 5000,  "monthly": 50000},
    "enterprise": {"daily": 50000, "monthly": 500000},
}

MAX_KEYS_PER_SERVICE = 2  # max active keys per user per service

def create_api_key(user_id: str, service: str, label: str = "") -> dict:
    if service not in SERVICES:
        raise ValueError(f"Unknown service: {service}")
    c = _conn()
    # Enforce key limit per user per service
    existing = c.execute(
        "SELECT COUNT(*) as cnt FROM api_keys WHERE user_id = ? AND service = ? AND active = 1",
        (user_id, service),
    ).fetchone()["cnt"]
    if existing >= MAX_KEYS_PER_SERVICE:
        c.close()
        raise ValueError(f"Maximum {MAX_KEYS_PER_SERVICE} active keys per service. Revoke an existing key first.")
    raw_key = f"sk_{service}_{secrets.token_urlsafe(32)}"
    key_id = secrets.token_urlsafe(12)
    c.execute(
        "INSERT INTO api_keys (id, user_id, key_hash, key_prefix, service, label) VALUES (?, ?, ?, ?, ?, ?)",
        (key_id, user_id, _hash_key(raw_key), raw_key[:20], service, label),
    )
    c.commit()
    c.close()
    return {"id": key_id, "key": raw_key, "prefix": raw_key[:20], "service": service}

def validate_api_key(raw_key: str) -> dict | None:
    """Validate a key and return info. Returns None if invalid."""
    h = _hash_key(raw_key)
    c = _conn()
    row = c.execute(
        "SELECT ak.*, u.email FROM api_keys ak JOIN users u ON ak.user_id = u.id WHERE ak.key_hash = ? AND ak.active = 1",
        (h,),
    ).fetchone()
    if not row:
        c.close()
        return None
    # Update last_used
    c.execute("UPDATE api_keys SET last_used = datetime('now') WHERE id = ?", (row["id"],))
    c.commit()
    # Check subscription tier
    sub = c.execute(
        "SELECT tier FROM subscriptions WHERE user_id = ? AND service = ? AND status = 'active'",
        (row["user_id"], row["service"]),
    ).fetchone()
    tier = sub["tier"] if sub else "free"
    c.close()
    return {
        "valid": True,
        "key_id": row["id"],
        "user_id": row["user_id"],
        "email": row["email"],
        "service": row["service"],
        "tier": tier,
    }

def get_user_keys(user_id: str) -> list:
    c = _conn()
    rows = c.execute(
        "SELECT id, key_prefix, service, tier, label, created_at, last_used, active FROM api_keys WHERE user_id = ? ORDER BY created_at DESC",
        (user_id,),
    ).fetchall()
    c.close()
    return [dict(r) for r in rows]

def revoke_api_key(key_id: str, user_id: str) -> bool:
    c = _conn()
    cur = c.execute("UPDATE api_keys SET active = 0 WHERE id = ? AND user_id = ?", (key_id, user_id))
    c.commit()
    c.close()
    return cur.rowcount > 0


# ── Usage Tracking ───────────────────────────────────────────

def record_usage(key_id: str) -> dict:
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    c = _conn()
    c.execute(
        "INSERT INTO usage (api_key_id, date, count) VALUES (?, ?, 1) ON CONFLICT(api_key_id, date) DO UPDATE SET count = count + 1",
        (key_id, today),
    )
    c.commit()
    row = c.execute("SELECT count FROM usage WHERE api_key_id = ? AND date = ?", (key_id, today)).fetchone()
    c.close()
    return {"today": row["count"] if row else 0}

def check_rate_limit(key_id: str, tier: str) -> dict:
    limits = TIER_LIMITS.get(tier, TIER_LIMITS["free"])
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    month_start = datetime.now(timezone.utc).strftime("%Y-%m-01")
    c = _conn()
    daily = c.execute("SELECT COALESCE(SUM(count),0) as total FROM usage WHERE api_key_id = ? AND date = ?", (key_id, today)).fetchone()["total"]
    monthly = c.execute("SELECT COALESCE(SUM(count),0) as total FROM usage WHERE api_key_id = ? AND date >= ?", (key_id, month_start)).fetchone()["total"]
    c.close()
    return {
        "allowed": daily < limits["daily"] and monthly < limits["monthly"],
        "daily_used": daily,
        "daily_limit": limits["daily"],
        "monthly_used": monthly,
        "monthly_limit": limits["monthly"],
    }

def get_usage_stats(user_id: str) -> list:
    c = _conn()
    rows = c.execute("""
        SELECT ak.service, ak.key_prefix, SUM(u.count) as total, MAX(u.date) as last_date
        FROM api_keys ak LEFT JOIN usage u ON ak.id = u.api_key_id
        WHERE ak.user_id = ? AND ak.active = 1
        GROUP BY ak.id
    """, (user_id,)).fetchall()
    c.close()
    return [dict(r) for r in rows]


# ── Subscriptions ────────────────────────────────────────────

def upsert_subscription(user_id: str, service: str, tier: str, stripe_sub_id: str = None, stripe_price_id: str = None, status: str = "active", period_start: str = None, period_end: str = None) -> dict:
    sub_id = secrets.token_urlsafe(12)
    c = _conn()
    c.execute("""
        INSERT INTO subscriptions (id, user_id, service, tier, stripe_subscription_id, stripe_price_id, status, current_period_start, current_period_end)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, service) DO UPDATE SET
            tier = excluded.tier,
            stripe_subscription_id = excluded.stripe_subscription_id,
            stripe_price_id = excluded.stripe_price_id,
            status = excluded.status,
            current_period_start = excluded.current_period_start,
            current_period_end = excluded.current_period_end
    """, (sub_id, user_id, service, tier, stripe_sub_id, stripe_price_id, status, period_start, period_end))
    c.commit()
    c.close()
    return {"user_id": user_id, "service": service, "tier": tier, "status": status}

def get_user_subscriptions(user_id: str) -> list:
    c = _conn()
    rows = c.execute("SELECT * FROM subscriptions WHERE user_id = ? ORDER BY service", (user_id,)).fetchall()
    c.close()
    return [dict(r) for r in rows]

def get_sub_by_stripe_id(stripe_sub_id: str) -> dict | None:
    c = _conn()
    row = c.execute("SELECT * FROM subscriptions WHERE stripe_subscription_id = ?", (stripe_sub_id,)).fetchone()
    c.close()
    return dict(row) if row else None
