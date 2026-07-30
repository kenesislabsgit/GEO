# MVP Implementation Plan

This plan splits the product into small build steps.  
We should finish and verify one step before moving to the next.

---

## Step 1: Website Crawler

### Build

Create a module that accepts one website URL and crawls the important public pages:

- Homepage
- About
- Product / Features
- Pricing
- FAQ
- Docs
- Blog
- Contact

Extract only deterministic data:

- Page title
- Meta description
- Headings
- Main text
- Navigation links
- Internal links
- Schema / JSON-LD
- Image alt text if useful

### End Goal

Given a URL, the tool should produce a clean `Website Snapshot` JSON file.

### Success Check

The snapshot should clearly show what content exists on the website without using any LLM.

---

## Step 2: Company Profile + Website Evidence

### Build

Use the website snapshot to generate two outputs:

1. A structured company profile using an LLM.
2. A website evidence file for later competitor comparison.

The company profile should include:

- Company name
- Category
- Target audience
- Industries
- Features
- Use cases
- Problems solved
- Unique value proposition
- Pricing model
- Keywords
- Core messaging

The website evidence file should include:

- Homepage headline
- Homepage subheadline
- Primary CTA
- Target audience clarity
- Industry clarity
- Use case pages found
- Feature pages found
- Pricing page found
- FAQ page found
- Documentation found
- Schema / JSON-LD found
- Comparison pages found
- Testimonials / case studies found
- Metadata quality
- Navigation clarity

### End Goal

The tool should produce:

- `company_profile.json`
- `website_evidence.json`

### Success Check

The company profile should explain what the company is.

The website evidence file should explain what can be compared against competitors.

Every field should be supported by website evidence. Missing information should be marked as `Unknown` or `Not found`.

---

## Step 2c: Competitor Seed Generation

Generate a small competitor seed list from `company_profile.json`.

This seed list is only a hypothesis.  
The final competitor list must still come from repeated AI recommendations.

### Build

Generate up to 10 probable competitors.

Each competitor should include:

- Company name
- Reason
- Confidence

### End Goal

The tool should produce `probable_competitors.json`.

### Success Check

The list should contain only companies that serve a similar customer need.

---

## Step 3: Customer Intent Prompts

### Build

Generate around 30 realistic customer questions based on the company profile.

Prompts should cover:

- Discovery
- Comparison
- Alternatives
- Industry-specific searches
- Problem-based searches
- Feature searches
- Pricing
- Beginner buyers
- Enterprise buyers

### End Goal

The tool should produce a list of realistic AI search prompts.

### Success Check

The prompts should sound like real customer questions, not SEO keywords.

---

## Step 4: AI Recommendation Collection

Initial implementation uses OpenAI only.

Claude and Gemini can be added later through the same result structure.

### Build

Send each customer prompt to:

- ChatGPT
- Claude later
- Gemini later

For every response, collect:

- Prompt
- Model
- Recommended companies
- Ranking order
- Reasoning
- Citations
- Source URLs
- Timestamp

### End Goal

The tool should produce raw recommendation results from all models.

### Success Check

For each prompt and model, we should know which companies were recommended and why.

---

## Step 5: Pattern Discovery

### Build

Aggregate the recommendation results.

Calculate:

- Mention frequency
- Average rank
- Number of models mentioning each company
- Citation frequency
- Source frequency

### End Goal

The tool should identify the top 3-5 recurring competitors.

### Success Check

The selected competitors should be based on repeated AI recommendations, not guesses.

---

## Step 6: Competitor Evidence Collection

### Build

Collect evidence for the top competitors.

Website evidence:

- Homepage positioning
- Use cases
- Feature pages
- Pricing
- FAQ
- Documentation
- Schema
- Comparison pages

External authority evidence:

- Review platforms
- Industry publications
- Developer docs
- GitHub
- Product Hunt
- News
- Blogs
- Reddit / communities

### End Goal

The tool should produce an evidence file for each top competitor.

### Success Check

Evidence should prioritize citations and sources found in AI responses.

---

## Step 7: User vs Competitor Comparison

### Build

Compare the user's company against the top competitors using a fixed checklist:

- Clear product explanation
- Clear target audience
- Industry focus
- Use cases
- Feature depth
- Pricing clarity
- Documentation
- FAQ
- Schema
- Comparison pages
- External mentions
- Reviews
- Trusted citations

### End Goal

The tool should produce a structured comparison report.

### Success Check

Every comparison point should be based on observable evidence.

---

## Step 8: Recommendation Engine

### Build

Generate prioritized recommendations.

Each recommendation must include:

- Observation
- Evidence
- Suggested change
- Expected impact
- Confidence

### End Goal

The tool should produce practical, evidence-backed recommendations.

### Success Check

No recommendation should be generic. Every recommendation must explain why it matters.

---

## Step 9: Final Report

### Build

Generate one professional audit report.

The report should include:

- Executive summary
- AI recommendation summary
- Top competitors
- Competitor patterns
- Website audit
- External authority audit
- Prioritized recommendations
- Suggested copy

### End Goal

The user receives a complete AI recommendation audit report.

### Success Check

The report should clearly answer:

- Does AI recommend this company?
- Who is recommended instead?
- Why do those competitors appear?
- What evidence supports this?
- What should the company change first?
- Why do those changes matter?

---

## Step 10: MVP Polish

### Build

Make the tool easier to run and review.

Add:

- Simple command to run an audit
- Clear output folders
- Example test website
- Error handling
- Basic cost controls
- README instructions

### End Goal

The MVP should be usable from start to finish with one website URL.

### Success Check

A full audit can run without manual intervention, and all outputs are saved clearly.
