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

from db_config import get_db_schema, is_mock_mode, should_scrape_vendor
from mock_utils import dump_data_examples


KANZEN_BASE_URL = "https://kanzengames.com"
KANZEN_COLLECTION_PATH = "/collections/gundam-singles-all"
STORE_401_BASE_URL = "https://store.401games.ca"
CURRENCY_RATES_URL = "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.min.json"
FASTSIMON_API_URL = (
    "https://api.fastsimon.com/categories_navigation"
    "?page_num=1&products_per_page=999999&facets_required=1"
    "&with_product_attributes=false&request_source=v-next-ssr&src=v-next-ssr"
    "&UUID=d3cae9c0-9d9b-4fe3-ad81-873270df14b5&uuid=d3cae9c0-9d9b-4fe3-ad81-873270df14b5"
    "&store_id=17041809&api_type=json&narrow=%5B%5D&sort_by=relevance&category_id=313010651323"
)
HTTP_TIMEOUT = 30
USER_AGENT = "Mozilla/5.0 (compatible; TCGScraper/1.0)"
AMBIGUOUS_LOG_SHOWN = False

RARITY_PRIORITY = ["lr", "r", "u", "c"]
RARITY_PRIORITY_MAP = {value: idx for idx, value in enumerate(RARITY_PRIORITY)}
RARITY_EQUIVALENTS = {
    "legend rare": "lr",
    "legendary rare": "lr",
    "rare": "r",
    "uncommon": "u",
    "common": "c",
}

META_NUMBER = "_meta_number"
META_GROUP = "_meta_group"
META_RARITY_HINT = "_meta_rarity_hint"
META_VENDOR_GROUP_ABBREV = "_meta_vendor_group_abbrev"
META_VENDOR_GROUP_NAME_ONLY = "_meta_vendor_group_name_only"


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

def _fetch_currency_rates() -> Dict[str, float]:
    """Fetch and cache USD-based currency conversion rates."""
    try:
        response = requests.get(CURRENCY_RATES_URL, timeout=HTTP_TIMEOUT)
        response.raise_for_status()
        payload = response.json()
        rates = payload.get("usd", {})
        return {k.lower(): float(v) for k, v in rates.items() if v}
    except Exception as exc:
        print(f"  ⚠️  Could not fetch currency conversion rates: {exc}")
        return {}


def _convert_to_usd(value: Optional[float], currency: str, rates: Dict[str, float]) -> Optional[float]:
    """Convert a numeric price value from the given currency to USD."""
    if value is None:
        return None


def _normalize_rarity_value(value: Optional[str]) -> tuple[Optional[str], int]:
    if not value:
        return None, 0
    cleaned = value.strip().lower()
    plus_count = 0
    while cleaned.endswith("+"):
        plus_count += 1
        cleaned = cleaned[:-1]
    cleaned = cleaned.strip()
    base = RARITY_EQUIVALENTS.get(cleaned, cleaned if cleaned else None)
    return base, plus_count


def _rarity_strings_equal(a: Optional[str], b: Optional[str]) -> bool:
    base_a, plus_a = _normalize_rarity_value(a)
    base_b, plus_b = _normalize_rarity_value(b)
    return base_a is not None and base_a == base_b and plus_a == plus_b


def _rarity_sort_key(value: Optional[str]) -> tuple[int, int]:
    base, plus = _normalize_rarity_value(value)
    priority = RARITY_PRIORITY_MAP.get(base or "", len(RARITY_PRIORITY))
    return (priority, -(plus or 0))
    currency_key = currency.lower()
    if currency_key == "usd":
        return round(value, 6)
    rate = rates.get(currency_key)
    if not rate:
        return None
    try:
        usd_value = value / rate
        return round(usd_value, 6)
    except Exception:
        return None


def _fetch_kanzen_products(currency_rates: Dict[str, float]) -> List[Dict[str, Any]]:
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

            price_single_value = _parse_price_value(price_single)
            price_min_value = _parse_price_value(price_min)
            price_max_value = _parse_price_value(price_max)

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
                "market_price": _convert_to_usd(price_single_value, "cad", currency_rates) or price_single_value,
                "price_min_text": price_min,
                "low_price": _convert_to_usd(price_min_value, "cad", currency_rates) or price_min_value,
                "price_max_text": price_max,
                "high_price": _convert_to_usd(price_max_value, "cad", currency_rates) or price_max_value,
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


def _parse_401_group_label(label: Optional[str]) -> Dict[str, Optional[str]]:
    """
    Parse Fast Simon group label format: "{abbr} {type}: {name}".
    Returns dict with abbreviation and name components.
    """
    result = {"abbreviation": None, "name": None, "full": None}
    if not label:
        return result
    result["full"] = label.strip()

    parts = label.split(":", 1)
    if len(parts) == 2:
        left, name = parts
        result["name"] = name.strip() or None
        left = left.strip()
        if left:
            tokens = left.split()
            if tokens:
                result["abbreviation"] = tokens[0].strip()
    else:
        result["name"] = label.strip() or None
    return result


