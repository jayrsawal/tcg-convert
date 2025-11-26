"""
Scraper runs tracking module.
Logs each scraper execution to the database for diagnostic purposes.
"""

from datetime import datetime, timezone
from typing import Optional
from supabase import Client
from db_config import get_db_schema, is_mock_mode


class ScraperRunTracker:
    """Tracks scraper execution runs in the database."""
    
    def __init__(self, client: Client):
        self.client = client
        self.schema = get_db_schema()
        self.run_id: Optional[int] = None
        self.stats = {
            "categories_scraped": 0,
            "groups_scraped": 0,
            "products_scraped": 0,
            "prices_scraped": 0,
        }
        self.scrapers_executed = {
            "tcgcsv": False,
            "cardtrader": False,
            "vendor_prices": False,
        }
    
    def start_run(self) -> bool:
        """
        Log the start of a scraper run.
        
        Returns:
            True if successfully logged, False otherwise
        """
        if is_mock_mode():
            print("  [MOCK MODE] Would log scraper run start")
            return True
        
        try:
            table = self.client.schema(self.schema).from_("scraper_runs") if self.schema != "public" else self.client.table("scraper_runs")
            
            run_data = {
                "started_at": datetime.now(timezone.utc).isoformat(),
                "status": "running",
                "categories_scraped": 0,
                "groups_scraped": 0,
                "products_scraped": 0,
                "prices_scraped": 0,
                "ran_tcgcsv": False,
                "ran_cardtrader": False,
                "ran_vendor_prices": False,
            }
            
            result = table.insert(run_data).execute()
            
            # Extract run_id from result
            if hasattr(result, 'data') and result.data:
                self.run_id = result.data[0].get("run_id")
                print(f"  📝 Logged scraper run start (run_id: {self.run_id})")
                return True
            else:
                # Try to get it from the response
                print(f"  ⚠️  Started scraper run but couldn't get run_id")
                return True  # Still consider it successful
                
        except Exception as e:
            print(f"  ❌ Error logging scraper run start: {e}")
            import traceback
            traceback.print_exc()
            return False
    
    def update_stats(self, **kwargs):
        """Update statistics for the current run."""
        self.stats.update(kwargs)

    def mark_scraper_executed(self, scraper_name: str):
        """Record that a specific scraper module actually ran."""
        if scraper_name not in self.scrapers_executed:
            return
        self.scrapers_executed[scraper_name] = True
    
    def complete_run(self, success: bool = True, error_message: Optional[str] = None, notes: Optional[str] = None):
        """
        Mark the current scraper run as completed.
        
        Args:
            success: Whether the run completed successfully
            error_message: Error message if run failed
            notes: Additional notes about the run
        """
        if is_mock_mode():
            print(f"  [MOCK MODE] Would log scraper run completion (success: {success})")
            return
        
        if not self.run_id:
            print("  ⚠️  No run_id available, cannot update scraper run")
            return
        
        try:
            table = self.client.schema(self.schema).from_("scraper_runs") if self.schema != "public" else self.client.table("scraper_runs")
            
            update_data = {
                "completed_at": datetime.now(timezone.utc).isoformat(),
                "status": "completed" if success else "failed",
                "categories_scraped": self.stats.get("categories_scraped", 0),
                "groups_scraped": self.stats.get("groups_scraped", 0),
                "products_scraped": self.stats.get("products_scraped", 0),
                "prices_scraped": self.stats.get("prices_scraped", 0),
                "ran_tcgcsv": self.scrapers_executed.get("tcgcsv", False),
                "ran_cardtrader": self.scrapers_executed.get("cardtrader", False),
                "ran_vendor_prices": self.scrapers_executed.get("vendor_prices", False),
            }
            
            if error_message:
                update_data["error_message"] = error_message
            if notes:
                update_data["notes"] = notes
            
            result = table.update(update_data).eq("run_id", self.run_id).execute()
            print(f"  📝 Logged scraper run completion (run_id: {self.run_id}, success: {success})")
            
        except Exception as e:
            print(f"  ❌ Error logging scraper run completion: {e}")
            import traceback
            traceback.print_exc()

