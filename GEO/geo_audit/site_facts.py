"""Facts about a website that code can read without asking a model.

Three of them shape how a buyer phrases a search: the market whose money and
rules the company works under, whether prices are published, and whether a
buyer can start alone or has to talk to someone. A model answered all three
inconsistently across runs on the same input, because none of them is a
judgment. They are patterns on a page, so they belong here.
"""
from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlparse

# Only currencies that belong to one market. The dollar, the euro and the
# pound sign are shared, so a price in them says nothing on its own.
CURRENCY_MARKETS: dict[str, str] = {
    "₹": "India",
    "inr": "India",
    "₨": "Pakistan",
    "৳": "Bangladesh",
    "රු": "Sri Lanka",
    "lkr": "Sri Lanka",
    "pkr": "Pakistan",
    "bdt": "Bangladesh",
    "npr": "Nepal",
    "¥": "Japan",
    "jpy": "Japan",
    "cny": "China",
    "rmb": "China",
    "₩": "South Korea",
    "krw": "South Korea",
    "₦": "Nigeria",
    "ngn": "Nigeria",
    "₱": "Philippines",
    "php": "Philippines",
    "฿": "Thailand",
    "thb": "Thailand",
    "₫": "Vietnam",
    "vnd": "Vietnam",
    "₪": "Israel",
    "ils": "Israel",
    "₴": "Ukraine",
    "uah": "Ukraine",
    "r$": "Brazil",
    "brl": "Brazil",
    "zar": "South Africa",
    "aed": "United Arab Emirates",
    "sar": "Saudi Arabia",
    "myr": "Malaysia",
    "idr": "Indonesia",
    "try": "Turkey",
    "rub": "Russia",
    "pln": "Poland",
    "sek": "Sweden",
    "nok": "Norway",
    "dkk": "Denmark",
    "chf": "Switzerland",
    "mxn": "Mexico",
    "cop": "Colombia",
    "clp": "Chile",
    "ars": "Argentina",
    "egp": "Egypt",
    "kes": "Kenya",
    "ghs": "Ghana",
}

# A regulator or an exchange names the market a company operates inside. Kept
# to acronyms specific enough that a word-boundary match is not a coincidence.
AUTHORITY_MARKETS: dict[str, str] = {
    "SEBI": "India",
    "NSE": "India",
    "BSE": "India",
    "RBI": "India",
    "IRDAI": "India",
    "FINRA": "United States",
    "NYSE": "United States",
    "NASDAQ": "United States",
    "FDIC": "United States",
    "FINCEN": "United States",
    "FCA": "United Kingdom",
    "PRA": "United Kingdom",
    "LSE": "United Kingdom",
    "OFCOM": "United Kingdom",
    "ASIC": "Australia",
    "ASX": "Australia",
    "APRA": "Australia",
    "MAS": "Singapore",
    "SGX": "Singapore",
    "OSC": "Canada",
    "TSX": "Canada",
    "FINTRAC": "Canada",
    "BAFIN": "Germany",
    "AMF": "France",
    "CONSOB": "Italy",
    "CNMV": "Spain",
    "CVM": "Brazil",
    "CNBV": "Mexico",
    "CSRC": "China",
    "KRX": "South Korea",
    "JPX": "Japan",
    "DFSA": "United Arab Emirates",
    "SAMA": "Saudi Arabia",
    "FSCA": "South Africa",
    "SECP": "Pakistan",
    "BSP": "Philippines",
}

# The country a site claims by its own address. A company picks this, so it
# says something about the market it wants, unlike a head office address.
TLD_MARKETS: dict[str, str] = {
    "in": "India",
    "uk": "United Kingdom",
    "au": "Australia",
    "ca": "Canada",
    "de": "Germany",
    "fr": "France",
    "it": "Italy",
    "es": "Spain",
    "nl": "Netherlands",
    "se": "Sweden",
    "no": "Norway",
    "dk": "Denmark",
    "fi": "Finland",
    "pl": "Poland",
    "br": "Brazil",
    "mx": "Mexico",
    "ar": "Argentina",
    "cl": "Chile",
    "co": "Colombia",
    "za": "South Africa",
    "ng": "Nigeria",
    "ke": "Kenya",
    "eg": "Egypt",
    "ae": "United Arab Emirates",
    "sa": "Saudi Arabia",
    "sg": "Singapore",
    "my": "Malaysia",
    "id": "Indonesia",
    "th": "Thailand",
    "vn": "Vietnam",
    "ph": "Philippines",
    "pk": "Pakistan",
    "bd": "Bangladesh",
    "lk": "Sri Lanka",
    "np": "Nepal",
    "jp": "Japan",
    "kr": "South Korea",
    "cn": "China",
    "tw": "Taiwan",
    "hk": "Hong Kong",
    "nz": "New Zealand",
    "ie": "Ireland",
    "ch": "Switzerland",
    "at": "Austria",
    "be": "Belgium",
    "pt": "Portugal",
    "gr": "Greece",
    "tr": "Turkey",
    "il": "Israel",
    "ru": "Russia",
    "ua": "Ukraine",
}

