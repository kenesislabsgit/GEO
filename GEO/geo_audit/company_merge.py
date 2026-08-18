"""One company, one count - merging the spellings the assistants used.

The analyzer records each recommended company exactly as the answer wrote it,
and different assistants spell the same company differently. Counting by
spelling then splits one competitor into several: a real audit reported its top
competitor at 34 mentions when Otter.ai, Otter, Otter Voice Notes and
Otter.ai Business together had 48 - and the split names crowd real competitors
out of the top-N list that decides who gets investigated.

No single analyzer call can fix this: analysis runs in parallel batches, and
the full list of names first exists only when they are all done. So this is
one extra call at that moment. Whether two names are the same company is a
judgement call, which makes it AI's; the AI only groups, and code verifies -
every returned name must exist, no name in two groups, no group touching the
audited company itself.

The two mistakes are not equal. A missed merge leaves the count where it is
today; a wrong merge invents a fact no answer contains. Everything here leans
the same way: the model is told to keep doubtful names separate, and a group
that fails verification simply does not merge.

Answers themselves are never rewritten - "recommended_instead" and the prompt
outcomes keep each answer's own spelling. The merge exists only where answers
are counted against each other.
"""

from __future__ import annotations

import json
from typing import Any

from .llm import (
    LLMNotConfigured,
    build_chat_payload,
    call_chat_completion,
    call_chat_message,
)
from .json_tools import extract_json_object


