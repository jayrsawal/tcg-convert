"""
Simple diagnostic script to test if database writes are working.
Run this to verify your database connection and write permissions.
"""

from db_config import get_supabase_client, get_db_schema, is_mock_mode
from datetime import datetime, timezone


def test_database_write():
    """Test if we can write to the database."""
    print("=" * 70)
    print("Database Write Test")
    print("=" * 70)
    
    if is_mock_mode():
        print("\n⚠️  MOCK MODE is enabled - no actual writes will occur")
        print("   Set MOCK_DB_OPERATIONS=false to test real writes\n")
        return
    
    try:
        client = get_supabase_client()
        schema = get_db_schema()
        print(f"\n✓ Connected to Supabase (schema: {schema})")
        
        # Test 1: Try to write to scraper_runs table
        print("\n[Test 1] Attempting to write to scraper_runs table...")
        try:
            table = client.schema(schema).from_("scraper_runs") if schema != "public" else client.table("scraper_runs")
            
            test_record = {
                "started_at": datetime.now(timezone.utc).isoformat(),
                "status": "test",
                "notes": "Diagnostic test write"
            }
            
            result = table.insert(test_record).execute()
            print("  ✅ SUCCESS: Write to scraper_runs table worked!")
            
            if hasattr(result, 'data') and result.data:
                run_id = result.data[0].get("run_id")
                print(f"  ✓ Inserted record with run_id: {run_id}")
                
                # Try to read it back
                read_result = table.select("*").eq("run_id", run_id).execute()
                if read_result.data:
                    print(f"  ✓ Successfully read back the record")
                    print(f"  ✓ Database writes and reads are working!")
                else:
                    print(f"  ⚠️  Wrote record but couldn't read it back")
            else:
                print("  ⚠️  Write succeeded but no data returned")
                
        except Exception as e:
            print(f"  ❌ FAILED: {e}")
            import traceback
            traceback.print_exc()
            return False
        
        # Test 2: Try a simple SELECT to verify connection
        print("\n[Test 2] Testing database connection with SELECT...")
        try:
            # Try to read from a table that should exist
            categories_table = client.schema(schema).from_("categories") if schema != "public" else client.table("categories")
            result = categories_table.select("category_id").limit(1).execute()
            print("  ✅ SUCCESS: Database connection is working!")
            print(f"  ✓ Can read from categories table")
        except Exception as e:
            print(f"  ⚠️  Could not read from categories table: {e}")
            print("  (This might be okay if the table is empty or doesn't exist yet)")
        
        print("\n" + "=" * 70)
        print("✓ Database write test completed!")
        print("=" * 70)
        return True
        
    except Exception as e:
        print(f"\n❌ FATAL ERROR: {e}")
        import traceback
        traceback.print_exc()
        return False


if __name__ == "__main__":
    test_database_write()

