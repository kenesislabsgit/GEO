from __future__ import annotations

from dataclasses import dataclass
import re
from typing import Any
from urllib.parse import urlparse, urlunparse

from .source_analysis import resolve_source_url


THIRD_PARTY_DOMAINS = (
    "g2.com",
    "capterra.com",
    "trustradius.com",
    "gartner.com",
    "forrester.com",
    "linkedin.com",
    "wikipedia.org",
    "youtube.com",
    "facebook.com",
    "twitter.com",
    "x.com",
    "reddit.com",
    "stackoverflow.com",
    "github.com",
    "medium.com",
    "techcrunch.com",
    "forbes.com",
)

THIRD_PARTY_KEYWORDS = (
    "review",
    "reviews",
    "compare",
    "comparison",
    "alternatives",
    "marketplace",
    "directory",
    "blog",
    "news",
    "press",
    "report",
)

LEGAL_SUFFIXES = (
    "inc",
    "llc",
    "ltd",
    "limited",
    "corp",
    "corporation",
    "company",
    "co",
    "plc",
    "ag",
    "gmbh",
    "sa",
    "bv",
)


@dataclass
class DomainCandidate:
    url: str
    domain: str
    score: int
    evidence: list[str]
    source_urls: list[str]


def discover_competitor_site(
    company_name: str,
    source_urls: list[str],
    *,
    manual_site: str | None = None,
) -> dict[str, Any]:
    if manual_site:
        return {
            "company_name": company_name,
            "official_website": normalize_site_url(manual_site),
            "confidence": "Manual",
            "method": "manual_override",
            "evidence": ["Matched explicit competitor site mapping."],
            "candidate_domains": [],
        }

    candidates = score_domain_candidates(company_name, source_urls)
    if not candidates:
        return empty_discovery(company_name, "No usable source URLs were available.")

    best = candidates[0]
    confidence = confidence_from_score(best.score)
    if confidence == "Low":
        return {
            "company_name": company_name,
            "official_website": None,
            "confidence": "Low",
            "method": "cited_source_domain_scoring",
            "evidence": [
                "Cited URLs existed, but no domain scored strongly enough as an official site."
            ],
            "candidate_domains": serialize_candidates(candidates),
        }

    return {
        "company_name": company_name,
        "official_website": best.url,
        "confidence": confidence,
        "method": "cited_source_domain_scoring",
        "evidence": dedupe(best.evidence),
        "candidate_domains": serialize_candidates(candidates),
    }


def score_domain_candidates(
    company_name: str,
    source_urls: list[str],
) -> list[DomainCandidate]:
    company_tokens = company_name_tokens(company_name)
    candidates: dict[str, DomainCandidate] = {}

    for raw_source_url in source_urls:
        source_url = resolve_source_url(raw_source_url)
        parsed = urlparse(source_url)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            continue

        domain = normalize_domain(parsed.netloc)
        if not domain:
            continue
        if domain == "vertexaisearch.cloud.google.com":
            continue

        root = root_domain(domain)
        score, evidence = score_domain(domain, parsed.path, company_tokens)
        candidate = candidates.get(root)
        if candidate is None:
            candidates[root] = DomainCandidate(
                url=canonical_candidate_url(
                    source_url,
                    company_tokens=company_tokens,
                ),
                domain=root,
                score=score,
                evidence=evidence,
                source_urls=[source_url],
            )
        else:
            candidate.score += score
            candidate.source_urls.append(source_url)
            candidate.evidence.extend(evidence)

    scored = [candidate for candidate in candidates.values() if candidate.score > 0]
    scored.sort(key=lambda item: (-item.score, item.domain))
    return scored


