#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Builds /data/items.json and /data/topics.json for the GitHub Pages frontend.

Design goals:
- Only store metadata (title/link/date/source/tags/summary) to respect publisher copyrights.
- Robust: skip broken feeds rather than failing the whole build.
- Reuters: use their public news-sitemap endpoints (titles + dates) instead of scraping article bodies.
"""

from __future__ import annotations

import hashlib
import json
import re
import sys
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

import feedparser
import requests
from dateutil import parser as dateparser
from xml.etree import ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
FEEDS_FILE = DATA_DIR / "feeds.json"

UA = (
    "yu-news-hub/1.0 (+https://github.com/; contact: your-email; "
    "purpose: personal RSS aggregation)"
)

SESSION = requests.Session()
SESSION.headers.update({"User-Agent": UA})


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def sha1(s: str) -> str:
    return hashlib.sha1(s.encode("utf-8", errors="ignore")).hexdigest()


TRACKING_PARAMS_RE = re.compile(r"^(utm_|spm|from|share|mkt_|mc_)", re.I)


def canonicalize_url(url: str) -> str:
    # Remove common tracking query params.
    try:
        from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode

        parts = urlsplit(url)
        q = [(k, v) for (k, v) in parse_qsl(parts.query, keep_blank_values=True)
             if not TRACKING_PARAMS_RE.match(k)]
        new_query = urlencode(q, doseq=True)
        return urlunsplit((parts.scheme, parts.netloc, parts.path, new_query, parts.fragment))
    except Exception:
        return url


def parse_date(entry: Any) -> Optional[datetime]:
    # feedparser may provide multiple date fields.
    for key in ("published", "updated", "created", "pubDate"):
        val = getattr(entry, key, None) if hasattr(entry, key) else entry.get(key)
        if not val:
            continue
        try:
            dt = dateparser.parse(val)
            if not dt:
                continue
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(timezone.utc)
        except Exception:
            continue

    # Some feeds expose structured time tuples.
    for key in ("published_parsed", "updated_parsed"):
        tp = getattr(entry, key, None) if hasattr(entry, key) else entry.get(key)
        if tp:
            try:
                return datetime(*tp[:6], tzinfo=timezone.utc)
            except Exception:
                pass
    return None


def clean_html(text: str) -> str:
    if not text:
        return ""
    # Very lightweight tag stripper.
    text = re.sub(r"<script.*?>.*?</script>", "", text, flags=re.S | re.I)
    text = re.sub(r"<style.*?>.*?</style>", "", text, flags=re.S | re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


@dataclass
class FeedDef:
    id: str
    name: str
    url: str
    type: str
    region: str
    lang: str
    tags: List[str]
    weight: float


def load_feeds() -> Tuple[Dict[str, Any], List[FeedDef]]:
    cfg = json.loads(FEEDS_FILE.read_text(encoding="utf-8"))
    feeds: List[FeedDef] = []
    for f in cfg["feeds"]:
        feeds.append(
            FeedDef(
                id=f["id"],
                name=f["name"],
                url=f["url"],
                type=f.get("type", "rss"),
                region=f.get("region", "Global"),
                lang=f.get("lang", "en"),
                tags=f.get("tags", []),
                weight=float(f.get("weight", 1.0)),
            )
        )
    return cfg, feeds


def fetch_text(url: str, timeout: int = 20) -> str:
    r = SESSION.get(url, timeout=timeout)
    r.raise_for_status()
    return r.text


def parse_rss(feed: FeedDef, max_items: int) -> List[Dict[str, Any]]:
    parsed = feedparser.parse(feed.url)
    out: List[Dict[str, Any]] = []
    for e in parsed.entries[:max_items]:
        link = canonicalize_url(getattr(e, "link", "") or "")
        if not link:
            continue
        title = getattr(e, "title", "") or ""
        dt = parse_date(e)
        summary = ""
        for k in ("summary", "description", "subtitle"):
            if hasattr(e, k) and getattr(e, k):
                summary = getattr(e, k)
                break
            if isinstance(e, dict) and e.get(k):
                summary = e.get(k)
                break
        summary = clean_html(summary)

        out.append(
            {
                "id": sha1(feed.id + "|" + link),
                "title": clean_html(title),
                "link": link,
                "published": (dt.isoformat() if dt else None),
                "source_id": feed.id,
                "source": feed.name,
                "region": feed.region,
                "lang": feed.lang,
                "tags": feed.tags,
                "weight": feed.weight,
                "summary": summary[:600],
            }
        )
    return out


def _et_find_text(node: ET.Element, path: str, ns: Dict[str, str]) -> Optional[str]:
    el = node.find(path, ns)
    return el.text.strip() if (el is not None and el.text) else None


def parse_reuters_news_sitemap_index(feed: FeedDef, max_items: int) -> List[Dict[str, Any]]:
    """
    Reuters exposes sitemaps in robots.txt. We use the news-sitemap-index and
    then pull a few most-recent child sitemaps, extracting <news:title> and
    <news:publication_date>.
    """
    xml = fetch_text(feed.url)
    ns = {
        "sm": "http://www.sitemaps.org/schemas/sitemap/0.9",
        "news": "http://www.google.com/schemas/sitemap-news/0.9",
    }
    root = ET.fromstring(xml)
    sitemaps = []
    for sm in root.findall("sm:sitemap", ns):
        loc = _et_find_text(sm, "sm:loc", ns)
        lastmod = _et_find_text(sm, "sm:lastmod", ns)
        if not loc:
            continue
        try:
            lm = dateparser.parse(lastmod) if lastmod else None
            if lm and lm.tzinfo is None:
                lm = lm.replace(tzinfo=timezone.utc)
        except Exception:
            lm = None
        sitemaps.append((loc, lm))
    # Most recent first
    sitemaps.sort(key=lambda x: x[1] or datetime(1970, 1, 1, tzinfo=timezone.utc), reverse=True)

    out: List[Dict[str, Any]] = []
    # Fetch a few most recent sitemaps (avoid hammering).
    for loc, _lm in sitemaps[:6]:
        try:
            child_xml = fetch_text(loc, timeout=25)
            child_root = ET.fromstring(child_xml)
            for url_node in child_root.findall("sm:url", ns):
                link = _et_find_text(url_node, "sm:loc", ns)
                title = _et_find_text(url_node, "news:news/news:title", ns)
                pub = _et_find_text(url_node, "news:news/news:publication_date", ns)
                if not link or not title:
                    continue
                dt = None
                if pub:
                    try:
                        dt = dateparser.parse(pub)
                        if dt.tzinfo is None:
                            dt = dt.replace(tzinfo=timezone.utc)
                        dt = dt.astimezone(timezone.utc)
                    except Exception:
                        dt = None
                out.append(
                    {
                        "id": sha1(feed.id + "|" + link),
                        "title": title.strip(),
                        "link": canonicalize_url(link.strip()),
                        "published": (dt.isoformat() if dt else None),
                        "source_id": feed.id,
                        "source": feed.name,
                        "region": feed.region,
                        "lang": feed.lang,
                        "tags": list(set(feed.tags + ["Reuters"])),
                        "weight": feed.weight,
                        "summary": "",
                    }
                )
                if len(out) >= max_items:
                    break
            if len(out) >= max_items:
                break
        except Exception:
            continue
    return out


def filter_by_age(items: List[Dict[str, Any]], max_age_days: int) -> List[Dict[str, Any]]:
    cutoff = now_utc() - timedelta(days=max_age_days)
    out = []
    for it in items:
        p = it.get("published")
        if not p:
            out.append(it)
            continue
        try:
            dt = dateparser.parse(p)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            if dt >= cutoff:
                out.append(it)
        except Exception:
            out.append(it)
    return out


def dedupe(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    seen = set()
    out = []
    for it in items:
        key = (canonicalize_url(it["link"]), re.sub(r"\s+", " ", it["title"]).strip().lower())
        if key in seen:
            continue
        seen.add(key)
        out.append(it)
    return out


WORD_RE = re.compile(r"[A-Za-z0-9\u4e00-\u9fff]+")


def tokenize(title: str) -> List[str]:
    t = title.lower()
    toks = WORD_RE.findall(t)
    # drop very short tokens
    return [x for x in toks if len(x) >= 2]


def jaccard(a: Iterable[str], b: Iterable[str]) -> float:
    sa, sb = set(a), set(b)
    if not sa or not sb:
        return 0.0
    inter = len(sa & sb)
    union = len(sa | sb)
    return inter / union if union else 0.0


def build_topics(items: List[Dict[str, Any]], top_k: int = 10) -> List[Dict[str, Any]]:
    """
    Simple clustering by title token Jaccard similarity.
    """
    clusters: List[Dict[str, Any]] = []
    for it in items:
        toks = tokenize(it["title"])
        assigned = False
        for c in clusters:
            if jaccard(toks, c["tokens"]) >= 0.55:
                c["items"].append(it["id"])
                c["sources"].add(it["source"])
                c["max_weight"] = max(c["max_weight"], float(it.get("weight", 1.0)))
                # keep the most informative headline (longer tends to be better)
                if len(it["title"]) > len(c["headline"]):
                    c["headline"] = it["title"]
                    c["tokens"] = toks
                assigned = True
                break
        if not assigned:
            clusters.append(
                {
                    "id": sha1("topic|" + it["title"])[:12],
                    "headline": it["title"],
                    "tokens": toks,
                    "items": [it["id"]],
                    "sources": {it["source"]},
                    "max_weight": float(it.get("weight", 1.0)),
                }
            )

    # score clusters: count * source_diversity * recency
    id_to_item = {it["id"]: it for it in items}
    def cluster_score(c: Dict[str, Any]) -> float:
        count = len(c["items"])
        diversity = len(c["sources"])
        # recency: newest item age
        newest = None
        for iid in c["items"]:
            p = id_to_item.get(iid, {}).get("published")
            if not p:
                continue
            try:
                dt = dateparser.parse(p)
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                newest = max(newest, dt) if newest else dt
            except Exception:
                continue
        if newest:
            age_h = max(0.0, (now_utc() - newest).total_seconds() / 3600.0)
            recency = 1.0 / (1.0 + age_h / 12.0)  # half-life-ish
        else:
            recency = 0.6
        return (count * (1.0 + 0.25 * (diversity - 1))) * recency * (0.9 + 0.1 * c["max_weight"])

    for c in clusters:
        c["score"] = cluster_score(c)

    clusters.sort(key=lambda x: x["score"], reverse=True)
    out = []
    for c in clusters[:top_k]:
        out.append(
            {
                "id": c["id"],
                "headline": c["headline"],
                "count": len(c["items"]),
                "sources": sorted(list(c["sources"]))[:10],
                "items": c["items"][:10],
                "score": round(float(c["score"]), 4),
            }
        )
    return out


def main() -> int:
    cfg, feeds = load_feeds()
    defaults = cfg.get("defaults", {})
    max_age_days = int(defaults.get("max_age_days", 7))
    max_items_per_feed = int(defaults.get("max_items_per_feed", 40))

    all_items: List[Dict[str, Any]] = []
    failures: List[Dict[str, str]] = []

    for f in feeds:
        try:
            if f.type == "rss":
                items = parse_rss(f, max_items_per_feed)
            elif f.type == "reuters_news_sitemap_index":
                items = parse_reuters_news_sitemap_index(f, max_items_per_feed)
            else:
                items = []
            all_items.extend(items)
        except Exception as e:
            failures.append({"feed": f.id, "url": f.url, "error": str(e)})

    all_items = filter_by_age(all_items, max_age_days)
    all_items = dedupe(all_items)

    # Sort: published desc then weight.
    def sort_key(it: Dict[str, Any]):
        p = it.get("published")
        try:
            dt = dateparser.parse(p) if p else datetime(1970, 1, 1, tzinfo=timezone.utc)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
        except Exception:
            dt = datetime(1970, 1, 1, tzinfo=timezone.utc)
        return (dt, float(it.get("weight", 1.0)))

    all_items.sort(key=sort_key, reverse=True)

    topics = build_topics(all_items, top_k=10)

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    (DATA_DIR / "items.json").write_text(json.dumps(all_items, ensure_ascii=False, indent=2), encoding="utf-8")
    (DATA_DIR / "topics.json").write_text(json.dumps(topics, ensure_ascii=False, indent=2), encoding="utf-8")
    (DATA_DIR / "meta.json").write_text(
        json.dumps(
            {
                "generated_at": now_utc().isoformat(),
                "count_items": len(all_items),
                "count_topics": len(topics),
                "failures": failures,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    print(f"Generated: {len(all_items)} items, {len(topics)} topics. Failures: {len(failures)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
