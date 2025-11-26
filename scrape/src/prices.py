"""
Prices scraper module.
Fetches, parses, and upserts pricing information for each product from tcgcsv.com.
"""

import json
import requests
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional
from supabase import Client
from db_config import get_db_schema, get_category_whitelist, is_mock_mode
from categories import filter_categories_by_whitelist
from mock_utils import dump_data_examples


def _normalize_timestamp(timestamp_str: Optional[str]) -> Optional[datetime]:
    """Normalize various timestamp formats to datetime object."""
    if not timestamp_str:
        return None
    
    formats = [
        "%Y-%m-%dT%H:%M:%S.%fZ",
        "%Y-%m-%dT%H:%M:%SZ",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M:%S",
    ]
    
    for fmt in formats:
        try:
            return datetime.strptime(timestamp_str, fmt)
        except ValueError:
            continue
    
    return None


def get_current_hour_timestamp() -> datetime:
    """
    Get the current timestamp rounded down to the hour.
    This ensures we can run the scraper multiple times per day without conflicts.
    """
    now = datetime.now(timezone.utc)
    return now.replace(minute=0, second=0, microsecond=0)


def fetch_prices_json(category_id: int, group_id: int) -> Dict[str, Any]:
    """
    Fetch pricing data for a group of products from tcgcsv.com API.
    
    Endpoint format (per tcgcsv):
        /tcgplayer/{category_id}/{group_id}/prices
    
    The response contains pricing information for all products in the group.
    """
    url = f"https://tcgcsv.com/tcgplayer/{category_id}/{group_id}/prices"
    response = requests.get(url, timeout=30)
    response.raise_for_status()
    return response.json()


def parse_prices_group_json(
    json_data: Dict[str, Any],
    category_id: int,
    group_id: int,
) -> tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """
    Parse group-level prices JSON into lists of current and history price dicts.
    
    Each result item is expected to contain at least:
      - productId
      - lowPrice, midPrice, highPrice, marketPrice, directLowPrice, subTypeName
    """
    prices_current: List[Dict[str, Any]] = []
    prices_history: List[Dict[str, Any]] = []
    
    results = json_data.get("results", [])
    if not results:
        return prices_current, prices_history
    
    fetched_at = get_current_hour_timestamp()
    fetched_at_str = fetched_at.isoformat()
    
    for item in results:
        product_id = item.get("productId")
        if product_id is None:
            continue
        
        # Current price record
        current_price = {
            "product_id": product_id,
            "low_price": item.get("lowPrice"),
            "mid_price": item.get("midPrice"),
            "high_price": item.get("highPrice"),
            "market_price": item.get("marketPrice"),
            "direct_low_price": item.get("directLowPrice"),
            "sub_type_name": item.get("subTypeName"),
            "fetched_at": fetched_at_str,
            "raw": json.dumps(item),
        }
        prices_current.append(current_price)
        
        # History price record
        history_price = {
            "product_id": product_id,
            "fetched_at": fetched_at_str,
            "low_price": item.get("lowPrice"),
            "mid_price": item.get("midPrice"),
            "high_price": item.get("highPrice"),
            "market_price": item.get("marketPrice"),
            "direct_low_price": item.get("directLowPrice"),
            "sub_type_name": item.get("subTypeName"),
            "raw": json.dumps(item),
        }
        prices_history.append(history_price)
    
    return prices_current, prices_history