COMPANY_MERGE_SYSTEM_PROMPT = """\
WHY THIS JOB EXISTS

A company is paying us to find out how often AI assistants recommend it, and
which rivals get recommended in its place. We asked several AI assistants the
same buyer questions and wrote down every company each one recommended, in the
assistant's own words.

Those words are the problem. One product gets written many different ways
across the answers. Counted as written, a single rival is split into four small
numbers, its real standing disappears, and four genuine rivals get pushed off
the customer's report. The customer then reads a false picture of who they are
losing to.

YOUR JOB

Turn that list of spellings into a list of products. Group the spellings that
are one product. Leave apart the ones that are not.

Every group you get right restores a rival to its true size. Every group you
get wrong invents a fact no assistant ever said, and it goes straight into a
paying customer's report. Be sure before you group.

WHAT YOU ARE GIVEN

For every distinct spelling: the spelling itself, how many times it was
recommended, the reasons the assistants gave for recommending it, and any links
they cited.

You are also told who the paying customer is: their name, their web address,
and the ways their own website writes their name.

THE CUSTOMER'S OWN NAME

Group the customer's spellings too, under "customer_group". This is the number
the customer checks first, so it is the one that must be right.

Read this part twice. "customer_group" holds spellings taken from the list of
names the assistants used - the same list every other group comes from. It does
NOT hold the names copied from the customer's own website. Those are given to
you only so you can recognise which of the assistants' spellings are the
customer. Copying them back is not an answer; if the assistants never named the
customer, the right reply is an empty list.

The customer never appears in "groups". Their spellings go in
"customer_group" and nowhere else.

The customer may not be in the list at all. Assistants often recommend nobody
from the customer's own company, and that is a real and useful answer - it is
the finding the customer is paying to hear. So first ask whether any spelling
in the list is the customer. If none is, return an empty list and move on. Do
not reach for the closest name to fill the gap.

The bar here is higher than anywhere else. Add a name only when you are certain
it is the customer - it matches a name from their own site, or a search shows
that name belongs to their web address. A rival wrongly counted as the customer
inflates the one figure the whole report rests on.

If a name merely looks like the customer's, search it. If the search does not
put that name at the customer's web address, leave it out. Being unsure means
leaving it out.

Never put a name in both the customer's group and an ordinary group.

YOUR TOOL

You have search_the_web. Use it whenever the reasons and links in front of you
do not settle a pair. Do not guess and do not reason from the spelling - go and
look. Searching is cheap. A wrong merge is not. Search as many times as you
need, and search again with different wording if the first result says nothing
useful.

HOW TO DECIDE

Work in this order for every pair you are tempted to group:

1. Read the names. Note which ones look related.
2. Then read their reasons, and only then decide. The reasons describe what
   each one actually does, so they - not the spelling - settle it. Some names
   are just the maker with no product attached. When that maker's reasons keep
   describing one particular product, group it onto that product's name.
3. Now answer ONE question, and answer it from the reasons and links, never
   from how the names look:

   Is this ONE product written two ways, or are these TWO different products?

   One product written two ways -> group them. It does not matter how far
   apart the two spellings look.

   Two different products -> leave them apart. It does not matter that the
   same company makes both, that the names share almost every word, or that
   both do the same kind of job. Rival tools are routinely described the same
   way; that makes them competitors in one category, not one product.

4. You have THREE pieces of evidence in front of you for each name: the name,
   the reasons, and the links. Group on them alone ONLY when all three point
   the same way and none of them contradicts the others. That is a high bar,
   and it is meant to be. Names alone never clear it. Two names doing the same
   kind of work never clear it.

   The moment any one of the three leaves you unsure - a missing link, a
   reason too vague to identify a product, two names that could plausibly be
   one thing or two - STOP and use search_the_web. Do not reason your way
   past a gap in the evidence. Go and get the missing evidence.

   Only after the search comes back do you decide which list the pair belongs
   in. Deciding first and searching afterwards is how a wrong merge gets made.

5. If you have searched and still cannot tell, leave the names apart. A missed
   grouping is recoverable; a wrong one is not.

Before anything below, the two rules that outrank all of it:

  Three pieces of evidence - name, reasons, links. If all three agree, decide.
  If even one of them leaves a gap, SEARCH before you decide. Never fill a gap
  with reasoning about the spelling.

  The customer's group takes only spellings the assistants actually used, and
  only ones you are certain are the customer. Never copy in a name from the
  customer's own website. Never stretch a near-miss to fill the group. If no
  spelling in the list is the customer, the group is empty, and an empty group
  is a correct answer - not a failure to find something.

Nothing below overrides question 3 or the rule above. These only help you
answer it:

- The maker's name is not part of the product. Adding it, dropping it, or
  moving it changes the spelling, not the product.
- A company's everyday name and its full registered name are one company.
- Suffixes like .ai/.com/.io, nicknames, and plan tiers ("X Business" is X)
  are the same product.
- Two different official web addresses mean two different companies.
- The SAME web address proves the same maker. It does not prove the same
  product - one company sells many products from one site. When two names
  share an address but their reasons describe different work, that is a reason
  to search, not a reason to group.
- A search result can say outright that one name is now known by the other, or
  that one is the other's full or shortened name. That settles it.
- "canonical" must be copied EXACTLY from the input names - pick the most
  official-looking spelling. Never invent or edit a name.
- Every name may appear in AT MOST one group, as canonical or variant, never
  both and never twice.

Return only JSON:

{"groups": [{"canonical": "...", "variants": ["..."],
             "why": "what made you sure these are one product",
             "evidence": "the reason line or the search result you relied on"}],
 "customer_group": {"variants": ["..."],
                    "why": "how you know each of these is the customer",
                    "evidence": "the customer's own name list, or the search"},
 "left_apart": [{"names": ["...", "..."],
                 "why": "what makes these two different products"}]}

Put in "customer_group" only spellings of the paying customer, and leave the
list empty when the assistants never named them. Never put the customer's name
in "groups".

List in "groups" only groups with at least one variant. Names you leave out
stay as they are.

"left_apart" holds pairs you decided are DIFFERENT products and must not be
grouped. That is the only thing it holds. It is not a notes field: never put a
pair there to explain that you grouped them, or to record where a name ended
up. A pair listed there is treated as different and is never merged, so a note
written there quietly destroys a correct grouping.

Name the pairs that looked alike and say what separated them.

A name in "customer_group" belongs only there. Never repeat it in "groups" or
in "left_apart".

The two lists are opposites. A pair belongs in exactly one of them. Putting a
pair in "groups" while also listing it in "left_apart" - or writing a "why"
that says the two names are different products - is a self-contradiction, and
the whole group is thrown away when that happens. Read your own "why" back
before you send it: if it says they are different, the pair goes in
"left_apart".

"why" and "evidence" are read by a person. If your evidence is a search
result, quote the part of it you used.
"""


