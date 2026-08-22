# Single-agent web-mention experiment

This directory is isolated from the production audit pipeline. It loads a
completed audit, builds the audited-company plus top-five input, intentionally
withholds one competitor website, and lets one tool-using agent research and
verify external mentions.

Run from `GEO`:

```powershell
python -m experiments.web_mention_agent `
  --source-run outputs/20260818-224605-typeform.com `
  --remove-link UserTesting
```

Each run creates a timestamped directory under `runs/`. It stores input,
private withheld-site evaluation data, exact system prompt, tool definitions,
visible conversation, model calls, tool calls/results, searches, homepage
reads, downloaded page text, passage results, raw output, validated output,
validation report, timings, and a Markdown summary.

`conversation.json` records all visible agent messages and tool interactions.
Provider-hidden chain-of-thought is not available and is not claimed to be
stored.
