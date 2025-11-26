"""
Categories scraper module.
Fetches, parses, and upserts category data from tcgcsv.com.
"""

import json
import requests
from datetime import datetime
from typing import Dict, Any, List, Optional
from supabase import Client
from db_config import get_db_schema, get_category_whitelist, is_mock_mode
from mock_utils import dump_data_examples, mock_table_operations


def _normalize_timestamp(timestamp_str: Optional[str]) -> Optional[datetime]:
    """
    Normalize various timestamp formats to datetime object.
    
    Args:
        timestamp_str: ISO format timestamp string or None
        
    Returns:
        datetime object or None
    """
    if not timestamp_str:
        return None
    
    # Try various ISO formats
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
    
    # If all formats fail, return None
    return None


def fetch_categories_json() -> Dict[str, Any]:
    """
    Fetch categories data from tcgcsv.com API.
    
    Returns:
        JSON response as dictionary
        
    Raises:
        requests.RequestException: If the API request fails
    """
    url = "https://tcgcsv.com/tcgplayer/categories"
    response = requests.get(url, timeout=30)
    response.raise_for_status()
    return response.json()


def parse_categories_json(json_data: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Parse JSON response into list of category dictionaries.
    
    Args:
        json_data: JSON response from the API
        
    Returns:
        List of category dictionaries ready for database insertion
    """
    categories = []
    results = json_data.get("results", [])
    
    for item in results:
        modified_on = _normalize_timestamp(item.get("modifiedOn"))
        
        def get_string(key: str) -> Optional[str]:
            value = item.get(key)
            if value is None:
                return None
            if isinstance(value, str):
                cleaned = value.strip()
                return cleaned if cleaned else None
            return str(value).strip() or None
        
        def get_int(key: str) -> Optional[int]:
            value = item.get(key)
            if value is None:
                return None
            try:
                return int(value)
            except (ValueError, TypeError):
                return None
        
        def get_bool(key: str) -> Optional[bool]:
            value = item.get(key)
            if value is None:
                return None
            if isinstance(value, bool):
                return value
            if isinstance(value, str):
                return value.lower() in ("true", "1", "yes")
            return bool(value)
        
        category = {
            "category_id": item.get("categoryId"),
            "name": item.get("name", "").strip() or "",
            "display_name": get_string("displayName"),
            "seo_category_name": get_string("seoCategoryName"),
            "sealed_label": get_string("sealedLabel"),
            "non_sealed_label": get_string("nonSealedLabel"),
            "condition_guide_url": get_string("conditionGuideUrl"),
            "is_scannable": get_bool("isScannable"),
            "popularity": get_int("popularity"),
            "fixed_amount": get_int("fixedAmount"),
            "modified_on": modified_on.isoformat() if modified_on else None,
            "raw": json.dumps(item)
        }
        categories.append(category)
    
    return categories


def filter_categories_by_whitelist(
    categories: List[Dict[str, Any]], 
    whitelist: Optional[List[str]]
) -> List[Dict[str, Any]]:
    """
    Filter categories based on whitelist (category IDs or names).
    
    Args:
        categories: List of category dictionaries
        whitelist: List of category IDs (as strings) or names to include
        
    Returns:
        Filtered list of categories
    """
    if not whitelist:
        return categories
    
    filtered = []
    for cat in categories:
        cat_id = str(cat.get("category_id", ""))
        cat_name = cat.get("name", "").lower()
        
        # Check if category matches whitelist (by ID or name)
        if cat_id in whitelist or cat_name in [w.lower() for w in whitelist]:
            filtered.append(cat)
    
    return filtered


def upsert_categories(client: Client, categories: List[Dict[str, Any]]) -> None:
    """
    Upsert categories into the database using bulk operations.
    
    Args:
        client: Supabase client instance
        schema: Database schema name
        categories: List of category dictionaries to upsert
    """
    if not categories:
        return
    
    # Check for mock mode
    if is_mock_mode():
        print("  [MOCK MODE] Categories upsert - dumping examples:")
        dump_data_examples("categories", categories, "UPSERT", max_examples=5)
        print(f"  [MOCK] Would upsert {len(categories)} categories")
        return
    
    schema = get_db_schema()
    table = client.schema(schema).from_("categories") if schema != "public" else client.table("categories")
    
    try:
        # Bulk fetch existing categories
        category_ids = [cat["category_id"] for cat in categories]
        existing_map = {}
        
        # Fetch in batches to avoid query size limits
        batch_size = 100
        for i in range(0, len(category_ids), batch_size):
            batch_ids = category_ids[i:i + batch_size]
            response = table.select("category_id,modified_on").in_("category_id", batch_ids).execute()
            for row in response.data:
                existing_map[row["category_id"]] = row.get("modified_on")
        
        # Separate new/updated from unchanged
        to_upsert = []
        skipped = 0
        
        for cat in categories:
            cat_id = cat["category_id"]
            existing_modified = existing_map.get(cat_id)
            cat_modified = cat.get("modified_on")
            
            # Skip if unchanged
            if existing_modified and cat_modified and str(existing_modified) == str(cat_modified):
                skipped += 1
                continue
            
            to_upsert.append(cat)
        
        if to_upsert:
            # Bulk upsert
            print(f"  Attempting to upsert {len(to_upsert)} categories...")
            try:
                result = table.upsert(to_upsert, on_conflict="category_id").execute()
                print(f"  ✅ Successfully executed upsert for {len(to_upsert)} categories (skipped {skipped} unchanged)")
                # Supabase upsert may not return data, so we just confirm execution
            except Exception as upsert_err:
                print(f"  ❌ Error during upsert execution: {upsert_err}")
                import traceback
                traceback.print_exc()
                raise  # Re-raise to trigger fallback
        else:
            if skipped > 0:
                print(f"  All {len(categories)} categories up to date (skipped {skipped} unchanged)")
            else:
                print(f"  ⚠️  No categories to upsert (total scraped: {len(categories)})")
            
    except Exception as e:
        print(f"  Error in bulk upsert, falling back to individual operations: {e}")
        import traceback
        traceback.print_exc()
        # Fallback to individual upserts
        for cat in categories:
            try:
                table.upsert(cat, on_conflict="category_id").execute()
            except Exception as err:
                print(f"  Error upserting category {cat.get('category_id')}: {err}")


def scrape_and_upsert_all_categories(client: Client) -> None:
    """
    Main function to fetch, parse, filter, and upsert all categories.
    
    Args:
        client: Supabase client instance
    """
    print("Fetching categories from tcgcsv.com...")
    json_data = fetch_categories_json()
    
    print("Parsing categories...")
    categories = parse_categories_json(json_data)
    print(f"Found {len(categories)} categories")
    
    # Apply whitelist filter if configured
    whitelist = get_category_whitelist()
    if whitelist:
        print(f"Applying category whitelist: {whitelist}")
        categories = filter_categories_by_whitelist(categories, whitelist)
        print(f"Filtered to {len(categories)} categories")
    
    print(f"Upserting {len(categories)} categories...")
    upsert_categories(client, categories)
    print("✅ Categories scraping completed")