def _fetch_401games_products(currency_rates: Dict[str, float]) -> List[Dict[str, Any]]:
    """Fetch vendor pricing data from 401 Games Fast Simon API."""
    vendor_domain = "store.401games.ca"
    fetched_at = _current_hour_iso()
    headers = {"User-Agent": USER_AGENT}

    try:
        response = requests.get(FASTSIMON_API_URL, headers=headers, timeout=HTTP_TIMEOUT)
        response.raise_for_status()
    except Exception as exc:
        print(f"  ❌ Error fetching 401 Games data: {exc}")
        return []

    payload = response.json()
    items = payload.get("items", [])
    records: List[Dict[str, Any]] = []

    for item in items:
        title = item.get("l")
        if not title:
            continue

        price_single = item.get("p") or None
        price_min = item.get("p_min") or None
        price_max = item.get("p_max") or None
        quickshop_rel = item.get("u") or ""
        quickshop_url = urljoin(STORE_401_BASE_URL, quickshop_rel)

        price_single_value = _parse_price_value(price_single)
        price_min_value = _parse_price_value(price_min)
        price_max_value = _parse_price_value(price_max)

        record = {
            "vendor": vendor_domain,
            "title": title,
            "price_single_text": price_single,
            "market_price": _convert_to_usd(price_single_value, "cad", currency_rates) or price_single_value,
            "price_min_text": price_min,
            "low_price": _convert_to_usd(price_min_value, "cad", currency_rates) or price_min_value,
            "price_max_text": price_max,
            "high_price": _convert_to_usd(price_max_value, "cad", currency_rates) or price_max_value,
            "quickshop_url": quickshop_url,
            "source_url": FASTSIMON_API_URL,
            "fetched_at": fetched_at,
            "product_id": None,
            "raw": json.dumps(item),
        }

        record.update(_extract_title_metadata(title))

        group_info = _parse_401_group_label(item.get("v"))
        if group_info.get("full"):
            record[META_GROUP] = group_info["full"]
        if group_info.get("abbreviation"):
            record[META_VENDOR_GROUP_ABBREV] = group_info["abbreviation"]
        if group_info.get("name"):
            record[META_VENDOR_GROUP_NAME_ONLY] = group_info["name"]
        records.append(record)

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

    def resolve_group_ids() -> tuple[Optional[Set[int]], bool]:
        hint_used = False
        group_name_hint = record.get(META_GROUP)
        if group_name_hint:
            hint_used = True
            key = group_name_hint.strip().lower()
            if key in group_ids_by_name:
                return group_ids_by_name[key], hint_used

        vendor = record.get("vendor")
        if vendor == "store.401games.ca":
            abbr = record.get(META_VENDOR_GROUP_ABBREV)
            if abbr:
                hint_used = True
                abbr_key = abbr.strip().lower()
                matches: Set[int] = set()
                for name_key, ids in group_ids_by_name.items():
                    if name_key.startswith(abbr_key):
                        matches.update(ids)
                if matches:
                    return matches, hint_used

            name_hint = record.get(META_VENDOR_GROUP_NAME_ONLY)
            if name_hint:
                hint_used = True
                target = name_hint.strip().lower()
                matches: Set[int] = set()
                for name_key, ids in group_ids_by_name.items():
                    suffix = name_key.split(":")[-1].strip()
                    if suffix == target:
                        matches.update(ids)
                if matches:
                    return matches, hint_used

        return None, hint_used

    filtered = candidates
    group_ids, hint_used = resolve_group_ids()
    if group_ids:
        filtered = [c for c in filtered if c.get("group_id") in group_ids]
        if len(filtered) == 1:
            return filtered[0]["product_id"]
    if len(filtered) > 1:
        rarity_phrase = None
        rarity_match = re.search(r"\(([A-Za-z0-9\+\s]+)\)", record["title"])
        if rarity_match:
            rarity_phrase = rarity_match.group(1).strip().lower()

        hint = record.get(META_RARITY_HINT)

        if rarity_phrase:
            rarity_filtered = [
                c for c in filtered if _rarity_strings_equal(c.get("rarity"), rarity_phrase)
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

    sorted_candidates = sorted(filtered, key=lambda c: _rarity_sort_key(c.get("rarity")))
    chosen = sorted_candidates[0] if sorted_candidates else None

    if chosen:
        return chosen.get("product_id")

    print(
        f"  ⚠️  Unable to match vendor product '{record['title']}' "
        f"(number={number}) to a unique product_id"
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


def _dedupe_vendor_records(records: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Remove duplicate (vendor,title) combos, keeping the last occurrence."""
    deduped: Dict[tuple, Dict[str, Any]] = {}
    for record in records:
        key = (record.get("vendor"), record.get("title"))
        deduped[key] = record
    return list(deduped.values())


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

    deduped_records = _dedupe_vendor_records(records)
    cleaned_records = _strip_internal_fields(deduped_records)

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
        currency_rates = _fetch_currency_rates()
        if not currency_rates:
            print("  ⚠️  Currency rates unavailable; price_value columns will use vendor currency values.")
        all_records: List[Dict[str, Any]] = []

        if should_scrape_vendor("kanzengames"):
            kanzen_records = _fetch_kanzen_products(currency_rates)
            print(f"  Collected {len(kanzen_records)} Kanzen vendor price records")
            all_records.extend(kanzen_records)
        else:
            print("  ⏭️  Skipping Kanzen vendor scraping (SCRAPE_VENDOR_KANZENGAMES=false)")

        if should_scrape_vendor("401games"):
            games401_records = _fetch_401games_products(currency_rates)
            print(f"  Collected {len(games401_records)} 401 Games vendor price records")
            all_records.extend(games401_records)
        else:
            print("  ⏭️  Skipping 401 Games vendor scraping (SCRAPE_VENDOR_401GAMES=false)")

        _match_products_to_vendor_records(client, all_records)

        upsert_vendor_prices(client, all_records)
        insert_vendor_prices_history(client, all_records)
        print("✅ Vendor price scraping completed.")
    except Exception as exc:
        print(f"❌ Vendor price scraping failed: {exc}")
        import traceback

        traceback.print_exc()
        raise

