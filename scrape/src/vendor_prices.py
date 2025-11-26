"""
Scraper for vendor price data (e.g., Kanzen Games Gundam singles).
Collects title, price, quickshop URLs, performs fuzzy product matching,
and upserts results into vendor price tables.
"""

import json
import re
from collections import defaultdict
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional, Iterable, Set
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup
from supabase import Client

from db_config import get_db_schema, is_mock_mode
from mock_utils import dump_data_examples


KANZEN_BASE_URL = "https://kanzengames.com"
KANZEN_COLLECTION_PATH = "/collections/gundam-singles-all"
HTTP_TIMEOUT = 30
USER_AGENT = "Mozilla/5.0 (compatible; TCGScraper/1.0)"
AMBIGUOUS_LOG_SHOWN = False

RARITY_PRIORITY = [
    "lr++",
    "lr+",
    "lr",
    "legend rare",
    "legendary rare",
    "r+",
    "r",
    "rare",
    "u+",
    "u",
    "uncommon",
    "c+",
    "c",
    "common",
]
RARITY_PRIORITY_MAP = {value: idx for idx, value in enumerate(RARITY_PRIORITY)}

META_NUMBER = "_meta_number"
META_GROUP = "_meta_group"
META_RARITY_HINT = "_meta_rarity_hint"


def _current_hour_iso() -> str:
    """Return the current UTC hour (minute/second zeroed) as ISO string."""
    now = datetime.now(timezone.utc)
    hour = now.replace(minute=0, second=0, microsecond=0)
    return hour.isoformat()


def _parse_price_value(price_text: Optional[str]) -> Optional[float]:
    """Extract a numeric value from a price string."""
    if not price_text:
        return None
    cleaned = price_text.replace(",", "")
    match = re.search(r"-?\d+(?:\.\d+)?", cleaned)
    if not match:
        return None
    try:
        return float(match.group(0))
    except ValueError:
        return None


def _extract_title_metadata(title: str) -> Dict[str, Optional[str]]:
    """Extract product number, group name, and rarity hints from title."""
    metadata: Dict[str, Optional[str]] = {}
    # Preferred pattern (e.g., GD01-118)
    number_match = re.search(r"\b([A-Za-z]{2}\d{2}-\d{3})\b", title)
    if not number_match:
        number_match = re.search(r"\b([A-Za-z]{1,4}-\d{3})\b", title)
    metadata[META_NUMBER] = number_match.group(1) if number_match else None

    group_match = re.search(r"\[([^\]]+)\]", title)
    metadata[META_GROUP] = group_match.group(1).strip() if group_match else None

    title_lower = title.lower()
    if "holofoil" in title_lower:
        metadata[META_RARITY_HINT] = "holofoil"
    elif "foil" in title_lower:
        metadata[META_RARITY_HINT] = "foil"
    else:
        metadata[META_RARITY_HINT] = None

    return metadata


def _fetch_kanzen_products() -> List[Dict[str, Any]]:
    """Scrape all paginated Kanzen Gundam singles listings."""
    records: List[Dict[str, Any]] = []
    next_url = urljoin(KANZEN_BASE_URL, KANZEN_COLLECTION_PATH)
    vendor_domain = urlparse(KANZEN_BASE_URL).netloc
    fetched_at = _current_hour_iso()

    headers = {"User-Agent": USER_AGENT}

    while next_url:
        response = requests.get(next_url, headers=headers, timeout=HTTP_TIMEOUT)
        response.raise_for_status()
        soup = BeautifulSoup(response.text, "html.parser")
        product_items = soup.select("li.productgrid--item")

        for item in product_items:
            info = item.select_one("div.productitem--info")
            if not info:
                continue

            title_el = info.select_one(".productitem--title")
            price_single_el = info.select_one(".price__current--single")
            price_min_el = info.select_one(".price__current--min")
            price_max_el = info.select_one(".price__current--max")

            title = title_el.get_text(strip=True) if title_el else None
            if not title:
                continue

            price_single = price_single_el.get_text(strip=True) if price_single_el else None
            price_min = price_min_el.get_text(strip=True) if price_min_el else None
            price_max = price_max_el.get_text(strip=True) if price_max_el else None

            quickshop_rel = item.get("data-product-quickshop-url")
            quickshop_url = (
                quickshop_rel
                if quickshop_rel and quickshop_rel.startswith("http")
                else (urljoin(KANZEN_BASE_URL, quickshop_rel) if quickshop_rel else None)
            )

            record = {
                "vendor": vendor_domain,
                "title": title,
                "price_single_text": price_single,
                "price_single_value": _parse_price_value(price_single),
                "price_min_text": price_min,
                "price_min_value": _parse_price_value(price_min),
                "price_max_text": price_max,
                "price_max_value": _parse_price_value(price_max),
                "quickshop_url": quickshop_url,
                "source_url": next_url,
                "fetched_at": fetched_at,
                "product_id": None,
                "raw": json.dumps(
                    {
                        "title": title,
                        "price_single": price_single,
                        "price_min": price_min,
                        "price_max": price_max,
                        "quickshop_url": quickshop_rel,
                    }
                ),
            }

            record.update(_extract_title_metadata(title))
            records.append(record)

        next_anchor = soup.select_one("li.pagination--next a")
        if next_anchor and next_anchor.get("href"):
            href = next_anchor["href"]
            next_url = href if href.startswith("http") else urljoin(KANZEN_BASE_URL, href)
        else:
            break

    return records


