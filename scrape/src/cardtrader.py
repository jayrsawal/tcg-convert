"""
CardTrader API scraper module.
Fetches, parses, and upserts CardTrader API v2 data: games, categories, expansions, blueprints.
"""

import json
import requests
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional, Tuple
from supabase import Client
from db_config import (
    get_db_schema,
    get_cardtrader_key,
    get_cardtrader_game_whitelist,
    is_mock_mode
)
from mock_utils import dump_data_examples


CARDTRADER_API_BASE = "https://api.cardtrader.com/api/v2"
CURRENCY_RATES_URL = "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.min.json"


def _normalize_timestamp(timestamp_str: Optional[str]) -> Optional[str]:
    """
    Normalize timestamp to ISO format string.
    If already a string, return as-is. If datetime object, convert to ISO.
    """
    if timestamp_str is None:
        return None
    
    if isinstance(timestamp_str, str):
        return timestamp_str
    
    if isinstance(timestamp_str, datetime):
        return timestamp_str.isoformat()
    
    return str(timestamp_str)


def _normalize_date(date_str: Optional[str]) -> Optional[str]:
    """
    Normalize date string to YYYY-MM-DD format.
    """
    if date_str is None:
        return None
    
    if isinstance(date_str, str):
        # Try to parse and reformat if needed
        try:
            # Try common date formats
            for fmt in ["%Y-%m-%d", "%Y/%m/%d", "%d/%m/%Y", "%m/%d/%Y"]:
                try:
                    dt = datetime.strptime(date_str, fmt)
                    return dt.strftime("%Y-%m-%d")
                except ValueError:
                    continue
            # If parsing fails, return as-is
            return date_str
        except Exception:
            return date_str
    
    return str(date_str)


def _flatten_object(obj: Dict[str, Any], prefix: str = "") -> Dict[str, Any]:
    """
    Flatten a nested object, keeping arrays as JSON.
    
    Args:
        obj: Dictionary to flatten
        prefix: Optional prefix for nested keys
        
    Returns:
        Flattened dictionary
    """
    flattened = {}
    
    for key, value in obj.items():
        new_key = f"{prefix}_{key}" if prefix else key
        
        if value is None:
            flattened[new_key] = None
        elif isinstance(value, (str, int, float, bool)):
            flattened[new_key] = value
        elif isinstance(value, list):
            # Keep arrays as JSON
            flattened[new_key] = json.dumps(value) if value else None
        elif isinstance(value, dict):
            # Recursively flatten nested objects
            nested = _flatten_object(value, new_key)
            flattened.update(nested)
        else:
            # Convert other types to string
            flattened[new_key] = str(value) if value else None
    
    return flattened


def _current_hour_iso() -> str:
    """
    Get the current UTC timestamp truncated to the hour (ISO format).
    Ensures hourly granularity for fetched_at fields.
    """
    now = datetime.now(timezone.utc)
    hour = now.replace(minute=0, second=0, microsecond=0)
    return hour.isoformat()


def _get_auth_headers() -> Dict[str, str]:
    """Get authentication headers for CardTrader API."""
    token = get_cardtrader_key()
    if not token:
        raise ValueError("CARDTRADER_KEY must be set in environment variables or .env file")
    
    return {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }


def fetch_games() -> List[Dict[str, Any]]:
    """
    Fetch games from CardTrader API.
    
    Returns:
        List of game objects (extracted from response["array"])
    """
    url = f"{CARDTRADER_API_BASE}/games"
    headers = _get_auth_headers()
    
    response = requests.get(url, headers=headers, timeout=30)
    response.raise_for_status()
    data = response.json()
    
    # API returns object with "array" key containing the games
    return data.get("array", [])


def fetch_categories() -> List[Dict[str, Any]]:
    """
    Fetch categories from CardTrader API.
    
    Returns:
        List of category objects
    """
    url = f"{CARDTRADER_API_BASE}/categories"
    headers = _get_auth_headers()
    
    response = requests.get(url, headers=headers, timeout=30)
    response.raise_for_status()
    return response.json()


def fetch_expansions() -> List[Dict[str, Any]]:
    """
    Fetch expansions from CardTrader API.
    
    Returns:
        List of expansion objects
    """
    url = f"{CARDTRADER_API_BASE}/expansions"
    headers = _get_auth_headers()
    
    response = requests.get(url, headers=headers, timeout=30)
    response.raise_for_status()
    return response.json()


