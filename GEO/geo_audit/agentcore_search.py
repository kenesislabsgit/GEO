from __future__ import annotations

import json
import os
from threading import Lock
from typing import Any
from urllib.parse import urlparse
from urllib.request import Request, urlopen


AGENTCORE_REGION = "us-east-1"
MCP_PROTOCOL_VERSION = "2025-03-26"


class AgentCoreWebSearchClient:
    def __init__(
        self,
        gateway_url: str,
        *,
        region: str = AGENTCORE_REGION,
        tool_name: str | None = None,
        bearer_token: str | None = None,
        timeout: int = 20,
    ) -> None:
        if region != AGENTCORE_REGION:
            raise ValueError(
                "AgentCore Web Search is currently available only in us-east-1."
            )
        self.gateway_url = gateway_url.strip()
        if not self.gateway_url:
            raise ValueError("An AgentCore Gateway URL is required.")
        self.region = region
        self.tool_name = tool_name.strip() if tool_name else None
        self.bearer_token = bearer_token.strip() if bearer_token else None
        self.timeout = timeout
        self._tool_lock = Lock()

    @classmethod
    def from_environment(
        cls,
        *,
        gateway_url: str | None = None,
        tool_name: str | None = None,
    ) -> AgentCoreWebSearchClient:
        return cls(
            gateway_url
            or os.getenv("AGENTCORE_GATEWAY_URL")
            or os.getenv("GATEWAY_URL", ""),
            region=os.getenv("AGENTCORE_REGION", AGENTCORE_REGION),
            tool_name=tool_name or os.getenv("AGENTCORE_WEB_SEARCH_TOOL_NAME"),
            bearer_token=os.getenv("AGENTCORE_GATEWAY_BEARER_TOKEN"),
        )

    def discover_web_search_tool(self) -> str:
        if self.tool_name:
            return self.tool_name

        with self._tool_lock:
            if self.tool_name:
                return self.tool_name
            response = self._call_mcp("tools/list")
            tools = response.get("tools", [])
            if not isinstance(tools, list):
                raise RuntimeError(
                    "AgentCore Gateway returned an invalid tools/list result."
                )

            names = [
                str(tool.get("name", "")).strip()
                for tool in tools
                if isinstance(tool, dict)
            ]
            preferred = next(
                (
                    name
                    for name in names
                    if name.lower() == "websearch"
                    or name.lower().endswith("___websearch")
                ),
                None,
            )
            if not preferred:
                raise RuntimeError(
                    "The configured AgentCore Gateway has no WebSearch connector target."
                )
            self.tool_name = preferred
            return preferred

    def search(self, query: str, max_results: int = 4) -> list[dict[str, Any]]:
        clean_query = " ".join(query.split())[:200]
        if not clean_query:
            return []
        tool_name = self.discover_web_search_tool()
        response = self._call_mcp(
            "tools/call",
            {
                "name": tool_name,
                "arguments": {
                    "query": clean_query,
                    "maxResults": max(1, min(25, max_results)),
                },
            },
        )
        if response.get("isError"):
            raise RuntimeError(_content_error(response.get("content", [])))
        return parse_web_search_content(response.get("content", []))

    def _call_mcp(
        self,
        method: str,
        params: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "jsonrpc": "2.0",
            "id": f"geo-audit-{method.replace('/', '-')}",
            "method": method,
        }
        if params is not None:
            payload["params"] = params
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        headers = {
            "Accept": "application/json, text/event-stream",
            "Content-Type": "application/json",
            "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
            "User-Agent": "GEOAuditBot/0.3",
        }
        if self.bearer_token:
            headers["Authorization"] = f"Bearer {self.bearer_token}"
        else:
            headers = self._sigv4_headers(body, headers)

        request = Request(
            self.gateway_url,
            data=body,
            headers=headers,
            method="POST",
        )
        with urlopen(request, timeout=self.timeout) as response:
            raw = response.read().decode("utf-8")
        envelope = parse_mcp_response(raw)
        if envelope.get("error"):
            error = envelope["error"]
            message = error.get("message", error) if isinstance(error, dict) else error
            raise RuntimeError(f"AgentCore Gateway error: {message}")
        result = envelope.get("result")
        if not isinstance(result, dict):
            raise RuntimeError("AgentCore Gateway returned no MCP result.")
        return result

    def _sigv4_headers(
        self,
        body: bytes,
        headers: dict[str, str],
    ) -> dict[str, str]:
        try:
            import boto3
            from botocore.auth import SigV4Auth
            from botocore.awsrequest import AWSRequest
        except ImportError as exc:
            raise RuntimeError(
                "Install boto3 to invoke an IAM-authorized AgentCore Gateway."
            ) from exc

        credentials = boto3.Session().get_credentials()
        if credentials is None:
            raise RuntimeError("AWS credentials are not configured.")
        aws_request = AWSRequest(
            method="POST",
            url=self.gateway_url,
            data=body,
            headers=headers,
        )
        SigV4Auth(
            credentials.get_frozen_credentials(),
            "bedrock-agentcore",
            self.region,
        ).add_auth(aws_request)
        return {str(key): str(value) for key, value in aws_request.headers.items()}


def parse_mcp_response(raw: str) -> dict[str, Any]:
    stripped = raw.strip()
    if not stripped:
        raise RuntimeError("AgentCore Gateway returned an empty response.")
    if stripped.startswith("{"):
        parsed = json.loads(stripped)
        if not isinstance(parsed, dict):
            raise RuntimeError("AgentCore Gateway returned invalid JSON.")
        return parsed

    for line in stripped.splitlines():
        if not line.startswith("data:"):
            continue
        candidate = line[5:].strip()
        if candidate and candidate != "[DONE]":
            parsed = json.loads(candidate)
            if isinstance(parsed, dict):
                return parsed
    raise RuntimeError("AgentCore Gateway returned an unsupported MCP response.")


def parse_web_search_content(content: Any) -> list[dict[str, Any]]:
    if not isinstance(content, list):
        return []
    rows: list[dict[str, Any]] = []
    for block in content:
        if not isinstance(block, dict) or block.get("type") != "text":
            continue
        try:
            payload = json.loads(str(block.get("text", "")))
        except json.JSONDecodeError:
            continue
        results = payload.get("results", []) if isinstance(payload, dict) else []
        for rank, item in enumerate(results, start=1):
            if not isinstance(item, dict):
                continue
            raw_url = item.get("url")
            url = str(raw_url).strip() if raw_url is not None else ""
            if not is_http_url(url):
                continue
            rows.append(
                {
                    "url": url,
                    "title": str(item.get("title", "")).strip(),
                    "snippet": str(item.get("text", "")).strip(),
                    "published_date": str(item.get("publishedDate", "")).strip(),
                    "search_rank": rank,
                }
            )
    return rows


def _content_error(content: Any) -> str:
    if not isinstance(content, list):
        return "WebSearch invocation failed."
    messages = [
        str(block.get("text", "")).strip()
        for block in content
        if isinstance(block, dict) and block.get("text")
    ]
    return " ".join(messages) or "WebSearch invocation failed."


def is_http_url(url: str) -> bool:
    parsed = urlparse(url)
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)