# One signal is a coincidence. A price in rupees beside a mention of SEBI is
# not, and neither is either of them beside a .in address.
REQUIRED_MARKET_SIGNALS = 2

PRICE_PATTERN = re.compile(
    r"(?:[₹₨৳¥₩₦₱฿₫₪₴$€£]|\b(?:usd|eur|gbp|inr|jpy|aud|cad|sgd|aed|brl|zar)\b)"
    r"\s?\d",
    re.IGNORECASE,
)

# Every one of these means a buyer can open an account without being called.
# "Get started" and "Start now" are not here: they sit on agency contact forms
# just as often, and one of them alone called a services firm self-serve.
SELF_SERVE_PHRASES = (
    "sign up",
    "signup",
    "start free",
    "start for free",
    "try free",
    "try for free",
    "free trial",
    "create an account",
    "create account",
    "open an account",
    "open account",
    "buy now",
    "add to cart",
    "subscribe now",
)
CONTACT_SALES_PHRASES = (
    "contact sales",
    "talk to sales",
    "talk to an expert",
    "request a demo",
    "book a demo",
    "schedule a demo",
    "request a quote",
    "get a quote",
    "request pricing",
    "contact us for pricing",
    "speak to our team",
)


def detect_site_facts(snapshot: dict[str, Any]) -> dict[str, Any]:
    """Market, published prices and purchase path, read straight off the pages."""
    pages = [page for page in snapshot.get("pages", []) if isinstance(page, dict)]
    joined = "\n".join(str(page.get("main_text", "")) for page in pages)
    lowered = joined.lower()
    domain = str(
        snapshot.get("domain") or urlparse(str(snapshot.get("input_url", ""))).netloc
    )

    signals = market_signals(joined, lowered, domain)
    return {
        "primary_market": settled_market(signals),
        "market_signals": signals,
        "pricing_visible": bool(PRICE_PATTERN.search(joined)),
        "purchase_path": purchase_path(lowered),
    }


def market_signals(text: str, lowered: str, domain: str) -> dict[str, list[str]]:
    """Each market that showed up, and which kinds of evidence showed it.

    Grouped by kind rather than counted, because a page repeating "SEBI" nine
    times is still one reason to believe anything.
    """
    found: dict[str, set[str]] = {}

    for token, market in CURRENCY_MARKETS.items():
        # A three-letter code needs word edges or "makes 2024" reads as Kenyan
        # shillings. Symbols carry their own edge and have none to find.
        edge = r"\b" if token.isalpha() else ""
        if re.search(rf"{edge}{re.escape(token)}\s?\d", lowered):
            found.setdefault(market, set()).add("currency")

    for acronym, market in AUTHORITY_MARKETS.items():
        if re.search(rf"\b{acronym}\b", text):
            found.setdefault(market, set()).add("authority")

    suffix = domain.lower().rsplit(".", 1)[-1]
    if suffix in TLD_MARKETS:
        found.setdefault(TLD_MARKETS[suffix], set()).add("domain")

    return {market: sorted(kinds) for market, kinds in found.items()}


def settled_market(signals: dict[str, list[str]]) -> str:
    """The one market with enough independent evidence, or Unknown.

    A tie is Unknown on purpose. Two markets with equal support means the site
    serves both, and guessing between them puts every question in the wrong
    country.
    """
    ranked = sorted(
        signals.items(), key=lambda row: (len(row[1]), row[0]), reverse=True
    )
    if not ranked or len(ranked[0][1]) < REQUIRED_MARKET_SIGNALS:
        return "Unknown"
    if len(ranked) > 1 and len(ranked[1][1]) == len(ranked[0][1]):
        return "Unknown"
    return ranked[0][0]


def purchase_path(lowered: str) -> str:
    self_serve = any(phrase in lowered for phrase in SELF_SERVE_PHRASES)
    contact = any(phrase in lowered for phrase in CONTACT_SALES_PHRASES)
    if self_serve and contact:
        return "both"
    if self_serve:
        return "self_serve"
    if contact:
        return "contact_sales"
    return "unknown"