def fetch_blueprints(expansion_id: int) -> List[Dict[str, Any]]:
    """
    Fetch blueprints for an expansion from CardTrader API.
    
    Args:
        expansion_id: Expansion ID to fetch blueprints for
        
    Returns:
        List of blueprint objects
    """
    url = f"{CARDTRADER_API_BASE}/blueprints/export"
    headers = _get_auth_headers()
    params = {"expansion_id": expansion_id}
    
    response = requests.get(url, headers=headers, params=params, timeout=30)
    response.raise_for_status()
    return response.json()


def fetch_marketplace_products(expansion_id: int) -> Dict[str, List[Dict[str, Any]]]:
    """
    Fetch marketplace products (listings) for an expansion.
    
    Returns:
        Dictionary keyed by blueprint_id (string) -> list of listing objects
    """
    url = f"{CARDTRADER_API_BASE}/marketplace/products"
    headers = _get_auth_headers()
    params = {"expansion_id": expansion_id}
    
    response = requests.get(url, headers=headers, params=params, timeout=30)
    response.raise_for_status()
    data = response.json()
    
    # Ensure dictionary format (API returns dict keyed by blueprint id strings)
    return data if isinstance(data, dict) else {}


def fetch_currency_rates() -> Dict[str, float]:
    """
    Fetch USD-based currency conversion rates.
    
    Returns:
        Dictionary mapping currency code (lowercase) to units per USD.
        Example: {"cad": 1.41} means 1 USD = 1.41 CAD.
    """
    try:
        response = requests.get(CURRENCY_RATES_URL, timeout=30)
        response.raise_for_status()
        payload = response.json()
        rates = payload.get("usd", {})
        # Normalize keys to lowercase for easier lookup
        return {str(k).lower(): float(v) for k, v in rates.items() if v}
    except Exception as exc:
        print(f"  ⚠️  Could not fetch currency conversion rates: {exc}")
        return {}


def convert_to_usd(price_cents: Optional[int], currency: Optional[str], rates: Dict[str, float]) -> Tuple[Optional[float], Optional[float]]:
    """
    Convert a price (in cents) to USD using provided rates.
    
    Returns:
        Tuple of (price_usd, conversion_rate). Both None if conversion failed.
    """
    if price_cents is None or not currency:
        return None, None
    
    currency_key = currency.lower()
    if currency_key == "usd":
        usd_value = round(price_cents / 100, 6)
        return usd_value, 1.0
    
    rate = rates.get(currency_key)
    if not rate or rate == 0:
        return None, None
    
    usd_value = round((price_cents / 100) / rate, 6)
    return usd_value, rate


def parse_game(game: Dict[str, Any]) -> Dict[str, Any]:
    """
    Parse a game object into database format.
    
    Game object fields per API docs: id, name, display_name
    Reference: https://www.cardtrader.com/docs/api/full/reference
    """
    record = {
        "id": game.get("id"),
        "name": game.get("name"),
        "display_name": game.get("display_name"),
        "raw": json.dumps(game),
    }
    
    return record


def parse_category(category: Dict[str, Any]) -> Dict[str, Any]:
    """
    Parse a category object into database format.
    
    Category object fields per API docs: id, name, game_id, properties (array)
    Reference: https://www.cardtrader.com/docs/api/full/reference
    """
    # Store properties array as JSON
    properties = category.get("properties")
    properties_json = json.dumps(properties) if properties else None
    
    record = {
        "id": category.get("id"),
        "name": category.get("name"),
        "game_id": category.get("game_id"),
        "properties": properties_json,
        "raw": json.dumps(category),
    }
    
    return record


def parse_expansion(expansion: Dict[str, Any]) -> Dict[str, Any]:
    """
    Parse an expansion object into database format.
    
    Expansion object fields per API docs: id, game_id, code, name
    Reference: https://www.cardtrader.com/docs/api/full/reference
    """
    record = {
        "id": expansion.get("id"),
        "game_id": expansion.get("game_id"),
        "code": expansion.get("code"),
        "name": expansion.get("name"),
        "raw": json.dumps(expansion),
    }
    
    return record


