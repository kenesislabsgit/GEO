from __future__ import annotations

import json
import time
import os
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import Mock, patch

from geo_audit.export import (
    build_action_rows,
    build_competitor_report_rows,
    build_query_results,
)
from geo_audit.audit_recommendations import (
    build_audit_recommendations_payload,
    build_free_preview_recommendations,
    build_verified_evidence_catalog,
    readable_evidence_row,
    ensure_top_competitor_finding,
    resolve_recommendation_evidence,
    verify_selected_evidence_with_firecrawl,
)
from geo_audit.competitor_evidence import enhance_competitor_snapshot
from geo_audit.cli import (
    assess_crawl_quality,
    collect_user_website_snapshot,
    merge_user_snapshots,
    website_crawl_failure_message,
)
from geo_audit.crawler import ensure_url, normalize_url
from geo_audit.firecrawl import (
    FirecrawlClient,
    FirecrawlError,
    enrich_user_snapshot,
    firecrawl_document_to_page,
    is_terminal_site_error,
    markdown_body_text,
    scrape_pages,
    should_enrich_user_snapshot,
)
from geo_audit.evidence import build_website_evidence
from geo_audit.aggregation import aggregate_recommendations
from geo_audit.intents import (
    build_customer_intent_review_payload,
    build_customer_intent_payload,
    build_required_search_frame,
    generate_free_customer_intents,
    normalize_buyer_band,
    sanitize_prompt_records,
)
from geo_audit.profile import (
    BOILERPLATE_TEXT_BUDGET,
    HOME_TEXT_BUDGET,
    PAGE_TEXT_BUDGET,
    build_company_profile_payload,
    build_profile_system_prompt,
    compact_snapshot_for_llm,
    normalize_company_profile,
    normalize_buying_signals,
    normalize_named_customers,
    profile_text_budget,
)
from geo_audit.quality import build_quality_summary
from geo_audit.site_facts import detect_site_facts
from geo_audit.recommendations import (
    collect_multi_model_recommendations,
    normalize_recommendations,
    verify_provider_citations,
)
from geo_audit.site_discovery import discover_competitor_site
from geo_audit.agentcore_search import (
    AgentCoreWebSearchClient,
    parse_mcp_response,
    parse_web_search_content,
)
from geo_audit.web_presence import (
    build_bounded_search_queries,
    build_search_queries,
    collect_web_presence,
)
from geo_audit.web_search import FallbackWebSearchClient


# Question generation now derives the buyer band before it writes anything, so
# every mocked run answers three calls: band, draft, review.
BAND_RESPONSE = json.dumps(
    {
        "band_summary": "Operations leaders at mid-sized plants",
        "organization_sizes": ["50-500 staff"],
        "sectors_served": ["Manufacturing"],
        "sectors_open_to_it": ["Manufacturing"],
        "geography": "India",
        "decision_makers": ["Plant safety head"],
        "band_confidence": "Medium",
        "band_evidence": ["site names factory customers"],
        "buyer_situations": [
            {
                "situation_id": "safety-head",
                "role": "Safety head",
                "organization": "Mid-sized factory",
                "trigger": "Repeat PPE incidents",
                "constraint": "Cannot replace existing cameras",
                "words_they_use": ["PPE compliance"],
            }
        ],
    }
)


PROFILE = {
    "company_name": "Kenesis",
    "category": "AI Video Analytics for Industrial Safety",
    "target_audience": "Manufacturing safety teams",
    "industries": ["Manufacturing"],
    "keywords": ["CCTV analytics", "PPE compliance"],
    "use_cases": ["Real-time detection of PPE violations on factory floors"],
    "evidence": {"supporting_pages": ["https://kenesis.ai/"]},
}


def ai_question_response(prompts: list[str]) -> str:
    return json.dumps(
        [
            {
                "category": "Discovery",
                "buying_stage": "Discovery",
                "persona_id": "buyer",
                "intent": "find suitable providers",
                "profile_evidence": [],
                "prompt": prompt,
            }
            for prompt in prompts
        ]
    )


