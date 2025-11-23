"""
Groups scraper module.
Fetches, parses, and upserts group data for each category from tcgcsv.com.
"""

import json
import requests
from datetime import datetime
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


def fetch_groups_json(category_id: int) -> Dict[str, Any]:
    """Fetch groups data for a category from tcgcsv.com API."""
    url = f"https://tcgcsv.com/tcgplayer/{category_id}/groups"
    response = requests.get(url, timeout=30)
    response.raise_for_status()
    return response.json()


def parse_groups_json(json_data: Dict[str, Any], category_id: int) -> List[Dict[str, Any]]:
    """Parse JSON response into list of group dictionaries."""
    groups = []
    results = json_data.get("results", [])
    
    for item in results:
        modified_on = _normalize_timestamp(item.get("modifiedOn"))
        published_on = _normalize_timestamp(item.get("publishedOn"))
        
        def get_string(key: str) -> Optional[str]:
            value = item.get(key)
            if value is None:
                return None
            if isinstance(value, str):
                cleaned = value.strip()
                return cleaned if cleaned else None
            return str(value).strip() or None
        
        def get_bool(key: str) -> Optional[bool]:
            value = item.get(key)
            if value is None:
                return None
            if isinstance(value, bool):
                return value
            if isinstance(value, str):
                return value.lower() in ("true", "1", "yes")
            return bool(value)
        
        group = {
            "group_id": item.get("groupId"),
            "category_id": category_id,
            "name": item.get("name", "").strip() or "",
            "abbreviation": get_string("abbreviation"),
            "is_supplemental": get_bool("isSupplemental"),
            "published_on": published_on,
            "modified_on": modified_on,
            "raw": json.dumps(item)
        }
        groups.append(group)
    
    return groups


def upsert_groups(client: Client, groups: List[Dict[str, Any]]) -> None:
    """Upsert groups into the database using bulk operations."""
    if not groups:
        return
    
    schema = get_db_schema()
    table = client.schema(schema).from_("groups") if schema != "public" else client.table("groups")
    
    try:
        # Bulk fetch existing groups
        group_ids = [g["group_id"] for g in groups]
        existing_map = {}
        
        batch_size = 100
        for i in range(0, len(group_ids), batch_size):
            batch_ids = group_ids[i:i + batch_size]
            response = table.select("group_id,modified_on").in_("group_id", batch_ids).execute()
            for row in response.data:
                existing_map[row["group_id"]] = row.get("modified_on")
        
        # Separate new/updated from unchanged
        to_upsert = []
        skipped = 0
        
        for group in groups:
            group_id = group["group_id"]
            existing_modified = existing_map.get(group_id)
            group_modified = group.get("modified_on")
            
            if existing_modified and group_modified and str(existing_modified) == str(group_modified):
                skipped += 1
                continue
            
            to_upsert.append(group)
        
        if to_upsert:
            table.upsert(to_upsert, on_conflict="group_id").execute()
            print(f"    Upserted {len(to_upsert)} groups (skipped {skipped} unchanged)")
        else:
            print(f"    All {len(groups)} groups up to date (skipped)")
            
    except Exception as e:
        print(f"    Error in bulk upsert, falling back to individual operations: {e}")
        for group in groups:
            try:
                table.upsert(group, on_conflict="group_id").execute()
            except Exception as err:
                print(f"    Error upserting group {group.get('group_id')}: {err}")


def scrape_and_upsert_groups_for_category(client: Client, category_id: int, category_name: str) -> None:
    """Scrape and upsert groups for a single category."""
    try:
        json_data = fetch_groups_json(category_id)
        groups = parse_groups_json(json_data, category_id)
        
        if groups:
            upsert_groups(client, groups)
        else:
            print(f"    No groups found for category {category_id}")
            
    except Exception as e:
        print(f"    Error scraping groups for category {category_id}: {e}")


def scrape_and_upsert_all_groups(client: Client) -> None:
    """Main function to fetch and upsert all groups for all categories."""
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
    
    print(f"Scraping groups for {len(categories)} categories...")
    
    for cat in categories:
        category_id = cat["category_id"]
        category_name = cat.get("name", "Unknown")
        print(f"  Processing category {category_id} ({category_name})...")
        # Use category-level bulk processing
        groups = scrape_and_upsert_groups_for_category_bulk(client, category_id)
        if groups:
            upsert_groups(client, groups)
    
    print("✅ Groups scraping completed")


def scrape_and_upsert_groups_for_category_bulk(client: Client, category_id: int) -> List[Dict[str, Any]]:
    """
    Scrape groups for a category and return them without upserting.
    Useful for bulk processing at category level.
    """
    try:
        json_data = fetch_groups_json(category_id)
        return parse_groups_json(json_data, category_id)
    except Exception as e:
        print(f"    Error scraping groups for category {category_id}: {e}")
        return []

