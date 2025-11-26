"""
Standalone function to force-write price history.
Bypasses all change detection and dependencies - just writes directly to prices_history.
Fetches prices from existing products in the database using the same endpoint pattern.
"""

from typing import Optional, Dict
from supabase import Client
from db_config import get_db_schema, get_supabase_client
from prices import fetch_prices_json, parse_prices_group_json


def force_insert_price_history_for_product(product_id: int, client: Optional[Client] = None) -> bool:
    """
    Force insert a price history record for a product.
    This bypasses ALL other logic and writes directly to prices_history.
    
    Args:
        product_id: The product ID to fetch prices for
        client: Optional Supabase client (will create one if not provided)
        
    Returns:
        True if successful, False otherwise
    """
    if client is None:
        client = get_supabase_client()
    
    schema = get_db_schema()
    print(f"\n{'='*70}")
    print(f"FORCE INSERT PRICE HISTORY - Product ID: {product_id}")
    print(f"{'='*70}")
    print(f"Schema: {schema}")
    
    try:
        # Look up category_id for this product in the database
        print(f"\n[Step 1] Looking up category_id for product {product_id} in database...")
        products_table = client.schema(schema).from_("products") if schema != "public" else client.table("products")
        prod_resp = products_table.select("category_id,group_id").eq("product_id", product_id).execute()
        if not prod_resp.data:
            print(f"  ❌ No product found in database with product_id={product_id}")
            return False
        category_id = prod_resp.data[0]["category_id"]
        group_id = prod_resp.data[0]["group_id"]
        print(f"  ✅ Found category_id={category_id}, group_id={group_id} for product_id={product_id}")

        # Step 2: Fetch price data from API using the SAME function as main scraper
        print(f"\n[Step 2] Fetching price data from API (group-level endpoint)...")
        json_data = fetch_prices_json(category_id, group_id)
        
        # Step 3: Parse group-level prices
        print(f"\n[Step 3] Parsing price data for group (using same parser as main scraper)...")
        prices_current, prices_history = parse_prices_group_json(json_data, category_id, group_id)
        
        # Find the history record for this specific product
        history_price = next((h for h in prices_history if h.get("product_id") == product_id), None)
        if not history_price:
            print(f"  ❌ No price data found in group response for product_id={product_id}")
            return False
        
        print(f"  ✅ Got price data from API")
        print(f"     Low: ${history_price.get('low_price')}, Mid: ${history_price.get('mid_price')}, High: ${history_price.get('high_price')}")
        
        # Use the parsed history_price directly - it's already in the correct format
        history_record = history_price
        
        print(f"  ✅ Record prepared")
        print(f"     fetched_at: {history_record['fetched_at']}")
        print(f"     product_id: {history_record['product_id']}")
        
        # Step 4: Delete any existing record for this hour (to avoid conflicts)
        print(f"\n[Step 4] Deleting existing record for this hour (if any)...")
        history_table = client.schema(schema).from_("prices_history") if schema != "public" else client.table("prices_history")
        
        fetched_at_str = history_record['fetched_at']
        
        try:
            delete_result = history_table.delete().eq("product_id", product_id).eq("fetched_at", fetched_at_str).execute()
            print(f"  ✅ Delete executed (may have deleted 0 rows if no existing record)")
        except Exception as delete_err:
            print(f"  ⚠️  Delete failed (continuing anyway): {delete_err}")
        
        # Step 5: Insert the record
        print(f"\n[Step 5] Inserting record into prices_history...")
        print(f"  Table: prices_history")
        print(f"  Schema: {schema}")
        print(f"  Record keys: {list(history_record.keys())}")
        print(f"  Record: {history_record}")
        
        try:
            insert_result = history_table.insert(history_record).execute()
            print(f"  ✅ INSERT EXECUTED SUCCESSFULLY!")
            
            # Try to verify the insert
            if hasattr(insert_result, 'data') and insert_result.data:
                print(f"  ✅ Insert confirmed - data returned: {len(insert_result.data)} record(s)")
                print(f"  ✅ Record inserted with product_id={product_id}, fetched_at={fetched_at_str}")
            else:
                print(f"  ⚠️  Insert executed but no data returned (this may be normal for Supabase)")
            
            # Step 6: Verify by reading it back
            print(f"\n[Step 6] Verifying insert by reading back...")
            verify_result = history_table.select("*").eq("product_id", product_id).eq("fetched_at", fetched_at_str).execute()
            
            if verify_result.data and len(verify_result.data) > 0:
                print(f"  ✅ VERIFICATION SUCCESSFUL - Record found in database!")
                print(f"  ✅ Database write is working correctly!")
                return True
            else:
                print(f"  ❌ VERIFICATION FAILED - Record not found in database")
                print(f"  ❌ This suggests the insert didn't actually write to the database")
                return False
                
        except Exception as insert_err:
            print(f"  ❌ INSERT FAILED: {insert_err}")
            print(f"  ❌ Error type: {type(insert_err).__name__}")
            import traceback
            traceback.print_exc()
            return False
            
    except Exception as e:
        print(f"\n❌ FATAL ERROR: {e}")
        import traceback
        traceback.print_exc()
        return False


