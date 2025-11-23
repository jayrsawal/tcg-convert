"""
Prices scraper module.
Fetches, parses, and upserts pricing information for each product from tcgcsv.com.
"""

import json
import requests
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional
from supabase import Client
from db_config import get_db_schema, get_category_whitelist
from categories import filter_categories_by_whitelist


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


def fetch_prices_json(product_id: int) -> Dict[str, Any]:
    """Fetch pricing data for a product from tcgcsv.com API."""
    url = f"https://tcgcsv.com/tcgplayer/{product_id}/prices"
    response = requests.get(url, timeout=30)
    response.raise_for_status()
    return response.json()


def parse_prices_json(json_data: Dict[str, Any], product_id: int) -> tuple[Optional[Dict], Optional[Dict]]:
    """
    Parse JSON response into current price and history price dictionaries.
    
    Returns:
        Tuple of (current_price dict, history_price dict) or (None, None) if no data
    """
    results = json_data.get("results", [])
    
    if not results:
        return None, None
    
    # Use the first result as current price
    item = results[0]
    
    fetched_at = get_current_hour_timestamp()
    
    current_price = {
        "product_id": product_id,
        "low_price": item.get("lowPrice"),
        "mid_price": item.get("midPrice"),
        "high_price": item.get("highPrice"),
        "market_price": item.get("marketPrice"),
        "direct_low_price": item.get("directLowPrice"),
        "sub_type_name": item.get("subTypeName"),
        "fetched_at": fetched_at.isoformat(),
        "raw": json.dumps(item)
    }
    
    history_price = {
        "product_id": product_id,
        "fetched_at": fetched_at.isoformat(),  # Use same fetched_at for consistency
        "low_price": item.get("lowPrice"),
        "mid_price": item.get("midPrice"),
        "high_price": item.get("highPrice"),
        "market_price": item.get("marketPrice"),
        "direct_low_price": item.get("directLowPrice"),
        "sub_type_name": item.get("subTypeName"),
        "raw": json.dumps(item)
    }
    
    return current_price, history_price


def upsert_prices(client: Client, prices_current: List[Dict[str, Any]], prices_history: List[Dict[str, Any]]) -> None:
    """
    Upsert prices into both prices_current and prices_history tables.
    Uses hourly timestamps to avoid primary key conflicts.
    """
    if not prices_current:
        return
    
    schema = get_db_schema()
    current_table = client.schema(schema).from_("prices_current") if schema != "public" else client.table("prices_current")
    history_table = client.schema(schema).from_("prices_history") if schema != "public" else client.table("prices_history")
    
    try:
        # Bulk upsert current prices
        current_table.upsert(prices_current, on_conflict="product_id").execute()
        
        # For history, delete existing entries for the current hour, then insert new ones
        if prices_history:
            fetched_at = prices_history[0]["fetched_at"]
            product_ids = [p["product_id"] for p in prices_history]
            
            # Delete existing entries for this hour
            history_table.delete().in_("product_id", product_ids).eq("fetched_at", fetched_at).execute()
            
            # Insert new history entries in batches
            batch_size = 500
            for i in range(0, len(prices_history), batch_size):
                batch = prices_history[i:i + batch_size]
                history_table.insert(batch).execute()
        
        print(f"      Upserted {len(prices_current)} current prices and {len(prices_history)} history records")
        
    except Exception as e:
        print(f"      Error in bulk upsert, falling back to individual operations: {e}")
        # Fallback to individual upserts for current prices
        for price in prices_current:
            try:
                current_table.upsert(price, on_conflict="product_id").execute()
            except Exception as err:
                print(f"      Error upserting price for product {price.get('product_id')}: {err}")
        
        # Fallback for history prices
        if prices_history:
            fetched_at = prices_history[0]["fetched_at"]
            for price in prices_history:
                try:
                    # Delete existing entry for this hour
                    history_table.delete().eq("product_id", price["product_id"]).eq("fetched_at", fetched_at).execute()
                    # Insert new entry
                    history_table.insert(price).execute()
                except Exception as err:
                    print(f"      Error upserting history price for product {price.get('product_id')}: {err}")


def scrape_and_upsert_prices_for_product(client: Client, product_id: int) -> tuple[Optional[Dict], Optional[Dict]]:
    """
    Scrape prices for a product and return them without upserting.
    Useful for bulk processing at category level.
    
    Returns:
        Tuple of (current_price dict, history_price dict) or (None, None) on error
    """
    try:
        json_data = fetch_prices_json(product_id)
        return parse_prices_json(json_data, product_id)
    except Exception as e:
        return None, None


def scrape_and_upsert_prices_for_category_bulk(client: Client, category_id: int) -> None:
    """
    Scrape and upsert all prices for a category in bulk.
    Processes all products for the category and performs bulk operations.
    """
    schema = get_db_schema()
    products_table = client.schema(schema).from_("products") if schema != "public" else client.table("products")
    
    # Fetch all products for this category
    response = products_table.select("product_id").eq("category_id", category_id).execute()
    products = response.data
    
    if not products:
        return
    
    print(f"    Processing {len(products)} products for category {category_id}...")
    
    prices_current = []
    prices_history = []
    
    for product in products:
        product_id = product["product_id"]
        current_price, history_price = scrape_and_upsert_prices_for_product(client, product_id)
        if current_price:
            prices_current.append(current_price)
        if history_price:
            prices_history.append(history_price)
    
    # Bulk upsert all prices for the category
    if prices_current:
        upsert_prices(client, prices_current, prices_history)


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

