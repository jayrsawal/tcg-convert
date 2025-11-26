"""
Products scraper module.
Fetches, parses, and upserts product data and extended data for each group from tcgcsv.com.
"""

import json
import requests
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional
from supabase import Client
from db_config import get_db_schema, get_category_whitelist, is_mock_mode
from categories import filter_categories_by_whitelist


def _extract_rarity_from_extended(ext_data: Optional[List[Dict[str, Any]]]) -> Optional[str]:
    """Return the first rarity value found in extended data."""
    if not ext_data:
        return None
    for entry in ext_data:
        if not isinstance(entry, dict):
            continue
        name = (entry.get("name") or "").strip().lower()
        display = (entry.get("displayName") or "").strip().lower()
        if name == "rarity" or display == "rarity":
            value = entry.get("value")
            if isinstance(value, str):
                value = value.strip()
            return value or None
    return None
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


def fetch_products_json(category_id: int, group_id: int) -> Dict[str, Any]:
    """Fetch products data for a group from tcgcsv.com API."""
    url = f"https://tcgcsv.com/tcgplayer/{category_id}/{group_id}/products"
    response = requests.get(url, timeout=30)
    response.raise_for_status()
    return response.json()


def parse_products_json(json_data: Dict[str, Any], category_id: int, group_id: int) -> tuple[List[Dict], List[Dict]]:
    """
    Parse JSON response into lists of product and extended data dictionaries.
    
    Returns:
        Tuple of (products list, extended_data list)
    """
    products = []
    extended_data = []
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
        
        # Extract extended data before creating product dict
        ext_data = item.get("extendedData", [])
        extended_data_raw = json.dumps(ext_data) if ext_data else None
        rarity_value = _extract_rarity_from_extended(ext_data)
        
        def get_int(key: str) -> Optional[int]:
            value = item.get(key)
            if value is None:
                return None
            try:
                return int(value)
            except (ValueError, TypeError):
                return None
        
        product = {
            "product_id": item.get("productId"),
            "category_id": category_id,
            "group_id": group_id,
            "name": get_string("name") or "",
            "clean_name": get_string("cleanName"),
            "image_url": get_string("imageUrl"),
            "url": get_string("url"),
            "number": get_string("number"),
            "fixed_amount": get_int("fixedAmount"),
            "modified_on": modified_on.isoformat() if modified_on else None,
            "raw": json.dumps(item),
            "extended_data_raw": extended_data_raw,
            "rarity": rarity_value
        }
        products.append(product)
        
        # Extract extended data for separate table
        product_id = product["product_id"]
        if ext_data and isinstance(ext_data, list):
            for ext_item in ext_data:
                if isinstance(ext_item, dict):
                    key = ext_item.get("name") or ext_item.get("displayName")
                    value = ext_item.get("value")
                    if key:
                        extended_data.append({
                            "product_id": product_id,
                            "key": str(key).strip(),
                            "value": str(value).strip() if value else None
                        })
    
    return products, extended_data


def upsert_products(client: Client, products: List[Dict[str, Any]], extended_data: List[Dict[str, Any]]) -> None:
    """Upsert products and extended data into the database using bulk operations."""
    if not products:
        return
    
    # Check for mock mode
    if is_mock_mode():
        print("      [MOCK MODE] Products upsert - dumping examples:")
        dump_data_examples("products", products, "UPSERT", max_examples=3)
        
        if extended_data:
            print("      [MOCK MODE] Product extended data insert - dumping examples:")
            dump_data_examples("product_extended_data", extended_data, "INSERT", max_examples=5)
            print(f"      [MOCK] Would insert {len(extended_data)} extended data records")
        
        print(f"      [MOCK] Would upsert {len(products)} products")
        return
    
    schema = get_db_schema()
    products_table = client.schema(schema).from_("products") if schema != "public" else client.table("products")
    ext_data_table = client.schema(schema).from_("product_extended_data") if schema != "public" else client.table("product_extended_data")
    
    try:
        # Bulk fetch existing products
        product_ids = [p["product_id"] for p in products]
        existing_map = {}
        
        batch_size = 100
        for i in range(0, len(product_ids), batch_size):
            batch_ids = product_ids[i:i + batch_size]
            response = products_table.select("product_id,modified_on").in_("product_id", batch_ids).execute()
            for row in response.data:
                existing_map[row["product_id"]] = row.get("modified_on")
        
        # Separate new/updated from unchanged
        to_upsert = []
        skipped = 0
        
        for product in products:
            product_id = product["product_id"]
            existing_modified = existing_map.get(product_id)
            product_modified = product.get("modified_on")
            
            if existing_modified and product_modified and str(existing_modified) == str(product_modified):
                skipped += 1
                continue
            
            to_upsert.append(product)
        
        if to_upsert:
            print(f"      Attempting to upsert {len(to_upsert)} products...")
            try:
                result = products_table.upsert(to_upsert, on_conflict="product_id").execute()
                print(f"      ✅ Successfully executed upsert for {len(to_upsert)} products (skipped {skipped} unchanged)")
            except Exception as upsert_err:
                print(f"      ❌ Error during upsert execution: {upsert_err}")
                import traceback
                traceback.print_exc()
                raise  # Re-raise to trigger fallback
        else:
            if skipped > 0:
                print(f"      All {len(products)} products up to date (skipped {skipped} unchanged)")
            else:
                print(f"      ⚠️  No products to upsert (total scraped: {len(products)})")
        
        # Handle extended data: delete old and insert new for updated products
        if to_upsert:
            updated_product_ids = [p["product_id"] for p in to_upsert]
            # Delete existing extended data for updated products
            ext_data_table.delete().in_("product_id", updated_product_ids).execute()
            
            # Insert new extended data
            if extended_data:
                # Filter extended data to only include updated products
                ext_data_to_insert = [ed for ed in extended_data if ed["product_id"] in updated_product_ids]
                if ext_data_to_insert:
                    # Insert in batches
                    batch_size = 500
                    for i in range(0, len(ext_data_to_insert), batch_size):
                        batch = ext_data_to_insert[i:i + batch_size]
                        ext_data_table.insert(batch).execute()
                    print(f"      Inserted {len(ext_data_to_insert)} extended data records")
            
    except Exception as e:
        print(f"      Error in bulk upsert, falling back to individual operations: {e}")
        for product in products:
            try:
                products_table.upsert(product, on_conflict="product_id").execute()
            except Exception as err:
                print(f"      Error upserting product {product.get('product_id')}: {err}")


