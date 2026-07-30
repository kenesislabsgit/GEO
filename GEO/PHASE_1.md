# Phase 1 – Project Understanding & Product Vision (MVP)

> **Purpose of this document**
>
> This phase is **not** about implementation. It exists to make the development agent (Codex) completely understand **what product is being built, why it exists, what problem it solves, what success looks like, and what should NOT be built in the MVP.**
>
> No coding decisions should be made in this phase. This phase establishes the vision and constraints that every implementation decision in later phases must follow.

---

# 1. Project Overview

We are building an **AI Recommendation Audit Platform**.

This is **not** an SEO tool.

This is **not** an AI ranking manipulation tool.

This is **not** a website optimization tool in the traditional sense.

Instead, this tool helps businesses answer one simple but increasingly important question:

> **"When people ask ChatGPT, Claude or Gemini for products like mine, why is my company not being recommended?"**

The purpose of the product is to answer that question with evidence instead of assumptions.

---

# 2. Why This Product Exists

The way users discover products is changing.

Instead of searching Google and opening multiple websites, users increasingly ask AI assistants questions such as:

* Best CRM software
* Best AI coding assistant
* Best project management tool
* Best attendance software for factories
* Best cybersecurity platform
* Best accounting software for startups

The AI assistant immediately recommends several companies.

Businesses are beginning to notice a new problem:

> Their competitors are consistently recommended while their own company is missing.

Today, there is almost no tool that explains why.

Traditional SEO tools explain:

* backlinks
* page speed
* meta tags
* keywords

Those tools do **not** explain AI recommendations.

Therefore businesses have no visibility into:

* whether AI recommends them
* who AI recommends instead
* why those competitors were selected
* what patterns exist among recommended companies
* what changes are most likely to improve AI understanding

This product fills that gap.

---

# 3. The Core Problem We Are Solving

The actual problem is **not**

> "How do I rank #1 in ChatGPT?"

Nobody outside the AI providers can answer that honestly.

The real problem is:

> Businesses cannot understand why AI systems recommend competing companies instead of them.

Everything we build in this MVP should contribute toward solving this problem.

---

# 4. Our Goal

The final output of the product should answer these questions:

### Question 1

Does AI recommend my company?

---

### Question 2

If not,

which companies are recommended instead?

---

### Question 3

Why do those companies appear repeatedly?

---

### Question 4

What evidence supports those conclusions?

---

### Question 5

What exactly should I change?

---

### Question 6

Why do we believe those changes matter?

---

If our report answers all six questions clearly, then the MVP has achieved its goal.

---

# 5. Product Philosophy

Every recommendation must be backed by evidence.

Never generate generic advice.

Bad recommendation:

> Improve your homepage.

Good recommendation:

> Four of the five most frequently recommended competitors clearly identify their target audience in the first section of their homepage. Your homepage never specifies who the product is designed for.

Evidence should always come before recommendations.

---

# 6. What We Are NOT Building

To keep the MVP focused, the following are explicitly out of scope.

* User authentication
* Teams
* Multi-user collaboration
* Historical tracking
* Weekly monitoring
* Email reports
* Dashboards
* AI visibility trend graphs
* Large-scale competitor databases
* Database optimization
* Background workers
* Billing
* Subscription management
* Browser extensions
* Chrome plugins

Those features belong in future versions.

---

# 7. MVP Objective

The MVP has one job.

Input:

A company website.

Output:

A professional report explaining:

* why competitors are recommended
* what patterns exist
* what evidence supports those patterns
* what improvements the company should make

Nothing more.

---

# 8. High-Level Workflow

The MVP follows a simple reasoning pipeline.

```
Website URL

↓

Understand the company

↓

Generate realistic customer questions

↓

Ask multiple AI assistants

↓

Collect recommended companies

↓

Collect evidence and citations

↓

Identify recurring competitors

↓

Compare the user's company against those competitors

↓

Generate an evidence-backed audit

↓

Produce the final report
```

Every phase after this document exists to implement one part of this pipeline.

---

# 9. Fundamental Principles

These principles must never be violated.

## Principle 1 — Evidence First

Every recommendation must reference observable evidence.

Never recommend something simply because it sounds like a good SEO practice.

---

## Principle 2 — No Guessing

If evidence does not exist,

do not invent conclusions.

The report should clearly distinguish between:

* observed facts
* reasonable inferences
* unknown information

---

## Principle 3 — Honesty

Never claim:

> "This change will make ChatGPT recommend you."

Instead say:

> "This change improves how clearly your product is described and aligns your website with patterns observed among frequently recommended competitors."

---

## Principle 4 — Deterministic First

Whenever possible,

use traditional programming instead of LLMs.

Examples:

Good uses of deterministic code:

* HTML parsing
* Schema detection
* Metadata extraction
* Heading extraction
* Internal links
* Navigation
* Sitemap parsing

Good uses of LLMs:

* Understanding business positioning
* Generating customer search intent
* Explaining observed differences
* Writing suggested content

---

## Principle 5 — Cost Awareness

API calls should be minimized.

Every unnecessary LLM request increases operational cost.

The MVP should only use LLMs where genuine reasoning is required.

---

# 10. What Makes This Product Different

This product does not ask:

> "How many backlinks do you have?"

Instead it asks:

> "Why did AI trust your competitors?"

That difference is the foundation of the entire platform.

Everything should revolve around discovering the reasons behind AI recommendations rather than measuring traditional SEO metrics.

---

# 11. What Success Looks Like

At the end of an analysis, a business owner should be able to say:

* I know whether AI recommends my company.
* I know who my AI competitors are.
* I understand why those competitors appear repeatedly.
* I can see evidence supporting those conclusions.
* I know exactly what changes I should make first.
* I have example content that I can directly use.

If the product achieves these outcomes consistently, then it has fulfilled its purpose.

---

# 12. MVP Boundaries

This project intentionally focuses on solving one problem exceptionally well.

We are **not** trying to build another SEO platform.

We are **not** trying to reverse engineer proprietary AI ranking algorithms.

We are **not** trying to guarantee inclusion in AI responses.

Instead, we are building an **AI Recommendation Audit Tool** that uses observable evidence, repeated AI sampling, and competitor comparison to explain why some companies are consistently recommended and to provide practical, evidence-backed improvements.

Every implementation decision in the following phases must support this single objective.

---

# End of Phase 1

**Phase 1 Exit Criteria**

Before moving to implementation, the development agent should understand:

* The exact problem the product solves.
* The difference between SEO and AI recommendation auditing.
* The scope of the MVP.
* The guiding principles of the product.
* What the final report must accomplish.
* What is intentionally excluded from the MVP.
* The high-level workflow that later phases will implement.

Only after these concepts are fully understood should development proceed to **Phase 2**, where the complete technical workflow, system prompts, LLM interactions, data flow, and implementation details will be specified.
