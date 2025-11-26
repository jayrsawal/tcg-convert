"""
Main entry point for the TCG scraper.
Orchestrates the execution of different scraping modules.
"""

import sys
from db_config import (
    get_supabase_client,
    get_db_schema,
    is_mock_mode,
    should_scrape_tcgcsv,
    should_scrape_cardtrader
)
from categories import scrape_and_upsert_all_categories
from groups import scrape_and_upsert_all_groups
from products import scrape_and_upsert_all_products
from prices import scrape_and_upsert_all_prices
from cardtrader import scrape_and_upsert_all_cardtrader
from scraper_runs import ScraperRunTracker


def main():
    """Main execution function."""
    tracker = None
    try:
        print("Starting TCG scraper...")
        
        # Check for mock mode
        if is_mock_mode():
            print("\n" + "=" * 70)
            print("  MOCK MODE ENABLED - Database operations will be mocked")
            print("  All data will be dumped instead of written to database")
            print("=" * 70 + "\n")
        
        # Initialize Supabase client
        client = get_supabase_client()
        schema = get_db_schema()
        print(f"Connected to Supabase (schema: {schema})")
        
        # Initialize scraper run tracker
        tracker = ScraperRunTracker(client)
        print("\n=== Logging Scraper Run ===")
        if not tracker.start_run():
            print("  ⚠️  Warning: Could not log scraper run start, but continuing...")
        
        # Check which scrapers to run
        scrape_tcgcsv = should_scrape_tcgcsv()
        scrape_cardtrader = should_scrape_cardtrader()
        
        if not scrape_tcgcsv and not scrape_cardtrader:
            print("\n⚠️  Both SCRAPE_TCGCSV and SCRAPE_CARDTRADER are disabled. Nothing to scrape.")
            return
        
        print(f"\n📋 Scraper Configuration:")
        print(f"   TCGCSV: {'✅ Enabled' if scrape_tcgcsv else '❌ Disabled'}")
        print(f"   CardTrader: {'✅ Enabled' if scrape_cardtrader else '❌ Disabled'}")
        
        # TCGCSV Scraping
        if scrape_tcgcsv:
            print("\n" + "="*70)
            print("TCGCSV SCRAPING")
            print("="*70)
            
            # Feature 2: Scrape and upsert categories
            print("\n=== Feature 2: Scraping Categories ===")
            scrape_and_upsert_all_categories(client)
            
            # Feature 3: Scrape and upsert groups
            print("\n=== Feature 3: Scraping Groups ===")
            scrape_and_upsert_all_groups(client)
            
            # Feature 4 & 4a: Scrape and upsert products and extended data
            print("\n=== Feature 4 & 4a: Scraping Products ===")
            scrape_and_upsert_all_products(client)
            
            # Feature 5 & 5a: Scrape and upsert prices
            print("\n=== Feature 5 & 5a: Scraping Prices ===")
            scrape_and_upsert_all_prices(client)
        else:
            print("\n⏭️  Skipping TCGCSV scraping (SCRAPE_TCGCSV=false)")
        
        # CardTrader API Scraping
        if scrape_cardtrader:
            print("\n" + "="*70)
            print("CARDTRADER API SCRAPING")
            print("="*70)
            scrape_and_upsert_all_cardtrader(client)
        else:
            print("\n⏭️  Skipping CardTrader scraping (SCRAPE_CARDTRADER=false)")
        
        print("\n✅ Scraping completed successfully!")
        
        # Log successful completion
        if tracker:
            tracker.complete_run(success=True, notes="Scraping completed successfully")
        
    except Exception as e:
        error_msg = str(e)
        print(f"\n❌ Error during scraping: {error_msg}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        
        # Log failed completion
        if tracker:
            tracker.complete_run(success=False, error_message=error_msg)
        
        sys.exit(1)


if __name__ == "__main__":
    main()