def _dedupe_by_product_id(records: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Deduplicate a list of price records by product_id.
    
    Supabase/Postgres upserts cannot handle multiple rows with the same
    constrained key (product_id) in a single ON CONFLICT statement.
    We keep the last record seen for each product_id.
    """
    by_id: Dict[Any, Dict[str, Any]] = {}
    for rec in records:
        pid = rec.get("product_id")
        if pid is None:
            continue
        by_id[pid] = rec
    return list(by_id.values())


def upsert_prices(client: Client, prices_current: List[Dict[str, Any]], prices_history: List[Dict[str, Any]]) -> None:
    """
    Upsert prices into both prices_current and prices_history tables.
    Uses hourly timestamps to avoid primary key conflicts.
    
    Note: prices_history is ALWAYS inserted (even if prices_current is empty) 
    because it's a historical record that should be created on every run.
    """
    # Always process prices_history, even if prices_current is empty
    # This ensures we capture price history on every run
    if not prices_current and not prices_history:
        return

    # Deduplicate records by product_id to avoid ON CONFLICT multi-update errors
    original_current_len = len(prices_current)
    original_history_len = len(prices_history)
    prices_current = _dedupe_by_product_id(prices_current)
    prices_history = _dedupe_by_product_id(prices_history)
    if len(prices_current) != original_current_len:
        print(f"      Deduped current prices: {original_current_len} -> {len(prices_current)} by product_id")
    if len(prices_history) != original_history_len:
        print(f"      Deduped history prices: {original_history_len} -> {len(prices_history)} by product_id")
    
    # Check for mock mode
    if is_mock_mode():
        print("      [MOCK MODE] Prices upsert - dumping examples:")
        dump_data_examples("prices_current", prices_current, "UPSERT", max_examples=3)
        
        if prices_history:
            print("      [MOCK MODE] Prices history insert - dumping examples:")
            dump_data_examples("prices_history", prices_history, "INSERT", max_examples=3)
            print(f"      [MOCK] Would insert {len(prices_history)} history records")
        
        print(f"      [MOCK] Would upsert {len(prices_current)} current prices")
        return
    
    schema = get_db_schema()
    current_table = client.schema(schema).from_("prices_current") if schema != "public" else client.table("prices_current")
    history_table = client.schema(schema).from_("prices_history") if schema != "public" else client.table("prices_history")
    
    try:
        # Bulk upsert current prices (if any)
        if prices_current:
            print(f"      Attempting to upsert {len(prices_current)} current prices...")
            try:
                result = current_table.upsert(prices_current, on_conflict="product_id").execute()
                print(f"      ✅ Successfully executed upsert for {len(prices_current)} current prices")
            except Exception as upsert_err:
                print(f"      ❌ Error during current prices upsert: {upsert_err}")
                import traceback
                traceback.print_exc()
                raise  # Re-raise to trigger fallback
        else:
            print(f"      No current prices to upsert (all may have been skipped)")
        
        # For history, ALWAYS insert (even if prices_current was empty)
        # This ensures we capture price history on every run
        if prices_history:
            fetched_at = prices_history[0]["fetched_at"]
            product_ids = [p["product_id"] for p in prices_history]
            
            # Delete existing entries for this hour
            # Note: We delete before insert to avoid primary key conflicts
            # Delete each product individually to ensure the query works correctly
            for product_id in product_ids:
                try:
                    history_table.delete().eq("product_id", product_id).eq("fetched_at", fetched_at).execute()
                except Exception as delete_err:
                    # Log but continue - might be no existing record, which is fine
                    pass
            
            # Insert new history entries in batches
            inserted_count = 0
            batch_size = 500
            for i in range(0, len(prices_history), batch_size):
                batch = prices_history[i:i + batch_size]
                try:
                    history_table.insert(batch).execute()
                    inserted_count += len(batch)
                except Exception as insert_err:
                    print(f"      Error inserting history batch {i//batch_size + 1}: {insert_err}")
                    import traceback
                    traceback.print_exc()
                    # Try individual inserts for this batch to identify problematic records
                    for price in batch:
                        try:
                            history_table.insert(price).execute()
                            inserted_count += 1
                        except Exception as individual_err:
                            print(f"      Error inserting history for product {price.get('product_id')}: {individual_err}")
                            import traceback
                            traceback.print_exc()
            
            if inserted_count > 0:
                print(f"      Inserted {inserted_count} history records")
            else:
                print(f"      WARNING: Failed to insert any history records!")
        else:
            print(f"      No history records to insert")
        
    except Exception as e:
        print(f"      Error in bulk upsert, falling back to individual operations: {e}")
        import traceback
        traceback.print_exc()
        
        # Fallback to individual upserts for current prices
        for price in prices_current:
            try:
                current_table.upsert(price, on_conflict="product_id").execute()
            except Exception as err:
                print(f"      Error upserting price for product {price.get('product_id')}: {err}")
        
        # Fallback for history prices
        if prices_history:
            fetched_at = prices_history[0]["fetched_at"]
            inserted_count = 0
            for price in prices_history:
                try:
                    # Delete existing entry for this hour
                    history_table.delete().eq("product_id", price["product_id"]).eq("fetched_at", fetched_at).execute()
                    # Insert new entry
                    history_table.insert(price).execute()
                    inserted_count += 1
                except Exception as err:
                    print(f"      Error upserting history price for product {price.get('product_id')}: {err}")
                    import traceback
                    traceback.print_exc()
            
            print(f"      Inserted {inserted_count} history records (fallback mode)")


def scrape_and_upsert_prices_for_category_bulk(client: Client, category_id: int) -> None:
    """
    Scrape and upsert all prices for a category in bulk.
    Processes all products for the category and performs bulk operations.
    """
    schema = get_db_schema()
    groups_table = client.schema(schema).from_("groups") if schema != "public" else client.table("groups")
    
    # Fetch all groups for this category
    response = groups_table.select("group_id").eq("category_id", category_id).execute()
    groups = response.data
    
    if not groups:
        print(f"      ⚠️  No groups found in database for category {category_id} - cannot scrape prices")
        print(f"      (Groups/products must be scraped first before prices can be scraped)")
        return
    
    print(f"    Processing {len(groups)} groups for category {category_id}...")
    
    prices_current: List[Dict[str, Any]] = []
    prices_history: List[Dict[str, Any]] = []
    failed_count = 0
    
    for group in groups:
        group_id = group["group_id"]
        try:
            json_data = fetch_prices_json(category_id, group_id)
            curr_list, hist_list = parse_prices_group_json(json_data, category_id, group_id)
            prices_current.extend(curr_list)
            prices_history.extend(hist_list)
        except Exception as e:
            failed_count += 1
            print(f"      ⚠️  Error scraping prices for group {group_id}: {e}")
    
    if failed_count > 0:
        print(f"      ⚠️  Failed to scrape prices for {failed_count} groups")
    
    # Always upsert prices, even if prices_current is empty
    # prices_history should ALWAYS be written for historical tracking
    if prices_current or prices_history:
        print(f"      Collected {len(prices_current)} current prices and {len(prices_history)} history records")
        upsert_prices(client, prices_current, prices_history)
    else:
        print(f"      ⚠️  No prices collected for category {category_id} (may indicate API issues)")


def scrape_and_upsert_all_prices(client: Client) -> None:
    """Main function to fetch and upsert all prices for all categories."""
    schema = get_db_schema()
    table = client.schema(schema).from_("categories") if schema != "public" else client.table("categories")
    
    # Fetch all categories from database
    response = table.select("category_id,name").execute()
    all_categories = response.data
    
    # Apply whitelist filter if configured
    whitelist = get_category_whitelist()
    if whitelist:
        categories = filter_categories_by_whitelist(all_categories, whitelist)
    else:
        categories = all_categories
    
    print(f"Scraping prices for {len(categories)} categories...")
    
    for cat in categories:
        category_id = cat["category_id"]
        category_name = cat.get("name", "Unknown")
        print(f"  Processing category {category_id} ({category_name})...")
        scrape_and_upsert_prices_for_category_bulk(client, category_id)
    
    print("✅ Prices scraping completed")