def parse_blueprint(blueprint: Dict[str, Any], expansion_id: int) -> Dict[str, Any]:
    """
    Parse a blueprint object into database format.
    
    Blueprint object structure per API reference/docs includes:
      - Basic fields: id, name, version, game_id, category_id, expansion_id
      - Arrays: card_market_ids, editable_properties
      - Nested objects: fixed_properties, image, back_image
      - Optional identifiers: scryfall_id, tcg_player_id
    
    Reference: https://www.cardtrader.com/docs/api/full/reference
    """
    card_market_ids = blueprint.get("card_market_ids")
    editable_properties = blueprint.get("editable_properties")
    fixed_properties = blueprint.get("fixed_properties") if isinstance(blueprint.get("fixed_properties"), dict) else None
    image = blueprint.get("image") if isinstance(blueprint.get("image"), dict) else None
    back_image = blueprint.get("back_image") if isinstance(blueprint.get("back_image"), dict) else None
    
    def _nested_url(value: Optional[Dict[str, Any]]) -> Optional[str]:
        if isinstance(value, dict):
            url = value.get("url")
            return url if isinstance(url, str) else None
        if isinstance(value, str):
            return value
        return None
    
    record: Dict[str, Any] = {
        "id": blueprint.get("id"),
        "name": blueprint.get("name"),
        "expansion_id": expansion_id,
        "game_id": blueprint.get("game_id"),
        "category_id": blueprint.get("category_id"),
        "version": blueprint.get("version"),
        "image_url": blueprint.get("image_url"),
        "scryfall_id": blueprint.get("scryfall_id"),
        "tcg_player_id": blueprint.get("tcg_player_id"),
        "card_market_ids": card_market_ids if card_market_ids else None,
        "editable_properties": editable_properties if editable_properties else None,
        "fixed_properties": fixed_properties if fixed_properties else None,
        "fixed_properties_mtg_rarity": fixed_properties.get("mtg_rarity") if fixed_properties else None,
        "fixed_properties_collector_number": fixed_properties.get("collector_number") if fixed_properties else None,
        "raw": json.dumps(blueprint),
    }
    
    if image:
        record["image_path"] = image.get("url") if isinstance(image.get("url"), str) else None
        record["image_show_url"] = _nested_url(image.get("show"))
        record["image_preview_url"] = _nested_url(image.get("preview"))
        record["image_social_url"] = _nested_url(image.get("social"))
    
    if back_image:
        record["back_image_path"] = back_image.get("url") if isinstance(back_image.get("url"), str) else None
        record["back_image_show_url"] = _nested_url(back_image.get("show"))
        record["back_image_preview_url"] = _nested_url(back_image.get("preview"))
        record["back_image_social_url"] = _nested_url(back_image.get("social"))
    
    return record