class PipelineChangeTests(unittest.TestCase):
    def test_website_url_rejects_invalid_hostname(self) -> None:
        with self.assertRaisesRegex(ValueError, "valid public hostname"):
            ensure_url("bad domain.example")

    def test_crawl_quality_distinguishes_good_and_failed_snapshots(self) -> None:
        good = assess_crawl_quality(
            {
                "pages": [
                    {
                        "url": "https://example.com/",
                        "status_code": 200,
                        "main_text": "A" * 1000,
                        "fetch_provider": "firecrawl",
                    },
                    {
                        "url": "https://example.com/services",
                        "status_code": 200,
                        "main_text": "B" * 1000,
                        "fetch_provider": "firecrawl",
                    },
                ]
            }
        )
        failed = assess_crawl_quality({"pages": []})

        self.assertEqual(good["status"], "good")
        self.assertEqual(good["providers"], ["firecrawl"])
        self.assertEqual(failed["status"], "failed")

    def test_snapshot_merge_keeps_best_text_and_missing_metadata(self) -> None:
        merged = merge_user_snapshots(
            {
                "pages": [
                    {
                        "url": "https://example.com/services",
                        "main_text": "short",
                        "title": "Services",
                        "fetch_provider": "firecrawl",
                    }
                ]
            },
            {
                "pages": [
                    {
                        "url": "https://www.example.com/services/",
                        "main_text": "longer standard content",
                        "schema_json_ld": [{"@type": "Service"}],
                    }
                ],
                "failed_pages": [],
            },
            max_pages=5,
        )

        self.assertEqual(len(merged["pages"]), 1)
        self.assertEqual(merged["pages"][0]["main_text"], "longer standard content")
        self.assertEqual(merged["pages"][0]["title"], "Services")
        self.assertEqual(
            merged["pages"][0]["schema_json_ld"],
            [{"@type": "Service"}],
        )

    def test_firecrawl_dns_error_stops_redundant_scrape_attempt(self) -> None:
        client = Mock()
        client.can_request.return_value = True
        client.map_site.side_effect = FirecrawlError(
            "DNS resolution failed for hostname example.invalid"
        )

        snapshot, result = enrich_user_snapshot(
            client,
            "https://example.invalid",
            {"pages": []},
            max_pages=4,
        )

        self.assertEqual(snapshot["pages"], [])
        self.assertEqual(len(result["errors"]), 1)
        client.scrape.assert_not_called()
        self.assertTrue(is_terminal_site_error(result["errors"][0]["error"]))

    def test_crawl_failure_message_surfaces_firecrawl_dns_error(self) -> None:
        message = website_crawl_failure_message(
            "wedigi.com",
            {
                "errors": [
                    {
                        "operation": "scrape",
                        "error": "DNS resolution failed for hostname wedigi.com",
                    }
                ]
            },
            firecrawl_configured=True,
        )
        self.assertIn("DNS resolution failed", message)
        self.assertNotIn("FIRECRAWL_API_KEY", message)

    def test_user_crawl_uses_firecrawl_first_without_standard_fallback(self) -> None:
        client = Mock()
        client.can_request.return_value = True
        client.map_site.return_value = [
            {"url": "https://example.com/services", "title": "Services"},
            {"url": "https://example.com/about", "title": "About"},
        ]

        def scrape(url: str) -> dict[str, object]:
            return {
                "markdown": f"# Page\n{('Useful buyer and service context. ' * 80)}",
                "metadata": {"sourceURL": url, "title": "Page"},
                "links": [],
            }

        client.scrape.side_effect = scrape
        with patch("geo_audit.cli.crawl_website") as standard_crawl:
            snapshot, result = collect_user_website_snapshot(
                "example.com",
                max_pages=6,
                firecrawl_client=client,
            )

        standard_crawl.assert_not_called()
        self.assertFalse(result["standard_fallback_used"])
        self.assertEqual(len(snapshot["pages"]), 3)
        self.assertTrue(
            all(page["fetch_provider"] == "firecrawl" for page in snapshot["pages"])
        )

    def test_user_crawl_falls_back_when_firecrawl_fails(self) -> None:
        client = Mock()
        client.can_request.return_value = True
        client.map_site.return_value = []
        client.scrape.side_effect = FirecrawlError("blocked")
        standard_snapshot = {
            "input_url": "example.com",
            "normalized_url": "https://example.com",
            "domain": "example.com",
            "allowed_domains": ["example.com", "www.example.com"],
            "generated_at": "now",
            "max_pages": 6,
            "pages": [
                {
                    "url": "https://example.com",
                    "main_text": "Standard crawler content",
                    "fetch_provider": "deterministic_crawler",
                }
            ],
            "failed_pages": [],
        }
        with patch(
            "geo_audit.cli.crawl_website",
            return_value=standard_snapshot,
        ) as standard_crawl:
            snapshot, result = collect_user_website_snapshot(
                "example.com",
                max_pages=6,
                firecrawl_client=client,
            )

        standard_crawl.assert_called_once()
        self.assertTrue(result["standard_fallback_used"])
        self.assertEqual(snapshot["pages"][0]["fetch_provider"], "deterministic_crawler")

    def test_weak_user_snapshot_is_enriched_with_firecrawl(self) -> None:
        snapshot = {
            "normalized_url": "https://example.com",
            "pages": [
                {
                    "url": "https://example.com",
                    "main_text": "Short page",
                }
            ],
        }
        client = Mock()
        client.can_request.return_value = True
        client.map_site.return_value = [
            {
                "url": "https://example.com/services",
                "title": "Services",
            }
        ]
        client.scrape.side_effect = [
            {
                "markdown": "# Example\n" + ("Buyer-focused homepage content. " * 80),
                "metadata": {
                    "sourceURL": "https://example.com",
                    "title": "Example",
                },
                "links": [],
            },
            {
                "markdown": "# Services\n" + ("Website development services. " * 80),
                "metadata": {
                    "sourceURL": "https://example.com/services",
                    "title": "Services",
                },
                "links": [],
            },
        ]

        self.assertTrue(should_enrich_user_snapshot(snapshot))
        enriched, result = enrich_user_snapshot(
            client,
            "https://example.com",
            snapshot,
            max_pages=2,
        )

        self.assertEqual(result["pages_replaced"], 1)
        self.assertEqual(result["pages_added"], 1)
        self.assertEqual(len(enriched["pages"]), 2)
        self.assertTrue(
            all(page["fetch_provider"] == "firecrawl" for page in enriched["pages"])
        )

    def test_strong_user_snapshot_does_not_require_firecrawl(self) -> None:
        snapshot = {
            "pages": [
                {
                    "url": "https://example.com",
                    "main_text": "Homepage content " * 100,
                },
                {
                    "url": "https://example.com/services",
                    "main_text": "Service content " * 100,
                },
            ]
        }
        self.assertFalse(should_enrich_user_snapshot(snapshot))

    def test_profile_removes_unverifiable_persona_references(self) -> None:
        profile = normalize_company_profile(
            {
                "company_name": "Example",
                "category": "Digital agency",
                "target_audience": "Small businesses",
                "buyer_personas": [
                    {
                        "persona_id": "owner",
                        "buyer_role": "Small business owner",
                        "organization_type": "Small businesses",
                        "evidence_refs": ["invented-page"],
                    }
                ],
            },
            {"pages": [{"url": "https://example.com"}]},
        )
        self.assertEqual(profile["buyer_personas"], [])
        self.assertEqual(profile["target_audience"], "Unknown")

    def test_profile_keeps_only_claims_supported_by_exact_page_quotes(self) -> None:
        snapshot = {
            "pages": [
                {
                    "url": "https://example.com",
                    "title": "Industrial safety analytics",
                    "main_text": (
                        "We serve industrial manufacturers worldwide. "
                        "Safety managers use our video analytics to detect PPE "
                        "violations in real time. Contact our team for a demo."
                    ),
                },
                {
                    "url": "https://example.com/contact",
                    "main_text": "Our office is located in Chennai, India.",
                },
            ]
        }
        profile = normalize_company_profile(
            {
                "company_name": "Example",
                "category": "Industrial safety analytics",
                "target_audience": "Industrial manufacturers",
                "business_type": "B2B software",
                "delivery_model": "Software platform",
                "company_locations": ["Chennai, India"],
                "regions_served": ["India", "Worldwide"],
                "features": ["Real-time PPE violation detection"],
                "use_cases": ["Detect PPE violations in real time"],
                "problems_solved": ["Workplace PPE violations"],
                "primary_offerings": ["Industrial safety video analytics"],
                "pricing_model": "Custom pricing",
                "buyer_personas": [
                    {
                        "persona_id": "safety-manager",
                        "buyer_role": "Safety managers",
                        "organization_type": "Industrial manufacturers",
                        "organization_sizes": ["Medium", "Large"],
                        "regions": ["India", "Worldwide"],
                        "jobs_to_be_done": [
                            "Detect PPE violations in real time"
                        ],
                        "buying_triggers": ["New compliance mandate"],
                        "decision_factors": ["Low implementation cost"],
                        "constraints": ["Limited budget"],
                        "claim_evidence": [
                            {
                                "field": "buyer_role",
                                "value": "Safety managers",
                                "page_id": "page-001",
                                "quote": "Safety managers use our video analytics",
                            },
                            {
                                "field": "organization_type",
                                "value": "Industrial manufacturers",
                                "page_id": "page-001",
                                "quote": "We serve industrial manufacturers worldwide",
                            },
                            {
                                "field": "jobs_to_be_done",
                                "value": "Detect PPE violations in real time",
                                "page_id": "page-001",
                                "quote": "detect PPE violations in real time",
                            },
                            {
                                "field": "regions",
                                "value": "Worldwide",
                                "page_id": "page-001",
                                "quote": "We serve industrial manufacturers worldwide",
                            },
                            {
                                "field": "regions",
                                "value": "India",
                                "page_id": "page-002",
                                "quote": "Our office is located in Chennai, India",
                            },
                        ],
                    }
                ],
                "purchase_context": {
                    "pricing_signals": ["Likely quote based"],
                    "common_objections": ["Implementation cost"],
                },
                "evidence": {
                    "field_evidence": [
                        {
                            "field": "regions_served",
                            "value": "Worldwide",
                            "page_id": "page-001",
                            "quote": "We serve industrial manufacturers worldwide",
                        },
                        {
                            "field": "regions_served",
                            "value": "India",
                            "page_id": "page-002",
                            "quote": "Our office is located in Chennai, India",
                        },
                        {
                            "field": "pricing_model",
                            "value": "Custom pricing",
                            "page_id": "page-001",
                            "quote": "Contact our team for a demo",
                        },
                    ]
                },
            },
            snapshot,
        )

        self.assertEqual(profile["regions_served"], ["Worldwide"])
        self.assertEqual(profile["pricing_model"], "Unknown")
        self.assertEqual(profile["buyer_personas"][0]["regions"], ["Worldwide"])
        self.assertEqual(
            profile["buyer_personas"][0]["organization_sizes"],
            [],
        )
        self.assertEqual(profile["buyer_personas"][0]["buying_triggers"], [])
        self.assertEqual(profile["buyer_personas"][0]["constraints"], [])
        self.assertEqual(profile["purchase_context"]["pricing_signals"], [])

    def test_trimmed_profile_prompt_drops_fields_nothing_reads(self) -> None:
        for lean in (False, True):
            prompt = build_profile_system_prompt(lean=lean)
            for field in (
                "keywords",
                "core_messaging",
                "customer_segments",
                "company_locations",
                "pricing_model",
            ):
                self.assertNotIn(f'"{field}"', prompt, f"{field} lean={lean}")
            for field in (
                "category",
                "regions_served",
                "industries",
                "primary_offerings",
                "problems_solved",
                "use_cases",
                "buyer_personas",
                "purchase_context",
                "competitor_scope",
            ):
                self.assertIn(f'"{field}"', prompt, f"{field} lean={lean}")

    def test_trimmed_profile_prompt_keeps_quotes_confidence_depends_on(self) -> None:
        # confidence_from_claims() needs an identity claim and a jobs_to_be_done
        # claim to rate a persona above Low, and reliable_buyer_personas() blanks
        # most fields of a Low persona. Dropping these quotes would empty the
        # persona the questions are built from.
        prompt = build_profile_system_prompt(lean=True)
        claim_fields = prompt.split('"field": "')[1].split('"')[0]
        for field in (
            "buyer_role",
            "organization_type",
            "jobs_to_be_done",
            "organization_sizes",
            "buying_triggers",
            "decision_factors",
            "constraints",
        ):
            self.assertIn(field, claim_fields)

    def test_lean_profile_asks_for_one_persona(self) -> None:
        lean = build_profile_system_prompt(lean=True)
        paid = build_profile_system_prompt(lean=False)
        self.assertIn("single most important buyer persona", lean)
        self.assertIn("at most 3 buyer personas", paid)
        payload = build_company_profile_payload({"pages": []}, {}, lean=True)
        self.assertEqual(payload["messages"][0]["content"], lean)

    def test_profile_without_trimmed_fields_still_normalizes(self) -> None:
        # The model no longer returns the dropped fields. Normalization must
        # degrade to empty values instead of raising.
        snapshot = {
            "pages": [
                {
                    "url": "https://example.com",
                    "title": "Industrial safety analytics",
                    "main_text": (
                        "We serve industrial manufacturers worldwide. "
                        "Safety managers use our video analytics to detect PPE "
                        "violations in real time."
                    ),
                }
            ]
        }
        profile = normalize_company_profile(
            {
                "company_name": "Example",
                "category": "Industrial safety analytics",
                "target_audience": "Industrial manufacturers",
                "business_type": "B2B software",
                "delivery_model": "Software platform",
                "primary_offerings": ["Industrial safety video analytics"],
                "problems_solved": ["Workplace PPE violations"],
                "buyer_personas": [
                    {
                        "persona_id": "safety-manager",
                        "buyer_role": "Safety managers",
                        "organization_type": "Industrial manufacturers",
                        "jobs_to_be_done": [
                            "Detect PPE violations in real time"
                        ],
                        "claim_evidence": [
                            {
                                "field": "buyer_role",
                                "value": "Safety managers",
                                "page_id": "page-001",
                                "quote": "Safety managers use our video analytics",
                            },
                            {
                                "field": "organization_type",
                                "value": "Industrial manufacturers",
                                "page_id": "page-001",
                                "quote": "We serve industrial manufacturers worldwide",
                            },
                            {
                                "field": "jobs_to_be_done",
                                "value": "Detect PPE violations in real time",
                                "page_id": "page-001",
                                "quote": "detect PPE violations in real time",
                            },
                        ],
                    }
                ],
            },
            snapshot,
        )

        self.assertEqual(profile["company_locations"], [])
        self.assertEqual(profile["pricing_model"], "Unknown")
        self.assertEqual(profile["keywords"], [])
        # primary_offerings no longer falls back to features, so it must survive
        # on its own.
        self.assertEqual(
            profile["primary_offerings"], ["Industrial safety video analytics"]
        )
        persona = profile["buyer_personas"][0]
        self.assertEqual(persona["buyer_role"], "Safety managers")
        self.assertNotEqual(persona["confidence"], "Low")

    def test_named_customers_are_kept_whole_instead_of_being_labelled(self) -> None:
        # A tier word had to pick a winner among these five and answered
        # "enterprise", losing the two colleges and the two small firms that
        # are most of the list. Names carry the spread; a label cannot.
        page_texts = {
            "page-001": "trusted by leading companies aura mental health "
                        "brakes india rajalakshmi engineering college "
                        "rent machi thiagarajar engineering college"
        }
        rows = normalize_named_customers(
            [
                {"name": "Aura Mental Health", "page_id": "page-001"},
                {"name": "Brakes India", "described_as": "auto components",
                 "page_id": "page-001"},
                {"name": "Rajalakshmi Engineering College", "page_id": "page-001"},
                {"name": "Rent Machi", "page_id": "page-001"},
                {"name": "Thiagarajar Engineering College", "page_id": "page-001"},
            ],
            page_texts,
        )
        self.assertEqual(len(rows), 5)
        self.assertEqual(rows[1]["described_as"], "auto components")

    def test_a_customer_not_on_its_page_is_dropped(self) -> None:
        # "e.g. Tata Steel" was a contact form placeholder on a live site and
        # became a client. The name must be on the page it is credited to.
        rows = normalize_named_customers(
            [
                {"name": "Tata Steel", "page_id": "page-002"},
                {"name": "Brakes India", "page_id": "page-001"},
            ],
            {"page-001": "trusted by brakes india", "page-002": "get in touch"},
        )
        self.assertEqual([row["name"] for row in rows], ["Brakes India"])

    def test_a_summary_sentence_is_not_a_customer_name(self) -> None:
        rows = normalize_named_customers(
            [
                {
                    "name": "educational institutions and large manufacturing "
                            "companies across south india",
                    "page_id": "page-001",
                }
            ],
            {"page-001": "educational institutions and large manufacturing "
                         "companies across south india"},
        )
        self.assertEqual(rows, [])

    def test_the_same_customer_listed_twice_appears_once(self) -> None:
        rows = normalize_named_customers(
            [
                {"name": "Brakes India", "page_id": "page-001"},
                {"name": "brakes india", "page_id": "page-001"},
            ],
            {"page-001": "trusted by brakes india"},
        )
        self.assertEqual(len(rows), 1)

    def test_market_needs_two_kinds_of_evidence_before_it_counts(self) -> None:
        # A regulator beside prices in rupees is a market. Either one alone is
        # a coincidence, and guessing puts every question in the wrong country.
        facts = detect_site_facts(
            {
                "domain": "example.com",
                "pages": [
                    {"main_text": "Brokerage at ₹20 per order. Member of NSE "
                                  "and BSE, regulated by SEBI."}
                ],
            }
        )
        self.assertEqual(facts["primary_market"], "India")
        self.assertEqual(facts["market_signals"]["India"], ["authority", "currency"])

        thin = detect_site_facts(
            {"domain": "example.com", "pages": [{"main_text": "Pay ₹499 monthly."}]}
        )
        self.assertEqual(thin["primary_market"], "Unknown")

    def test_two_markets_with_equal_support_settle_on_unknown(self) -> None:
        facts = detect_site_facts(
            {
                "domain": "example.in",
                "pages": [
                    {"main_text": "Plans from ₹499. Also ¥1000 in Japan, "
                                  "listed on JPX."}
                ],
            }
        )
        self.assertEqual(facts["primary_market"], "Unknown")

    def test_a_currency_code_needs_word_edges(self) -> None:
        # "makes 2024" is not a price in Kenyan shillings.
        facts = detect_site_facts(
            {"domain": "example.com", "pages": [{"main_text": "It makes 2024 easy"}]}
        )
        self.assertEqual(facts["market_signals"], {})
        self.assertFalse(facts["pricing_visible"])

    def test_get_started_alone_is_not_a_self_serve_signup(self) -> None:
        # An agency contact form says "Get Started" too, and that one phrase
        # labelled a services firm self-serve on a live run.
        agency = detect_site_facts(
            {"domain": "a.test", "pages": [{"main_text": "Get Started with us"}]}
        )
        self.assertEqual(agency["purchase_path"], "unknown")

        product = detect_site_facts(
            {
                "domain": "b.test",
                "pages": [{"main_text": "Sign up free, or contact sales for volume"}],
            }
        )
        self.assertEqual(product["purchase_path"], "both")

    def test_code_overrules_the_model_on_prices_and_purchase_path(self) -> None:
        signals = normalize_buying_signals(
            {"pricing_visible": False, "purchase_path": "contact_sales"},
            {"pricing_visible": True, "purchase_path": "self_serve"},
        )
        self.assertTrue(signals["pricing_visible"])
        self.assertEqual(signals["purchase_path"], "self_serve")

    def test_buying_signals_keep_only_a_known_purchase_path(self) -> None:
        signals = normalize_buying_signals(
            {
                "pricing_visible": True,
                "purchase_path": "Self_Serve",
                "buyer_facing_terms": ["founders", "IT teams"],
                "company_self_description": ["premium global partner"],
            }
        )
        self.assertEqual(signals["purchase_path"], "self_serve")
        self.assertTrue(signals["pricing_visible"])
        self.assertEqual(signals["buyer_facing_terms"], ["founders", "IT teams"])

        invented = normalize_buying_signals({"purchase_path": "marketplace"})
        self.assertEqual(invented["purchase_path"], "unknown")
        self.assertFalse(invented["pricing_visible"])

    def test_boilerplate_pages_get_a_small_share_of_the_profile_prompt(self) -> None:
        # Page size says nothing about how much a page says about the company.
        # A privacy policy was the largest page we sent for one live site.
        self.assertEqual(profile_text_budget("https://a.test/"), HOME_TEXT_BUDGET)
        for url in (
            "https://a.test/privacy-policy",
            "https://a.test/terms-of-service",
            "https://a.test/cookies",
            "https://a.test/careers",
            "https://a.test/th/legal/ssa/gi",
        ):
            self.assertEqual(profile_text_budget(url), BOILERPLATE_TEXT_BUDGET, url)

    def test_a_company_selling_legal_or_cookie_products_keeps_its_pages(self) -> None:
        # The words that mark boilerplate are products for somebody, so a
        # segment only counts when every word in it is boilerplate or filler.
        for url in (
            "https://a.test/legal-tech-solutions",
            "https://a.test/products/cookie-manager",
            "https://a.test/solutions/privacy-engineering",
            "https://a.test/legal-services",
            "https://a.test/services",
        ):
            self.assertEqual(profile_text_budget(url), PAGE_TEXT_BUDGET, url)

    def test_compact_snapshot_trims_boilerplate_before_the_model_sees_it(self) -> None:
        compact = compact_snapshot_for_llm(
            {
                "pages": [
                    {"url": "https://a.test/privacy-policy", "main_text": "x" * 9000},
                    {"url": "https://a.test/portfolio", "main_text": "y" * 9000},
                    {"url": "https://a.test/", "main_text": "z" * 9999},
                ]
            }
        )
        lengths = [len(page["main_text"]) for page in compact["pages"]]
        self.assertEqual(
            lengths, [BOILERPLATE_TEXT_BUDGET, PAGE_TEXT_BUDGET, HOME_TEXT_BUDGET]
        )

    def test_parallel_scrapes_come_back_in_the_order_they_were_asked(self) -> None:
        # Page ids are positions in this list, so completion order deciding it
        # would move the cited evidence under every quote in the report.
        client = FirecrawlClient("key", max_requests=10, max_reported_credits=10)
        delays = {"https://a.test/1": 0.03, "https://a.test/2": 0.0}

        def fake_scrape(url):
            time.sleep(delays[url])
            return {"markdown": f"# page for {url}", "metadata": {"sourceURL": url}}

        with patch.object(FirecrawlClient, "scrape", side_effect=fake_scrape):
            rows = scrape_pages(client, ["https://a.test/1", "https://a.test/2"])
        self.assertEqual([url for url, _page, _error in rows],
                         ["https://a.test/1", "https://a.test/2"])
        self.assertIn("page for https://a.test/1", rows[0][1]["main_text"])

    def test_a_parallel_batch_reserves_the_firecrawl_budget_up_front(self) -> None:
        # Every worker reading can_request() before any has spent it would let
        # a batch of six through a budget of two.
        client = FirecrawlClient("key", max_requests=2, max_reported_credits=99)
        with patch.object(
            FirecrawlClient,
            "scrape",
            side_effect=lambda url: {"markdown": "# x", "metadata": {"sourceURL": url}},
        ):
            rows = scrape_pages(client, [f"https://a.test/{n}" for n in range(6)])
        self.assertEqual(len(rows), 2)

    def test_a_failed_scrape_does_not_take_down_its_batch(self) -> None:
        client = FirecrawlClient("key", max_requests=10, max_reported_credits=10)

        def fake_scrape(url):
            if url.endswith("2"):
                raise FirecrawlError("404")
            return {"markdown": "# ok", "metadata": {"sourceURL": url}}

        with patch.object(FirecrawlClient, "scrape", side_effect=fake_scrape):
            rows = scrape_pages(
                client, ["https://a.test/1", "https://a.test/2", "https://a.test/3"]
            )
        self.assertIsNone(rows[1][1])
        self.assertEqual(rows[1][2], "404")
        self.assertIsNotNone(rows[0][1])
        self.assertIsNotNone(rows[2][1])

    def test_firecrawl_markdown_keeps_the_shape_of_the_page(self) -> None:
        # We pay Firecrawl for structure and used to flatten it away. A model
        # reading one run-on line cannot tell a client list from a contact
        # form, and it read "e.g. Tata Steel" out of a form as a customer.
        page = firecrawl_document_to_page(
            {
                "markdown": "## Trusted by leading companies\n\n"
                            "- [Brakes India](https://brakesindia.example)\n"
                            "- Rajalakshmi Engineering College\n\n\n\n"
                            "We\\'ll scale with you.\\\n"
                            "![logo](https://x.example/l.png)Acme",
                "metadata": {"sourceURL": "https://x.example/", "title": "X"},
            },
            "https://x.example/",
        )
        self.assertEqual(
            page["main_text"],
            "## Trusted by leading companies\n\n"
            "- Brakes India\n"
            "- Rajalakshmi Engineering College\n\n"
            "We'll scale with you.\n"
            "logoAcme",
        )

    def test_markdown_body_text_drops_runs_of_blank_lines(self) -> None:
        self.assertEqual(markdown_body_text("a\n\n\n\n\nb"), "a\n\nb")

    def test_the_search_frame_carries_customer_names_not_a_tier(self) -> None:
        frame = build_required_search_frame(
            {
                "category": "Software development agency",
                "regions_served": ["India"],
                "named_customers": [
                    {"name": "Brakes India", "described_as": "auto components"},
                    {"name": "Rent Machi", "described_as": ""},
                ],
                "buyer_personas": [],
            }
        )
        self.assertEqual(frame["regions"], ["India"])
        self.assertEqual(
            [row["name"] for row in frame["named_customers"]],
            ["Brakes India", "Rent Machi"],
        )

    def test_buyer_band_keeps_only_situations_with_a_buyer_in_them(self) -> None:
        band = normalize_buyer_band(
            {
                "band_summary": "Small firms and colleges in Tamil Nadu",
                "organization_sizes": ["10-50 staff", "500-2000 students"],
                "sectors_served": ["Education", "Manufacturing"],
                "geography": "India",
                "band_confidence": "medium",
                "buyer_situations": [
                    {
                        "situation_id": "registrar",
                        "role": "Registrar",
                        "organization": "Private engineering college",
                        "trigger": "Admissions portal keeps failing",
                        "constraint": "Fixed annual budget",
                        "words_they_use": ["student portal"],
                    },
                    {"trigger": "no role and no organization here"},
                ],
            },
            6,
        )
        self.assertEqual(len(band["buyer_situations"]), 1)
        self.assertEqual(band["buyer_situations"][0]["role"], "Registrar")
        self.assertEqual(band["band_confidence"], "Medium")

    def test_buyer_band_falls_back_to_low_confidence_on_junk(self) -> None:
        band = normalize_buyer_band({"band_confidence": "certain"}, 6)
        self.assertEqual(band["band_confidence"], "Low")
        self.assertEqual(band["buyer_situations"], [])
        self.assertEqual(band["geography"], "Unknown")

    def test_the_sellers_word_partner_is_corrected_out_of_the_provider_name(
        self,
    ) -> None:
        # Every question is built on this phrase, so one seller word here
        # reaches all of them. Nobody searching says they want a partner.
        band = normalize_buyer_band(
            {"buyer_words_for_provider": "custom software development partner"}, 6
        )
        self.assertEqual(
            band["buyer_words_for_provider"], "custom software development company"
        )

    def test_words_buyers_really_use_are_left_alone(self) -> None:
        # A wider list was tried and deleted all of these, which are exactly
        # how people search.
        for phrase in (
            "payment platform",
            "cloud provider",
            "SEO specialist",
            "web development agency",
            "stock broker",
        ):
            band = normalize_buyer_band({"buyer_words_for_provider": phrase}, 6)
            self.assertEqual(band["buyer_words_for_provider"], phrase)

    def test_a_generalist_may_not_call_its_own_history_its_market(self) -> None:
        # Told in prose to look past its finished projects, the model wrote
        # "generalist" and answered with the same five sectors anyway, so five
        # customers became five questions and measured the wrong market.
        band = normalize_buyer_band(
            {
                "sector_focus": "generalist",
                "sectors_served": ["Education", "Media"],
                "sectors_open_to_it": ["Education", "Logistics", "Dental"],
            },
            6,
        )
        self.assertEqual(band["sectors_served"], ["Education", "Media"])
        self.assertEqual(band["sectors_open_to_it"], ["Logistics", "Dental"])

    def test_a_specialist_keeps_its_sector_as_its_market(self) -> None:
        band = normalize_buyer_band(
            {
                "sector_focus": "specialist",
                "sectors_served": ["Manufacturing"],
                "sectors_open_to_it": ["Manufacturing"],
            },
            6,
        )
        self.assertEqual(band["sectors_open_to_it"], ["Manufacturing"])

    def test_a_generalist_echoing_its_history_is_left_with_no_market(self) -> None:
        # Falling back to the served list would restore exactly the behaviour
        # this split exists to stop, so it keeps whatever survived instead.
        band = normalize_buyer_band(
            {
                "sector_focus": "generalist",
                "sectors_served": ["Education"],
                "sectors_open_to_it": ["Education"],
            },
            6,
        )
        self.assertEqual(band["sectors_open_to_it"], ["Education"])

    def test_sector_focus_falls_back_to_specialist(self) -> None:
        # Guessing generalist would invent a market the site cannot show.
        self.assertEqual(
            normalize_buyer_band({"sector_focus": "both"}, 6)["sector_focus"],
            "specialist",
        )
        self.assertEqual(
            normalize_buyer_band({"sector_focus": "Generalist"}, 6)["sector_focus"],
            "generalist",
        )

    def test_a_hedged_paragraph_is_not_a_geography(self) -> None:
        # Asked where the buyers are, the model wrote "Not explicitly stated;
        # likely global or multi-region given the premium global partner
        # claim". A sentence anchors nothing, so it is no answer at all.
        band = normalize_buyer_band(
            {
                "geography": "Not explicitly stated; likely global or "
                             "multi-region given no named regions",
                "buyer_words_for_provider": "web development agency",
            },
            6,
        )
        self.assertEqual(band["geography"], "Unknown")
        self.assertEqual(band["buyer_words_for_provider"], "web development agency")
        self.assertEqual(normalize_buyer_band({"geography": "India"}, 6)["geography"],
                         "India")

    def test_a_question_may_not_borrow_the_companys_marketing_words(self) -> None:
        # No buyer types "premium global technology partner" into a search box.
        profile = {
            "company_name": "WeDigi",
            "buying_signals": {
                "company_self_description": ["premium global technology partner"]
            },
            "evidence": {"supporting_pages": []},
        }
        kept = sanitize_prompt_records(
            [
                {"prompt": "looking for a premium global technology partner"},
                {"prompt": "who can rebuild our college admissions portal"},
            ],
            profile,
        )
        self.assertEqual(
            [row["prompt"] for row in kept],
            ["who can rebuild our college admissions portal?"],
        )

    def test_a_question_may_not_name_one_of_the_customers(self) -> None:
        # A question built around a named client is written for that client.
        # Nobody searching today has heard of them.
        profile = {
            "company_name": "WeDigi",
            "named_customers": [{"name": "Brakes India", "described_as": ""}],
            "evidence": {"supporting_pages": []},
        }
        kept = sanitize_prompt_records(
            [
                {"prompt": "web development partner for Brakes India"},
                {"prompt": "web development partner for an auto parts maker"},
            ],
            profile,
        )
        self.assertEqual(
            [row["prompt"] for row in kept],
            ["web development partner for an auto parts maker?"],
        )

    def test_service_company_questions_use_buyer_context_naturally(self) -> None:
        profile = {
            "company_name": "WeDigi",
            "category": "Website development and digital marketing",
            "target_audience": "startups and small businesses",
            "business_type": "Service company",
            "delivery_model": "Boutique digital agency",
            "primary_offerings": [
                "website development",
                "digital marketing",
            ],
            "buyer_personas": [
                {
                    "persona_id": "owner",
                    "buyer_role": "small business owner",
                    "organization_type": "small businesses",
                    "industries": [],
                    "regions": ["India"],
                    "jobs_to_be_done": [
                        "replace an outdated website and generate more leads"
                    ],
                    "decision_factors": ["project cost"],
                    "evidence_refs": ["page-001"],
                }
            ],
            "competitor_scope": {
                "direct_peer_description": "boutique digital agencies"
            },
        }
        response = ai_question_response(
            [
                "Which boutique digital agencies build websites for small businesses?",
                "Can you recommend boutique digital agencies that replace outdated websites?",
                "Which boutique digital agencies provide digital marketing for small businesses?",
                "Which boutique digital agencies should a small business owner compare?",
                "Which boutique digital agencies in India help small businesses generate leads?",
            ]
        )
        with patch(
            "geo_audit.intents.call_chat_completion",
            side_effect=[BAND_RESPONSE, response, response],
        ):
            prompts, payload, error = generate_free_customer_intents(profile)
        text = " ".join(item["prompt"] for item in prompts).lower()

        self.assertIsNone(error)
        self.assertEqual(len(prompts), 5)
        self.assertIn("small businesses", text)
        self.assertIn("boutique digital agencies", text)
        self.assertIn("replace outdated websites", text)
        self.assertNotIn("long-term support", text)
        self.assertEqual(
            payload["inputs"]["buyer_personas"][0]["persona_id"],
            "owner",
        )

    def test_low_confidence_buyer_role_is_not_used_in_questions(self) -> None:
        profile = {
            **PROFILE,
            "primary_offerings": ["industrial safety video analytics"],
            "buyer_personas": [
                {
                    "persona_id": "buyer",
                    "buyer_role": "Compliance Officer",
                    "organization_type": "manufacturing facilities",
                    "jobs_to_be_done": ["detect PPE violations"],
                    "confidence": "Low",
                    "evidence_refs": [],
                }
            ],
        }
        response = ai_question_response(
            [
                "Which providers offer industrial safety video analytics?",
                "Which providers detect PPE violations in manufacturing facilities?",
                "Which industrial safety video analytics providers should manufacturers compare?",
                "Can you recommend providers for factory safety monitoring?",
                "Which providers help manufacturing facilities detect PPE violations?",
            ]
        )
        with patch(
            "geo_audit.intents.call_chat_completion",
            side_effect=[BAND_RESPONSE, response, response],
        ):
            prompts, _payload, error = generate_free_customer_intents(profile)
        text = " ".join(item["prompt"] for item in prompts or []).lower()
        self.assertIsNone(error)
        self.assertNotIn("compliance officer", text)

    def test_low_confidence_persona_details_are_hidden_from_pro_generator(self) -> None:
        payload = build_customer_intent_payload(
            {
                **PROFILE,
                "buyer_personas": [
                    {
                        "persona_id": "guessed-buyer",
                        "buyer_role": "Chief Compliance Officer",
                        "organization_type": "Fortune 500 companies",
                        "organization_sizes": ["10,000+ employees"],
                        "regions": ["North America"],
                        "jobs_to_be_done": ["replace global security systems"],
                        "confidence": "Low",
                    }
                ],
            }
        )
        user_data = json.loads(payload["messages"][1]["content"])
        persona = user_data["buyer_profile"]["buyer_personas"][0]

        self.assertEqual(persona["buyer_role"], "Unknown")
        self.assertEqual(persona["organization_sizes"], [])
        self.assertEqual(persona["regions"], [])
        self.assertEqual(
            persona["organization_type"],
            PROFILE["target_audience"],
        )
        self.assertNotIn("Fortune 500", json.dumps(user_data))

    def test_small_customer_segment_is_kept_in_free_questions(self) -> None:
        profile = {
            "company_name": "Acme Studio",
            "category": "Shopify website development",
            "target_audience": "online retailers",
            "business_type": "Web development agency",
            "delivery_model": "Specialist ecommerce agency",
            "primary_offerings": ["Shopify store development"],
            "problems_solved": ["launch and improve online stores"],
            "buyer_personas": [
                {
                    "persona_id": "retailer",
                    "buyer_role": "Store owner",
                    "organization_type": "online retailers",
                    "organization_sizes": ["small businesses"],
                    "jobs_to_be_done": ["launch an online store"],
                    "confidence": "High",
                }
            ],
        }
        response = ai_question_response(
            [
                "Which specialist ecommerce agencies develop Shopify stores for small online retailers?",
                "Which Shopify agencies help small online retailers launch stores?",
                "Can you recommend ecommerce agencies for small online retailers?",
                "Which Shopify development agencies should small online retailers compare?",
                "Which specialist agencies improve Shopify stores for small online retailers?",
            ]
        )
        with patch(
            "geo_audit.intents.call_chat_completion",
            side_effect=[BAND_RESPONSE, response, response],
        ):
            prompts, _payload, error = generate_free_customer_intents(profile)
        text = " ".join(item["prompt"] for item in prompts or []).lower()

        self.assertIsNone(error)
        self.assertEqual(len(prompts), 5)
        self.assertIn("small online retailers", text)
        self.assertIn("specialist ecommerce agencies", text)

    def test_ai_review_receives_complete_service_market_context(self) -> None:
        profile = {
            "company_name": "WeDigi",
            "category": "Website development and digital marketing",
            "target_audience": "startups and small businesses",
            "business_type": "Service company",
            "delivery_model": "Boutique digital agency",
            "primary_offerings": ["website development", "digital marketing"],
            "problems_solved": ["generate leads from a business website"],
            "competitor_scope": {
                "direct_peer_description": "boutique digital agencies",
                "excluded_provider_types": ["enterprise consultancies"],
            },
        }
        candidates = [
            {"prompt": "Which companies provide website development?"},
            {
                "prompt": (
                    "Which boutique digital agencies provide website "
                    "development for small businesses?"
                )
            },
        ]
        payload = build_customer_intent_review_payload(
            profile,
            candidates,
            count=5,
        )
        review_data = json.loads(payload["messages"][1]["content"])

        self.assertEqual(review_data["candidate_questions"], candidates)
        self.assertEqual(review_data["requested_question_count"], 5)
        self.assertEqual(
            review_data["required_search_frame"]["direct_provider_type"],
            "boutique digital agencies",
        )

    def test_pro_question_payload_uses_buyer_profile(self) -> None:
        payload = build_customer_intent_payload(
            {
                **PROFILE,
                "business_type": "Service company",
                "buyer_personas": [
                    {
                        "persona_id": "safety-leader",
                        "buyer_role": "Safety leader",
                        "jobs_to_be_done": ["detect PPE violations"],
                        "evidence_refs": ["page-001"],
                    }
                ],
            }
        )
        user_data = json.loads(payload["messages"][1]["content"])
        self.assertEqual(
            user_data["buyer_profile"]["business_type"],
            "Service company",
        )
        self.assertEqual(
            user_data["buyer_profile"]["buyer_personas"][0]["buyer_role"],
            "Safety leader",
        )

    def test_crawler_encodes_spaces_in_internal_urls(self) -> None:
        self.assertEqual(
            normalize_url("https://example.com/faq copy.html"),
            "https://example.com/faq%20copy.html",
        )

    def test_website_page_types_are_exclusive_and_skip_homepage(self) -> None:
        snapshot = {
            "domain": "acme.test",
            "normalized_url": "https://acme.test",
            "pages": [
                {
                    "url": "https://acme.test",
                    "title": "Acme safety solutions",
                    "headings": {"h1": ["Factory safety"], "h2": []},
                    "internal_links": [
                        {
                            "text": "Product/Pricing",
                            "url": "https://acme.test/pricing",
                        },
                        {
                            "text": "Product sheets",
                            "url": "https://acme.test/product-sheets",
                        },
                        {
                            "text": "Industries",
                            "url": "https://acme.test/industries",
                        },
                    ],
                    "navigation": [],
                }
            ],
        }
        evidence = build_website_evidence(snapshot)
        self.assertEqual(
            evidence["feature_pages_found"]["urls"],
            ["https://acme.test/product-sheets"],
        )
        self.assertEqual(
            evidence["pricing_page_found"]["urls"],
            ["https://acme.test/pricing"],
        )
        self.assertNotIn(
            "https://acme.test",
            evidence["use_case_pages_found"]["urls"],
        )

    def test_question_sanitizer_only_enforces_structure_and_brand_safety(self) -> None:
        prompts = sanitize_prompt_records(
            [
                {
                    "prompt": "How can I improve factory safety monitoring?",
                    "category": "Problem",
                    "buying_stage": "Discovery",
                },
                {
                    "prompt": "Which companies provide factory safety monitoring software?",
                    "category": "Vendor",
                    "buying_stage": "Discovery",
                },
                {
                    "prompt": "Which Kenesis alternatives should I compare?",
                    "category": "Vendor",
                    "buying_stage": "Discovery",
                },
            ],
            PROFILE,
        )
        self.assertEqual(len(prompts), 2)
        self.assertTrue(prompts[0]["prompt"].endswith("?"))
        self.assertNotIn("Kenesis", " ".join(item["prompt"] for item in prompts))

    def test_question_quality_is_assigned_to_ai_reviewer(self) -> None:
        payload = build_customer_intent_review_payload(
            PROFILE,
            [{"prompt": "Which companies are the best?"}],
            count=5,
        )
        system_prompt = payload["messages"][0]["content"].lower()
        self.assertIn("using reasoning", system_prompt)
        self.assertIn("rewrite or replace", system_prompt)
        self.assertIn("not keyword matching", system_prompt)

    def test_free_preview_generates_and_reviews_five_ai_questions(self) -> None:
        response = ai_question_response(
            [
                "Which providers offer AI video analytics for industrial safety?",
                "Which providers help manufacturers detect PPE violations?",
                "Can you recommend factory safety monitoring platforms?",
                "Which industrial safety video analytics providers should manufacturers compare?",
                "Which providers offer CCTV analytics for manufacturing safety teams?",
            ]
        )
        with patch(
            "geo_audit.intents.call_chat_completion",
            side_effect=[BAND_RESPONSE, response, response],
        ) as llm_call:
            prompts, payload, error = generate_free_customer_intents(PROFILE)
        self.assertIsNone(error)
        self.assertEqual(len(prompts), 5)
        self.assertEqual(payload["mode"], "ai_generated_free_preview")
        # Band, draft, review.
        self.assertEqual(llm_call.call_count, 3)
        self.assertTrue(
            all("kenesis" not in item["prompt"].lower() for item in prompts)
        )

    def test_free_preview_stops_when_profile_is_unknown(self) -> None:
        prompts, payload, error = generate_free_customer_intents(
            {
                "company_name": "Unknown",
                "category": "Unknown",
                "target_audience": "Unknown",
            }
        )
        self.assertIsNone(prompts)
        self.assertEqual(payload["question_count"], 0)
        self.assertIn("Missing:", error)

    def test_free_preview_keeps_answer_only_competitor_with_label(self) -> None:
        rows = build_competitor_report_rows(
            [{"name": "Acme", "mentions": 1}],
            [
                {
                    "prompt": "Which companies provide factory safety software?",
                    "assistant": "bedrock_llama",
                    "model": "test",
                    "recommended_companies": [
                        {
                            "company_name": "Acme",
                            "rank": 1,
                            "reasoning": "Factory safety focus",
                            "evidence_quote": "Acme provides factory safety software.",
                            "source_urls": [],
                        }
                    ],
                }
            ],
            {"competitors": []},
            allow_answer_only=True,
        )
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["evidence_status"], "answer_only_unverified")

    def test_free_preview_builds_one_honest_action(self) -> None:
        recommendations = build_free_preview_recommendations(
            PROFILE,
            {
                "user_recommendation_summary": {
                    "responses_analyzed": 5,
                    "user_mentions": 0,
                    "prompts_where_user_was_not_recommended": [
                        {"category": "Factory safety"}
                    ],
                },
                "top_competitors": [
                    {"company_name": "Acme"},
                    {"company_name": "Beta"},
                ],
            },
        )
        self.assertEqual(len(recommendations), 1)
        self.assertEqual(recommendations[0]["confidence"], "Low")
        self.assertIn("one AI model", recommendations[0]["evidence"])

    def test_quality_marks_source_free_preview_as_low_confidence(self) -> None:
        quality = build_quality_summary(
            [
                {
                    "assistant": "bedrock_llama",
                    "recommended_companies": [{"company_name": "Acme"}],
                    "provider_source_urls": [],
                }
            ],
            {"top_competitors": [{"company_name": "Acme"}]},
            {
                "summary": {"with_website_evidence": 0},
                "competitors": [],
            },
            {"summary": {}},
        )
        self.assertEqual(quality["confidence_level"], "low")
        self.assertEqual(len(quality["warnings"]), 2)

    def test_structured_recommendations_require_answer_evidence(self) -> None:
        items = [
            {
                "company_name": "Acme Safety",
                "rank": 1,
                "reasoning": "Strong fit.",
                "evidence_quote": "Acme Safety is a strong option.",
                "explicitly_recommended": True,
            },
            {
                "company_name": "Example Corp",
                "rank": 2,
                "evidence_quote": "This sentence is absent.",
                "explicitly_recommended": True,
            },
        ]
        normalized = normalize_recommendations(
            items,
            answer_text="Acme Safety is a strong option.",
            require_evidence=True,
        )
        self.assertEqual([item["company_name"] for item in normalized], ["Acme Safety"])
        self.assertEqual(normalized[0]["extraction_confidence"], 0.95)

    def test_bedrock_batch_returns_structure_without_analyzer_call(self) -> None:
        response = {
            "answers": [
                {
                    "prompt_index": 1,
                    "answer_text": "Acme Safety is the strongest option.",
                    "recommended_companies": [
                        {
                            "company_name": "Acme Safety",
                            "rank": 1,
                            "reasoning": "Purpose-built.",
                            "evidence_quote": "Acme Safety is the strongest option.",
                            "explicitly_recommended": True,
                        }
                    ],
                    "overall_reasoning": "Purpose-built vendor.",
                    "unknowns": [],
                }
            ]
        }
        prompts = [
            {
                "prompt": "Which vendors provide CCTV factory safety monitoring?",
                "category": "Vendor",
                "buying_stage": "Discovery",
            }
        ]
        with (
            patch(
                "geo_audit.recommendations.call_bedrock_converse",
                return_value=(
                    json.dumps(response),
                    {"model": "test-model"},
                ),
            ) as bedrock_call,
            patch(
                "geo_audit.recommendations.analyze_provider_answer_batch",
                side_effect=AssertionError("Analyzer should not run"),
            ),
        ):
            results, _payloads, errors = collect_multi_model_recommendations(
                prompts,
                assistants=["bedrock_llama"],
                limit_per_assistant=1,
            )
        self.assertEqual(errors, [])
        self.assertEqual(bedrock_call.call_count, 1)
        call_args, call_kwargs = bedrock_call.call_args
        self.assertIn("focused shortlist", call_args[0])
        self.assertIn("3 to 5 strongest options", call_args[0])
        self.assertEqual(call_kwargs["max_tokens"], 4000)
        self.assertEqual(results[0]["collection_mode"], "structured_provider_batch")
        self.assertEqual(
            results[0]["recommended_companies"][0]["company_name"],
            "Acme Safety",
        )

    def test_mistral_batch_uses_compact_prompt_and_output_limit(self) -> None:
        response = {
            "answers": [
                {
                    "prompt_index": 1,
                    "answer_text": "Acme Safety is a strong option.",
                    "recommended_companies": [
                        {
                            "company_name": "Acme Safety",
                            "rank": 1,
                            "reasoning": "Purpose-built.",
                            "evidence_quote": "Acme Safety is a strong option.",
                            "explicitly_recommended": True,
                        }
                    ],
                    "overall_reasoning": "Strong fit.",
                    "unknowns": [],
                }
            ]
        }
        prompts = [
            {
                "prompt": "Which factory safety vendors should I consider?",
                "category": "Vendor",
                "buying_stage": "Discovery",
            }
        ]
        with patch(
            "geo_audit.recommendations.call_bedrock_converse",
            return_value=(json.dumps(response), {"model": "test-model"}),
        ) as bedrock_call:
            results, _payloads, errors = collect_multi_model_recommendations(
                prompts,
                assistants=["bedrock_mistral"],
                limit_per_assistant=1,
            )
        self.assertEqual(errors, [])
        self.assertEqual(len(results), 1)
        call_args, call_kwargs = bedrock_call.call_args
        self.assertIn("compact buyer-facing result", call_args[0])
        self.assertEqual(call_kwargs["max_tokens"], 3000)

    def test_openai_search_batches_questions_and_keeps_annotated_urls(self) -> None:
        response = {
            "answers": [
                {
                    "prompt_index": 1,
                    "answer_text": "Acme Safety is a strong option.",
                    "recommended_companies": [
                        {
                            "company_name": "Acme Safety",
                            "rank": 1,
                            "reasoning": "Purpose-built.",
                            "evidence_quote": "Acme Safety is a strong option.",
                            "explicitly_recommended": True,
                            "source_urls": ["https://sources.test/acme"],
                        }
                    ],
                    "overall_reasoning": "Strong fit.",
                    "unknowns": [],
                    "source_urls": ["https://sources.test/acme"],
                },
                {
                    "prompt_index": 2,
                    "answer_text": "Beta Vision is another option.",
                    "recommended_companies": [
                        {
                            "company_name": "Beta Vision",
                            "rank": 1,
                            "reasoning": "On-premise support.",
                            "evidence_quote": "Beta Vision is another option.",
                            "explicitly_recommended": True,
                            "source_urls": ["https://invented.test/beta"],
                        }
                    ],
                    "overall_reasoning": "Deployment fit.",
                    "unknowns": [],
                    "source_urls": ["https://invented.test/beta"],
                },
            ]
        }
        metadata = {
            "model": "gpt-5-mini",
            "output": [
                {
                    "content": [
                        {
                            "annotations": [
                                {"url": "https://sources.test/acme"},
                            ]
                        }
                    ]
                }
            ],
        }
        prompts = [
            {
                "prompt": "Which factory safety vendors should I consider?",
                "category": "Vendor",
                "buying_stage": "Discovery",
            },
            {
                "prompt": "Which on-premise video analytics vendors are available?",
                "category": "Vendor",
                "buying_stage": "Discovery",
            },
        ]
        with (
            patch(
                "geo_audit.recommendations.call_openai_response",
                return_value=(json.dumps(response), metadata),
            ) as openai_call,
            patch(
                "geo_audit.recommendations.analyze_provider_answer_batch",
                side_effect=AssertionError("Analyzer should not run"),
            ),
        ):
            results, payloads, errors = collect_multi_model_recommendations(
                prompts,
                assistants=["openai_search"],
                limit_per_assistant=2,
                # The default is one question per call, which is what production
                # runs: it is faster and a failure only loses one question. This
                # test is about the batching path, so it has to ask for it.
                openai_search_batch_size=2,
            )

        self.assertEqual(errors, [])
        self.assertEqual(openai_call.call_count, 1)
        self.assertEqual(len(results), 2)
        self.assertEqual(
            results[0]["provider_source_urls"],
            ["https://sources.test/acme"],
        )
        self.assertEqual(results[1]["provider_source_urls"], [])
        self.assertEqual(
            results[1]["recommended_companies"][0]["source_urls"],
            [],
        )
        batched_input = json.loads(
            payloads[0]["payload"]["input"][1]["content"]
        )
        self.assertEqual(len(batched_input["questions"]), 2)

    def test_openai_batch_retains_reported_urls_for_later_verification(self) -> None:
        response = {
            "answers": [
                {
                    "prompt_index": 1,
                    "answer_text": "Acme Safety is a strong option.",
                    "recommended_companies": [
                        {
                            "company_name": "Acme Safety",
                            "rank": 1,
                            "reasoning": "Purpose-built.",
                            "evidence_quote": "Acme Safety is a strong option.",
                            "explicitly_recommended": True,
                            "source_urls": ["https://sources.test/acme"],
                        }
                    ],
                    "overall_reasoning": "Strong fit.",
                    "unknowns": [],
                    "source_urls": ["https://sources.test/acme"],
                }
            ]
        }
        prompts = [
            {
                "prompt": "Which factory safety vendors should I consider?",
                "category": "Vendor",
                "buying_stage": "Discovery",
            }
        ]
        with patch(
            "geo_audit.recommendations.call_openai_response",
            return_value=(
                json.dumps(response),
                {"model": "gpt-5-mini", "output": []},
            ),
        ):
            results, _payloads, errors = collect_multi_model_recommendations(
                prompts,
                assistants=["openai_search"],
                limit_per_assistant=1,
            )
        self.assertEqual(errors, [])
        self.assertEqual(
            results[0]["provider_source_urls"],
            ["https://sources.test/acme"],
        )
        self.assertEqual(
            results[0]["provider_citation_origin"],
            "structured_web_search_output_pending_verification",
        )

    def test_openai_batch_keeps_explicit_vendor_when_quote_format_changes(self) -> None:
        response = {
            "answers": [
                {
                    "prompt_index": 1,
                    "answer_text": "Acme Safety is a recommended vendor [1].",
                    "recommended_companies": [
                        {
                            "company_name": "Acme Safety",
                            "rank": 1,
                            "reasoning": "Purpose-built.",
                            "evidence_quote": "Acme Safety is a recommended vendor.",
                            "explicitly_recommended": True,
                            "source_urls": [],
                        }
                    ],
                    "overall_reasoning": "Strong fit.",
                    "unknowns": [],
                    "source_urls": [],
                }
            ]
        }
        prompts = [
            {
                "prompt": "Which factory safety vendors should I consider?",
                "category": "Vendor",
                "buying_stage": "Discovery",
            }
        ]
        with patch(
            "geo_audit.recommendations.call_openai_response",
            return_value=(
                json.dumps(response),
                {"model": "gpt-5-mini", "output": []},
            ),
        ):
            results, _payloads, errors = collect_multi_model_recommendations(
                prompts,
                assistants=["openai_search"],
                limit_per_assistant=1,
            )
        self.assertEqual(errors, [])
        self.assertEqual(
            results[0]["recommended_companies"][0]["company_name"],
            "Acme Safety",
        )
        self.assertEqual(
            results[0]["recommended_companies"][0]["extraction_confidence"],
            0.85,
        )

    def test_structured_recommendation_recovers_quote_from_answer(self) -> None:
        rejections: list[dict[str, object]] = []
        normalized = normalize_recommendations(
            [
                {
                    "company_name": "Acme Safety",
                    "rank": 1,
                    "reasoning": "Strong fit.",
                    "evidence_quote": "A differently formatted quote.",
                    "explicitly_recommended": True,
                }
            ],
            answer_text="Acme Safety is a strong option for factory monitoring.",
            require_evidence=True,
            rejection_log=rejections,
        )
        self.assertEqual(len(normalized), 1)
        self.assertEqual(
            normalized[0]["evidence_quote"],
            "Acme Safety is a strong option for factory monitoring.",
        )
        self.assertEqual(rejections, [])

    def test_structured_recommendation_logs_unverifiable_company(self) -> None:
        rejections: list[dict[str, object]] = []
        normalized = normalize_recommendations(
            [
                {
                    "company_name": "Imaginary Vendor",
                    "evidence_quote": "Not present.",
                    "explicitly_recommended": True,
                }
            ],
            answer_text="Acme Safety is the recommended option.",
            require_evidence=True,
            rejection_log=rejections,
        )
        self.assertEqual(normalized, [])
        self.assertEqual(
            rejections[0]["reason"],
            "company_and_evidence_quote_absent_from_answer",
        )

    def test_aggregation_excludes_audited_company_from_competitors(self) -> None:
        patterns = aggregate_recommendations(
            [
                {
                    "assistant": "test",
                    "model": "test",
                    "prompt": "Which vendors?",
                    "prompt_category": "Vendor",
                    "recommended_companies": [
                        {"company_name": "Kenesis", "rank": 1},
                        {"company_name": "Acme Safety", "rank": 2},
                    ],
                }
            ],
            user_company="Kenesis",
        )
        self.assertEqual(
            [item["company_name"] for item in patterns["competitors"]],
            ["Acme Safety"],
        )

    def test_search_queries_are_deterministic_and_contextual(self) -> None:
        first = build_search_queries("AWS", PROFILE, [], [])
        second = build_search_queries("AWS", PROFILE, [], [])
        self.assertEqual(first, second)
        self.assertIn('"Amazon Web Services" official website', first[0]["query"])
        self.assertTrue(any("site:reddit.com" in item["query"] for item in first))
        self.assertTrue(any("PPE violations" in item["query"] for item in first))

    def test_duckduckgo_failure_is_logged_without_agentcore(self) -> None:
        primary = Mock(provider="duckduckgo")
        primary.search.side_effect = RuntimeError("rate limited")
        client = FallbackWebSearchClient(primary)
        result = client.search('"Acme" safety software', 4)
        self.assertEqual(result["results"], [])
        self.assertFalse(result["fallback_used"])
        self.assertEqual(result["errors"][0]["provider"], "duckduckgo")
        self.assertIn("rate limited", result["errors"][0]["error"])

    def test_agentcore_is_used_after_duckduckgo_failure(self) -> None:
        primary = Mock(provider="duckduckgo")
        primary.search.side_effect = RuntimeError("rate limited")
        fallback = Mock()
        fallback.search.return_value = [
            {
                "url": "https://example.test/acme",
                "title": "Acme",
                "snippet": "Acme safety software",
                "search_rank": 1,
            }
        ]
        client = FallbackWebSearchClient(primary, fallback)
        result = client.search('"Acme" safety software', 4)
        self.assertTrue(result["fallback_used"])
        self.assertEqual(result["provider"], "aws_agentcore_web_search")
        self.assertEqual(
            result["results"][0]["search_provider"],
            "aws_agentcore_web_search",
        )

    def test_web_presence_writes_search_error_log(self) -> None:
        with TemporaryDirectory() as temp_dir:
            log_path = Path(temp_dir) / "web_search_errors.log"
            with (
                patch.dict(os.environ, {}, clear=True),
                patch("geo_audit.web_presence.load_dotenv"),
                patch("geo_audit.web_presence.DDGSSearchClient") as ddgs_class,
            ):
                ddgs_class.return_value.provider = "duckduckgo"
                ddgs_class.return_value.search.return_value = []
                result = collect_web_presence(
                    PROFILE,
                    [],
                    [],
                    {"top_competitors": []},
                    error_log_path=log_path,
                )
            self.assertEqual(result["status"], "failed")
            self.assertEqual(result["summary"]["queries_run"], 3)
            self.assertEqual(result["summary"]["fallback_queries"], 0)
            self.assertTrue(log_path.exists())
            logged = [
                json.loads(line)
                for line in log_path.read_text(encoding="utf-8").splitlines()
            ]
            self.assertEqual(len(logged), 3)
            self.assertTrue(
                all(item["provider"] == "duckduckgo" for item in logged)
            )

    def test_web_presence_query_budget_includes_official_competitor_searches(self) -> None:
        entities = [
            {"company_name": "Kenesis", "entity_type": "user_company"},
            *[
                {"company_name": name, "entity_type": "competitor"}
                for name in ("Acme", "Beta", "Gamma")
            ],
        ]
        queries = [
            build_bounded_search_queries(entity, PROFILE, [], [])
            for entity in entities
        ]
        self.assertEqual(sum(len(items) for items in queries), 12)
        self.assertTrue(
            any(
                "site:reddit.com" in item["query"]
                for items in queries
                for item in items
            )
        )
        self.assertTrue(
            all(
                any(item["query_type"] == "official" for item in items)
                for items in queries
            )
        )

    def test_agentcore_web_search_response_is_parsed(self) -> None:
        content = [
            {
                "type": "text",
                "text": json.dumps(
                    {
                        "results": [
                            {
                                "text": "Acme is mentioned here.",
                                "url": "https://example.test/acme",
                                "title": "Acme review",
                                "publishedDate": "2026-01-02",
                            },
                            {
                                "text": "Missing source URL.",
                                "url": None,
                                "title": "Invalid result",
                            },
                        ]
                    }
                ),
            }
        ]
        self.assertEqual(
            parse_web_search_content(content)[0]["published_date"],
            "2026-01-02",
        )
        self.assertEqual(len(parse_web_search_content(content)), 1)

    def test_agentcore_discovers_prefixed_web_search_tool(self) -> None:
        client = AgentCoreWebSearchClient(
            "https://example.test/mcp",
            bearer_token="test-token",
        )
        with patch.object(
            client,
            "_call_mcp",
            return_value={
                "tools": [
                    {"name": "x_amz_bedrock_agentcore_search"},
                    {"name": "web-search-tool___WebSearch"},
                ]
            },
        ):
            self.assertEqual(
                client.discover_web_search_tool(),
                "web-search-tool___WebSearch",
            )

    def test_agentcore_accepts_gateway_url_alias(self) -> None:
        with patch.dict(
            os.environ,
            {"GATEWAY_URL": "https://example.test/mcp"},
            clear=True,
        ):
            client = AgentCoreWebSearchClient.from_environment()
        self.assertEqual(client.gateway_url, "https://example.test/mcp")

    def test_agentcore_sse_response_is_parsed(self) -> None:
        response = parse_mcp_response(
            'event: message\ndata: {"jsonrpc":"2.0","id":"1","result":{"tools":[]}}\n\n'
        )
        self.assertEqual(response["result"]["tools"], [])

    def test_aws_subdomain_can_resolve_as_official_site(self) -> None:
        discovery = discover_competitor_site(
            "AWS",
            ["https://aws.amazon.com/rekognition/"],
        )
        self.assertEqual(discovery["confidence"], "High")
        self.assertEqual(
            discovery["official_website"],
            "https://aws.amazon.com/rekognition",
        )

    def test_newsroom_subdomain_resolves_to_company_root(self) -> None:
        discovery = discover_competitor_site(
            "Axis Communications",
            ["https://newsroom.axis.com/en-gb/blog/responsible-trustworthy-ai"],
        )
        self.assertEqual(discovery["official_website"], "https://axis.com")

    def test_unverified_provider_urls_are_removed(self) -> None:
        results = [
            {
                "provider_source_urls": [
                    "https://ok.test",
                    "https://bad.test",
                ],
                "provider_citation_origin": (
                    "structured_web_search_output_pending_verification"
                ),
            }
        ]
        checks = {
            "https://ok.test": {
                "url": "https://ok.test",
                "resolved_url": "https://ok.test/page",
                "verified": True,
            },
            "https://bad.test": {
                "url": "https://bad.test",
                "verified": False,
                "error": "404",
            },
        }
        with patch(
            "geo_audit.recommendations.verify_source_url",
            # verify_source_url grew a match_terms keyword. A stub that refuses
            # it raises inside the thread pool, the broad except marks the URL
            # unverified, and this test failed for a year on its own stub.
            side_effect=lambda url, **kwargs: checks[url],
        ):
            verified = verify_provider_citations(results)
        self.assertEqual(
            verified[0]["provider_source_urls"],
            ["https://ok.test/page"],
        )
        self.assertEqual(
            verified[0]["provider_citation_origin"],
            "structured_web_search_output_verified",
        )

    def test_export_does_not_treat_model_urls_as_citations(self) -> None:
        rows = build_query_results(
            [
                {
                    "prompt_index": 1,
                    "prompt": "Which vendors?",
                    "assistant": "bedrock_llama",
                    "model": "test",
                    "recommended_companies": [
                        {
                            "company_name": "Acme",
                            "rank": 1,
                            "source_urls": ["https://hallucinated.test/missing"],
                        }
                    ],
                    "provider_source_urls": [],
                }
            ],
            "Kenesis",
        )
        self.assertEqual(rows[0]["citations"], [])

    def test_competitor_report_rows_keep_claims_and_verifiable_sources(self) -> None:
        score_rows = [
            {
                "name": "Acme Safety",
                "mentions": 2,
                "average_rank": 1.5,
            }
        ]
        raw_results = [
            {
                "prompt": "Which safety vendors should I consider?",
                "assistant": "openai_search",
                "model": "test-model",
                "recommended_companies": [
                    {
                        "company_name": "Acme Safety",
                        "rank": 1,
                        "reasoning": "Purpose-built for factory safety.",
                        "evidence_quote": "Acme Safety is purpose-built for factory safety.",
                        "source_urls": ["https://sources.test/acme"],
                    }
                ],
            }
        ]
        competitor_evidence = {
            "competitors": [
                {
                    "company_name": "Acme Safety",
                    "website_url": "https://acme.test",
                    "collection_status": "website_and_citations",
                    "website_evidence": {
                        "homepage_url": "https://acme.test",
                        "homepage_headline": "Prevent incidents in real time",
                        "homepage_subheadline": "AI safety monitoring for factories",
                        "testimonials_or_case_studies_found": {
                            "found": True,
                            "urls": ["https://acme.test/customers/factory"],
                        },
                    },
                    "website_snapshot": {
                        "pages": [
                            {
                                "url": "https://www.triya.ai",
                                "title": "Triya",
                                "main_text": "AI video analytics for safer work",
                            },
                            {
                                "url": "https://www.triya.ai/faq",
                                "title": "FAQ",
                                "main_text": "Frequently asked questions about deployment and privacy.",
                            },
                            {
                                "url": "https://www.triya.ai/features",
                                "title": "Features",
                                "main_text": "Product features for video analytics.",
                            },
                        ]
                    },
                    "verified_web_mentions": [
                        {
                            "verified": True,
                            "title": "Factory safety platforms",
                            "snippet": "Acme Safety provides PPE monitoring.",
                            "url": "https://industry.test/acme",
                            "domain": "industry.test",
                            "source_type": "news_or_blog",
                            "matched_context_terms": ["factory safety"],
                        }
                    ],
                }
            ]
        }
        rows = build_competitor_report_rows(
            score_rows,
            raw_results,
            competitor_evidence,
        )
        self.assertEqual(
            rows[0]["answer_evidence"][0]["answer_excerpt"],
            "Acme Safety is purpose-built for factory safety.",
        )
        self.assertEqual(
            rows[0]["website_evidence"][0]["url"],
            "https://acme.test",
        )
        self.assertEqual(
            rows[0]["verified_mentions"][0]["url"],
            "https://industry.test/acme",
        )

    def test_competitor_report_hides_company_without_verified_support(self) -> None:
        rows = build_competitor_report_rows(
            [{"name": "Acme Safety", "mentions": 2}],
            [
                {
                    "prompt": "Which vendors?",
                    "assistant": "bedrock_llama",
                    "model": "test",
                    "recommended_companies": [
                        {
                            "company_name": "Acme Safety",
                            "rank": 1,
                            "evidence_quote": "Acme Safety is recommended.",
                            "source_urls": [],
                        }
                    ],
                }
            ],
            {
                "competitors": [
                    {
                        "company_name": "Acme Safety",
                        "website_url": "Unknown",
                        "website_evidence": None,
                        "verified_web_mentions": [],
                    }
                ]
            },
        )
        self.assertEqual(rows, [])

    def test_official_site_is_not_exported_as_external_mention(self) -> None:
        rows = build_competitor_report_rows(
            [{"name": "Acme Safety", "mentions": 1}],
            [
                {
                    "prompt": "Which vendors?",
                    "assistant": "openai_search",
                    "model": "test",
                    "recommended_companies": [
                        {
                            "company_name": "Acme Safety",
                            "rank": 1,
                            "evidence_quote": "Acme Safety is recommended.",
                            "source_urls": ["https://acme.test/source"],
                        }
                    ],
                }
            ],
            {
                "competitors": [
                    {
                        "company_name": "Acme Safety",
                        "website_url": "https://acme.test",
                        "website_evidence": None,
                        "verified_web_mentions": [
                            {
                                "verified": True,
                                "url": "https://acme.test/about",
                                "source_type": "official_site",
                            }
                        ],
                    }
                ]
            },
        )
        self.assertEqual(rows[0]["verified_mentions"], [])

    def test_action_rows_export_only_catalog_validated_evidence(self) -> None:
        actions = [
            {
                "observation": "Customer proof is less visible",
                "evidence": "Recommended competitors publish customer examples.",
                "suggested_change": "Publish detailed case studies.",
                "expected_impact": "Improves evidence quality.",
                "confidence": "High",
                "supporting_evidence": [
                    {
                        "evidence_id": "ev-001",
                        "company_name": "Acme Safety",
                        "evidence_type": "customer_proof",
                        "label": "Customer proof or case study",
                        "title": "Factory customer story",
                        "url": "https://acme.test/customers/factory",
                        "provenance": "competitor_website",
                    }
                ],
                "evidence_validation": {
                    "mode": "catalog_ids",
                    "accepted_refs": ["ev-001"],
                },
            }
        ]
        rows = build_action_rows(actions)
        supporting = rows[0]["evidence"]["supporting_evidence"]
        self.assertEqual(len(supporting), 1)
        self.assertEqual(
            supporting[0]["url"],
            "https://acme.test/customers/factory",
        )

    def test_citations_survive_without_the_model_echoing_a_type(self) -> None:
        competitor_evidence = {
            "competitors": [
                {
                    "company_name": "Triya",
                    "website_evidence": {
                        "homepage_url": "https://www.triya.ai",
                        "homepage_headline": "AI video analytics for safer work",
                        "faq_page_found": {
                            "found": True,
                            "matches": [
                                {"url": "https://www.triya.ai/faq", "text": "FAQ"}
                            ],
                        },
                        "feature_pages_found": {
                            "found": True,
                            "matches": [
                                {
                                    "url": "https://www.triya.ai/features",
                                    "text": "Features",
                                }
                            ],
                        },
                    },
                    "website_snapshot": {
                        "pages": [
                            {
                                "url": "https://www.triya.ai",
                                "title": "Triya",
                                "main_text": "AI video analytics for safer work",
                            },
                            {
                                "url": "https://www.triya.ai/faq",
                                "title": "FAQ",
                                "main_text": "Frequently asked questions about deployment and privacy.",
                            },
                            {
                                "url": "https://www.triya.ai/features",
                                "title": "Features",
                                "main_text": "Product features for video analytics.",
                            },
                        ]
                    },
                    "verified_web_mentions": [
                        {
                            "verified": True,
                            "source_type": "other_source",
                            "url": "https://www.triyaestate.com",
                            "title": "Triya Estate",
                            "snippet": "Luxury property in Thailand.",
                            "matched_context_terms": [],
                        }
                    ],
                }
            ]
        }
        catalog = build_verified_evidence_catalog(competitor_evidence)
        self.assertFalse(
            any(item["url"] == "https://www.triyaestate.com" for item in catalog)
        )
        faq_id = next(
            item["evidence_id"]
            for item in catalog
            if item["evidence_type"] == "faq_page"
        )
        feature_id = next(
            item["evidence_id"]
            for item in catalog
            if item["evidence_type"] == "feature_page"
        )
        resolved = resolve_recommendation_evidence(
            [
                {
                    "observation": "FAQ coverage is missing",
                    "evidence": "Triya publishes an FAQ.",
                    "suggested_change": "Publish an FAQ.",
                    "evidence_types": ["faq_page"],
                    "evidence_refs": [faq_id, feature_id, "ev-999"],
                }
            ],
            catalog,
        )
        rows = build_action_rows(resolved)
        supporting = rows[0]["evidence"]["supporting_evidence"]
        # Both real citations survive. The model no longer sees our page
        # labels, so it cannot echo them and we no longer check its echo. What
        # it cited is what the report shows; an invented id is still refused.
        self.assertEqual(
            [item["url"] for item in supporting],
            ["https://www.triya.ai/faq", "https://www.triya.ai/features"],
        )
        self.assertEqual(
            sorted(resolved[0]["evidence_types"]), ["faq_page", "feature_page"]
        )
        rejected = resolved[0]["evidence_validation"]["rejected_refs"]
        self.assertEqual(
            {item["reason"] for item in rejected}, {"unknown_evidence_id"}
        )

    def test_the_model_never_sees_our_guess_about_a_page(self) -> None:
        # We label pages by looking for words in the address. "?products=" in
        # a checkout link made it a "Product or feature page", and the model
        # trusted that over the address and extract in front of it.
        row = readable_evidence_row(
            {
                "evidence_id": "ev-002",
                "company_name": "Handoff",
                "evidence_type": "feature_page",
                "label": "Product or feature page",
                "title": "Handoff Standard",
                "url": "https://a.test/api/checkout?products=abc",
                "excerpt": "$1,000 / mo Subtotal Add discount code",
                "provenance": "competitor_website",
            }
        )
        self.assertNotIn("label", row)
        self.assertNotIn("evidence_type", row)
        self.assertEqual(row["url"], "https://a.test/api/checkout?products=abc")
        self.assertEqual(row["title"], "Handoff Standard")

    def test_recommendation_payload_uses_strict_schema_and_catalog(self) -> None:
        competitor_evidence = {
            "competitors": [
                {
                    "company_name": "Triya",
                    "website_evidence": {
                        "homepage_url": "https://www.triya.ai",
                        "faq_page_found": {
                            "found": True,
                            "urls": ["https://www.triya.ai/faq"],
                        },
                    },
                    "website_snapshot": {
                        "pages": [
                            {
                                "url": "https://www.triya.ai/faq",
                                "title": "FAQ",
                                "main_text": "Frequently asked questions about the platform.",
                            }
                        ]
                    },
                }
            ]
        }
        payload = build_audit_recommendations_payload(
            PROFILE,
            {},
            {"top_competitors": []},
            competitor_evidence,
            {},
        )
        self.assertEqual(payload["response_format"]["type"], "json_schema")
        prompt_data = json.loads(payload["messages"][1]["content"])
        self.assertEqual(
            prompt_data["evidence_catalog"][0]["url"],
            "https://www.triya.ai/faq",
        )

    def test_firecrawl_enhances_weak_snapshot_with_priority_page(self) -> None:
        client = Mock()
        client.can_request.return_value = True
        client.map_site.return_value = [
            {"url": "https://acme.test/faq", "title": "FAQ"},
            {"url": "https://acme.test/blog", "title": "Blog"},
        ]
        client.scrape.return_value = {
            "markdown": "# FAQ\n\nFrequently asked questions about Acme deployment.",
            "links": [],
            "metadata": {
                "sourceURL": "https://acme.test/faq",
                "title": "FAQ",
                "statusCode": 200,
            },
        }
        snapshot = {
            "normalized_url": "https://acme.test",
            "domain": "acme.test",
            "pages": [],
            "failed_pages": [],
        }
        enhanced, result = enhance_competitor_snapshot(
            client,
            "https://acme.test",
            snapshot,
            build_website_evidence(snapshot),
            max_pages=2,
        )
        self.assertEqual(result["pages_added"], 1)
        self.assertEqual(enhanced["pages"][0]["fetch_provider"], "firecrawl")
        self.assertEqual(enhanced["pages"][0]["url"], "https://acme.test/faq")

    def test_firecrawl_final_verification_rejects_wrong_company_page(self) -> None:
        client = Mock()
        client.can_request.return_value = True
        client.scrape.return_value = {
            "markdown": "# Unrelated Estate\n\nLuxury property and holiday homes.",
            "links": [],
            "metadata": {
                "sourceURL": "https://example.test/wrong",
                "title": "Unrelated Estate",
                "statusCode": 200,
            },
        }
        recommendations = [
            {
                "supporting_evidence": [
                    {
                        "evidence_id": "ev-001",
                        "company_name": "Triya",
                        "evidence_type": "external_mention",
                        "url": "https://example.test/wrong",
                        "excerpt": "Search result about Triya.",
                    }
                ],
                "evidence_validation": {
                    "mode": "catalog_ids",
                    "accepted_refs": ["ev-001"],
                    "rejected_refs": [],
                },
            }
        ]
        verified = verify_selected_evidence_with_firecrawl(
            recommendations, client
        )
        self.assertEqual(verified[0]["supporting_evidence"], [])
        self.assertEqual(
            verified[0]["evidence_validation"]["rejected_refs"][0]["reason"],
            "firecrawl_content_mismatch",
        )

    def test_firecrawl_page_conversion_preserves_evidence_content(self) -> None:
        page = firecrawl_document_to_page(
            {
                "markdown": "# Pricing\n\nStarter plan costs $20 per month.",
                "links": ["https://acme.test/faq"],
                "metadata": {
                    "sourceURL": "https://acme.test/pricing",
                    "title": "Pricing",
                },
            },
            "https://acme.test/pricing",
        )
        self.assertEqual(page["title"], "Pricing")
        self.assertIn("Starter plan", page["main_text"])
        self.assertTrue(page["firecrawl_verified"])

    def test_firecrawl_zero_request_budget_disables_calls(self) -> None:
        client = FirecrawlClient("test-key", max_requests=0)
        self.assertFalse(client.can_request())

    def test_top_competitor_is_added_to_action_findings(self) -> None:
        rows = ensure_top_competitor_finding(
            [],
            {
                "top_competitors": [
                    {
                        "company_name": "Vintra",
                        "mention_frequency": 6,
                        "average_rank": 2.17,
                        "sample_reasoning": ["Strong video analytics fit."],
                    }
                ]
            },
            {
                "competitors": [
                    {
                        "company_name": "Vintra",
                        "website_evidence": None,
                    }
                ]
            },
        )
        self.assertIn("Vintra", rows[0]["observation"])
        self.assertIn("not verified", rows[0]["evidence"])


if __name__ == "__main__":
    unittest.main()
