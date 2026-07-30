# Phase 2 – MVP Technical Workflow & Implementation Specification

> **Purpose of this document**
>
> Phase 1 explained **why** this product exists.
>
> Phase 2 explains **exactly how the MVP should work**.
>
> This document specifies the complete workflow, the responsibility of each module, the exact order of execution, when LLMs should be used, when they should not be used, and what each stage should produce.
>
> The implementation should follow this document as closely as possible. Do not invent additional architecture unless it is necessary to support the workflow described here.

---

# 1. MVP Workflow

The MVP follows a fixed pipeline.

```
Website URL
        │
        ▼
Website Crawling
        │
        ▼
Website Snapshot
        │
        ▼
Company Profile Generation
        │
        ▼
Competitor Seed Generation
        │
        ▼
Customer Intent Generation
        │
        ▼
Run Prompts on ChatGPT
Claude
Gemini
        │
        ▼
Collect Recommendations
Reasoning
Citations
        │
        ▼
Aggregate Results
        │
        ▼
Identify Top Competitors
        │
        ▼
Collect Competitor Evidence
        │
        ▼
Compare User vs Competitors
        │
        ▼
Generate Recommendations
        │
        ▼
Generate Final Report
```

Every module has a single responsibility.

---

# 2. Input

The MVP accepts only one input.

```
Website URL
```

Example

```
https://company.com
```

No additional user information is required.

---

# 3. Module 1 – Website Crawling

## Goal

Understand the company using only publicly available information.

No LLM should be used during crawling.

---

## Pages to Crawl

Attempt to collect information from:

* Homepage
* About
* Product
* Features
* Pricing
* FAQ
* Documentation
* Blog
* Contact

If some pages do not exist,

continue normally.

---

## Information to Extract

Extract deterministically:

* Titles
* Meta descriptions
* H1-H6
* Structured Data
* Schema.org
* JSON-LD
* Navigation
* Internal Links
* Main textual content

Ignore:

* CSS
* JavaScript
* Images (except alt text if useful)

---

## Output

Produce a structured Website Snapshot.

This becomes the input to every later stage.

---

# 4. Module 2 – Company Profile Generation

This is the first LLM call.

The purpose is **not** summarization.

The purpose is to convert the Website Snapshot into structured business knowledge.

---

## System Prompt

```
You are an experienced business analyst.

Your task is to understand a company using the provided website snapshot.

Only extract information that is directly supported by the website.

Do not invent facts.

Do not guess.

Return structured information.

If information is missing, return Unknown.
```

---

## Output

Example

```
Company

Category

Target Audience

Industries

Features

Use Cases

Problems Solved

Unique Value Proposition

Pricing Model

Business Type

Product Type

Keywords

Core Messaging
```

The output should be machine-readable.

---

# 5. Module 3 – Competitor Seed Generation

Purpose

Generate an initial understanding of who the likely competitors are.

This list is only a hypothesis.

It is NOT the final competitor list.

---

## Why this exists

Without context,

later comparisons become weaker.

This gives the system an initial market understanding.

---

## System Prompt

```
You are a market research analyst.

Given this company profile,

identify the companies that most likely compete in the same market.

Return only companies that genuinely compete.

Explain briefly why each competitor belongs in the list.

Do not include companies unless they serve a similar customer need.
```

---

## Output

```
Top 10 probable competitors

Reason

Confidence
```

---

# 6. Module 4 – Customer Intent Generation

Goal

Generate realistic prompts that actual customers would ask AI assistants.

These prompts simulate real buying behaviour.

---

## Why only around 30 prompts?

More prompts dramatically increase API cost.

After roughly thirty high-quality prompts,

recommendation patterns become relatively stable for most product categories.

Therefore,

the MVP should generate approximately 30 prompts.

Quality is more important than quantity.

---

## Categories

Ensure prompts cover

Discovery

Comparison

Alternatives

Industry

Problem

Features

Pricing

Beginner

Enterprise

Decision-making

---

## System Prompt

```
You are an expert UX researcher and user research analyst.

Generate realistic prompts that actual customers would ask ChatGPT, Claude or Gemini when searching for products like this company.

These should sound like natural human questions.

Do NOT generate SEO keywords.

Do NOT generate artificial prompts.

Cover multiple buying stages.

Return only the prompts.
```

---

## User Prompt

Provide the structured Company Profile.

---

## Output

Approximately thirty prompts.

---

# 7. Module 5 – AI Recommendation Collection

This is the core of the MVP.

Every generated prompt will be sent to

* ChatGPT
* Claude
* Gemini

using the same System Prompt.

---

## Why use a System Prompt?

Without one,

each model behaves differently.

Using a fixed system prompt reduces unnecessary variation.

This creates more consistent comparisons.

---

## Fixed System Prompt

```
You are acting as a neutral assistant helping a customer choose software.

Recommend the companies you genuinely believe best satisfy the user's request.

Do not intentionally diversify recommendations.

If web grounding or search is available, use it.

Include citations or referenced sources whenever available.

Rank recommendations naturally.

Do not attempt to include any company unless it genuinely deserves to appear.
```