def _select_lowest_price_listing(listings: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """
    Select the lowest-priced listing from a list of marketplace products.
    Falls back to the first listing if price data is missing.
    """
    if not listings:
        return None
    
    def _price_value(entry: Dict[str, Any]) -> float:
        price_cents = entry.get("price_cents")
        if price_cents is not None:
            return float(price_cents)
        price_info = entry.get("price") or {}
        return float(price_info.get("cents") or 0)
    
    try:
        return min(listings, key=_price_value)
    except Exception:
        return listings[0]


def parse_marketplace_listing(
    listing: Dict[str, Any],
    blueprint_id: int,
    currency_rates: Dict[str, float],
    fetched_at_iso: str,
    tcg_player_id: Optional[int] = None,
) -> Dict[str, Any]:
    """
    Parse a marketplace listing into the schema used by cardtrader_prices tables.
    """
    price_info = listing.get("price") or {}
    price_cents = listing.get("price_cents", price_info.get("cents"))
    price_currency = listing.get("price_currency", price_info.get("currency"))
    price_value = round(price_cents / 100, 6) if price_cents is not None else None
    
    price_usd, conversion_rate = convert_to_usd(price_cents, price_currency, currency_rates)
    
    expansion = listing.get("expansion") or {}
    user = listing.get("user") or {}
    
    record = {
        "blueprint_id": blueprint_id,
        "listing_id": listing.get("id"),
        "tcg_player_id": tcg_player_id,
        "expansion_id": expansion.get("id"),
        "expansion_code": expansion.get("code"),
        "expansion_name": expansion.get("name_en") or expansion.get("name"),
        "price_cents": price_cents,
        "price_currency": price_currency,
        "price_value": price_value,
        "price_usd": price_usd,
        "conversion_rate_to_usd": conversion_rate,
        "quantity": listing.get("quantity"),
        "description": listing.get("description"),
        "graded": listing.get("graded"),
        "on_vacation": listing.get("on_vacation"),
        "user_id": user.get("id"),
        "user_username": user.get("username"),
        "user_country_code": user.get("country_code"),
        "user_type": user.get("user_type"),
        "user_can_sell_via_hub": user.get("can_sell_via_hub"),
        "user_can_sell_sealed_with_ct_zero": user.get("can_sell_sealed_with_ct_zero"),
        "user_max_sellable_in24h_quantity": user.get("max_sellable_in24h_quantity"),
        "user_too_many_request_for_cancel_as_seller": user.get("too_many_request_for_cancel_as_seller"),
        "price_currency_symbol": price_info.get("currency_symbol"),
        "price_formatted": price_info.get("formatted"),
        "properties_hash": listing.get("properties_hash"),
        "raw": json.dumps(listing),
        "fetched_at": fetched_at_iso,
    }
    
    return record


def upsert_games(client: Client, games: List[Dict[str, Any]]) -> None:
    """Upsert games into cardtrader_games table."""
    if not games:
        return
    
    if is_mock_mode():
        print("  [MOCK MODE] CardTrader games upsert - dumping examples:")
        dump_data_examples("cardtrader_games", games, "UPSERT", max_examples=5)
        print(f"  [MOCK] Would upsert {len(games)} games")
        return
    
    schema = get_db_schema()
    table = client.schema(schema).from_("cardtrader_games") if schema != "public" else client.table("cardtrader_games")
    
    try:
        # Deduplicate by id
        by_id = {g["id"]: g for g in games if g.get("id") is not None}
        unique_games = list(by_id.values())
        
        print(f"  Attempting to upsert {len(unique_games)} games...")
        result = table.upsert(unique_games, on_conflict="id").execute()
        print(f"  ✅ Successfully executed upsert for {len(unique_games)} games")
    except Exception as e:
        print(f"  ❌ Error upserting games: {e}")
        import traceback
        traceback.print_exc()


def upsert_categories(client: Client, categories: List[Dict[str, Any]]) -> None:
    """Upsert categories into cardtrader_categories table."""
    if not categories:
        return
    
    if is_mock_mode():
        print("  [MOCK MODE] CardTrader categories upsert - dumping examples:")
        dump_data_examples("cardtrader_categories", categories, "UPSERT", max_examples=5)
        print(f"  [MOCK] Would upsert {len(categories)} categories")
        return
    
    schema = get_db_schema()
    table = client.schema(schema).from_("cardtrader_categories") if schema != "public" else client.table("cardtrader_categories")
    
    try:
        # Deduplicate by id
        by_id = {c["id"]: c for c in categories if c.get("id") is not None}
        unique_categories = list(by_id.values())
        
        print(f"  Attempting to upsert {len(unique_categories)} categories...")
        result = table.upsert(unique_categories, on_conflict="id").execute()
        print(f"  ✅ Successfully executed upsert for {len(unique_categories)} categories")
    except Exception as e:
        print(f"  ❌ Error upserting categories: {e}")
        import traceback
        traceback.print_exc()


def upsert_expansions(client: Client, expansions: List[Dict[str, Any]]) -> None:
    """Upsert expansions into cardtrader_expansions table."""
    if not expansions:
        return
    
    if is_mock_mode():
        print("  [MOCK MODE] CardTrader expansions upsert - dumping examples:")
        dump_data_examples("cardtrader_expansions", expansions, "UPSERT", max_examples=5)
        print(f"  [MOCK] Would upsert {len(expansions)} expansions")
        return
    
    schema = get_db_schema()
    table = client.schema(schema).from_("cardtrader_expansions") if schema != "public" else client.table("cardtrader_expansions")
    
    try:
        # Deduplicate by id
        by_id = {e["id"]: e for e in expansions if e.get("id") is not None}
        unique_expansions = list(by_id.values())
        
        print(f"  Attempting to upsert {len(unique_expansions)} expansions...")
        result = table.upsert(unique_expansions, on_conflict="id").execute()
        print(f"  ✅ Successfully executed upsert for {len(unique_expansions)} expansions")
    except Exception as e:
        print(f"  ❌ Error upserting expansions: {e}")
        import traceback
        traceback.print_exc()


def upsert_blueprints(client: Client, blueprints: List[Dict[str, Any]]) -> None:
    """Upsert blueprints into cardtrader_blueprints table."""
    if not blueprints:
        return
    
    if is_mock_mode():
        print("  [MOCK MODE] CardTrader blueprints upsert - dumping examples:")
        dump_data_examples("cardtrader_blueprints", blueprints, "UPSERT", max_examples=5)
        print(f"  [MOCK] Would upsert {len(blueprints)} blueprints")
        return
    
    schema = get_db_schema()
    table = client.schema(schema).from_("cardtrader_blueprints") if schema != "public" else client.table("cardtrader_blueprints")
    
    try:
        # Deduplicate by id
        by_id = {b["id"]: b for b in blueprints if b.get("id") is not None}
        unique_blueprints = list(by_id.values())
        
        print(f"  Attempting to upsert {len(unique_blueprints)} blueprints...")
        result = table.upsert(unique_blueprints, on_conflict="id").execute()
        print(f"  ✅ Successfully executed upsert for {len(unique_blueprints)} blueprints")
    except Exception as e:
        print(f"  ❌ Error upserting blueprints: {e}")
        import traceback
        traceback.print_exc()


def upsert_cardtrader_prices(client: Client, prices: List[Dict[str, Any]]) -> None:
    """Upsert current CardTrader marketplace prices."""
    if not prices:
        print("  No CardTrader prices to upsert.")
        return
    
    if is_mock_mode():
        print("  [MOCK MODE] CardTrader prices upsert - dumping examples:")
        dump_data_examples("cardtrader_prices", prices, "UPSERT", max_examples=5)
        print(f"  [MOCK] Would upsert {len(prices)} price records")
        return
    
    schema = get_db_schema()
    table = client.schema(schema).from_("cardtrader_prices") if schema != "public" else client.table("cardtrader_prices")
    
    # Deduplicate by blueprint_id
    by_blueprint = {}
    for record in prices:
        bp_id = record.get("blueprint_id")
        if bp_id is None:
            continue
        by_blueprint[bp_id] = record
    unique_prices = list(by_blueprint.values())
    
    try:
        print(f"  Attempting to upsert {len(unique_prices)} CardTrader price records...")
        table.upsert(unique_prices, on_conflict="blueprint_id").execute()
        print(f"  ✅ Successfully upserted {len(unique_prices)} CardTrader prices")
    except Exception as e:
        print(f"  ❌ Error upserting CardTrader prices: {e}")
        import traceback
        traceback.print_exc()


def insert_cardtrader_prices_history(client: Client, history_rows: List[Dict[str, Any]]) -> None:
    """Insert historical CardTrader marketplace prices."""
    if not history_rows:
        print("  No CardTrader price history records to insert.")
        return
    
    if is_mock_mode():
        print("  [MOCK MODE] CardTrader price history insert - dumping examples:")
        dump_data_examples("cardtrader_prices_history", history_rows, "INSERT", max_examples=5)
        print(f"  [MOCK] Would insert {len(history_rows)} cardtrader price history records")
        return
    
    schema = get_db_schema()
    table = client.schema(schema).from_("cardtrader_prices_history") if schema != "public" else client.table("cardtrader_prices_history")
    
    fetched_at_values = {row.get("fetched_at") for row in history_rows if row.get("fetched_at")}
    target_hour = fetched_at_values.pop() if len(fetched_at_values) == 1 else None
    
    try:
        if target_hour:
            print(f"  Removing existing CardTrader price history records for hour {target_hour}...")
            table.delete().eq("fetched_at", target_hour).execute()
        
        print(f"  Attempting to insert {len(history_rows)} CardTrader price history records...")
        table.insert(history_rows).execute()
        print(f"  ✅ Successfully inserted {len(history_rows)} CardTrader price history records")
    except Exception as e:
        print(f"  ❌ Error inserting CardTrader price history: {e}")
        import traceback
        traceback.print_exc()


def scrape_and_upsert_all_cardtrader(client: Client) -> None:
    """
    Main function to scrape and upsert all CardTrader data.
    Processes games, categories, expansions, and blueprints based on game whitelist.
    """
    print("\n=== CardTrader API Scraping ===")
    
    # Check for API key
    if not get_cardtrader_key():
        print("  ⚠️  CARDTRADER_KEY not set - skipping CardTrader scraping")
        return
    
    try:
        # Determine optional whitelist once
        game_whitelist = get_cardtrader_game_whitelist()
        if game_whitelist:
            print(f"  Game whitelist configured: {game_whitelist}")
        
        # Step 1: Fetch and upsert games
        print("\n[Step 1] Fetching games...")
        games_data = fetch_games()
        games = [parse_game(g) for g in games_data]
        print(f"  Parsed {len(games)} games")
        upsert_games(client, games)
        
        # Step 2: Fetch and upsert categories
        print("\n[Step 2] Fetching categories...")
        categories_data = fetch_categories()
        
        if game_whitelist:
            before_count = len(categories_data)
            categories_data = [c for c in categories_data if c.get("game_id") in game_whitelist]
            print(f"  Filtering categories by game whitelist ({before_count} -> {len(categories_data)})")
        
        categories = [parse_category(c) for c in categories_data]
        print(f"  Parsed {len(categories)} categories")
        upsert_categories(client, categories)
        
        # Step 3: Fetch and upsert expansions (filtered by game whitelist)
        print("\n[Step 3] Fetching expansions...")
        expansions_data = fetch_expansions()
        
        if game_whitelist:
            before_count = len(expansions_data)
            expansions_data = [e for e in expansions_data if e.get("game_id") in game_whitelist]
            print(f"  Filtering expansions by game whitelist ({before_count} -> {len(expansions_data)})")
        
        expansions = [parse_expansion(e) for e in expansions_data]
        print(f"  Parsed {len(expansions)} expansions")
        upsert_expansions(client, expansions)
        
        # Step 4: Fetch and upsert blueprints for each expansion
        print("\n[Step 4] Fetching blueprints for expansions...")
        expansion_ids = [e.get("id") for e in expansions_data if e.get("id") is not None]
        
        all_blueprints = []
        failed_count = 0
        
        for expansion_id in expansion_ids:
            try:
                blueprints_data = fetch_blueprints(expansion_id)
                blueprints = [parse_blueprint(b, expansion_id) for b in blueprints_data]
                all_blueprints.extend(blueprints)
            except Exception as e:
                failed_count += 1
                print(f"  ⚠️  Error fetching blueprints for expansion {expansion_id}: {e}")
        
        if failed_count > 0:
            print(f"  ⚠️  Failed to fetch blueprints for {failed_count} expansions")
        
        print(f"  Parsed {len(all_blueprints)} blueprints total")
        upsert_blueprints(client, all_blueprints)
        
        # Build blueprint -> tcg_player_id map for marketplace prices
        blueprint_tcgplayer_map = {
            bp.get("id"): bp.get("tcg_player_id")
            for bp in all_blueprints
            if bp.get("id") is not None
        }

        # Step 5: Fetch CardTrader marketplace prices
        print("\n[Step 5] Fetching marketplace prices...")
        if not expansion_ids:
            print("  No expansions available for marketplace prices; skipping.")
        else:
            currency_rates = fetch_currency_rates()
            if currency_rates:
                print(f"  Loaded {len(currency_rates)} currency conversion rates")
            else:
                print("  ⚠️  Currency conversion rates unavailable; USD values will be None")
            
            all_prices: List[Dict[str, Any]] = []
            all_history: List[Dict[str, Any]] = []
            price_failures = 0
            
            # Use consistent timestamp for current batch (hourly granularity)
            fetched_at_iso = _current_hour_iso()
            
            for expansion_id in expansion_ids:
                try:
                    marketplace_data = fetch_marketplace_products(expansion_id)
                except Exception as exp_err:
                    price_failures += 1
                    print(f"  ⚠️  Error fetching marketplace products for expansion {expansion_id}: {exp_err}")
                    continue
                
                for blueprint_key, listings in marketplace_data.items():
                    try:
                        blueprint_id = int(blueprint_key)
                    except (TypeError, ValueError):
                        continue
                    
                    lowest_listing = _select_lowest_price_listing(listings)
                    if not lowest_listing:
                        continue
                    
                    record = parse_marketplace_listing(
                        lowest_listing,
                        blueprint_id,
                        currency_rates,
                        fetched_at_iso,
                        tcg_player_id=blueprint_tcgplayer_map.get(blueprint_id),
                    )
                    all_prices.append(record)
                    all_history.append(dict(record))
            
            if price_failures:
                print(f"  ⚠️  Failed to fetch marketplace listings for {price_failures} expansions")
            
            print(f"  Prepared {len(all_prices)} current CardTrader prices and {len(all_history)} history rows")
            upsert_cardtrader_prices(client, all_prices)
            insert_cardtrader_prices_history(client, all_history)
        
        print("\n✅ CardTrader scraping completed")
        
    except Exception as e:
        print(f"\n❌ Error during CardTrader scraping: {e}")
        import traceback
        traceback.print_exc()
        raise