def normalize_company_name(value: str) -> str:
    return " ".join(str(value).lower().split())


# Enough reasons to identify a name, not so many that a popular name drowns
# the rest of the list.
MAX_REASONS_PER_NAME = 4


def collect_name_rows(raw_results: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Distinct spellings with counts, the reasons assistants gave, and links
    where they exist, so the model can tell two genuinely different companies
    with similar names apart.

    Every distinct reason travels, not the first one. "Google" was recommended
    four times: the first reason read "learns the user's preferences", and the
    other three said "integrated into Google Docs" outright. Sampling one
    reason sent the only line that identified nothing and hid the three that
    settled it - and the merge guessed a different Google product each run.
    """
    rows: dict[str, dict[str, Any]] = {}
    for result in raw_results:
        for item in result.get("recommended_companies", []) or []:
            name = str(item.get("company_name", "") or "").strip()
            if not name:
                continue
            key = normalize_company_name(name)
            row = rows.setdefault(
                key,
                {"name": name, "times_recommended": 0, "reasons": [], "urls": []},
            )
            row["times_recommended"] += 1
            reason = " ".join(str(item.get("reasoning", "") or "").split())[:200]
            if (
                reason
                and reason not in row["reasons"]
                and len(row["reasons"]) < MAX_REASONS_PER_NAME
            ):
                row["reasons"].append(reason)
            for url in item.get("source_urls", []) or []:
                clean = clean_source_url(url)
                if clean and clean not in row["urls"] and len(row["urls"]) < 2:
                    row["urls"].append(clean)
    ordered = sorted(rows.values(), key=lambda r: -r["times_recommended"])
    for row in ordered:
        if not row["urls"]:
            del row["urls"]
        if not row["reasons"]:
            del row["reasons"]
    return ordered


def clean_source_url(value: Any) -> str | None:
    """A link only helps if it shows whose site it is.

    Two kinds arrived useless: a link whose text and address had been squashed
    together by markdown, carrying "](" in the middle, and provider redirect
    links that hide the real address behind a tracking host. Both cost payload
    and identify nobody.
    """
    url = str(value or "").strip()
    if not url or "](" in url or " " in url:
        return None
    if not url.startswith(("http://", "https://")):
        return None
    host = url.split("/", 3)[2].lower() if url.count("/") >= 2 else ""
    if "grounding-api-redirect" in url or host.endswith("vertexaisearch.cloud.google.com"):
        return None
    return url


def drop_self_contradictions(
    groups: Any,
    left_apart: Any,
) -> tuple[list[Any], list[dict[str, Any]]]:
    """A pair the model itself called different never merges.

    Asked to return both its merges and the pairs it decided against, the model
    put Sonix and Soniox in both lists in the same reply - and the reason it
    gave for merging them read "they are different companies/products". It had
    the right answer and filed it in the wrong place. Rather than argue with it,
    the contradiction is simply resolved against merging, which is the safe
    direction: a missed merge leaves counts where they are, a wrong one invents
    a fact.
    """
    apart: set[frozenset[str]] = set()
    for item in left_apart if isinstance(left_apart, list) else []:
        if not isinstance(item, dict):
            continue
        names = [
            normalize_company_name(n)
            for n in (item.get("names") or [])
            if str(n or "").strip()
        ]
        for index, first in enumerate(names):
            for second in names[index + 1 :]:
                if first != second:
                    apart.add(frozenset((first, second)))

    kept: list[Any] = []
    contradictions: list[dict[str, Any]] = []
    for group in groups if isinstance(groups, list) else []:
        if not isinstance(group, dict):
            continue
        members = [
            str(m).strip()
            for m in [group.get("canonical"), *(group.get("variants") or [])]
            if str(m or "").strip()
        ]
        keys = [normalize_company_name(m) for m in members]
        clashes = [
            sorted((first, second))
            for index, first in enumerate(keys)
            for second in keys[index + 1 :]
            if frozenset((first, second)) in apart
        ]
        if clashes:
            contradictions.append(
                {
                    "group": members,
                    "reason": "it listed this pair as different in left_apart",
                    "pairs": clashes,
                }
            )
            continue
        kept.append(group)
    return kept, contradictions


def verify_groups(
    groups: Any,
    known_names: set[str],
    user_keys: set[str],
) -> tuple[dict[str, str], list[dict[str, Any]]]:
    """Code's half of the bargain. Returns (aliases, rejected) where aliases
    maps normalized variant -> canonical display spelling. A rejected group is
    not an error state - it just does not merge."""
    known = {normalize_company_name(n) for n in known_names}
    used: set[str] = set()
    aliases: dict[str, str] = {}
    rejected: list[dict[str, Any]] = []
    for group in groups if isinstance(groups, list) else []:
        if not isinstance(group, dict):
            continue
        canonical = str(group.get("canonical", "") or "").strip()
        # One name written twice inside one group is a slip of the pen, not a
        # contradiction. Treating it as "this name is in two groups" threw away
        # whole correct groups over a repeated word.
        variants = []
        seen_in_group = {normalize_company_name(canonical)}
        for value in group.get("variants") or []:
            name = str(value).strip()
            key = normalize_company_name(name)
            if not name or key in seen_in_group:
                continue
            seen_in_group.add(key)
            variants.append(name)
        if not canonical or not variants:
            continue
        # An invented canonical would put a name on the report that no answer
        # ever contained - reject the group. An invented variant is inert (no
        # answer spells it that way, so it can never match at count time):
        # drop just that name and keep the group, rather than losing a dozen
        # good merges to one reworded spelling.
        if normalize_company_name(canonical) not in known:
            rejected.append(
                {"group": [canonical, *variants], "reason": "invented canonical name"}
            )
            continue
        unknown = [v for v in variants if normalize_company_name(v) not in known]
        if unknown:
            rejected.append({"group": unknown, "reason": "unknown variant dropped"})
            variants = [v for v in variants if normalize_company_name(v) in known]
            if not variants:
                continue
        members = [canonical, *variants]
        keys = [normalize_company_name(m) for m in members]
        if len(set(keys)) != len(keys) or any(k in used for k in keys):
            rejected.append({"group": members, "reason": "name in two groups"})
            continue
        # The audited company's own counting has its own alias rules; a merge
        # that folds a competitor into the user - or the user into a
        # competitor - would corrupt the mention count, the one number the
        # report must never get wrong.
        if any(k in user_keys or any(k.startswith(f"{u} ") for u in user_keys) for k in keys):
            rejected.append({"group": members, "reason": "touches the audited company"})
            continue
        used.update(keys)
        for variant in variants:
            aliases[normalize_company_name(variant)] = canonical
    return aliases, rejected


def verify_customer_group(
    customer_group: Any,
    left_apart: Any,
    known_names: set[str],
    user_company: str | None,
) -> tuple[dict[str, str], list[dict[str, Any]]]:
    """The audited company's own spellings, checked harder than any other group.

    A rival wrongly counted as the customer inflates the single number the whole
    report rests on, so this leans further towards refusing than the competitor
    groups do: an unknown name is dropped, and a name the model itself listed as
    a different product anywhere in left_apart is dropped even if it also put it
    here.
    """
    canonical = str(user_company or "").strip()
    if not canonical or not isinstance(customer_group, dict):
        return {}, []

    known = {normalize_company_name(n) for n in known_names}
    apart: set[str] = set()
    for item in left_apart if isinstance(left_apart, list) else []:
        if not isinstance(item, dict):
            continue
        names = [normalize_company_name(n) for n in (item.get("names") or [])]
        if normalize_company_name(canonical) in names:
            apart.update(n for n in names if n != normalize_company_name(canonical))

    aliases: dict[str, str] = {}
    rejected: list[dict[str, Any]] = []
    for value in customer_group.get("variants") or []:
        name = str(value).strip()
        key = normalize_company_name(name)
        if not key or key == normalize_company_name(canonical):
            continue
        if key not in known:
            rejected.append({"group": [name], "reason": "customer name nobody used"})
            continue
        if key in apart:
            rejected.append(
                {
                    "group": [name],
                    "reason": "it also called this a different product",
                }
            )
            continue
        aliases[key] = canonical
    return aliases, rejected


# The vote was invented when the merge had no facts to work from: three runs
# agreeing was the only measure of doubt available. It is now one agent that
# can look things up, so agreement with itself measures nothing, and every
# extra round is another set of searches billed for the same question.
MERGE_VOTES = 1


def generate_company_aliases(
    raw_results: list[dict[str, Any]],
    user_company: str | None,
    user_aliases: list[str] | None = None,
    search_client: Any | None = None,
    category_hint: str | None = None,
    user_domain: str | None = None,
) -> tuple[dict[str, str], dict[str, Any], str | None]:
    """Returns (aliases, artifact, error). Any failure returns empty aliases:
    the audit carries on with today's per-spelling counts rather than dying.

    The audited company's own spellings are grouped here too. They used to be
    excluded, which left every later step deciding for itself whether a name
    was the customer - and the counting step accepted anything starting with
    the company name while the export accepted only an exact match, so one
    spelling could be the customer in the numbers and a stranger in the
    answers. Deciding once, where the evidence and the search tool are, is the
    only way those two can agree.
    """
    rows = collect_name_rows(raw_results)
    artifact: dict[str, Any] = {"input": rows}
    if len(rows) < 2:
        return {}, artifact, None

    user_keys = {
        normalize_company_name(v)
        for v in [user_company, *(user_aliases or [])]
        if v and str(v).strip()
    }
    known = {row["name"] for row in rows}
    customer: dict[str, Any] = {
        "name": user_company or "",
        "web_address": user_domain or "",
        "their_own_site_writes_it_as": [
            v for v in (user_aliases or []) if v and str(v).strip()
        ],
    }
    question = json.dumps(
        {
            "buyers are shopping for": category_hint or "",
            "the paying customer": customer,
            "names": rows,
        },
        separators=(",", ":"),
        ensure_ascii=False,
    )
    artifact["question"] = question

    votes: list[dict[str, str]] = []
    artifact["rounds"] = []
    for _round in range(MERGE_VOTES):
        payload = build_chat_payload(
            COMPANY_MERGE_SYSTEM_PROMPT,
            question,
            temperature=0,
            json_response=True,
        )
        searches: list[dict[str, Any]] = []
        try:
            if search_client is not None:
                payload["tools"] = [SEARCH_TOOL]
                raw, searches = answer_with_search(payload, search_client)
            else:
                raw = call_chat_completion(payload)
        except LLMNotConfigured as exc:
            return {}, artifact, str(exc)
        response = extract_json_object(raw)
        groups = response.get("groups") if isinstance(response, dict) else None
        left_apart = (
            response.get("left_apart") if isinstance(response, dict) else None
        )
        groups, contradictions = drop_self_contradictions(groups, left_apart)
        customer_group = (
            response.get("customer_group") if isinstance(response, dict) else None
        )
        customer_aliases, customer_rejected = verify_customer_group(
            customer_group, left_apart, known, user_company
        )
        round_aliases, rejected = verify_groups(groups, known, user_keys)
        round_aliases.update(customer_aliases)
        votes.append(round_aliases)
        artifact["rounds"].append(
            {
                "groups_returned": groups,
                "customer_group": customer_group,
                "customer_aliases": customer_aliases,
                "left_apart": left_apart,
                "contradicted_itself": contradictions,
                "searches_it_ran": searches,
                "rejected": [*rejected, *customer_rejected],
                "aliases": round_aliases,
            }
        )

    aliases = unanimous_aliases(votes)
    artifact["dropped_for_disagreement"] = sorted(
        {
            f"{variant} -> {canonical}"
            for vote in votes
            for variant, canonical in vote.items()
            if aliases.get(variant) != canonical
        }
    )
    artifact["aliases"] = aliases
    return aliases, artifact, None


SEARCH_TOOL = {
    "type": "function",
    "function": {
        "name": "search_the_web",
        "description": (
            "Search the web. Returns page addresses, titles and one-line "
            "descriptions. Use it whenever you are not sure whether two names "
            "are one product or two, instead of guessing."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "What to look up.",
                }
            },
            "required": ["query"],
            "additionalProperties": False,
        },
    },
}

# The model gets to search until it has what it needs, but a runaway loop
# would spend real money on searches. Past this many the tool is withdrawn and
# it must answer with what it has - and the prompt says an unresolved group is
# a reject, so running out of searches leaves the names apart.
MAX_SEARCHES = 10
MAX_SEARCH_TURNS = 6


def answer_with_search(
    payload: dict[str, Any],
    search_client: Any,
) -> tuple[str, list[dict[str, Any]]]:
    """Run the model until it stops asking for searches, then return its text.

    A fixed lookup done before the call can only answer questions we thought of
    in advance. Handing over the search itself lets the model ask the question
    it actually has - "are these two Dragon editions the same product" - which
    is not a question about either name on its own.

    The tool description carries no worked example on purpose. An example named
    the very pair the run was about, and the model searched it back almost word
    for word - which measured the example, not the model.
    """
    messages = payload["messages"]
    searches: list[dict[str, Any]] = []
    message: dict[str, Any] = {}
    for _turn in range(MAX_SEARCH_TURNS):
        message = call_chat_message(payload)
        calls = message.get("tool_calls") or []
        if not calls:
            return str(message.get("content") or ""), searches
        messages.append(
            {
                "role": "assistant",
                "content": message.get("content"),
                "tool_calls": calls,
            }
        )
        for call in calls:
            query = ""
            try:
                query = str(
                    json.loads((call.get("function") or {}).get("arguments") or "{}")
                    .get("query", "")
                ).strip()
            except (TypeError, ValueError):
                query = ""
            found = run_search(query, search_client) if query else {"results": []}
            searches.append({"query": query, **found})
            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": call.get("id"),
                    "content": json.dumps(found, ensure_ascii=False),
                }
            )
        if len(searches) >= MAX_SEARCHES:
            payload.pop("tools", None)
            break
    return str(call_chat_message(payload).get("content") or ""), searches


def run_search(query: str, search_client: Any) -> dict[str, Any]:
    """One search, shaped for the model: address, title, description."""
    try:
        response = search_client.search(query, max_results=4)
    except Exception as exc:  # noqa: BLE001 - a failed search must not stop the audit.
        return {"error": str(exc), "results": []}
    rows = response.get("results", []) if isinstance(response, dict) else response or []
    return {
        "results": [
            {
                "url": str(row.get("url", "")),
                "title": str(row.get("title", ""))[:120],
                "description": str(row.get("snippet") or row.get("body") or "")[:250],
            }
            for row in rows[:4]
        ]
    }


def unanimous_aliases(votes: list[dict[str, str]]) -> dict[str, str]:
    """Keep a grouping only when every round produced exactly it - same name,
    same group. One round hesitating is enough to leave the name alone."""
    if not votes:
        return {}
    agreed = set(votes[0].items())
    for vote in votes[1:]:
        agreed &= set(vote.items())
    return dict(agreed)
