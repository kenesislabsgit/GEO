import httpx
from bs4 import BeautifulSoup
import re


async def scrape_website(url: str) -> dict:
    """
    Visits a website URL and returns cleaned text content.
    Extracts: title, meta description, headings, and body text.
    """
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36"
        )
    }

    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=20.0) as client:
            response = await client.get(url, headers=headers)
            response.raise_for_status()
            html = response.text
    except httpx.HTTPStatusError as e:
        raise ValueError(f"Could not fetch website (HTTP {e.response.status_code}): {url}")
    except Exception as e:
        raise ValueError(f"Failed to connect to website: {url}. Error: {str(e)}")

    soup = BeautifulSoup(html, "html.parser")

    # --- Extract structured data ---

    # Page title
    title = soup.title.string.strip() if soup.title else "No title found"

    # Meta description
    meta_desc_tag = soup.find("meta", attrs={"name": "description"})
    meta_description = meta_desc_tag["content"].strip() if meta_desc_tag else "No meta description found"

    # All headings (h1-h3) for topic structure
    headings = []
    for tag in soup.find_all(["h1", "h2", "h3"]):
        text = tag.get_text(strip=True)
        if text:
            headings.append(f"[{tag.name.upper()}] {text}")

    # Main body text — strip scripts, styles, nav, footer
    for noise in soup(["script", "style", "nav", "footer", "header", "aside", "form"]):
        noise.decompose()

    raw_text = soup.get_text(separator=" ", strip=True)
    # Collapse whitespace
    clean_text = re.sub(r"\s+", " ", raw_text).strip()
    # Limit to 5000 characters to keep token usage reasonable
    clean_text = clean_text[:5000]

    return {
        "url": url,
        "title": title,
        "meta_description": meta_description,
        "headings": headings[:20],  # Top 20 headings max
        "body_text": clean_text,
    }