def force_insert_price_history_for_all_products(client: Optional[Client] = None, category_id: Optional[int] = None) -> Dict[str, int]:
    """
    Force insert price history for ALL products in the database.
    Uses the same pattern as the main scraper - reads products from DB, then fetches prices.
    
    Args:
        client: Optional Supabase client
        category_id: Optional category ID to limit to one category
        
    Returns:
        Dict with 'success' and 'failed' counts
    """
    if client is None:
        client = get_supabase_client()
    
    schema = get_db_schema()
    products_table = client.schema(schema).from_("products") if schema != "public" else client.table("products")
    
    # Fetch products from database (same as main scraper)
    if category_id:
        response = products_table.select("product_id").eq("category_id", category_id).execute()
    else:
        response = products_table.select("product_id").execute()
    
    products = response.data
    
    if not products:
        print(f"  ⚠️  No products found in database")
        return {"success": 0, "failed": 0}
    
    product_ids = [p["product_id"] for p in products]
    return force_insert_price_history_batch(product_ids, client)


def force_insert_price_history_batch(product_ids: list[int], client: Optional[Client] = None) -> Dict[str, int]:
    """
    Force insert price history for multiple products.
    
    Returns:
        Dict with 'success' and 'failed' counts
    """
    if client is None:
        client = get_supabase_client()
    
    results = {"success": 0, "failed": 0}
    
    print(f"\n{'='*70}")
    print(f"FORCE INSERT PRICE HISTORY - BATCH MODE")
    print(f"Processing {len(product_ids)} products...")
    print(f"{'='*70}\n")
    
    for i, product_id in enumerate(product_ids, 1):
        print(f"\n[{i}/{len(product_ids)}] Processing product {product_id}...")
        if force_insert_price_history_for_product(product_id, client):
            results["success"] += 1
        else:
            results["failed"] += 1
    
    print(f"\n{'='*70}")
    print(f"BATCH COMPLETE")
    print(f"  Success: {results['success']}")
    print(f"  Failed: {results['failed']}")
    print(f"{'='*70}\n")
    
    return results


if __name__ == "__main__":
    # Test with a single product
    import sys
    
    if len(sys.argv) > 1:
        arg = sys.argv[1].lower()
        if arg == "all":
            # Insert for all products
            results = force_insert_price_history_for_all_products()
            sys.exit(0 if results["failed"] == 0 else 1)
        elif arg.startswith("category:"):
            # Insert for a specific category
            try:
                cat_id = int(arg.split(":")[1])
                results = force_insert_price_history_for_all_products(category_id=cat_id)
                sys.exit(0 if results["failed"] == 0 else 1)
            except (ValueError, IndexError):
                print(f"Error: Invalid category format. Use 'category:123'")
                sys.exit(1)
        else:
            # Single product ID
            try:
                product_id = int(arg)
                success = force_insert_price_history_for_product(product_id)
                sys.exit(0 if success else 1)
            except ValueError:
                print(f"Error: Product ID must be a number, 'all', or 'category:ID'")
                sys.exit(1)
    else:
        print("Usage: python src/force_price_history.py <product_id|all|category:ID>")
        print("\nExamples:")
        print("  python src/force_price_history.py 12345          # Single product")
        print("  python src/force_price_history.py all            # All products")
        print("  python src/force_price_history.py category:1     # All products in category 1")
        sys.exit(1)