def score_domain(
    domain_value: str,
    path: str,
    company_tokens: set[str],
) -> tuple[int, list[str]]:
    score = 0
    evidence: list[str] = []
    root_domain_value = root_domain(domain_value)
    domain_label = domain_value.rsplit(".", 1)[0].replace(".", "")

    if is_third_party_domain(root_domain_value):
        score -= 25
        evidence.append(f"Penalized known third-party domain {root_domain_value}.")

    if any(keyword in root_domain_value for keyword in THIRD_PARTY_KEYWORDS):
        score -= 8
        evidence.append(f"Penalized directory/review-style domain {root_domain_value}.")

    matched_tokens = [token for token in company_tokens if token in domain_label]
    if matched_tokens:
        score += 30 + (8 * len(matched_tokens))
        evidence.append(
            "Domain contains company token(s): " + ", ".join(sorted(matched_tokens)) + "."
        )

    if clean_company_name(company_tokens) and clean_company_name(company_tokens) in domain_label:
        score += 20
        evidence.append("Domain label closely matches the compact company name.")

    clean_path = path.strip("/").lower()
    if clean_path in {"", "home"}:
        score += 8
        evidence.append("Source points at or near the domain homepage.")
    elif any(segment in clean_path for segment in ("product", "solution", "platform")):
        score += 4
        evidence.append("Source path appears to be a product or solution page.")

    if root_domain_value.endswith((".com", ".ai", ".io", ".co", ".net", ".org")):
        score += 3
        evidence.append("Domain uses a common company website TLD.")

    return score, evidence


def company_name_tokens(company_name: str) -> set[str]:
    cleaned = re.sub(r"[^a-z0-9\s]", " ", company_name.lower())
    raw_tokens = [token for token in cleaned.split() if token]
    return {
        token
        for token in raw_tokens
        if token not in LEGAL_SUFFIXES and len(token) > 1
    }


def clean_company_name(tokens: set[str]) -> str:
    return "".join(sorted(tokens))


def normalize_domain(domain: str) -> str:
    value = domain.lower().strip()
    if value.startswith("www."):
        value = value[4:]
    return value.split(":")[0]


def root_domain(domain: str) -> str:
    parts = domain.split(".")
    if len(parts) <= 2:
        return domain
    if len(parts[-2]) <= 3 and parts[-1] in {"uk", "au", "in", "br", "jp"}:
        return ".".join(parts[-3:])
    return ".".join(parts[-2:])


def is_third_party_domain(domain: str) -> bool:
    return any(domain == item or domain.endswith(f".{item}") for item in THIRD_PARTY_DOMAINS)


def confidence_from_score(score: int) -> str:
    if score >= 40:
        return "High"
    if score >= 25:
        return "Medium"
    return "Low"


def serialize_candidates(candidates: list[DomainCandidate]) -> list[dict[str, Any]]:
    return [
        {
            "domain": candidate.domain,
            "candidate_url": candidate.url,
            "score": candidate.score,
            "source_urls": candidate.source_urls[:5],
            "evidence": dedupe(candidate.evidence)[:8],
        }
        for candidate in candidates[:10]
    ]


def normalize_site_url(url: str) -> str:
    parsed = urlparse(url if "://" in url else f"https://{url}")
    if parsed.netloc:
        domain = normalize_domain(parsed.netloc)
        path = parsed.path or "/"
        return urlunparse(("https", domain, path, "", parsed.query, "")).rstrip("/")

    domain = normalize_domain(parsed.path)
    return f"https://{domain}/"


def canonical_candidate_url(
    url: str,
    *,
    company_tokens: set[str] | None = None,
) -> str:
    parsed = urlparse(url if "://" in url else f"https://{url}")
    domain = normalize_domain(parsed.netloc or parsed.path)
    root = root_domain(domain)
    subdomain = domain[: -(len(root) + 1)] if domain != root else ""
    if subdomain and not any(
        token in subdomain.replace(".", "")
        for token in (company_tokens or set())
    ):
        return f"https://{root}"
    path = parsed.path or "/"
    return urlunparse(("https", domain, path, "", parsed.query, "")).rstrip("/")


def empty_discovery(company_name: str, reason: str) -> dict[str, Any]:
    return {
        "company_name": company_name,
        "official_website": None,
        "confidence": "Low",
        "method": "cited_source_domain_scoring",
        "evidence": [reason],
        "candidate_domains": [],
    }


def dedupe(values: list[str]) -> list[str]:
    return list(dict.fromkeys(values))
