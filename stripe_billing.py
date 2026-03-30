"""Stripe billing integration — product/price creation and checkout sessions."""

import os
import stripe
import db

stripe.api_key = os.environ.get("STRIPE_SECRET_KEY", "")

# Service pricing config
SERVICE_PRICES = {
    "screenshot":  {"name": "ScreenshotAPI Pro",  "price": 1900, "desc": "10,000 screenshots/month"},
    "mailbox":     {"name": "TestMailbox Pro",     "price": 1200, "desc": "Unlimited inboxes, 24hr TTL"},
    "changelog":   {"name": "ChangelogHQ Pro",     "price": 1500, "desc": "Unlimited projects + custom branding"},
    "feedforge":   {"name": "FeedForge Pro",       "price": 1400, "desc": "100 feeds, 5min intervals"},
    "cronpilot":   {"name": "CronPilot Pro",       "price": 1600, "desc": "100 jobs, Slack/Discord alerts"},
    "waitlist":    {"name": "WaitlistKit Pro",     "price": 1000, "desc": "Unlimited waitlists + custom branding"},
    "invoice":     {"name": "InvoicePilot Pro",    "price": 1800, "desc": "Unlimited invoices + auto-reminders"},
}

_products_cache = {}
_prices_cache = {}


def _ensure_product(service: str) -> str:
    """Get or create Stripe product for a service."""
    if service in _products_cache:
        return _products_cache[service]

    cfg = SERVICE_PRICES[service]
    # Search for existing product
    products = stripe.Product.search(query=f'metadata["service"]:"{service}"', limit=1)
    if products.data:
        _products_cache[service] = products.data[0].id
        return products.data[0].id

    product = stripe.Product.create(
        name=cfg["name"],
        description=cfg["desc"],
        metadata={"service": service},
    )
    _products_cache[service] = product.id
    return product.id


def _ensure_price(service: str) -> str:
    """Get or create Stripe price for a service."""
    if service in _prices_cache:
        return _prices_cache[service]

    product_id = _ensure_product(service)
    cfg = SERVICE_PRICES[service]

    # Search for existing price
    prices = stripe.Price.list(product=product_id, active=True, limit=5)
    for p in prices.data:
        if p.unit_amount == cfg["price"] and p.recurring and p.recurring.interval == "month":
            _prices_cache[service] = p.id
            return p.id

    price = stripe.Price.create(
        product=product_id,
        unit_amount=cfg["price"],
        currency="usd",
        recurring={"interval": "month"},
        metadata={"service": service},
    )
    _prices_cache[service] = price.id
    return price.id


def get_or_create_customer(user_id: str, email: str) -> str:
    """Get or create Stripe customer for a user."""
    user = db.get_user(user_id)
    if user and user.get("stripe_customer_id"):
        return user["stripe_customer_id"]

    customer = stripe.Customer.create(
        email=email,
        metadata={"user_id": user_id},
    )
    db.update_user_stripe(user_id, customer.id)
    return customer.id


def create_checkout_session(user_id: str, email: str, service: str, success_url: str, cancel_url: str) -> str:
    """Create a Stripe Checkout session for a Pro subscription."""
    if service not in SERVICE_PRICES:
        raise ValueError(f"Unknown service: {service}")

    customer_id = get_or_create_customer(user_id, email)
    price_id = _ensure_price(service)

    session = stripe.checkout.Session.create(
        customer=customer_id,
        payment_method_types=["card"],
        line_items=[{"price": price_id, "quantity": 1}],
        mode="subscription",
        success_url=success_url,
        cancel_url=cancel_url,
        metadata={"user_id": user_id, "service": service},
        subscription_data={"metadata": {"user_id": user_id, "service": service}},
    )
    return session.url


def create_portal_session(user_id: str, email: str, return_url: str) -> str:
    """Create Stripe Customer Portal session for managing subscriptions."""
    customer_id = get_or_create_customer(user_id, email)
    session = stripe.billing_portal.Session.create(
        customer=customer_id,
        return_url=return_url,
    )
    return session.url


def handle_webhook_event(event: dict):
    """Process Stripe webhook events."""
    event_type = event["type"]

    if event_type == "checkout.session.completed":
        session = event["data"]["object"]
        user_id = session.get("metadata", {}).get("user_id")
        service = session.get("metadata", {}).get("service")
        sub_id = session.get("subscription")
        if user_id and service and sub_id:
            db.upsert_subscription(
                user_id=user_id,
                service=service,
                tier="pro",
                stripe_sub_id=sub_id,
                status="active",
            )

    elif event_type in ("customer.subscription.updated", "customer.subscription.deleted"):
        sub = event["data"]["object"]
        stripe_sub_id = sub["id"]
        user_id = sub.get("metadata", {}).get("user_id")
        service = sub.get("metadata", {}).get("service")
        status = sub["status"]  # active, past_due, canceled, unpaid

        tier = "pro" if status == "active" else "free"
        if user_id and service:
            db.upsert_subscription(
                user_id=user_id,
                service=service,
                tier=tier,
                stripe_sub_id=stripe_sub_id,
                status=status,
            )

    elif event_type == "invoice.payment_failed":
        invoice = event["data"]["object"]
        sub_id = invoice.get("subscription")
        if sub_id:
            existing = db.get_sub_by_stripe_id(sub_id)
            if existing:
                db.upsert_subscription(
                    user_id=existing["user_id"],
                    service=existing["service"],
                    tier="free",
                    stripe_sub_id=sub_id,
                    status="past_due",
                )