def upsert_category_extended_data_keys(client: Client, category_id: int, extended_data: List[Dict[str, Any]]) -> None:
    """
    Track distinct extended data keys for a category.
    
    Args:
        client: Supabase client instance
        category_id: Category ID
        extended_data: List of extended data dictionaries with 'key' field
    """
    if not extended_data:
        return
    
    # Get unique keys
    unique_keys = set(ed.get("key") for ed in extended_data if ed.get("key"))
    
    if not unique_keys:
        return
    
    # Check for mock mode
    if is_mock_mode():
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc)
        records = [
            {"category_id": category_id, "key": key, "last_seen": now.isoformat()}
            for key in unique_keys
        ]
        print("      [MOCK MODE] Category extended data keys upsert - dumping examples:")
        dump_data_examples("category_extended_data_keys", records, "UPSERT", max_examples=5)
        print(f"      [MOCK] Would upsert {len(records)} category extended data keys for category {category_id}")
        return
    
    schema = get_db_schema()
    table = client.schema(schema).from_("category_extended_data_keys") if schema != "public" else client.table("category_extended_data_keys")
    
    try:
        # Fetch existing keys for this category
        response = table.select("key").eq("category_id", category_id).execute()
        existing_keys = set(row["key"] for row in response.data)
        
        # Insert new keys
        new_keys = unique_keys - existing_keys
        if new_keys:
            records = [
                {"category_id": category_id, "key": key}
                for key in new_keys
            ]
            table.upsert(records, on_conflict="category_id,key").execute()
        
        # Update last_seen for all keys
        if unique_keys:
            from datetime import datetime, timezone
            now = datetime.now(timezone.utc)
            for key in unique_keys:
                table.upsert(
                    {"category_id": category_id, "key": key, "last_seen": now.isoformat()},
                    on_conflict="category_id,key"
                ).execute()
                
    except Exception as e:
        print(f"      Error updating category extended data keys: {e}")


def scrape_and_upsert_products_for_group(client: Client, category_id: int, group_id: int, group_name: str) -> tuple[List[Dict], List[Dict]]:
    """
    Scrape products for a group and return them without upserting.
    Useful for bulk processing at category level.
    
    Returns:
        Tuple of (products list, extended_data list)
    """
    try:
        json_data = fetch_products_json(category_id, group_id)
        return parse_products_json(json_data, category_id, group_id)
    except Exception as e:
        print(f"      Error scraping products for group {group_id}: {e}")
        return [], []


def scrape_and_upsert_products_for_category_bulk(client: Client, category_id: int) -> None:
    """
    Scrape and upsert all products for a category in bulk.
    Processes all groups for the category and performs bulk operations.
    """
    schema = get_db_schema()
    groups_table = client.schema(schema).from_("groups") if schema != "public" else client.table("groups")
    
    # Fetch all groups for this category
    response = groups_table.select("group_id,name").eq("category_id", category_id).execute()
    groups = response.data
    
    if not groups:
        return
    
    print(f"    Processing {len(groups)} groups for category {category_id}...")
    
    all_products = []
    all_extended_data = []
    
    for group in groups:
        group_id = group["group_id"]
        products, extended_data = scrape_and_upsert_products_for_group(client, category_id, group_id, group.get("name", ""))
        all_products.extend(products)
        all_extended_data.extend(extended_data)
    
    # Bulk upsert all products for the category
    if all_products:
        upsert_products(client, all_products, all_extended_data)
        upsert_category_extended_data_keys(client, category_id, all_extended_data)


def scrape_and_upsert_all_products(client: Client) -> None:
    """Main function to fetch and upsert all products for all categories."""
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
    
    print(f"Scraping products for {len(categories)} categories...")
    
    for cat in categories:
        category_id = cat["category_id"]
        category_name = cat.get("name", "Unknown")
        print(f"  Processing category {category_id} ({category_name})...")
        scrape_and_upsert_products_for_category_bulk(client, category_id)
    
    print("✅ Products scraping completed")