def _chunk_iterable(items: Iterable[Any], size: int = 100) -> Iterable[List[Any]]:
    chunk: List[Any] = []
    for item in items:
        chunk.append(item)
        if len(chunk) >= size:
            yield chunk
            chunk = []
    if chunk:
        yield chunk


def _extract_rarity_from_extended(raw: Optional[str]) -> Optional[str]:
    if not raw:
        return None
    try:
        data = json.loads(raw)
        if isinstance(data, list):
            for entry in data:
                name = (entry.get("name") or "").lower()
                display = (entry.get("displayName") or "").lower()
                if name == "rarity" or display == "rarity":
                    return entry.get("value")
    except Exception:
        return None
    return None


def _load_products_by_number(client: Client, numbers: Set[str]) -> Dict[str, List[Dict[str, Any]]]:
    products_by_number: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    if not numbers:
        return products_by_number

    schema = get_db_schema()
    table = client.schema(schema).from_("products") if schema != "public" else client.table("products")

    for chunk in _chunk_iterable([n for n in numbers if n]):
        resp = (
            table.select("product_id,number,group_id,extended_data_raw")
            .in_("number", chunk)
            .execute()
        )
        for row in resp.data or []:
            row["rarity"] = _extract_rarity_from_extended(row.get("extended_data_raw"))
            number_key = (row.get("number") or "").upper()
            products_by_number[number_key].append(row)

    return products_by_number


def _load_group_ids_by_name(client: Client, group_names: Set[str]) -> Dict[str, Set[int]]:
    if not group_names:
        return {}

    schema = get_db_schema()
    table = client.schema(schema).from_("groups") if schema != "public" else client.table("groups")
    name_to_ids: Dict[str, Set[int]] = defaultdict(set)

    for chunk in _chunk_iterable([name for name in group_names if name]):
        resp = table.select("group_id,name").in_("name", chunk).execute()
        for row in resp.data or []:
            key = (row.get("name") or "").strip().lower()
            if key:
                name_to_ids[key].add(row.get("group_id"))

    return name_to_ids


def _rarity_matches_hint(rarity: Optional[str], hint: Optional[str]) -> bool:
    if not rarity or not hint:
        return False
    r = rarity.lower()
    if hint == "holofoil":
        return "foil" in r or r.endswith("+")
    if hint == "foil":
        return "foil" in r or r.endswith("+")
    return False


def _match_product_for_record(
    record: Dict[str, Any],
    products_by_number: Dict[str, List[Dict[str, Any]]],
    group_ids_by_name: Dict[str, Set[int]],
) -> Optional[int]:
    number = record.get(META_NUMBER)
    if not number:
        print(f"  ⚠️  Vendor match failed for '{record['title']}' (no product number found)")
        return None

    candidates = products_by_number.get(number.upper())
    if not candidates:
        print(f"  ⚠️  No products found for number {number} (title='{record['title']}')")
        return None

    if len(candidates) == 1:
        return candidates[0]["product_id"]

    group_name = record.get(META_GROUP)
    filtered = candidates
    if group_name:
        group_ids = group_ids_by_name.get(group_name.strip().lower())
        if group_ids:
            filtered = [c for c in filtered if c.get("group_id") in group_ids]
            if len(filtered) == 1:
                return filtered[0]["product_id"]
        else:
            print(f"  ⚠️  Group '{group_name}' not found in groups table")

    if len(filtered) > 1:
        rarity_phrase = None
        rarity_match = re.search(r"\(([A-Za-z0-9\+\s]+)\)", record["title"])
        if rarity_match:
            rarity_phrase = rarity_match.group(1).strip().lower()

        hint = record.get(META_RARITY_HINT)

        if rarity_phrase:
            rarity_filtered = [
                c for c in filtered if (c.get("rarity") or "").lower() == rarity_phrase
            ]
            if len(rarity_filtered) == 1:
                return rarity_filtered[0]["product_id"]
            if rarity_filtered:
                filtered = rarity_filtered

        if len(filtered) > 1 and hint:
            rarity_filtered = [c for c in filtered if _rarity_matches_hint(c.get("rarity"), hint)]
            if len(rarity_filtered) == 1:
                return rarity_filtered[0]["product_id"]
            if rarity_filtered:
                filtered = rarity_filtered

    if len(filtered) == 1:
        return filtered[0]["product_id"]

    sorted_candidates = sorted(
        filtered,
        key=lambda c: RARITY_PRIORITY_MAP.get((c.get("rarity") or "").lower(), len(RARITY_PRIORITY)),
    )
    chosen = sorted_candidates[0] if sorted_candidates else None

    if chosen:
        return chosen.get("product_id")

    print(
        f"  ⚠️  Unable to resolve '{record['title']}' "
        f"(number={number}, group={group_name}) after rarity fallback"
    )
    return None


