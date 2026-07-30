from __future__ import annotations

from datetime import datetime
from pathlib import Path
import re
from urllib.parse import urlparse


def make_run_dir(output_root: Path, url: str) -> Path:
    parsed = urlparse(url if "://" in url else f"https://{url}")
    domain = parsed.netloc or parsed.path
    safe_domain = re.sub(r"[^A-Za-z0-9_.-]+", "-", domain).strip("-") or "website"
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    run_dir = output_root / f"{timestamp}-{safe_domain}"
    run_dir.mkdir(parents=True, exist_ok=True)
    return run_dir