---

## User Prompt

One generated customer question.

Example

```
Best factory monitoring software for manufacturing companies
```

---

## Store

For every response collect

Prompt

Model

Recommended Companies

Ranking Order

Reasoning

Citations

Source URLs

Timestamp

---

# 8. Module 6 – Pattern Discovery

After all prompts finish,

aggregate everything.

Calculate

Mention Frequency

Average Rank

Number of Models mentioning

Citation Frequency

Source Frequency

---

Example

```
Competitor A

Appeared

26

Average Rank

1.7

Models

ChatGPT

Claude

Gemini

Sources

Official Docs

G2

Reddit
```

Now identify

Top 3–5 recurring competitors.

These become the comparison set.

---

# 9. Module 7 – Competitor Evidence Collection

This stage answers

Why are these companies repeatedly recommended?

Collect evidence from two categories.

---

## A. Website Evidence

Collect

Homepage positioning

Use Cases

Feature Pages

Pricing

FAQ

Documentation

Comparison Pages

Schema

Structured Data

Content Quality

Machine Readability

---

## B. External Authority Evidence

Collect

Review Platforms

Industry Publications

Developer Documentation

GitHub

Product Hunt

News

Blogs

Communities

Reddit

Third-party Mentions

---

## Important Rule

Whenever the LLM response contains citations,

prioritize those sources.

Those citations are stronger evidence than random internet searches.

---

# 10. Module 8 – Comparison Engine

Now compare

User Company

vs

Top Competitors

using a fixed checklist.

---

## Website Comparison

Does homepage clearly explain

What the product is?

Who it serves?

Which industry?

Main value?

Use cases?

Features?

Pricing?

Documentation?

FAQ?

Schema?

Comparison pages?

---

## Authority Comparison

Does the company have

Reviews?

Community mentions?

Documentation?

Industry references?

Trusted citations?

Developer presence?

---

Every comparison should reference observable evidence.

Never rely on assumptions.

---

# 11. Module 9 – Recommendation Engine

This is the most important module.

Every recommendation must contain five sections.

---

## Observation

What is missing?

---

## Evidence

Why do we believe this matters?

Reference competitors.

Reference citations.

Reference patterns.

---

## Suggested Change

Provide exact improvements.

Whenever possible,

generate replacement copy.

Example

Current Hero

↓

Suggested Hero

---

## Expected Impact

Explain why the change improves discoverability.

Never promise rankings.

---

## Confidence

High

Medium

Low

Confidence should depend on

How consistently the pattern appeared across

Models

Prompts

Competitors

Evidence

---

# 12. Module 10 – Final Report

Generate one professional report.

---

## Executive Summary

Overall findings.

---

## AI Recommendation Summary

Per model

Mention frequency

Competitors

Observations

---

## Competitor Analysis

Top competitors

Patterns

Shared strengths

---

## Website Audit

Homepage

Positioning

Use Cases

FAQ

Documentation

Schema

Navigation

Content

---

## External Authority Audit

Reviews

Communities

Publications

Developer Presence

Citations

---

## Prioritized Recommendations

Every recommendation should include

Observation

Evidence

Suggested Fix

Expected Impact

Confidence

---

## Suggested Copy

Generate copy that users can directly use.

Examples

Homepage Hero

Meta Description

FAQ

Feature Description

Comparison Page Outline

---

# 13. MVP Constraints

The MVP should intentionally avoid

Authentication

Database optimization

Background workers

Multi-user support

Analytics

Historical reports

Scheduling

Subscriptions

Weekly scans

Monitoring

These belong to later versions.

---

# 14. Development Philosophy

When implementing every module,

follow these principles.

Use deterministic programming whenever possible.

Use LLMs only for reasoning.

Never perform expensive LLM operations if traditional code can solve the task.

Keep API calls minimal.

Prioritize evidence over assumptions.

Never make unsupported claims.

Every recommendation must explain

What

Why

Evidence

Suggested Change

Expected Impact

Confidence

---

# Phase 2 Exit Criteria

The MVP implementation should be considered complete when it can successfully:

* Accept a website URL.
* Crawl and understand the company.
* Generate a structured company profile.
* Generate realistic customer search prompts.
* Query ChatGPT, Claude and Gemini using standardized system prompts.
* Collect recommendations, reasoning and citations.
* Aggregate recurring competitors and identify patterns.
* Gather website and external authority evidence for the top competitors.
* Compare the user's company against those competitors using a consistent rubric.
* Generate evidence-backed recommendations with concrete examples.
* Produce a professional audit report that explains **why competitors are recommended and what the user can do to improve their chances of being recommended by AI systems.**

If every one of these objectives is met, the MVP should be considered functionally complete. Future versions can then focus on scalability, automation, historical tracking, caching, dashboards, authentication and other production features without changing the core product workflow.
