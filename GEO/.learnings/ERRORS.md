# Errors

## [ERR-20260724-001] dotenv-test-isolation

**Logged**: 2026-07-24T04:46:00+05:30
**Priority**: medium
**Status**: resolved
**Area**: tests

### Summary
The web-presence no-fallback test loaded the real Gateway URL from `.env`.

### Error
```text
AssertionError: fallback_queries was 3 instead of 0
```

### Context
- `collect_web_presence()` calls `load_dotenv()`.
- Clearing `os.environ` in the test was insufficient because the function
  repopulated environment variables from the project `.env`.
- The test attempted real AgentCore network calls after mocked DDGS returned no
  results.

### Suggested Fix
Mock `geo_audit.web_presence.load_dotenv` in tests that require an isolated
environment.

### Metadata
- Reproducible: yes
- Related Files: tests/test_pipeline_changes.py

### Resolution
- **Resolved**: 2026-07-24T04:46:00+05:30
- **Notes**: The test now mocks dotenv loading before clearing environment state.

---

## [ERR-20260729-001] unittest-module-path

**Logged**: 2026-07-29T13:17:00+05:30
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary
The test directory is not a Python package, so dotted-module unittest syntax fails.

### Error
```text
ModuleNotFoundError: No module named 'tests.test_pipeline_changes'
```

### Suggested Fix
Run this suite with unittest discovery: `python -m unittest discover -s tests`.

### Metadata
- Reproducible: yes
- Related Files: tests/test_pipeline_changes.py

### Resolution
- **Resolved**: 2026-07-29T13:17:00+05:30
- **Notes**: Switched the verification command to unittest discovery.

---

## [ERR-20260728-001] company-profile-openai-timeout

**Logged**: 2026-07-28T16:25:00+05:30
**Priority**: medium
**Status**: pending
**Area**: backend

### Summary
The live company-profile OpenAI request timed out after 120 seconds.

### Error
```text
TimeoutError: The read operation timed out
```

### Context
- Retried profiling the three-page Firecrawl snapshot for `kenesis.ai`.
- Payload was about 15 KB using `gpt-4.1-mini`.
- The timeout came from the external API connection, not profile validation.

### Suggested Fix
Convert timeout and network failures into a clean profile-generation error and
allow one bounded retry for transient read timeouts.

### Metadata
- Reproducible: unknown
- Related Files: geo_audit/llm.py, geo_audit/profile.py

---

## [ERR-20260724-004] openai-batch-quality-regression

**Logged**: 2026-07-24T11:15:00+05:30
**Priority**: high
**Status**: resolved
**Area**: backend

### Summary
The first five-question OpenAI web-search batch returned five answers but only
one answer contained validated recommendations.

### Error
```text
recommendations per answer: [5, 0, 0, 0, 0]
native citations per answer: [0, 0, 0, 0, 0]
```

### Context
- The request completed in 62.68 seconds using 14,544 total tokens.
- Strict JSON output did not include native URL annotations.
- The prompt did not state a minimum vendor count for every supplied question.

### Suggested Fix
Require 3–5 explicit vendors per question, retain structured web-search URLs as
unverified candidates when annotations are unavailable, and pass every URL
through the existing HTTP verification stage.

### Metadata
- Reproducible: unknown
- Related Files: geo_audit/recommendations.py

### Resolution
- **Resolved**: 2026-07-24T11:45:00+05:30
- **Notes**: The OpenAI batch path now retains explicitly recommended,
  plausible vendors when citation formatting prevents an exact evidence-quote
  match, while assigning lower extraction confidence.

---

## [ERR-20260724-003] service-quotas-access-denied

**Logged**: 2026-07-24T10:28:00+05:30
**Priority**: low
**Status**: pending
**Area**: infra

### Summary
The application IAM user cannot read account-specific Bedrock quotas.

### Error
```text
AccessDeniedException: servicequotas:ListServiceQuotas
```

### Context
- Attempted to inspect exact Bedrock RPM and TPM quotas in `us-east-1`.
- The configured `BedrockAPIKey-rvie` user can invoke models but cannot list
  Service Quotas.

### Suggested Fix
Grant read-only `servicequotas:ListServiceQuotas` permission or inspect Amazon
Bedrock quotas in the AWS Service Quotas console.

### Metadata
- Reproducible: yes
- Related Files: .env

---

## [ERR-20260724-002] agentcore-null-result-url

**Logged**: 2026-07-24T10:18:00+05:30
**Priority**: medium
**Status**: resolved
**Area**: backend

### Summary
AgentCore WebSearch returned a result with JSON `url: null`.

### Error
```text
The parser converted null to the literal string "None".
```

### Context
- A live AgentCore query returned two valid URLs and one result with no URL.
- `str(item.get("url", ""))` converted Python `None` into `"None"`.

### Suggested Fix
Require every parsed AgentCore URL to have an HTTP or HTTPS scheme and hostname.

### Metadata
- Reproducible: yes
- Related Files: geo_audit/agentcore_search.py

### Resolution
- **Resolved**: 2026-07-24T10:18:00+05:30
- **Notes**: Added strict HTTP URL validation and a regression test.

---