def _match_products_to_vendor_records(client: Client, records: List[Dict[str, Any]]) -> None:
    numbers = {rec.get(META_NUMBER).upper() for rec in records if rec.get(META_NUMBER)}
    group_names = {rec.get(META_GROUP).strip() for rec in records if rec.get(META_GROUP)}

    products_by_number = _load_products_by_number(client, numbers)
    group_ids_by_name = _load_group_ids_by_name(client, group_names)

    for record in records:
        product_id = _match_product_for_record(record, products_by_number, group_ids_by_name)
        record["product_id"] = product_id
        if not product_id:
            continue


def _strip_internal_fields(records: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    cleaned: List[Dict[str, Any]] = []
    for record in records:
        cleaned.append(
            {
                key: value
                for key, value in record.items()
                if not key.startswith("_meta_")
            }
        )
    return cleaned


def upsert_vendor_prices(client: Client, records: List[Dict[str, Any]]) -> None:
    """Upsert current vendor prices (vendor/title conflict)."""
    if not records:
        print("  No vendor price records to upsert.")
        return

    if is_mock_mode():
        dump_data_examples("vendor_prices", records, "UPSERT", max_examples=5)
        return

    schema = get_db_schema()
    table = (
        client.schema(schema).from_("vendor_prices")
        if schema != "public"
        else client.table("vendor_prices")
    )

    cleaned_records = _strip_internal_fields(records)

    try:
        print(f"  Upserting {len(cleaned_records)} vendor prices...")
        table.upsert(cleaned_records, on_conflict="vendor,title").execute()
        print("  ✅ Vendor prices upsert complete.")
    except Exception as exc:
        print(f"  ❌ Error upserting vendor prices: {exc}")
        import traceback

        traceback.print_exc()


def insert_vendor_prices_history(client: Client, records: List[Dict[str, Any]]) -> None:
    """Insert vendor price history rows (with hourly dedupe)."""
    if not records:
        print("  No vendor price history records to insert.")
        return

    if is_mock_mode():
        dump_data_examples("vendor_prices_history", records, "INSERT", max_examples=5)
        return

    schema = get_db_schema()
    table = (
        client.schema(schema).from_("vendor_prices_history")
        if schema != "public"
        else client.table("vendor_prices_history")
    )

    cleaned_records = _strip_internal_fields(records)

    fetched_hours = {row.get("fetched_at") for row in cleaned_records if row.get("fetched_at")}
    vendors = {row.get("vendor") for row in records if row.get("vendor")}

    try:
        if len(fetched_hours) == 1 and fetched_hours:
            target_hour = fetched_hours.pop()
            for vendor in vendors:
                if not vendor:
                    continue
                print(f"  Removing existing history for vendor={vendor}, hour={target_hour}")
                table.delete().eq("vendor", vendor).eq("fetched_at", target_hour).execute()

        print(f"  Inserting {len(cleaned_records)} vendor price history rows...")
        table.insert(cleaned_records).execute()
        print("  ✅ Vendor price history insert complete.")
    except Exception as exc:
        print(f"  ❌ Error inserting vendor price history: {exc}")
        import traceback

        traceback.print_exc()


def scrape_vendor_prices(client: Client) -> None:
    """Entry point to scrape vendor data and persist to Supabase."""
    print("\n=== Vendor Price Scraping (Kanzen Games) ===")
    try:
        records = _fetch_kanzen_products()
        print(f"  Collected {len(records)} vendor price records")

        _match_products_to_vendor_records(client, records)

        upsert_vendor_prices(client, records)
        insert_vendor_prices_history(client, records)
        print("✅ Vendor price scraping completed.")
    except Exception as exc:
        print(f"❌ Vendor price scraping failed: {exc}")
        import traceback

        traceback.print_exc()
        raise

