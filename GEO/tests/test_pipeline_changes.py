from __future__ import annotations

import json
import time
import os
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import Mock, patch

from geo_audit.export import (
    audited_domain,
    build_action_rows,
    build_competitor_report_rows,
    build_query_results,
    host_from_value,
)
from geo_audit.comparison import compare_user_to_competitors
from geo_audit.audit_recommendations import (
    AUDIT_RECOMMENDATION_SCHEMA,
    AUDIT_RECOMMENDATION_SYSTEM_PROMPT,
    FINAL_WRITER_RECOMMENDATION_SCHEMA,
    build_audit_recommendations_payload,
    build_free_preview_recommendations,
    add_missing_pages_to_the_catalog,
    build_verified_evidence_catalog,
    compact_recommendation_patterns,
    compact_competitor_evidence,
    canonical_url,
    readable_evidence_row,
    user_page_excerpts,
    ensure_top_competitor_finding,
    hydrate_writer_page,
    keep_evidence_from_the_companies_that_won,
    keep_complete_notebook_evidence_pairs,
    normalize_recommendation,
    passage_is_on_page,
    page_excerpt,
    resolve_recommendation_evidence,
    strip_internal_references,
    verify_selected_evidence_with_firecrawl,
    recommendations_from_findings,
    recommendations_from_final_writer,
    resolve_affected_prompts,
    validate_and_save_finding,
)
from geo_audit.competitor_evidence import enhance_competitor_snapshot
from geo_audit.cli import (
    assess_crawl_quality,
    collect_user_website_snapshot,
    merge_user_snapshots,
    website_crawl_failure_message,
)
from geo_audit.competitor_evidence import replacements_for_empty_competitors
from geo_audit.crawler import same_page_key, ensure_url, normalize_url, parse_page
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
from geo_audit.crawler import same_page_key
from geo_audit.web_search import FallbackWebSearchClient
from geo_audit.web_presence import (
    MAX_MENTION_WINDOWS,
    build_presence_entities,
    check_cited_extract,
    confirm_same_company,
    gate_entity_mentions,
    mention_windows,
    verify_search_result,
)
from geo_audit.evidence import build_website_evidence, readable_excerpt
from geo_audit.aggregation import build_user_keys  # noqa: F401
from geo_audit.aggregation import aggregate_recommendations
from geo_audit.intents import (
    MAX_QUESTION_WORDS,
    build_customer_intent_review_payload,
    build_customer_intent_payload,
    build_required_search_frame,
    generate_free_customer_intents,
    normalize_buyer_band,
    question_batches,
    sanitize_prompt_records,
)
from geo_audit.report_context import (
    anonymous_assistant_labels,
    build_company_blocks,
    build_headline_numbers,
    build_page_index,
    build_question_rows,
    open_page,
    open_company_sources,
    open_question,
    strip_assistant_names,
    assistant_and_model_names,
)
from geo_audit.profile import (
    describe_site_pages,
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
from geo_audit.competitor_evidence import (
    build_competitor_evidence,
    preferred_competitor_site,
    priority_firecrawl_urls,
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
        {
            "buyer_band": json.loads(BAND_RESPONSE),
            "questions": [
                {
                    "category": "Discovery",
                    "buying_stage": "Discovery",
                    "persona_id": "buyer",
                    "intent": "find suitable providers",
                    "profile_evidence": [],
                    "prompt": prompt,
                }
                for prompt in prompts
            ],
        }
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

    def test_strong_standard_user_crawl_skips_firecrawl(self) -> None:
        client = Mock()
        client.can_request.return_value = True
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
                    "main_text": "Useful homepage context. " * 80,
                },
                {
                    "url": "https://example.com/services",
                    "main_text": "Useful buyer and service context. " * 80,
                },
            ],
            "failed_pages": [],
        }
        with patch(
            "geo_audit.cli.crawl_website", return_value=standard_snapshot
        ) as standard_crawl:
            snapshot, result = collect_user_website_snapshot(
                "example.com",
                max_pages=6,
                firecrawl_client=client,
            )

        standard_crawl.assert_called_once()
        client.map_site.assert_not_called()
        client.scrape.assert_not_called()
        self.assertTrue(result["standard_crawl_sufficient"])
        self.assertFalse(result["firecrawl_fallback_used"])
        self.assertFalse(result["standard_fallback_used"])
        self.assertEqual(len(snapshot["pages"]), 2)

    def test_weak_standard_user_crawl_uses_firecrawl_fallback(self) -> None:
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
        self.assertTrue(result["firecrawl_fallback_used"])
        self.assertFalse(result["standard_fallback_used"])
        client.map_site.assert_called_once()
        self.assertEqual(snapshot["pages"][0]["fetch_provider"], "deterministic_crawler")

    def test_failed_standard_user_crawl_uses_firecrawl_fallback(self) -> None:
        client = Mock()
        client.can_request.return_value = True
        client.map_site.return_value = []
        client.scrape.return_value = {
            "markdown": "# Example\n" + ("Useful buyer context. " * 100),
            "metadata": {"sourceURL": "https://example.com", "title": "Example"},
            "links": [],
        }
        with patch(
            "geo_audit.cli.crawl_website", side_effect=ValueError("normal failed")
        ):
            snapshot, result = collect_user_website_snapshot(
                "example.com", max_pages=6, firecrawl_client=client
            )

        self.assertTrue(result["firecrawl_fallback_used"])
        self.assertEqual(snapshot["pages"][0]["fetch_provider"], "firecrawl")
        self.assertIn("normal failed", str(result["standard_failed_pages"]))

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

    def test_a_page_inventory_keeps_only_pages_we_actually_read(self) -> None:
        # This replaces looking for the word "pricing" in a link: a site whose
        # prices live at "how much it costs" was reported as publishing none.
        # No quote is asked for - we crawled these pages, so whose they are was
        # never in doubt. The address comes from the crawl, never the model.
        snapshot = {
            "pages": [
                {
                    "url": "https://example.com/how-much",
                    "title": "How much it costs",
                    "main_text": "Three plans start at 12 dollars a month.",
                },
                {"url": "https://example.com/login", "title": "Sign in"},
            ]
        }
        profile = normalize_company_profile(
            {
                "company_name": "Example",
                "site_pages": [
                    {
                        "page_id": "page-001",
                        "what_it_is_for": "lists three plans with monthly prices",
                    },
                    {"page_id": "page-002", "what_it_is_for": ""},
                    {
                        "page_id": "page-404",
                        "what_it_is_for": "a page that was never crawled",
                    },
                ],
            },
            snapshot,
        )
        self.assertEqual(
            profile["site_pages"],
            [
                {
                    "page_id": "page-001",
                    "url": "https://example.com/how-much",
                    "what_it_is_for": "lists three plans with monthly prices",
                }
            ],
        )

    def test_a_competitor_page_inventory_is_checked_the_same_way(self) -> None:
        snapshot = {
            "pages": [
                {
                    "url": "https://rival.com/plans",
                    "title": "Plans",
                    "main_text": "Team plan is 20 dollars per seat each month.",
                }
            ]
        }
        reply = json.dumps(
            {
                "site_pages": [
                    {
                        "page_id": "page-001",
                        "what_it_is_for": "publishes per-seat pricing",
                    }
                ]
            }
        )
        with patch("geo_audit.profile.call_chat_completion", lambda payload: reply):
            rows = describe_site_pages(snapshot)
        self.assertEqual(rows[0]["url"], "https://rival.com/plans")
        self.assertEqual(rows[0]["what_it_is_for"], "publishes per-seat pricing")

    def test_a_failed_inventory_call_does_not_stop_the_audit(self) -> None:
        # An empty list has to mean "not read", never "this rival publishes
        # nothing", so the audit falls back rather than inventing a gap.
        def boom(payload):
            raise RuntimeError("model down")

        with patch("geo_audit.profile.call_chat_completion", boom):
            rows = describe_site_pages(
                {"pages": [{"url": "https://rival.com", "main_text": "x"}]}
            )
        self.assertEqual(rows, [])

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
        self.assertNotIn("pricing_model", profile)
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
        for unused_field in (
            "pricing_model",
            "core_messaging",
            "customer_segments",
            "market_signals",
        ):
            self.assertNotIn(unused_field, profile)
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

    def test_a_word_from_the_company_name_is_not_treated_as_the_brand(self) -> None:
        # The failure this whole change exists to prevent. Horus Analytics
        # sells video analytics, so the old ban list held "analytics" and
        # deleted all thirty questions, twice, and ended the run. Whether a
        # word names the company or names its trade is a judgment, and it
        # belongs to the writer that can see what the company sells.
        profile = {
            "company_name": "Horus Analytics",
            "category": "AI Video Analytics Software",
            "evidence": {"supporting_pages": ["https://horusapp.io/"]},
        }
        kept = sanitize_prompt_records(
            [
                {"prompt": "best video analytics software for retail stores"},
                {"prompt": "on-premise analytics that works with existing cameras"},
            ],
            profile,
        )
        self.assertEqual(
            [row["prompt"] for row in kept],
            [
                "best video analytics software for retail stores?",
                "on-premise analytics that works with existing cameras?",
            ],
        )

    def test_the_sanitizer_never_empties_the_question_set(self) -> None:
        # A filter that removes everything it was given is broken, whatever it
        # was filtering for. Marketing wording, a customer's name and the
        # company's own name are all judgments now made by the writer, so
        # nothing here may delete on their account.
        profile = {
            "company_name": "WeDigi",
            "named_customers": [{"name": "Brakes India", "described_as": ""}],
            "buying_signals": {
                "company_self_description": ["premium global technology partner"]
            },
            "evidence": {"supporting_pages": ["https://wedigi.test/"]},
        }
        kept = sanitize_prompt_records(
            [
                {"prompt": "looking for a premium global technology partner"},
                {"prompt": "web development partner for Brakes India"},
                {"prompt": "who can rebuild our college admissions portal"},
            ],
            profile,
        )
        self.assertEqual(len(kept), 3)

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
            return_value=response,
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
            return_value=response,
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
            return_value=response,
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

    def test_question_sanitizer_only_enforces_structure(self) -> None:
        # Shape, not judgment: a question mark on the end, no exact repeats,
        # and a note on anything that ran long. Brand safety is the writer's
        # job, and it is told why in its own prompt rather than policed here.
        prompts = sanitize_prompt_records(
            [
                {
                    "prompt": "How can I improve factory safety monitoring?",
                    "category": "Problem",
                    "buying_stage": "Discovery",
                },
                {
                    "prompt": "Which companies provide factory safety monitoring software",
                    "category": "Vendor",
                    "buying_stage": "Discovery",
                },
                {
                    "prompt": "How can I improve factory safety monitoring?",
                    "category": "Problem",
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
        # Four in, one an exact repeat of the first.
        self.assertEqual(len(prompts), 3)
        self.assertTrue(all(item["prompt"].endswith("?") for item in prompts))
        self.assertIn("Kenesis", " ".join(item["prompt"] for item in prompts))
        self.assertFalse(any(item["overlong"] for item in prompts))

    def test_an_overlong_question_is_flagged_and_kept(self) -> None:
        # It used to be deleted. Deleting it is what emptied the set and ended
        # the run, so it is now carried with a note the reader can act on.
        long_question = " ".join(["word"] * (MAX_QUESTION_WORDS + 5))
        prompts = sanitize_prompt_records(
            [{"prompt": long_question}, {"prompt": "short enough"}],
            PROFILE,
        )
        self.assertEqual(len(prompts), 2)
        self.assertTrue(prompts[0]["overlong"])
        self.assertFalse(prompts[1]["overlong"])

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
            return_value=response,
        ) as llm_call:
            prompts, payload, error = generate_free_customer_intents(PROFILE)
        self.assertIsNone(error)
        self.assertEqual(len(prompts), 5)
        self.assertEqual(payload["mode"], "ai_generated_free_preview")
        self.assertEqual(llm_call.call_count, 1)
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

    def test_comparison_exports_evidence_backed_differential_analysis(self) -> None:
        comparison = compare_user_to_competitors(
            {
                "homepage_headline": "AI safety analytics for factories",
                "pricing_page_found": {"found": False, "urls": []},
                "documentation_found": {"found": True, "urls": ["https://kenesis.ai/docs"]},
            },
            {
                "competitors": [
                    {
                        "company_name": "Acme",
                        "collection_status": "website_crawled",
                        "website_evidence": {
                            "homepage_headline": "Video safety platform",
                            "pricing_page_found": {
                                "found": True,
                                "urls": ["https://acme.test/pricing"],
                                "matches": [
                                    {
                                        "url": "https://acme.test/pricing",
                                        "text": "Pricing",
                                        "excerpt": "Plans for manufacturing teams.",
                                    }
                                ],
                            },
                            "documentation_found": {"found": False, "urls": []},
                        },
                    },
                    {
                        "company_name": "Beta",
                        "collection_status": "website_crawled",
                        "website_evidence": {
                            "homepage_headline": "Factory safety software",
                            "pricing_page_found": {
                                "found": True,
                                "urls": ["https://beta.test/pricing"],
                            },
                            "documentation_found": {"found": False, "urls": []},
                        },
                    },
                ],
            },
        )

        differential = comparison["differential_analysis"]
        self.assertEqual(
            differential["basis"]["competitors_with_website_evidence"],
            2,
        )
        competitor_advantage_labels = {
            item["label"] for item in differential["competitor_advantages"]
        }
        self.assertIn("Pricing clarity", competitor_advantage_labels)
        audited_advantage_labels = {
            item["label"] for item in differential["audited_company_advantages"]
        }
        self.assertIn("Documentation", audited_advantage_labels)

    def test_comparison_does_not_treat_unknown_evidence_as_a_gap(self) -> None:
        comparison = compare_user_to_competitors(
            {},
            {
                "competitors": [
                    {
                        "company_name": "Acme",
                        "collection_status": "website_failed",
                        "website_evidence": None,
                    }
                ],
            },
        )

        differential = comparison["differential_analysis"]
        self.assertEqual(differential["competitor_advantages"], [])
        self.assertTrue(differential["uncertain_or_uncollected"])
        self.assertIn(
            "Unknown means",
            differential["basis"]["comparison_rule"],
        )

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

    def test_aggregation_demotes_broad_alternatives_when_profile_is_known(self) -> None:
        profile = {
            "category": "AI video analytics software for industrial safety",
            "target_audience": "manufacturing safety teams",
            "industries": ["manufacturing"],
            "use_cases": ["PPE violation detection"],
            "primary_offerings": ["video analytics"],
            "competitor_scope": {
                "direct_peer_description": (
                    "AI video analytics software for manufacturing safety"
                ),
                "larger_alternative_types": ["IT consulting firms"],
                "excluded_provider_types": ["consulting firms"],
            },
            "buyer_personas": [
                {
                    "jobs_to_be_done": ["detect PPE violations"],
                    "decision_factors": ["on-premise video analytics"],
                }
            ],
        }
        patterns = aggregate_recommendations(
            [
                {
                    "assistant": "test",
                    "model": "test",
                    "prompt": "Which vendors detect PPE violations?",
                    "prompt_category": "Vendor",
                    "recommended_companies": [
                        {
                            "company_name": "Infosys",
                            "rank": 1,
                            "reasoning": "A large IT consulting firm.",
                        },
                        {
                            "company_name": "Acme Vision",
                            "rank": 2,
                            "reasoning": (
                                "AI video analytics for manufacturing safety and PPE violation detection."
                            ),
                        },
                    ],
                }
            ],
            user_company="Kenesis",
            company_profile=profile,
        )

        self.assertEqual(patterns["top_competitors"][0]["company_name"], "Acme Vision")
        self.assertEqual(
            patterns["top_competitors"][0]["category_fit"]["classification"],
            "direct_peer",
        )
        infosys = next(
            item for item in patterns["competitors"] if item["company_name"] == "Infosys"
        )
        self.assertIn(
            infosys["category_fit"]["classification"],
            {"broad_alternative", "weak_or_unclear"},
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
        # The reported provider is taken from the client that answered, rather
        # than being a fixed string that assumed which one that would be.
        fallback = Mock(provider="aws_agentcore_web_search")
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

    def test_a_page_is_exported_once_however_many_answers_name_its_company(
        self,
    ) -> None:
        # The mention list was rebuilt per answer, so every answer naming Acme
        # carried Acme's whole list. A live run exported 306 rows for 45 pages
        # and the database stored all 306.
        answer = {
            "prompt_index": 1,
            "prompt": "Which vendors?",
            "assistant": "bedrock_llama",
            "model": "test",
            "recommended_companies": [{"company_name": "Acme", "rank": 1}],
            "provider_source_urls": [],
        }
        web_presence = {
            "entities": [
                {
                    "company_name": "Acme",
                    "entity_type": "competitor",
                    "verified_mentions": [
                        {"url": "https://review.test/acme", "verified": True},
                        {"url": "https://forum.test/acme", "verified": True},
                    ],
                }
            ]
        }
        rows = build_query_results(
            [dict(answer, prompt_index=index) for index in (1, 2, 3)],
            "Kenesis",
            web_presence,
        )
        exported = [
            mention["url"] for row in rows for mention in row["verified_mentions"]
        ]
        self.assertEqual(len(exported), 2)
        self.assertEqual(len(set(exported)), 2)
        # Carried by the first answer that named the company, so the page is
        # still tied to an answer rather than floating free of the audit.
        self.assertEqual(len(rows[0]["verified_mentions"]), 2)
        self.assertEqual(rows[1]["verified_mentions"], [])

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
                "competitor_evidence_reason": "The case study proves customer use.",
                "audited_company_evidence_reason": "The audited page lacks this proof.",
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
        self.assertEqual(
            rows[0]["evidence"]["competitor_evidence_reason"],
            "The case study proves customer use.",
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

    def test_a_large_question_set_is_written_in_parallel_batches(self) -> None:
        # Twenty questions in one pass took 98s, the second largest block in a
        # Pro run, and nothing in it depended on anything else in it. Ten in
        # one pass took 40s of an 83s stage, so the split starts at five.
        band = {"buyer_situations": [{"role": f"r{i}"} for i in range(6)]}
        self.assertEqual(len(question_batches(5, band)), 1)
        self.assertEqual([count for count, _ in question_batches(10, band)], [5, 5])

        batches = question_batches(20, band)
        self.assertEqual([count for count, _ in batches], [5, 5, 5, 5])
        # Each batch writes for different people rather than racing to cover
        # the same ones, so the halves do not collide.
        roles = [
            [row["role"] for row in share["buyer_situations"]]
            for _count, share in batches
        ]
        self.assertEqual(roles[0], ["r0", "r4"])
        self.assertEqual(roles[1], ["r1", "r5"])

    def test_batches_still_work_when_the_band_has_no_situations(self) -> None:
        batches = question_batches(20, {})
        self.assertEqual([count for count, _ in batches], [5, 5, 5, 5])

    def test_the_site_the_ai_cited_beats_a_name_search(self) -> None:
        # Searching the web for "Triya" returned a doctor's practice, which
        # outranked the right answer and would have had a clinic quoted as a
        # video analytics rival. The AI cited triya.ai four times.
        self.assertEqual(
            preferred_competitor_site(
                "https://drtriya.com",
                "https://triya.ai/solutions/on-premise-video-analytics",
                ["https://triya.ai/use-cases/manufacturing/"],
            ),
            "https://triya.ai/solutions/on-premise-video-analytics",
        )

    def test_a_name_search_still_wins_when_nothing_was_cited(self) -> None:
        self.assertEqual(
            preferred_competitor_site("https://found.test", "https://guess.test", []),
            "https://found.test",
        )
        self.assertEqual(
            preferred_competitor_site(None, "https://guess.test", []),
            "https://guess.test",
        )

    def test_one_page_served_under_three_addresses_is_crawled_once(self) -> None:
        # Some sites redirect between http, https and www; some serve all
        # three. Either way it is one page, and storing each spent half a
        # competitor's crawl budget on its home page.
        self.assertEqual(
            same_page_key("http://www.atomvision.ai/"),
            same_page_key("https://atomvision.ai"),
        )
        self.assertNotEqual(
            same_page_key("https://atomvision.ai/features"),
            same_page_key("https://atomvision.ai/"),
        )

    def test_competitor_sites_are_read_at_the_same_time_and_stay_in_order(
        self,
    ) -> None:
        # Each is a crawl of an unrelated website, so nothing about the first
        # has to finish before the second starts. Order still has to hold:
        # rank is read off this list.
        names = ["A", "B", "C", "D", "E"]

        def slow_crawl(url, max_pages=8, **_bounds):
            time.sleep(0.2)
            return {
                "pages": [{"url": url, "title": "t", "main_text": "x" * 900}],
                "failed_pages": [],
            }

        started = time.time()
        with patch("geo_audit.competitor_evidence.crawl_website", slow_crawl):
            evidence = build_competitor_evidence(
                {"top_competitors": [{"company_name": n} for n in names]},
                competitor_sites={n: f"https://{n.lower()}.test/" for n in names},
                max_pages=4,
            )
        elapsed = time.time() - started
        self.assertEqual(
            [row["company_name"] for row in evidence["competitors"]], names
        )
        self.assertLess(elapsed, 0.6, "competitor sites were read one at a time")

    def test_finished_competitor_download_is_reused_after_web_search(self) -> None:
        patterns = {"top_competitors": [{"company_name": "Rival"}]}
        existing = {
            "competitors": [
                {
                    "company_name": "Rival",
                    "website_url": "https://rival.test",
                    "website_snapshot": {
                        "pages": [
                            {
                                "url": "https://rival.test",
                                "title": "Rival",
                                "main_text": "Useful rival content",
                            }
                        ]
                    },
                    "website_evidence": {"pages_crawled": 1},
                    "collection_status": "website_and_citations",
                }
            ]
        }
        web_presence = {
            "entities": [
                {
                    "company_name": "Rival",
                    "official_website": "https://rival.test",
                    "verified_mentions": [
                        {
                            "verified": True,
                            "url": "https://review.test/rival",
                            "source_type": "external_mention",
                        }
                    ],
                }
            ]
        }

        with patch("geo_audit.competitor_evidence.crawl_website") as crawl:
            refreshed = build_competitor_evidence(
                patterns,
                web_presence=web_presence,
                existing_evidence=existing,
            )

        crawl.assert_not_called()
        rival = refreshed["competitors"][0]
        self.assertEqual(len(rival["verified_web_mentions"]), 1)
        self.assertEqual(len(rival["website_snapshot"]["pages"]), 1)

    def test_missing_competitor_site_is_downloaded_after_web_search_finds_it(
        self,
    ) -> None:
        patterns = {"top_competitors": [{"company_name": "Rival"}]}
        existing = {
            "competitors": [
                {
                    "company_name": "Rival",
                    "website_url": "Unknown",
                    "website_snapshot": None,
                    "website_evidence": None,
                    "collection_status": "citation_only",
                }
            ]
        }
        web_presence = {
            "entities": [
                {
                    "company_name": "Rival",
                    "official_website": "https://rival.test",
                    "verified_mentions": [],
                }
            ]
        }
        snapshot = {
            "pages": [
                {
                    "url": "https://rival.test",
                    "title": "Rival",
                    "main_text": "Useful rival content",
                }
            ],
            "failed_pages": [],
        }

        with patch(
            "geo_audit.competitor_evidence.crawl_website", return_value=snapshot
        ) as crawl:
            refreshed = build_competitor_evidence(
                patterns,
                web_presence=web_presence,
                existing_evidence=existing,
            )

        crawl.assert_called_once()
        self.assertEqual(
            refreshed["competitors"][0]["collection_status"],
            "website_and_citations",
        )

    def test_a_slow_site_stops_at_its_time_budget(self) -> None:
        # Four real competitor sites: two answered in nine seconds, one took
        # sixty-eight. Every site is read at once, so the step waits for the
        # worst of them.
        import geo_audit.crawler as crawler

        counter = {"n": 0}

        def crawl_slowly(url):
            time.sleep(0.05)
            counter["n"] += 1
            page = counter["n"]
            html = (
                "<html><body><p>text</p>"
                f'<a href="https://slow.test/page{page}a">a</a>'
                f'<a href="https://slow.test/page{page}b">b</a>'
                "</body></html>"
            )
            return (html, 200, f"https://slow.test/page{page}")

        with patch.object(crawler, "fetch_html", side_effect=crawl_slowly), patch.object(
            crawler, "fetch_sitemap_urls", return_value=[]
        ):
            started = time.time()
            snapshot = crawler.crawl_website(
                "https://slow.test", max_pages=200, time_budget_seconds=0.3
            )
        self.assertLess(time.time() - started, 1.0)
        self.assertLess(len(snapshot["pages"]), 200)
        self.assertIn(
            "time budget reached",
            [row.get("error") for row in snapshot["failed_pages"]],
        )

    def test_a_site_of_dead_links_is_abandoned(self) -> None:
        # One site spent forty-four seconds on nineteen links that did not
        # exist before it found its eight pages.
        import geo_audit.crawler as crawler
        from urllib.error import URLError

        attempts = []

        def always_fail(url):
            attempts.append(url)
            raise URLError("gone")

        with patch.object(crawler, "fetch_html", side_effect=always_fail), patch.object(
            crawler, "fetch_sitemap_urls", return_value=[]
        ):
            snapshot = crawler.crawl_website(
                "https://broken.test", max_pages=8, max_failures=3
            )
        self.assertEqual(snapshot["pages"], [])
        self.assertLessEqual(len(attempts), 4)

    def test_the_same_page_is_not_fetched_twice(self) -> None:
        # A third of one competitor's page budget went on ":443" and
        # tracking-parameter copies of pages already read.
        self.assertEqual(
            same_page_key("https://acuity.com/"),
            same_page_key("https://acuity.com:443/"),
        )
        self.assertEqual(
            same_page_key("https://acuity.com/about"),
            same_page_key("https://acuity.com/about?nav-ref=navbar&dropdown=1"),
        )
        self.assertNotEqual(
            same_page_key("https://acuity.com/blog?page=2"),
            same_page_key("https://acuity.com/blog?page=3"),
        )

    def test_a_competitor_with_no_pages_is_replaced(self) -> None:
        # A competitor whose website was never found reads no pages, so it can
        # never be cited - while still sitting in the counts as though it had
        # been looked at.
        patterns = {
            "top_competitors": [
                {"company_name": "Found"},
                {"company_name": "Missing"},
                {"company_name": "NextInLine"},
            ],
            "investigation_priority": [{"company_name": "NextInLine"}],
        }
        picked = replacements_for_empty_competitors(
            [
                {"company_name": "Found", "website_snapshot": {"pages": [{"url": "u"}]}},
                {"company_name": "Missing", "website_snapshot": {"pages": []}},
            ],
            patterns,
            {"found", "missing"},
        )
        self.assertEqual([row["company_name"] for row in picked], ["NextInLine"])

    def test_the_replacement_is_a_company_that_beat_the_audited_one(self) -> None:
        # The most-mentioned rival may have won nothing. The report needs to
        # point at whoever took the questions the audited company was missing
        # from, so those come first when a slot has to be refilled.
        patterns = {
            "top_competitors": [
                {"company_name": "Loud"},
                {"company_name": "Gone"},
                {"company_name": "AlsoLoud"},
                {"company_name": "BeatYou"},
            ],
            "investigation_priority": [{"company_name": "BeatYou"}],
        }
        picked = replacements_for_empty_competitors(
            [
                {"company_name": "Loud", "website_snapshot": {"pages": [{"url": "u"}]}},
                {"company_name": "Gone", "website_snapshot": {"pages": []}},
            ],
            patterns,
            {"loud", "gone"},
        )
        self.assertEqual([row["company_name"] for row in picked], ["BeatYou"])

    def test_nothing_is_replaced_when_every_site_was_read(self) -> None:
        picked = replacements_for_empty_competitors(
            [{"company_name": "Found", "website_snapshot": {"pages": [{"url": "u"}]}}],
            {"top_competitors": [{"company_name": "Found"}, {"company_name": "Spare"}]},
            {"found"},
        )
        self.assertEqual(picked, [])

    def test_pages_the_ai_cited_are_read_before_anything_else(self) -> None:
        # Its own answer to "why this company" beats any keyword list we
        # invent. Triya was recommended fourteen times off two pages we never
        # read, while the budget went on licence plate recognition.
        urls = priority_firecrawl_urls(
            "https://www.triya.ai/",
            [
                {"url": "https://www.triya.ai/solutions/anpr", "title": "ANPR"},
                {"url": "https://www.triya.ai/pricing", "title": "Pricing"},
            ],
            ["pricing_page_found"],
            set(),
            weak_snapshot=False,
            cited_urls=[
                "https://www.triya.ai/use-cases/manufacturing/",
                "https://elsewhere.test/review",
            ],
        )
        self.assertEqual(urls[0], "https://www.triya.ai/use-cases/manufacturing/")
        self.assertNotIn("https://elsewhere.test/review", urls)

    def test_the_audited_site_is_described_by_what_it_says(self) -> None:
        # Competitors arrived as pages with real text while the company paying
        # for the audit arrived as a headline and true/false flags, so nothing
        # separated "never mentions this" from "mentions it once".
        rows = user_page_excerpts(
            {
                "pages": [
                    {
                        "url": "https://kenesis.ai/",
                        "title": "Kenesis",
                        "main_text": "On-premise AI. Video never leaves the plant.",
                    },
                    {"url": "http://www.kenesis.ai", "main_text": "duplicate"},
                    {"url": "https://kenesis.ai/about", "main_text": ""},
                ]
            }
        )
        self.assertEqual(len(rows), 1)
        self.assertIn("never leaves the plant", rows[0]["text"])

    def test_no_snapshot_means_no_pages_rather_than_a_crash(self) -> None:
        self.assertEqual(user_page_excerpts(None), [])
        self.assertEqual(user_page_excerpts({"pages": "nonsense"}), [])

    def test_the_payload_lists_pages_and_the_tool_carries_their_words(self) -> None:
        # The page text no longer travels in the payload. Choosing which seven
        # hundred characters mattered, before knowing the argument being made,
        # was always a guess; the writer opens what it needs instead.
        snapshot = {
            "pages": [{"url": "https://kenesis.ai/", "main_text": "On-premise AI"}]
        }
        profile = {
            "company_name": "Kenesis",
            "site_pages": [
                {
                    "url": "https://kenesis.ai/",
                    "what_it_is_for": "explains on-premise deployment",
                }
            ],
        }
        pages, blocks = build_company_blocks(
            profile, {"competitors": []}, {}, [], snapshot
        )
        payload = build_audit_recommendations_payload(
            profile,
            {"domain": "kenesis.ai"},
            {},
            {"competitors": []},
            {},
            user_snapshot=snapshot,
            company_blocks=blocks,
        )
        sent = payload["messages"][-1]["content"]
        self.assertNotIn("On-premise AI", sent)
        self.assertNotIn("https://kenesis.ai/", sent)
        self.assertNotIn("p-001", sent)
        sent_data = json.loads(sent)
        self.assertEqual(
            sent_data["companies_with_sources"],
            [{"company_name": "Kenesis", "relationship": "audited_company"}],
        )
        inventory = open_company_sources("Kenesis", blocks)
        self.assertEqual(
            inventory["pages_on_their_own_website"][0]["url"],
            "https://kenesis.ai/",
        )
        self.assertEqual(
            inventory["pages_on_their_own_website"][0]["page_id"],
            "p-001",
        )
        self.assertEqual(open_page("p-001", pages)["text"], "On-premise AI")
        self.assertIn("error", open_page("p-999", pages))

    def test_every_page_we_read_can_be_cited(self) -> None:
        # The catalog used to accept only pages a keyword list had bucketed,
        # so the top competitor reached the model with its home page alone.
        catalog = build_verified_evidence_catalog(
            {
                "competitors": [
                    {
                        "company_name": "Triya",
                        "website_evidence": {"homepage_url": "https://triya.test"},
                        "website_snapshot": {
                            "pages": [
                                {
                                    "url": "https://triya.test",
                                    "title": "Home",
                                    "main_text": "Turn any CCTV into analytics",
                                },
                                {
                                    "url": "https://triya.test/ai-video-search",
                                    "title": "Search",
                                    "main_text": "Search your CCTV in plain English",
                                },
                            ]
                        },
                    }
                ]
            }
        )
        self.assertIn(
            "https://triya.test/ai-video-search",
            [row["url"] for row in catalog],
        )

    def test_one_page_reached_by_three_addresses_is_one_citation(self) -> None:
        # http, https and www of a home page filled three citation slots.
        self.assertEqual(
            canonical_url("http://www.atomvision.ai/"),
            canonical_url("https://atomvision.ai"),
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
        patterns = {"top_competitors": [{"company_name": "Triya"}]}
        pages, blocks = build_company_blocks(
            PROFILE, competitor_evidence, patterns, [], None
        )
        payload = build_audit_recommendations_payload(
            PROFILE,
            {},
            patterns,
            competitor_evidence,
            {},
            company_blocks=blocks,
        )
        self.assertEqual(payload["response_format"]["type"], "json_schema")
        prompt_data = json.loads(payload["messages"][1]["content"])
        self.assertEqual(
            [row["company_name"] for row in prompt_data["companies_with_sources"]],
            [PROFILE["company_name"], "Triya"],
        )
        self.assertNotIn("https://www.triya.ai/faq", payload["messages"][1]["content"])
        listed = open_company_sources(
            "Triya", blocks
        )["pages_on_their_own_website"]
        faq = next(row for row in listed if row["url"] == "https://www.triya.ai/faq")
        self.assertIn(faq["page_id"], pages)
        self.assertNotIn("evidence_catalog", prompt_data)

    def test_finding_notebook_accepts_only_opened_exact_two_sided_evidence(self) -> None:
        competitor_text = (
            "Triya publishes a detailed security guide for regulated factory teams."
        )
        audited_text = (
            "Kenesis explains video analytics but gives only a short security overview."
        )
        pages = {
            "p-001": {
                "page_id": "p-001",
                "company_name": "Kenesis",
                "text": audited_text,
            },
            "p-002": {
                "page_id": "p-002",
                "company_name": "Triya",
                "text": competitor_text,
            },
        }
        rows = [
            {
                "question_id": "q-01",
                "who_was_named": [{"company": "Triya", "mentions": 3}],
            }
        ]
        findings: list[dict] = []
        result = validate_and_save_finding(
            {
                "primary_question_id": "q-01",
                "affected_question_ids": ["q-01"],
                "competitor_company": "Triya",
                "competitor_page_id": "p-002",
                "competitor_passage": competitor_text,
                "audited_page_id": "p-001",
                "audited_passage": audited_text,
                "observation": "Triya provides deeper security proof.",
                "suggested_change": "Expand the website security page with deployment proof.",
                "expected_impact": "Buyers can verify security fit more easily.",
                "competitor_evidence_reason": "The guide directly answers the security need.",
                "audited_company_evidence_reason": "The current page gives less detail.",
                "confidence": "High",
            },
            pages=pages,
            question_rows=rows,
            company_blocks={"Kenesis": {}, "Triya": {}},
            audited_company="Kenesis",
            opened_page_ids={"p-001", "p-002"},
            opened_question_ids={"q-01"},
            findings=findings,
        )

        self.assertTrue(result["accepted"])
        self.assertEqual(len(findings), 1)
        recommendation = recommendations_from_findings(findings)[0]
        self.assertEqual(recommendation["evidence_refs"], ["p-002", "p-001"])
        self.assertEqual(
            recommendation["suggested_change"],
            "Expand the website security page with deployment proof.",
        )

    def test_final_writer_uses_finding_id_without_overwriting_question_ids(self) -> None:
        findings = [
            {
                "finding_id": "finding-01",
                "primary_question_id": "q-03",
                "affected_question_ids": ["q-03", "q-08", "q-19"],
                "competitor_company": "Agorapulse",
                "competitor_page_id": "p-066",
                "competitor_passage": "Agorapulse describes its inbox workflow.",
                "audited_page_id": "p-017",
                "audited_passage": "Buffer has a small-business page.",
                "observation": "Agorapulse explains community inbox triage.",
                "suggested_change": (
                    "Update the website with a community inbox workflow."
                ),
                "expected_impact": "Buyers can compare moderation workflows.",
                "competitor_evidence_reason": (
                    "The competitor page proves the inbox workflow."
                ),
                "audited_company_evidence_reason": (
                    "The audited page is where the gap belongs."
                ),
                "confidence": "High",
            }
        ]
        writer_items = [
            {
                "finding_id": "finding-01",
                "observation": "Community inbox buyers are sent to Agorapulse.",
                "evidence": "Agorapulse shows a full inbox workflow.",
                "suggested_change": "Add a clearer community inbox workflow section.",
                "expected_impact": "Buyers can verify fit for community management.",
                "confidence": "High",
                "competitor_evidence_reason": "Agorapulse shows the workflow.",
                "audited_company_evidence_reason": "Buffer's cited page is broader.",
                # This is the live bug: a finding id was placed where question
                # ids used to be expected. It must be ignored completely.
                "affected_loss_refs": ["finding-01"],
                "evidence_refs": ["finding-01"],
            }
        ]

        recommendation = recommendations_from_final_writer(writer_items, findings)[0]

        self.assertEqual(
            recommendation["affected_loss_refs"], ["q-03", "q-08", "q-19"]
        )
        self.assertEqual(recommendation["evidence_refs"], ["p-066", "p-017"])
        self.assertEqual(
            recommendation["suggested_change"],
            "Add a clearer community inbox workflow section.",
        )

    def test_final_writer_schema_no_longer_requests_page_or_question_refs(self) -> None:
        item = FINAL_WRITER_RECOMMENDATION_SCHEMA["properties"]["recommendations"][
            "items"
        ]
        self.assertIn("finding_id", item["required"])
        self.assertNotIn("affected_loss_refs", item["properties"])
        self.assertNotIn("evidence_refs", item["properties"])

    def test_final_writer_missing_items_fall_back_to_validated_notebook(self) -> None:
        findings = [
            {
                "finding_id": f"finding-{index:02d}",
                "primary_question_id": f"q-{index:02d}",
                "affected_question_ids": [f"q-{index:02d}"],
                "competitor_page_id": f"p-{index:03d}",
                "audited_page_id": f"p-{index + 10:03d}",
                "observation": f"Observation {index}",
                "suggested_change": f"Change {index}",
                "expected_impact": f"Impact {index}",
                "competitor_evidence_reason": f"Competitor reason {index}",
                "audited_company_evidence_reason": f"Audited reason {index}",
                "confidence": "High",
            }
            for index in range(1, 6)
        ]
        writer_items = [
            {
                "finding_id": "finding-02",
                "observation": "Polished observation",
                "evidence": "Polished evidence",
                "suggested_change": "Polished change",
                "expected_impact": "Polished impact",
                "confidence": "High",
                "competitor_evidence_reason": "Polished competitor reason",
                "audited_company_evidence_reason": "Polished audited reason",
            },
            {"finding_id": "finding-99", "observation": "Unknown finding"},
        ]

        recommendations = recommendations_from_final_writer(writer_items, findings)

        self.assertEqual(len(recommendations), 5)
        self.assertEqual(recommendations[0]["finding_id"], "finding-02")
        self.assertEqual(recommendations[0]["affected_loss_refs"], ["q-02"])
        self.assertEqual(recommendations[0]["evidence_refs"], ["p-002", "p-012"])
        self.assertEqual(recommendations[1]["finding_id"], "finding-01")
        self.assertEqual(recommendations[1]["affected_loss_refs"], ["q-01"])

    def test_notebook_recommendation_requires_both_resolved_pages(self) -> None:
        recommendations = [
            {
                "finding_id": "finding-01",
                "evidence_refs": ["p-066", "p-017"],
                "supporting_evidence": [{"evidence_id": "p-066"}],
            },
            {
                "finding_id": "finding-02",
                "evidence_refs": ["p-051", "p-014"],
                "supporting_evidence": [
                    {"evidence_id": "p-051"},
                    {"evidence_id": "p-014"},
                ],
            },
        ]

        kept = keep_complete_notebook_evidence_pairs(recommendations)

        self.assertEqual([item["finding_id"] for item in kept], ["finding-02"])

    def test_evidence_map_rejects_unopened_pages(self) -> None:
        findings: list[dict] = []
        result = validate_and_save_finding(
            {
                "primary_question_id": "q-01",
                "affected_question_ids": ["q-01"],
                "competitor_company": "Triya",
                "competitor_page_id": "p-002",
                "competitor_passage": "Words that are not on the selected competitor page at all.",
                "audited_page_id": "p-001",
                "audited_passage": "Words that are not on the selected audited page at all.",
                "observation": "Unsupported comparison.",
                "suggested_change": "Publish a website guide.",
                "expected_impact": "Clearer proof.",
                "competitor_evidence_reason": "Unsupported.",
                "audited_company_evidence_reason": "Unsupported.",
                "confidence": "High",
            },
            pages={
                "p-001": {"company_name": "Kenesis", "text": "Different own text."},
                "p-002": {"company_name": "Triya", "text": "Different rival text."},
            },
            question_rows=[
                {
                    "question_id": "q-01",
                    "who_was_named": [{"company": "Triya", "mentions": 2}],
                }
            ],
            company_blocks={"Kenesis": {}, "Triya": {}},
            audited_company="Kenesis",
            opened_page_ids={"p-001"},
            opened_question_ids={"q-01"},
            findings=findings,
        )

        self.assertFalse(result["accepted"])
        self.assertEqual(findings, [])
        self.assertIn("open the competitor page", " ".join(result["errors"]))

    def test_finding_passage_may_join_page_list_items_without_inventing_claims(self) -> None:
        page = {
            "text": (
                "Track work across several teams. Keep stakeholders informed. "
                "Manage dependencies across connected projects. Coordinate launches "
                "with engineering and marketing teams."
            )
        }
        combined = (
            "Track work across several teams. Manage dependencies across connected "
            "projects. Coordinate launches with engineering and marketing teams."
        )
        self.assertTrue(passage_is_on_page(combined, page))

    def test_writer_selects_pages_in_stages_and_returns_five_actions(self) -> None:
        self.assertIn("Do not open every listed page", AUDIT_RECOMMENDATION_SYSTEM_PROMPT)
        self.assertIn("opened page content decides", AUDIT_RECOMMENDATION_SYSTEM_PROMPT)
        self.assertIn(
            "compare the actual opened content from the relevant",
            AUDIT_RECOMMENDATION_SYSTEM_PROMPT,
        )
        self.assertIn(
            "action first and then search for pages",
            AUDIT_RECOMMENDATION_SYSTEM_PROMPT,
        )
        self.assertIn(
            "skip that question and investigate another",
            AUDIT_RECOMMENDATION_SYSTEM_PROMPT,
        )
        self.assertIn(
            "same underlying website gap",
            AUDIT_RECOMMENDATION_SYSTEM_PROMPT,
        )
        self.assertIn(
            "describes what competitors do but cites only the audited company's pages",
            AUDIT_RECOMMENDATION_SYSTEM_PROMPT,
        )
        self.assertIn(
            "capability you describe must be supported",
            AUDIT_RECOMMENDATION_SYSTEM_PROMPT,
        )
        self.assertIn(
            "If any check fails",
            AUDIT_RECOMMENDATION_SYSTEM_PROMPT,
        )
        self.assertIn("NON-NEGOTIABLE METHOD", AUDIT_RECOMMENDATION_SYSTEM_PROMPT)
        self.assertIn(
            "new page only after checking that no existing page",
            AUDIT_RECOMMENDATION_SYSTEM_PROMPT,
        )
        self.assertIn(
            "Never recommend building a\nnew product capability",
            AUDIT_RECOMMENDATION_SYSTEM_PROMPT,
        )
        self.assertIn(
            "legitimate public\npresence on other websites",
            AUDIT_RECOMMENDATION_SYSTEM_PROMPT,
        )
        self.assertIn(
            "published proof or legitimate\nexternal visibility",
            AUDIT_RECOMMENDATION_SYSTEM_PROMPT,
        )
        self.assertEqual(
            AUDIT_RECOMMENDATION_SYSTEM_PROMPT.count(
                "If several failed questions have the same\nunderlying reason"
            ),
            2,
        )
        self.assertEqual(
            AUDIT_RECOMMENDATION_SYSTEM_PROMPT.count(
                "Changing the wording does not make a repeated idea\nunique"
            ),
            2,
        )
        self.assertEqual(
            AUDIT_RECOMMENDATION_SYSTEM_PROMPT.count(
                "recommendation must include at least one opened competitor page and at\n"
                "least one opened audited-company page in evidence_refs"
            ),
            2,
        )
        self.assertIn(
            "They let the user open\nboth pages, verify the comparison",
            AUDIT_RECOMMENDATION_SYSTEM_PROMPT,
        )
        self.assertIn(
            "remaining tool calls to find a different failed question and action",
            AUDIT_RECOMMENDATION_SYSTEM_PROMPT,
        )
        self.assertEqual(
            AUDIT_RECOMMENDATION_SYSTEM_PROMPT.count(
                "Do not ask the user to take an action without two verifiable page links."
            ),
            2,
        )
        self.assertEqual(
            AUDIT_RECOMMENDATION_SYSTEM_PROMPT.count(
                "When you cannot confidently provide both links, discard that action."
            ),
            2,
        )
        self.assertEqual(
            AUDIT_RECOMMENDATION_SYSTEM_PROMPT.count(
                "A recommendation without both links is not a recommendation."
            ),
            2,
        )
        self.assertIn(
            "A parent-company\npage is valid only when its opened text is specifically about the winning",
            AUDIT_RECOMMENDATION_SYSTEM_PROMPT,
        )
        self.assertIn(
            "never permits lowering this evidence standard",
            AUDIT_RECOMMENDATION_SYSTEM_PROMPT,
        )
        self.assertIn(
            "The main\npriority is broad investigation, proof from both sides and a clear action",
            AUDIT_RECOMMENDATION_SYSTEM_PROMPT,
        )
        self.assertIn(
            "investigate at\nleast five distinct lost questions covering different buyer needs",
            AUDIT_RECOMMENDATION_SYSTEM_PROMPT,
        )
        self.assertIn(
            "Do not write all five from one or two subject areas",
            AUDIT_RECOMMENDATION_SYSTEM_PROMPT,
        )
        self.assertIn(
            "Avoid vague actions such as merely saying\nto improve, enhance or strengthen",
            AUDIT_RECOMMENDATION_SYSTEM_PROMPT,
        )
        self.assertIn(
            "Finally confirm that the main job was completed",
            AUDIT_RECOMMENDATION_SYSTEM_PROMPT,
        )
        self.assertIn("Write exactly five", AUDIT_RECOMMENDATION_SYSTEM_PROMPT)
        schema = AUDIT_RECOMMENDATION_SCHEMA["properties"]["recommendations"]
        self.assertEqual(schema["minItems"], 5)
        self.assertEqual(schema["maxItems"], 5)
        required = schema["items"]["required"]
        self.assertIn("competitor_evidence_reason", required)
        self.assertIn("audited_company_evidence_reason", required)

    def test_selected_empty_page_is_fetched_for_the_writer(self) -> None:
        page = {
            "url": "https://example.test/research",
            "title": "",
            "text": "",
        }
        html = (
            "<html><head><title>Research</title></head><body>"
            "Independent research explains the company and its product clearly."
            "</body></html>"
        )
        with patch(
            "geo_audit.audit_recommendations.fetch_html",
            return_value=(html, 200, "https://example.test/research"),
        ) as fetch:
            hydrated = hydrate_writer_page(page)

        fetch.assert_called_once_with(
            "https://example.test/research", timeout=15
        )
        self.assertIn("Independent research", hydrated["text"])
        self.assertEqual(hydrated["title"], "Research")

    def test_selected_page_firecrawl_is_a_bounded_fallback(self) -> None:
        page = {
            "url": "https://example.test/research",
            "title": "",
            "text": "",
        }
        client = Mock()
        client.can_request.return_value = True
        client.scrape.return_value = {
            "markdown": "# Research\nUseful independent information about the company.",
            "metadata": {
                "sourceURL": "https://example.test/research",
                "title": "Research",
            },
            "links": [],
        }
        with patch(
            "geo_audit.audit_recommendations.fetch_html",
            side_effect=TimeoutError("normal fetch timed out"),
        ):
            hydrated = hydrate_writer_page(page, client)

        client.scrape.assert_called_once_with(
            "https://example.test/research", timeout=15
        )
        self.assertIn("Useful independent information", hydrated["text"])

    def test_svg_accessibility_title_does_not_replace_page_title(self) -> None:
        html = """
        <html>
          <head><title>Company product page</title></head>
          <body><svg><title>Social network</title></svg></body>
        </html>
        """
        page = parse_page("https://example.test/product", html, 200)
        self.assertEqual(page["title"], "Company product page")

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

    def test_the_final_reread_improves_the_extract_and_keeps_the_citation(self) -> None:
        # The re-read used to decide whether a page proved a point by hunting
        # for words - a pricing page headed "how much it costs" failed, and any
        # page carrying the word passed. Whether a page belongs was already
        # settled when it entered the list, and the writer chose it from pages
        # it could read, so the re-read now only fetches a better extract.
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
        with patch(
            "geo_audit.audit_recommendations.fetch_html",
            side_effect=ValueError("normal fetch failed"),
        ):
            verified = verify_selected_evidence_with_firecrawl(
                recommendations, client
            )
        self.assertEqual(
            [row["evidence_id"] for row in verified[0]["supporting_evidence"]],
            ["ev-001"],
        )
        self.assertEqual(verified[0]["evidence_validation"]["rejected_refs"], [])
        client.scrape.assert_called_once()

    def test_final_reread_uses_normal_fetch_before_firecrawl(self) -> None:
        client = Mock()
        client.can_request.return_value = True
        recommendations = [
            {
                "supporting_evidence": [
                    {
                        "evidence_id": "ev-001",
                        "evidence_type": "external_mention",
                        "url": "https://example.test/article",
                        "excerpt": "Search snippet.",
                    }
                ],
                "evidence_validation": {
                    "accepted_refs": ["ev-001"],
                    "rejected_refs": [],
                },
            }
        ]
        html = "<html><title>Article</title><body>" + (
            "Useful independent article content. " * 20
        ) + "</body></html>"
        with patch(
            "geo_audit.audit_recommendations.fetch_html",
            return_value=(html, 200, "https://example.test/article"),
        ):
            verified = verify_selected_evidence_with_firecrawl(
                recommendations, client
            )

        client.scrape.assert_not_called()
        row = verified[0]["supporting_evidence"][0]
        self.assertEqual(row["provenance"], "standard_crawler_verified")
        self.assertEqual(row["verification"]["provider"], "deterministic_crawler")

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

    def test_audited_domain_comes_from_the_crawl_not_the_model(self):
        """A live free run of kenesis.ai produced no validated field evidence,
        so the profile's supporting_pages was empty, the export carried
        "domain": null, and the frontend discarded a complete audit with
        "audit_export.brand.domain is required". The crawl knew the answer the
        whole time."""
        profile_without_evidence = {
            "company_name": "Kenesis",
            "evidence": {"supporting_pages": []},
        }
        snapshot = {
            "input_url": "kenesis.ai",
            "normalized_url": "https://kenesis.ai/",
            "domain": "kenesis.ai",
            "pages": [{"url": "https://kenesis.ai/"}],
        }
        self.assertEqual(
            audited_domain(profile_without_evidence, snapshot), "kenesis.ai"
        )

    def test_audited_domain_falls_back_to_snapshot_pages(self):
        snapshot = {"pages": [{"url": "https://www.acme.io/about"}]}
        self.assertEqual(audited_domain({}, snapshot), "acme.io")

    def test_audited_domain_still_reads_profile_evidence_without_a_crawl(self):
        profile = {
            "evidence": {"supporting_pages": ["https://www.example.com/pricing"]}
        }
        self.assertEqual(audited_domain(profile, None), "example.com")

    def test_internal_reference_ids_never_reach_the_reader(self):
        """A live report read "...suitable for industrial sites (ev-004,
        ev-005, ev-006)." Those are how the model is asked to point at a piece
        of evidence, not words for a customer."""
        written = (
            "Fenec Labs is built as an on-prem appliance with low local "
            "inference latency (ev-004, ev-005, ev-006). Kenesis mentions PPE "
            "violations but only in brief."
        )
        cleaned = strip_internal_references(written)
        self.assertNotIn("ev-004", cleaned)
        # The bracket that held them goes with them; taking only the ids left
        # a stranded ")" behind.
        self.assertNotIn(")", cleaned)
        self.assertIn("low local inference latency. Kenesis", cleaned)

    def test_internal_reference_stripping_leaves_ordinary_text_alone(self):
        for text in ("No ids here at all.", "Version 2-3 of the platform.", ""):
            self.assertEqual(strip_internal_references(text), text)

    def test_page_and_question_ids_never_reach_the_reader(self):
        self.assertEqual(
            strip_internal_references("Evidence (p-049, p-052)."), "Evidence."
        )
        self.assertEqual(
            strip_internal_references("Reason (q-09 answers)."), "Reason."
        )

    def test_normalize_recommendation_strips_ids_from_every_written_field(self):
        cleaned = normalize_recommendation(
            {
                "observation": "Lost loss-001 to Triya.",
                "evidence": "Shown on their site (ev-002).",
                "suggested_change": "Publish a page. See ev-003.",
                "expected_impact": "Clearer for buyers, per loss-001.",
                "competitor_evidence_reason": "Chosen from p-003.",
                "audited_company_evidence_reason": "Compared with p-004.",
            }
        )
        for field in (
            "observation",
            "evidence",
            "suggested_change",
            "expected_impact",
            "competitor_evidence_reason",
            "audited_company_evidence_reason",
        ):
            self.assertNotRegex(cleaned[field], r"(?:ev|loss)-\d+")
        self.assertEqual(cleaned["observation"], "Lost to Triya.")

    def test_excerpts_do_not_open_with_website_furniture(self):
        """All three competitor quotes in a live report began "Skip to main
        content", and one began "##"."""
        excerpt = readable_excerpt(
            "Skip to main content Product # One appliance.Every camera.Local "
            "safety AI."
        )
        self.assertFalse(excerpt.lower().startswith("skip to"))
        self.assertNotIn("#", excerpt)
        # The line breaks the page used for layout took the spaces with them.
        self.assertIn("One appliance. Every camera. Local safety AI.", excerpt)

    def test_excerpts_drop_markdown_emphasis(self):
        self.assertEqual(
            readable_excerpt("## AtomVision Features: How It Works"),
            "AtomVision Features: How It Works",
        )
        self.assertEqual(
            readable_excerpt("**Bold opener** and the rest."),
            "Bold opener and the rest.",
        )

    def test_recommendation_excerpts_get_the_same_cleaning(self):
        """This path skipped readable_excerpt, which is why the report quoted
        pages that opened with a skip-link."""
        excerpt = page_excerpt(
            {
                "main_text": "Skip to main content ## Use cases Detect missing PPE.",
                "title": "Use cases",
            }
        )
        self.assertFalse(excerpt.lower().startswith("skip to"))
        self.assertNotIn("##", excerpt)

    def test_investigation_priority_ignores_questions_already_won(self):
        """The numbers here are a live free audit of kenesis.ai. AtomVision led
        the competitor list with three mentions, but two were in questions
        Kenesis had already won and the third put it fifth. Triya was named
        twice and came first both times, in questions Kenesis was absent from.
        The audit read AtomVision's site and cited it under a finding about a
        question AtomVision also lost."""
        raw = [
            {
                "prompt": "lost one",
                "recommended_companies": [
                    {"company_name": "Triya", "rank": 1},
                    {"company_name": "AtomVision", "rank": 5},
                ],
            },
            {
                "prompt": "lost two",
                "recommended_companies": [{"company_name": "Triya", "rank": 1}],
            },
            {
                "prompt": "won one",
                "recommended_companies": [
                    {"company_name": "AtomVision", "rank": 2},
                    {"company_name": "Kenesis", "rank": 4},
                ],
            },
            {
                "prompt": "won two",
                "recommended_companies": [
                    {"company_name": "AtomVision", "rank": 1},
                    {"company_name": "Kenesis", "rank": 3},
                ],
            },
        ]
        patterns = aggregate_recommendations(
            raw, user_company="Kenesis", user_aliases=["Kenesis"]
        )
        priority = patterns["investigation_priority"]
        self.assertEqual(priority[0]["company_name"], "Triya")
        self.assertEqual(priority[0]["priority_score"], 200)
        atom = next(
            row for row in priority if row["company_name"] == "AtomVision"
        )
        # Fifth place in the one question it was actually in, and nothing for
        # the question Kenesis beat it in.
        self.assertEqual(atom["priority_score"], 20)
        # The list the dashboard shows is deliberately left alone: being named
        # three times is true and worth showing.
        self.assertEqual(
            patterns["top_competitors"][0]["company_name"], "AtomVision"
        )

    def test_investigation_priority_falls_back_when_nothing_was_lost(self):
        """Recommended everywhere still leaves the companies placed above."""
        raw = [
            {
                "prompt": "won but second",
                "recommended_companies": [
                    {"company_name": "Triya", "rank": 1},
                    {"company_name": "Kenesis", "rank": 2},
                    {"company_name": "Later Co", "rank": 3},
                ],
            }
        ]
        patterns = aggregate_recommendations(
            raw, user_company="Kenesis", user_aliases=["Kenesis"]
        )
        priority = patterns["investigation_priority"]
        self.assertEqual([row["company_name"] for row in priority], ["Triya"])
        self.assertEqual(priority[0]["basis"], "outranked_questions")

    def test_losses_carry_the_reason_each_winner_was_chosen(self):
        raw = [
            {
                "prompt": "lost one",
                "recommended_companies": [
                    {
                        "company_name": "Triya",
                        "rank": 1,
                        "reasoning": "On-premise edge deployment on existing cameras.",
                    }
                ],
            }
        ]
        patterns = aggregate_recommendations(
            raw, user_company="Kenesis", user_aliases=["Kenesis"]
        )
        loss = patterns["user_recommendation_summary"][
            "prompts_where_user_was_not_recommended"
        ][0]
        self.assertEqual(loss["winners"][0]["company_name"], "Triya")
        self.assertEqual(loss["winners"][0]["rank"], 1)
        self.assertIn("edge deployment", loss["winners"][0]["reason"])

    def test_a_finding_cannot_cite_a_company_that_lost_the_same_question(self):
        """AtomVision placed fifth in the question this finding is about, and
        was cited under it because its was the only website that had been
        read."""
        recommendations = [
            {
                "observation": "Lost the zone breach question.",
                "affected_prompts": [
                    {
                        "loss_id": "loss-001",
                        "prompt": "zone breach detection?",
                        # AtomVision is in the answer, in last place. With the
                        # audited company absent, every name here is nominally
                        # ahead of it, so presence alone cannot be the test.
                        "recommended_instead": [
                            "Triya",
                            "Visionify",
                            "Witvix",
                            "AtomVision",
                        ],
                        "winners": [
                            {"company_name": "Triya", "rank": 1},
                            {"company_name": "Visionify", "rank": 2},
                            {"company_name": "Witvix", "rank": 3},
                        ],
                    }
                ],
                "supporting_evidence": [
                    {
                        "evidence_id": "ev-001",
                        "company_name": "AtomVision",
                        "evidence_type": "homepage_message",
                    },
                    {
                        "evidence_id": "ev-002",
                        "company_name": "Triya",
                        "evidence_type": "homepage_message",
                    },
                ],
                "evidence_validation": {"accepted_refs": ["ev-001", "ev-002"]},
            }
        ]
        cleaned = keep_evidence_from_the_companies_that_won(recommendations)
        kept = cleaned[0]["supporting_evidence"]
        self.assertEqual([row["company_name"] for row in kept], ["Triya"])
        rejected = cleaned[0]["evidence_validation"]["rejected_refs"]
        self.assertEqual(rejected[0]["company_name"], "AtomVision")
        self.assertEqual(
            rejected[0]["reason"], "company_did_not_win_the_cited_question"
        )

    def test_a_finding_with_no_question_keeps_its_citation(self):
        recommendations = [
            {
                "observation": "General website gap.",
                "affected_prompts": [],
                "supporting_evidence": [
                    {"evidence_id": "ev-001", "company_name": "AtomVision"}
                ],
            }
        ]
        cleaned = keep_evidence_from_the_companies_that_won(recommendations)
        self.assertEqual(len(cleaned[0]["supporting_evidence"]), 1)

    def test_prompt_resolution_merges_winners_from_repeated_provider_losses(self):
        prompt = "Which providers ensure healthcare AI compliance?"
        prompt_losses = [
            {
                "loss_id": "loss-001",
                "prompt": prompt,
                "category": "Compliance",
                "recommended_instead": ["Microsoft", "Deloitte"],
                "winners": [{"company_name": "Microsoft Azure", "rank": 1}],
            },
            {
                "loss_id": "loss-002",
                "prompt": prompt,
                "category": "Compliance",
                "recommended_instead": ["Accenture", "Capgemini"],
                "winners": [{"company_name": "Accenture", "rank": 1}],
            },
        ]
        recommendations = [
            {
                "affected_loss_refs": ["q-06"],
                "supporting_evidence": [
                    {"evidence_id": "p-065", "company_name": "Microsoft"}
                ],
                "evidence_validation": {"accepted_refs": ["p-065"]},
            }
        ]

        resolved = resolve_affected_prompts(
            recommendations,
            prompt_losses,
            [{"question_id": "q-06", "question": prompt}],
        )
        cleaned = keep_evidence_from_the_companies_that_won(resolved)

        self.assertEqual(
            [row["company_name"] for row in cleaned[0]["supporting_evidence"]],
            ["Microsoft"],
        )

    def test_compact_patterns_keep_all_pro_loss_rows_for_question_resolution(self):
        losses = [
            {
                "prompt": f"Question {index}",
                "category": "Category",
                "assistant": "assistant",
                "recommended_instead": ["Accenture"],
                "winners": [{"company_name": "Accenture", "rank": 1}],
            }
            for index in range(1, 21)
        ]

        compacted = compact_recommendation_patterns(
            {"user_recommendation_summary": {"prompts_where_user_was_not_recommended": losses}}
        )
        prompt_losses = compacted["user_company_recommendation_summary"][
            "prompt_losses"
        ]
        resolved = resolve_affected_prompts(
            [{"affected_loss_refs": ["q-20"]}],
            prompt_losses,
            [{"question_id": "q-20", "question": "Question 20"}],
        )

        self.assertEqual(resolved[0]["affected_prompts"][0]["prompt"], "Question 20")

    def test_host_from_value_accepts_bare_hosts_and_urls(self):
        # The snapshot stores `domain` bare and `normalized_url` as a URL;
        # urlparse returns an empty netloc for the bare form.
        self.assertEqual(host_from_value("kenesis.ai"), "kenesis.ai")
        self.assertEqual(host_from_value("www.kenesis.ai"), "kenesis.ai")
        self.assertEqual(host_from_value("https://www.kenesis.ai/about"), "kenesis.ai")
        self.assertIsNone(host_from_value(""))
        self.assertIsNone(host_from_value(None))


def provider_answer(question, assistant, model, names, positions=None):
    positions = positions or list(range(1, len(names) + 1))
    return {
        "prompt": question,
        "prompt_category": "voice dictation",
        "assistant": assistant,
        "model": model,
        "recommended_companies": [
            {
                "company_name": name,
                "rank": position,
                "reasoning": f"{assistant} liked {name} at {position}",
            }
            for name, position in zip(names, positions)
        ],
    }


class ReportContextTests(unittest.TestCase):
    """The writer used to get ten of a hundred lost questions and the first
    seven hundred characters of three pages. Both slices were chosen without
    knowing what it would need."""

    ANSWERS = [
        provider_answer("Best dictation app?", "bedrock_claude", "claude-haiku",
                        ["Otter.ai", "Dragon"]),
        provider_answer("Best dictation app?", "openai_search", "gpt-5-mini",
                        ["Dragon", "Otter.ai"]),
        provider_answer("Best dictation app?", "bedrock_nova", "amazon.nova-lite",
                        ["Otter", "Wispr Flow"]),
        provider_answer("Cheapest dictation app?", "bedrock_claude", "claude-haiku",
                        ["Wispr Flow"]),
    ]
    KEYS = build_user_keys("Wispr Flow", None)
    ALIASES = {"otter": "Otter.ai"}

    def rows(self):
        return build_question_rows(self.ANSWERS, "Wispr Flow", self.KEYS, self.ALIASES)

    def test_one_row_per_question_not_per_answer(self):
        rows = self.rows()
        self.assertEqual([row["question_id"] for row in rows], ["q-01", "q-02"])

    def test_a_merged_spelling_is_counted_as_one_company(self):
        # "Otter" and "Otter.ai" are one company, so the row must not show two.
        first = self.rows()[0]
        names = [item["company"] for item in first["who_was_named"]]
        self.assertEqual(sorted(names), ["Dragon", "Otter.ai"])
        otter = next(item for item in first["who_was_named"] if item["company"] == "Otter.ai")
        self.assertEqual(otter["named_by"], 3)
        self.assertEqual(otter["position"], 1)

    def test_the_row_carries_names_and_places_only(self):
        # Reasons here spent ten thousand characters restating the same few
        # sentences. The writer opens a question when it wants them.
        dragon = next(
            item for item in self.rows()[0]["who_was_named"]
            if item["company"] == "Dragon"
        )
        self.assertEqual(dragon, {"company": "Dragon", "position": 1, "named_by": 2})

    def test_the_reasons_are_there_when_a_question_is_opened(self):
        rows = self.rows()
        opened = open_question("q-01", rows, self.ANSWERS, anonymous_assistant_labels(self.ANSWERS))
        reasons = [
            company["reason"]
            for answer in opened["answers"]
            for company in answer["companies_it_named"]
        ]
        self.assertTrue(any("liked Dragon" in reason for reason in reasons))

    def test_open_question_returns_page_ids_cited_for_each_company(self):
        answers = [
            {
                "prompt": "Best review platform?",
                "assistant": "openai_search",
                "model": "search-model",
                "raw_response": "GitLab is strong for reviews.",
                "provider_source_urls": ["https://gitlab.test/reviews"],
                "recommended_companies": [
                    {
                        "company_name": "GitLab",
                        "rank": 1,
                        "reasoning": "Detailed review workflows.",
                        "source_urls": ["https://gitlab.test/reviews"],
                    }
                ],
            }
        ]
        rows = build_question_rows(answers, "Linear", build_user_keys("Linear", None), {})
        pages = {
            "p-081": {
                "page_id": "p-081",
                "company_name": "GitLab",
                "url": "https://gitlab.test/reviews",
            }
        }
        opened = open_question(
            "q-01",
            rows,
            answers,
            anonymous_assistant_labels(answers),
            pages=pages,
        )
        answer = opened["answers"][0]
        self.assertEqual(answer["assistant_cited_page_ids"], ["p-081"])
        self.assertEqual(
            answer["companies_it_named"][0]["assistant_cited_page_ids"],
            ["p-081"],
        )

    def test_open_question_uses_an_empty_page_list_when_no_source_was_cited(self):
        rows = self.rows()
        opened = open_question(
            "q-01",
            rows,
            self.ANSWERS,
            anonymous_assistant_labels(self.ANSWERS),
            pages={},
        )
        for answer in opened["answers"]:
            self.assertEqual(answer["assistant_cited_page_ids"], [])
            for company in answer["companies_it_named"]:
                self.assertEqual(company["assistant_cited_page_ids"], [])

    def test_the_audited_company_is_counted_not_listed_as_a_rival(self):
        rows = self.rows()
        self.assertEqual(rows[0]["answers_naming_the_company"], 1)
        self.assertEqual(rows[1]["answers_naming_the_company"], 1)
        for row in rows:
            self.assertNotIn(
                "Wispr Flow", [item["company"] for item in row["who_was_named"]]
            )

    def test_the_headline_says_questions_not_answers(self):
        rows = self.rows()
        numbers = build_headline_numbers(
            self.ANSWERS, rows, "Wispr Flow", self.KEYS, self.ALIASES
        )
        self.assertEqual(numbers["questions_asked"], 2)
        self.assertEqual(numbers["answers_we_got_back"], 4)
        self.assertEqual(numbers["assistants_asked"], 3)
        self.assertEqual(numbers["answers_naming_the_audited_company"], 2)

    def test_opening_a_question_hides_which_assistant_answered(self):
        rows = self.rows()
        labels = anonymous_assistant_labels(self.ANSWERS)
        opened = open_question("q-01", rows, self.ANSWERS, labels)
        said = {answer["assistant"] for answer in opened["answers"]}
        self.assertTrue(all(name.startswith("assistant ") for name in said), said)
        self.assertNotIn("bedrock_claude", json.dumps(opened))

    def test_an_unknown_id_answers_rather_than_crashing(self):
        rows = self.rows()
        self.assertIn("error", open_question("q-99", rows, self.ANSWERS, {}))

    def test_no_assistant_or_model_name_survives_into_the_advice(self):
        names = assistant_and_model_names(self.ANSWERS)
        written = strip_assistant_names(
            "Claude and gpt-5-mini both ranked Otter.ai first.", names
        )
        self.assertNotIn("laude", written)
        self.assertNotIn("gpt", written.lower())
        self.assertIn("Otter.ai", written)

    def test_ordinary_wording_is_left_alone(self):
        names = assistant_and_model_names(self.ANSWERS)
        line = "Three of the six assistants sent buyers to Otter.ai."
        self.assertEqual(strip_assistant_names(line, names), line)

    def test_ordinary_words_hiding_inside_model_ids_survive(self):
        # Splitting model ids into alphabetic parts harvested "large",
        # "flash" and "instruct" from mistral-large and gemini-2.5-flash. A
        # live report then told a customer it needed SLAs "for an AI assistant
        # organizations".
        answers = [
            provider_answer("q", "bedrock_mistral", "mistral.mistral-large-2402-v1:0", ["A"]),
            provider_answer("q", "gemini", "gemini-2.5-flash", ["A"]),
            provider_answer("q", "bedrock_llama", "us.meta.llama3-1-70b-instruct-v1:0", ["A"]),
        ]
        names = assistant_and_model_names(answers)
        line = "SLAs for large organizations, a flash sale page, and instruct-led docs."
        self.assertEqual(strip_assistant_names(line, names), line)
        self.assertNotIn("large", names)
        self.assertNotIn("flash", names)
        self.assertNotIn("instruct", names)


class PageListTests(unittest.TestCase):
    """Three kinds of page, told apart. The audited company was one name among
    six, and an outside review sat beside a rival's own marketing page with
    nothing to separate them."""

    PROFILE = {"company_name": "Kenesis"}
    COMPETITORS = {
        "competitors": [
            {
                "company_name": "Triya",
                "website_snapshot": {
                    "pages": [
                        {
                            "url": "https://triya.ai/pricing",
                            "title": "Pricing",
                            "main_text": "Three plans.",
                        }
                    ]
                },
                "site_pages": [
                    {
                        "url": "https://triya.ai/pricing",
                        "what_it_is_for": "lists three plans with prices",
                    }
                ],
                "verified_web_mentions": [
                    {
                        "verified": True,
                        "url": "https://g2.com/triya",
                        "title": "Triya reviews",
                        "snippet": "42 reviews",
                        "usefulness_reason": "buyers comparing it with rivals",
                    }
                ],
            }
        ]
    }
    SNAPSHOT = {
        "pages": [
            {"url": "https://kenesis.ai/", "title": "Home", "main_text": "On-premise"}
        ]
    }

    def index(self):
        return build_company_blocks(
            self.PROFILE, self.COMPETITORS,
            {"top_competitors": [{"company_name": "Triya"}]}, [], self.SNAPSHOT
        )

    def test_each_company_gets_its_own_block(self):
        patterns = {"top_competitors": [{"company_name": "Triya"}]}
        _pages, blocks = build_company_blocks(
            self.PROFILE, self.COMPETITORS, patterns, [], self.SNAPSHOT
        )
        payload = build_audit_recommendations_payload(
            self.PROFILE, {}, patterns, self.COMPETITORS, {},
            company_blocks=blocks, user_snapshot=self.SNAPSHOT,
        )
        sent = json.loads(payload["messages"][1]["content"])
        self.assertEqual(
            [row["company_name"] for row in sent["companies_with_sources"]],
            ["Kenesis", "Triya"],
        )
        self.assertNotIn("https://kenesis.ai/", payload["messages"][1]["content"])
        kenesis_sources = open_company_sources("Kenesis", blocks)
        self.assertEqual(
            [r["url"] for r in kenesis_sources["pages_on_their_own_website"]],
            ["https://kenesis.ai/"],
        )

    def test_a_page_written_elsewhere_is_kept_apart_from_their_own(self):
        # What AI reaches for and what the wider internet holds are different
        # claims, and reading them together is the diagnosis the report makes.
        _pages, blocks = self.index()
        triya = blocks["Triya"]
        self.assertEqual(
            [r["url"] for r in triya["pages_on_their_own_website"]],
            ["https://triya.ai/pricing"],
        )
        self.assertEqual(
            [r["url"] for r in triya["pages_the_wider_internet_holds_about_them"]],
            ["https://g2.com/triya"],
        )

    def test_audited_company_web_mentions_reach_its_company_block(self):
        web_presence = {
            "entities": [
                {
                    "company_name": "Kenesis",
                    "entity_type": "user_company",
                    "verified_mentions": [
                        {
                            "verified": True,
                            "url": "https://industry.test/kenesis-review",
                            "title": "Kenesis review",
                            "page_text": "Kenesis provides on-premise video analytics.",
                            "passages": ["Kenesis provides on-premise video analytics."],
                        },
                        {
                            "verified": False,
                            "url": "https://unverified.test/kenesis",
                        },
                    ],
                }
            ]
        }
        pages, blocks = build_company_blocks(
            self.PROFILE,
            self.COMPETITORS,
            {"top_competitors": [{"company_name": "Triya"}]},
            [],
            user_snapshot=self.SNAPSHOT,
            web_presence=web_presence,
        )

        rows = blocks["Kenesis"]["pages_the_wider_internet_holds_about_them"]
        self.assertEqual(
            [row["url"] for row in rows],
            ["https://industry.test/kenesis-review"],
        )
        self.assertEqual(
            pages[rows[0]["page_id"]]["passages"],
            web_presence["entities"][0]["verified_mentions"][0]["passages"],
        )

    def test_a_company_with_no_website_found_says_so(self):
        _pages, blocks = build_company_blocks(
            self.PROFILE,
            {"competitors": [{"company_name": "Ghost", "verified_web_mentions": []}]},
            {"top_competitors": [{"company_name": "Ghost"}]},
            [],
            self.SNAPSHOT,
        )
        self.assertEqual(blocks["Ghost"]["official_website"], "not known")
        self.assertEqual(blocks["Ghost"]["pages_on_their_own_website"], [])

    def test_discovered_official_homepage_can_be_opened_after_failed_crawl(self):
        competitors = {
            "competitors": [
                {
                    "company_name": "Triya",
                    "website_url": "https://triya.test",
                    "website_snapshot": {"pages": []},
                }
            ]
        }
        answers = [
            {
                "recommended_companies": [
                    {
                        "company_name": "Triya",
                        "official_website": "https://triya.test",
                    }
                ]
            }
        ]
        pages, blocks = build_company_blocks(
            self.PROFILE,
            competitors,
            {"top_competitors": [{"company_name": "Triya"}]},
            answers,
            user_snapshot=self.SNAPSHOT,
        )

        own = blocks["Triya"]["pages_on_their_own_website"]
        self.assertEqual(own[0]["url"], "https://triya.test")
        self.assertIn(own[0]["page_id"], pages)
        self.assertEqual(pages[own[0]["page_id"]]["text"], "")


class EverythingListedIsCitableTests(unittest.TestCase):
    """A live run produced three recommendations and zero links. All three
    cited the audited company's own pages, which the catalog never held."""

    def test_the_audited_companys_own_pages_can_be_cited(self):
        profile = {"company_name": "Kenesis"}
        snapshot = {
            "pages": [
                {
                    "url": "https://kenesis.ai/features",
                    "title": "Features",
                    "main_text": "Slack and Zapier integrations.",
                }
            ]
        }
        competitors = {"competitors": []}
        catalog = build_verified_evidence_catalog(competitors)
        pages, _inventory = build_page_index(profile, competitors, snapshot, catalog)
        catalog = add_missing_pages_to_the_catalog(catalog, pages)

        resolved = resolve_recommendation_evidence(
            [{"observation": "x", "evidence_refs": ["p-001"]}], catalog
        )
        self.assertEqual(
            [row["url"] for row in resolved[0]["supporting_evidence"]],
            ["https://kenesis.ai/features"],
        )

    def test_an_id_that_was_never_listed_is_still_refused(self):
        catalog = add_missing_pages_to_the_catalog([], {})
        resolved = resolve_recommendation_evidence(
            [{"observation": "x", "evidence_refs": ["p-999"]}], catalog
        )
        self.assertEqual(resolved[0]["supporting_evidence"], [])
        self.assertEqual(
            resolved[0]["evidence_validation"]["rejected_refs"][0]["reason"],
            "unknown_evidence_id",
        )


class PageReadingTests(unittest.TestCase):
    """A page found by web search used to carry the search engine's blurb -
    a summary written for a query, not for the page - while the passages we
    had pulled from the page itself were thrown away."""

    PAGES = {
        "p-001": {
            "page_id": "p-001",
            "company_name": "Triya",
            "url": "https://g2.com/triya",
            "title": "Triya reviews",
            "text": "Cookie notice. Navigation. " + ("filler " * 400) + "Triya is cheap.",
            "passages": ["Reviewers say Triya is cheap and quick to set up."],
        },
        "p-002": {
            "page_id": "p-002",
            "company_name": "Triya",
            "url": "https://triya.ai/pricing",
            "title": "Pricing",
            "text": "Three plans from 12 dollars.",
            "passages": [],
        },
    }

    def test_text_is_what_comes_back_by_default(self):
        # One call behaves the same way whatever the page is.
        out = open_page("p-001", self.PAGES)
        self.assertIn("Cookie notice", out["text"])
        self.assertNotIn("what_it_says_about_this_company", out)

    def test_passages_can_be_asked_for_on_a_web_mention(self):
        out = open_page("p-001", self.PAGES, "passages")
        self.assertEqual(
            out["what_it_says_about_this_company"],
            ["Reviewers say Triya is cheap and quick to set up."],
        )

    def test_asking_for_passages_on_a_crawled_page_returns_its_text(self):
        # Pages read from a company's own website have no passages, because the
        # whole page is already held.
        out = open_page("p-002", self.PAGES, "passages")
        self.assertEqual(out["text"], "Three plans from 12 dollars.")
        self.assertIn("not a web mention", out["note"])

    def test_an_unknown_page_says_so(self):
        self.assertIn("error", open_page("p-999", self.PAGES))

    def test_a_long_page_can_be_read_on_from_where_it_stopped(self):
        # A fixed cut left the writer with the top of a long page and no way to
        # know what it had missed.
        pages = {"p-1": {"page_id": "p-1", "company_name": "X", "url": "u",
                         "title": "t", "text": "A" * 14000, "passages": []}}
        first = open_page("p-1", pages)
        self.assertEqual((first["part"], first["parts"], len(first["text"])), (1, 3, 6000))
        self.assertIn("part 2", first["more"])
        last = open_page("p-1", pages, "text", 3)
        self.assertEqual(len(last["text"]), 2000)
        self.assertNotIn("more", last)

    def test_asking_beyond_the_end_returns_the_last_part(self):
        pages = {"p-1": {"page_id": "p-1", "company_name": "X", "url": "u",
                         "title": "t", "text": "A" * 100, "passages": []}}
        self.assertEqual(open_page("p-1", pages, "text", 99)["part"], 1)


class WrittenAddressTests(unittest.TestCase):
    """Links reach the reader through the citation list, where every address
    came from a page this audit read. One typed into a sentence has no such
    backing, and a link that goes nowhere costs the reader their trust."""

    CATALOG = [
        {
            "evidence_id": "ev-001",
            "company_name": "Rival",
            "evidence_type": "pricing_page",
            "url": "https://rival.com/plans",
            "title": "Plans",
            "excerpt": "Team plan is 20 dollars a seat.",
        }
    ]

    def resolve(self, text):
        return resolve_recommendation_evidence(
            [
                {
                    "observation": text,
                    "evidence": text,
                    "suggested_change": text,
                    "expected_impact": text,
                    "evidence_refs": ["ev-001"],
                }
            ],
            self.CATALOG,
        )[0]

    def test_an_address_we_read_survives(self):
        row = self.resolve("Their prices are at https://rival.com/plans today.")
        self.assertIn("https://rival.com/plans", row["observation"])

    def test_an_address_we_never_read_is_removed(self):
        row = self.resolve("See https://rival.com/invented-by-the-model for this.")
        self.assertNotIn("invented-by-the-model", row["observation"])
        self.assertNotIn("http", row["evidence"])

    def test_the_citation_still_carries_the_real_link(self):
        row = self.resolve("Their pricing page publishes per-seat prices.")
        self.assertEqual(
            [item["url"] for item in row["supporting_evidence"]],
            ["https://rival.com/plans"],
        )

    def test_each_rival_page_is_handed_the_id_it_can_be_cited_by(self):
        compact = compact_competitor_evidence(
            {
                "competitors": [
                    {
                        "company_name": "Rival",
                        "site_pages": [
                            {
                                "url": "https://rival.com/plans",
                                "what_it_is_for": "publishes per-seat pricing",
                            },
                            {
                                "url": "https://rival.com/never-crawled",
                                "what_it_is_for": "something else",
                            },
                        ],
                    }
                ]
            },
            self.CATALOG,
        )
        pages = compact["competitors"][0]["their_pages"]
        self.assertEqual(pages[0]["cite_as"], "ev-001")
        self.assertIsNone(pages[1]["cite_as"])
        # No address travels with the description; the id fetches it.
        self.assertNotIn("url", pages[0])


class WebPresenceEntityCheckTests(unittest.TestCase):
    """The step counts how widely a company is written about, so a page that
    belongs to somebody with the same name moves the number being reported."""

    def test_the_audited_company_carries_the_address_it_was_audited_at(self):
        # The one identity in this step that was not worked out from a name.
        # A live run counted app.horuslab.xyz, titled "HORUS Analytics", as web
        # presence for Horus Analytics of horusapp.io.
        entities = build_presence_entities(
            {
                "company_name": "Horus Analytics",
                "evidence": {
                    "supporting_pages": ["https://horusapp.io/industries"]
                },
            },
            [],
            {"top_competitors": [{"company_name": "Agent Vi"}]},
            max_competitors=2,
        )
        audited = entities[0]
        self.assertEqual(audited["entity_type"], "user_company")
        self.assertEqual(audited["audited_domain"], "horusapp.io")
        # A competitor's site is resolved by name matching, which is the thing
        # this step doubts. Handing it over as identity would launder a guess.
        self.assertIsNone(entities[1].get("audited_domain"))

    def test_the_judge_is_told_the_address_only_when_it_is_known(self):
        seen = {}

        def fake_call(payload):
            seen.update(json.loads(payload["messages"][1]["content"]))
            return json.dumps({"pages": []})

        rows = [
            {
                "url": "https://app.horuslab.xyz/login",
                "domain": "app.horuslab.xyz",
                "title": "HORUS Analytics",
                "mention_windows": ["HORUS Analytics sign in"],
            }
        ]
        with patch("geo_audit.web_presence.call_chat_completion", fake_call):
            confirm_same_company("Horus Analytics", {}, rows, "horusapp.io")
        self.assertEqual(seen["company_website"], "horusapp.io")
        self.assertEqual(seen["pages"][0]["domain"], "app.horuslab.xyz")

        seen.clear()
        with patch("geo_audit.web_presence.call_chat_completion", fake_call):
            confirm_same_company("Agent Vi", {}, rows)
        self.assertNotIn("company_website", seen)

    def test_the_model_rates_how_useful_each_page_is(self):
        reply = json.dumps(
            {
                "pages": [
                    {
                        "url": "https://reddit.com/r/x",
                        "is_this_company": True,
                        "line": 1,
                        "usefulness": "high",
                        "reason": "buyers comparing it with rivals",
                    }
                ]
            }
        )
        rows = [{"url": "https://reddit.com/r/x", "mention_windows": ["Horus"]}]
        with patch(
            "geo_audit.web_presence.call_chat_completion", lambda payload: reply
        ):
            verdicts = confirm_same_company("Horus", {}, rows)
        self.assertEqual(verdicts["https://reddit.com/r/x"][3], "high")

    def test_a_rating_the_model_leaves_out_lands_in_the_middle(self):
        # A missing rating must not quietly promote or bury a page.
        reply = json.dumps(
            {
                "pages": [
                    {
                        "url": "https://x.com/a",
                        "is_this_company": True,
                        "line": 1,
                        "usefulness": "",
                        "reason": "",
                    }
                ]
            }
        )
        rows = [{"url": "https://x.com/a", "mention_windows": ["Horus"]}]
        with patch(
            "geo_audit.web_presence.call_chat_completion", lambda payload: reply
        ):
            verdicts = confirm_same_company("Horus", {}, rows)
        self.assertEqual(verdicts["https://x.com/a"][3], "medium")

    def test_the_most_useful_pages_are_shown_first(self):
        # This order used to come from a hand-made sum that rewarded a page for
        # repeating industry words.
        entity_rows = [
            {
                "company_name": "Horus",
                "verified_mentions": [
                    {"url": "https://a", "search_rank": 1, "mention_windows": ["Horus"]},
                    {"url": "https://b", "search_rank": 2, "mention_windows": ["Horus"]},
                    {"url": "https://c", "search_rank": 3, "mention_windows": ["Horus"]},
                ],
            }
        ]
        ratings = {"https://a": "low", "https://b": "high", "https://c": "medium"}

        def fake_confirm(name, profile, rows, own_website=None):
            return {
                str(row["url"]): (True, 1, "because", ratings[str(row["url"])])
                for row in rows
            }

        with patch("geo_audit.web_presence.confirm_same_company", fake_confirm):
            gated, _diagnostics = gate_entity_mentions(entity_rows, {})
        self.assertEqual(
            [row["url"] for row in gated[0]["verified_mentions"]],
            ["https://b", "https://c", "https://a"],
        )
        self.assertEqual(gated[0]["verified_mentions"][0]["usefulness_reason"], "because")

    def test_a_mention_late_in_a_long_page_is_still_read(self):
        # A forum thread names the company in comment forty. Reading the top of
        # the page finds nothing, which is how a real mention gets thrown away.
        page = ("unrelated chatter. " * 400) + "Horus does video analytics for factories."
        windows = mention_windows(page, ["Horus"])
        self.assertEqual(len(windows), 1)
        self.assertIn("video analytics for factories", windows[0])

    def test_one_name_repeated_in_a_paragraph_costs_one_extract(self):
        page = "Triya and Triya and Triya all in one breath, then video analytics."
        self.assertEqual(len(mention_windows(page, ["Triya"])), 1)

    def test_a_page_that_never_names_the_company_yields_nothing(self):
        self.assertEqual(mention_windows("a page about something else", ["Horus"]), [])

    def test_extracts_are_capped(self):
        page = " ".join(f"Horus paragraph {index}. " + "filler " * 200 for index in range(9))
        self.assertLessEqual(len(mention_windows(page, ["Horus"])), MAX_MENTION_WINDOWS)

    def test_a_verdict_the_model_cannot_point_at_is_rejected(self):
        # Asked whether a page is about a company, a model tends to agree.
        # Making it cite the extract turns the answer into something testable.
        row = {"mention_windows": ["Horus builds video analytics software."]}
        keep, reason, _use, _said = check_cited_extract(
            row, ["Horus"], (True, 4, "looks right", "medium")
        )
        self.assertFalse(keep)
        self.assertEqual(reason, "cited_extract_does_not_exist")

    def test_an_extract_that_does_not_name_the_company_is_rejected(self):
        row = {"mention_windows": ["Skip to main content. Contact sales today."]}
        keep, reason, _use, _said = check_cited_extract(
            row, ["Horus"], (True, 1, "it is them", "medium")
        )
        self.assertFalse(keep)
        self.assertEqual(reason, "cited_extract_does_not_name_the_company")

    def test_a_cited_extract_that_names_the_company_is_kept(self):
        row = {"mention_windows": ["Horus builds video analytics software."]}
        keep, reason, usefulness, said = check_cited_extract(
            row, ["Horus"], (True, 1, "video analytics", "high")
        )
        self.assertEqual(usefulness, "high")
        self.assertEqual(said, "video analytics")
        self.assertTrue(keep)
        self.assertEqual(reason, "model_cited_extract_1")

    def test_a_model_saying_no_is_taken_at_its_word(self):
        row = {"mention_windows": ["Horus, an ancient Egyptian deity."]}
        keep, reason, _use, _said = check_cited_extract(
            row, ["Horus"], (False, 0, "mythology", "low")
        )
        self.assertFalse(keep)
        self.assertTrue(reason.startswith("model:"))

    def test_a_search_snippet_cannot_stand_in_for_the_page(self):
        # The snippet is written by the search provider, not by the page. A
        # page that never names the company was admitted on the strength of a
        # summary about it, and then had no extract to show.
        html = "<html><head><title>Some Directory</title></head><body>Listings of vendors.</body></html>"
        row = {
            "url": "https://example.com/listing",
            "company_name": "Horus",
            "snippet": "Horus is a video analytics company",
        }
        with patch(
            "geo_audit.web_presence.fetch_html",
            return_value=(html, 200, "https://example.com/listing"),
        ):
            self.assertIsNone(verify_search_result(row, company_profile={}))


class SearchProviderOrderTests(unittest.TestCase):
    """Which provider is tried first is a decision, not a name in a string."""

    class FakeClient:
        def __init__(self, provider, rows=None, error=None):
            self.provider = provider
            self.rows = rows or []
            self.error = error
            self.calls = 0

        def search(self, query, max_results=4):
            self.calls += 1
            if self.error:
                raise self.error
            return self.rows

    def test_the_fallback_is_left_alone_while_the_first_choice_answers(self):
        # Every query used to pay about 31 seconds for DuckDuckGo to fail
        # before the provider that works was asked at all.
        primary = self.FakeClient("aws_agentcore_web_search", [{"url": "https://a.test"}])
        fallback = self.FakeClient("duckduckgo")
        client = FallbackWebSearchClient(primary, fallback)

        result = client.search("anything")

        self.assertEqual(result["provider"], "aws_agentcore_web_search")
        self.assertFalse(result["fallback_used"])
        self.assertEqual(fallback.calls, 0)

    def test_the_fallback_still_runs_when_the_first_choice_fails(self):
        primary = self.FakeClient("aws_agentcore_web_search", error=RuntimeError("down"))
        fallback = self.FakeClient("duckduckgo", [{"url": "https://b.test"}])
        client = FallbackWebSearchClient(primary, fallback)

        result = client.search("anything")

        self.assertEqual(result["provider"], "duckduckgo")
        self.assertTrue(result["fallback_used"])
        self.assertEqual(result["results"][0]["search_provider"], "duckduckgo")

    def test_the_reported_provider_follows_the_order_it_was_given(self):
        primary = self.FakeClient("aws_agentcore_web_search")
        fallback = self.FakeClient("duckduckgo")
        self.assertEqual(
            FallbackWebSearchClient(primary, fallback).provider,
            "aws_agentcore_web_search_with_duckduckgo_fallback",
        )
        self.assertEqual(
            FallbackWebSearchClient(fallback, None).provider,
            "duckduckgo",
        )


if __name__ == "__main__":
    unittest.main()
