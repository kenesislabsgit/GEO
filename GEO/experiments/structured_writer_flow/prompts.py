"""Generic instructions for each small step in the structured writer flow.

These prompts intentionally contain no company, product, or audit-specific
examples.  The facts for a run arrive only in the user message.
"""

QUESTION_SELECTOR_PROMPT = """
You select buyer questions that deserve evidence-based website improvement work.

The audited company wants to be recommended more often in future AI answers. First
group questions that express the same underlying buyer need, even when their wording,
industry, or persona differs. Select at most one question from each group. Prefer the
questions where the audited company was mentioned least and where both competitor and
audited-company pages are available. Never pad the result with repeated buyer needs
just to reach the requested maximum. Do not decide the recommendation yet. Do not
invent facts, pages, or page IDs. Return only the required JSON.
""".strip()

PAGE_PLANNER_PROMPT = """
You plan a small evidence investigation for one buyer question.

Choose pages to read before deciding any action. Select competitor pages that are
likely to explain why a company that won this question was credible, and audited-
company pages that are likely to show its current coverage of the same buyer need.
Use the URL path first and title as a helpful clue. Assistant-cited pages are useful
clues, but are not automatically correct. Choose only supplied page IDs. Do not
recommend an action and do not invent page IDs. Return only the required JSON.
""".strip()

EVIDENCE_JUDGE_PROMPT = """
You judge one possible website or public-web visibility gap from page content.

Read the buyer question, assistant answer evidence, and opened pages. A valid bundle
must contain one competitor page whose content helps explain why that competitor
could win this buyer question, and one audited-company page whose content shows the
current state. Compare what the pages actually say before proposing an action. The
action must improve the audited company's website or public web presence so it can
be understood and recommended more accurately in future AI answers.

For each side, copy one short passage of 8 to 60 words exactly from the supplied page
text. The passage must directly support your reasoning; it will be checked against
the stored text. If no exact supporting passage exists on either side, reject the
bundle instead of stretching an unrelated page.

Public page evidence proves what a company clearly publishes; silence on one page
does not prove that its product lacks a capability. Describe a missing explanation,
proof, page, comparison, or discoverability signal—not a missing product feature.
Recommend a concrete content or public-presence change. Do not propose building a
product feature unless the supplied page explicitly proves a known product defect.
The audited-company passage must positively support the capability that the action
will explain. A competitor capability alone is never permission to claim parity. If
the audited evidence supports only part of the buyer need, narrow the action to that
supported part. If no meaningful part is supported, reject the bundle.

Choose the narrowest improvement domain. Use capability_explanation only when a more
specific domain does not fit: workflow_education is setup or process guidance;
use_case_content is audience or scenario content; buyer_proof is outcomes or customer
evidence; pricing_and_packaging is plan clarity; integration_content is connected-tool
content; comparison_content is honest category or alternative positioning;
technical_discoverability is machine-readable or crawl structure; external_authority
is credible third-party presence; terminology_and_positioning is naming and category
clarity.

Reject the bundle when either side is irrelevant, empty, belongs to the wrong entity,
or does not support a confident comparison. Never fill gaps with general knowledge.
Use only opened page IDs and return only the required JSON.
""".strip()

DEDUPE_SELECTOR_PROMPT = """
Choose exactly five materially different evidence bundles.

Two bundles are duplicates when they address the same underlying website or public-
presence problem, even if their questions or wording differ. Group questions that
share one cause under one selected bundle. The five selected bundles must cover five
different buyer needs. Prefer strong, specific evidence and a useful spread of
improvement types. Use only supplied bundle IDs. Return only JSON.
""".strip()

FINAL_WRITER_PROMPT = """
Write five clear actions from five already-validated evidence bundles.

Do not search, select new pages, or change evidence. Each action must explain the
observed gap, the exact website or public-web change to make, why that change follows
from the comparison, and the expected effect on future AI recommendations. Keep the
five actions materially different and tied to five different buyer needs. Website
silence is not proof of a missing product feature: say what the reviewed page does not
clearly explain, and recommend a precise content or public-presence improvement. Do
not tell the company to copy a competitor or invent capabilities it cannot verify.
The audited-company quote is the boundary of what you may claim. Address only the
part of the buyer need that this evidence positively supports; never import a
competitor-only capability into the audited company's action.
Use plain customer-friendly English. Preserve the bundle ID, improvement domain,
page IDs, and question IDs exactly. Return only the required JSON.
List every audited-company capability asserted by each action in capability_claims.
Do not omit a claim merely to avoid validation; each listed claim will be checked
against the audited-company passage.
""".strip()

FINAL_EVALUATOR_PROMPT = """
Audit the five written recommendations against their validated evidence bundles.

First extract and check every item in each recommendation's capability_claims. Return
one claim_check for every claim, using the exact same claim text. Mark it supported
only if the audited-company passage positively proves it, and copy the shortest exact
supporting passage. An empty or merely related passage is not support.

Pass an item only when its action is specific, within website or public-web presence,
supported by both cited pages, understandable to a customer, and faithful to the
buyer question. Fail claims that infer a missing product capability merely because a
reviewed page does not mention it. Also detect recommendations that solve the same
underlying problem or repeat the same buyer need.
Fail any action that describes, promises, or asks the company to market a capability
not positively supported by its audited-company quote and proof. Competitor evidence
may show a useful presentation pattern, but cannot prove product parity.
Do not rewrite recommendations and do not use outside knowledge. Return only JSON.
""".strip()

REPAIR_PROMPT = """
Repair only the failed recommendations using the supplied evaluator feedback and
their original validated bundles. Keep every bundle ID, page ID, and question ID
exactly. Do not alter or return passed recommendations. Make each repaired action
specific, evidence-supported, customer-friendly, and distinct. Narrow an action when
the audited-company evidence supports only part of the buyer need. Never import a
competitor-only capability. Update capability_claims so they list every capability
remaining in the repaired action. Return only JSON.
""".strip()

CAPABILITY_VERIFIER_PROMPT = """
Independently inspect one proposed website or public-presence action.

Extract every product feature, integration, workflow, data source, outcome, or other
audited-company capability that the action assumes is real. Phrases such as "explain
how", "show that", or "add content about" still assume the described capability.
Judge each extracted claim using only the supplied audited-company passage. Do not use
the recommendation's declared claim list, competitor facts, or outside knowledge.

Mark a claim supported only when the passage positively proves it. Copy a short exact
supporting passage for supported claims. If the action imports any unsupported
capability, safe must be false. Distinguish a capability asserted as real from one the
action explicitly says is absent or unsupported; a clearly negated capability is not
an imported claim. Return only JSON.
""".strip()
