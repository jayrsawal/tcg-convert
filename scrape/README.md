# TCG Scraper

A Python scraper for extracting trading card game data from [tcgcsv.com](https://tcgcsv.com) and storing it in a Supabase database.

## Features

- **Feature 1**: Load database configurations through `.env` file and set up Supabase connections
- **Feature 2**: Read all available categories and upsert them into the `categories` table
- **Feature 3**: For each category, upsert all groups into the `groups` table
- **Feature 4**: For each group, upsert all products into the `products` table
- **Feature 4a**: Also upsert all product extended data into the `product_extended_data` table
- **Feature 5**: For each product, upsert the pricing information into the `prices_current` table
- **Feature 5a**: Also insert all pricing information into the `prices_history` table with hourly granularity
- **Category Whitelist**: Filter categories to scrape using environment variable
- **Extended Data Tracking**: Track distinct extended data keys per category
- **Product Cards**: Generate HTML product card pages with special handling for card text attributes
- **Mock Mode**: Test the scraper without writing to the database - dumps example data instead
- **CardTrader API Integration**: Scrapes games, categories, expansions, and blueprints from CardTrader API v2
- **Vendor Price Scraping**: Scrapes KanzenGames Gundam singles (or other vendors) with hourly history retention

## Requirements

- Python 3.8+
- Supabase account and project
- Internet connection for API access

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd scrape
```

2. Create a virtual environment:
```bash
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

3. Install dependencies:
```bash
pip install -r requirements.txt
```

4. Set up your `.env` file:
```bash
cp .env.example .env  # If you have an example file
# Or create .env manually
```

## Configuration

Create a `.env` file in the project root with the following variables:

```env
# Supabase Configuration
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key

# Database Schema (optional, defaults to 'public')
DB_SCHEMA=public

# Category Whitelist (optional, comma-separated category IDs or names)
# Examples:
# CATEGORY_WHITELIST=1,2,3
# CATEGORY_WHITELIST=Pokemon,Magic
CATEGORY_WHITELIST=

# Scraper Selection
# SCRAPE_TCGCSV=true                # Enable/disable TCGCSV scraping (default true)
# SCRAPE_CARDTRADER=true            # Enable/disable CardTrader scraping (default true)
# SCRAPE_VENDOR_PRICES=false        # Master toggle for vendor scraping
# SCRAPE_VENDOR_KANZENGAMES=true    # Vendor-specific toggle (default true)
# SCRAPE_VENDOR_401GAMES=true       # Vendor-specific toggle (default true)

# CardTrader API Configuration (optional, required if SCRAPE_CARDTRADER=true)
# CARDTRADER_KEY=your-jwt-bearer-token
# CARDTRADER_GAME_WHITELIST=1,2,3  # Optional, comma-separated game IDs
```

### Environment Variables

- **SUPABASE_URL**: Your Supabase project URL
- **SUPABASE_ANON_KEY**: Your Supabase anon/public key (preferred)
  - **SUPABASE_KEY**: Also supported for backward compatibility
- **DB_SCHEMA**: Database schema name (default: `public`)
  - Use `public` for the default Supabase schema
  - Use `tcg` for a custom schema (requires enabling in Supabase API settings)
- **CATEGORY_WHITELIST**: Optional comma-separated list of category IDs or names to limit scraping scope
- **MOCK_DB_OPERATIONS**: Set to `true` to enable mock mode (default: `false`)
  - When enabled, all database write operations are mocked
  - Data that would be inserted/updated is dumped to console with examples
  - Useful for testing the scraper without modifying the database
- **SCRAPE_TCGCSV**: Enable/disable TCGCSV scraping (default: `true`)
  - Set to `false` to skip TCGCSV scraping entirely
- **SCRAPE_CARDTRADER**: Enable/disable CardTrader scraping (default: `true`)
  - Set to `false` to skip CardTrader scraping entirely
- **SCRAPE_VENDOR_PRICES**: Master toggle for vendor scraping (default: `false`)
- **SCRAPE_VENDOR_KANZENGAMES**: Enable/disable Kanzen vendor scraping (default: `true`)
- **SCRAPE_VENDOR_401GAMES**: Enable/disable 401 Games vendor scraping (default: `true`)
- **CARDTRADER_KEY**: JWT bearer token for CardTrader API authentication (required if SCRAPE_CARDTRADER=true)
- **CARDTRADER_GAME_WHITELIST**: Optional comma-separated list of game IDs to limit CardTrader expansion/blueprint scraping

## Database Setup

### Option 1: Public Schema (Recommended)

1. Open your Supabase Dashboard → SQL Editor
2. Copy and paste the contents of `docs/schema_public.sql`
3. Execute the script to create all tables

### Option 2: Custom Schema (tcg)

1. Open your Supabase Dashboard → SQL Editor
2. Copy and paste the contents of `docs/schema.sql`
3. Execute the script to create the schema and tables
4. Enable the schema in Supabase API settings (Settings → API → Additional schemas)

### Running Migrations

If you're adding features incrementally, run migrations in order:

1. `migrations/001_add_category_extended_data_keys.sql`
2. `migrations/002_add_extended_data_raw_to_products.sql`

## Usage

Run the main scraper:

```bash
python src/main.py
```

The scraper will:
1. Fetch and upsert all categories (or filtered categories if whitelist is set)
2. For each category, fetch and upsert all groups
3. For each group, fetch and upsert all products and extended data
4. For each group, fetch and upsert current and historical prices (group-level endpoint)
5. Fetch and upsert CardTrader API data (games, categories, expansions, blueprints) if CARDTRADER_KEY is set
6. Scrape vendor price data (e.g., Kanzen Games) when `SCRAPE_VENDOR_PRICES=true`

### Mock Mode (Testing Without Database Writes)

To test the scraper without writing to the database, enable mock mode:

```bash
# Set environment variable
export MOCK_DB_OPERATIONS=true

# Or add to .env file
echo "MOCK_DB_OPERATIONS=true" >> .env

# Then run the scraper
python src/main.py
```

In mock mode:
- All database write operations (inserts, updates, upserts) are mocked
- Example data that would be inserted is dumped to the console
- Shows up to 3-5 examples per table type
- Database reads still work (to determine what to scrape)
- Useful for verifying data structure and scraper behavior before running on production

### Generating Product Cards

To generate HTML product card pages:

```python
from src.product_cards import generate_product_card_html, save_product_card_html
from src.db_config import get_supabase_client

client = get_supabase_client()
html = generate_product_card_html(client, product_id=12345)
if html:
    save_product_card_html(html, "product_card.html")
```

## Project Structure

```
scrape/
├── src/                      # Source code
│   ├── __init__.py
│   ├── db_config.py          # Database configuration
│   ├── main.py               # Main entry point
│   ├── categories.py         # Categories scraper
│   ├── groups.py             # Groups scraper
│   ├── products.py           # Products scraper
│   ├── prices.py             # Prices scraper
│   └── product_cards.py      # Product card HTML generator
├── docs/                     # Documentation
│   ├── schema.sql            # Database schema (tcg namespace)
│   └── schema_public.sql    # Database schema (public namespace)
├── migrations/              # Database migrations
│   ├── 001_add_category_extended_data_keys.sql
│   └── 002_add_extended_data_raw_to_products.sql
├── .env                     # Environment variables (create this)
├── requirements.txt        # Python dependencies
└── README.md               # This file
```

## Data Flow

1. **Categories**: Fetched from `/tcgplayer/categories` → stored in `categories` table
2. **Groups**: For each category, fetched from `/tcgplayer/{categoryId}/groups` → stored in `groups` table
3. **Products**: For each group, fetched from `/tcgplayer/{categoryId}/{groupId}/products` → stored in `products` table
   - Extended data is stored in `product_extended_data` table
   - Raw extended data JSON is stored in `products.extended_data_raw` column
4. **Prices**: For each product, fetched from `/tcgplayer/{productId}/prices` → stored in `prices_current` and `prices_history` tables
5. **Vendor Prices**: External vendor listings (e.g., Kanzen Games) scraped from HTML pages → stored in `vendor_prices` and `vendor_prices_history`

## API Endpoints

The scraper uses the following tcgcsv.com endpoints:

- `GET https://tcgcsv.com/tcgplayer/categories` - List all categories
- `GET https://tcgcsv.com/tcgplayer/{categoryId}/groups` - List groups for a category
- `GET https://tcgcsv.com/tcgplayer/{categoryId}/{groupId}/products` - List products for a group
- `GET https://tcgcsv.com/tcgplayer/{productId}/prices` - Get pricing for a product

## Database Schema

### Tables

- **categories**: Category information
- **groups**: Group information (sets, expansions, etc.)
- **products**: Product information with raw extended data JSON
- **product_extended_data**: Structured extended data (key-value pairs)
- **prices_current**: Current pricing information
- **prices_history**: Historical pricing with hourly granularity
- **category_extended_data_keys**: Tracks distinct extended data keys per category
- **cardtrader_games / categories / expansions / blueprints**: CardTrader API entities
- **cardtrader_prices / cardtrader_prices_history**: Marketplace prices from CardTrader API
- **vendor_prices / vendor_prices_history**: Vendor scraping snapshots and hourly history

### Key Features

- **Bulk Operations**: Uses bulk upserts for performance
- **Change Detection**: Skips unchanged records based on `modified_on` timestamps
- **Hourly Granularity**: Price history uses hourly timestamps to allow multiple runs per day
- **Extended Data**: Both structured (table) and raw (JSON) storage for flexibility

## Performance Optimizations

- **Bulk Fetching**: Fetches existing records in batches to check for changes
- **Bulk Upserts**: Uses Supabase's upsert functionality for efficient inserts/updates
- **Change Detection**: Only updates records when `modified_on` timestamp changes
- **Category-Level Processing**: Processes groups, products, and prices at category level for better batching
- **Batch Operations**: Splits large operations into smaller batches to avoid query size limits

## Product Cards

The `product_cards.py` module generates HTML product card pages with:

- Product image and basic information
- **Card Text Section**: Attributes named "DESCRIPTION", "TRIGGER", "EFFECT", or longer than 50 characters
- **Attributes Section**: Regular attributes displayed in a grid layout

Card text attributes are automatically separated from regular attributes for better readability.

## Troubleshooting

### Schema Errors

If you see errors about tables not found:
- Ensure you've run the appropriate schema script (`schema_public.sql` or `schema.sql`)
- Check that `DB_SCHEMA` in `.env` matches your database schema
- For custom schemas, ensure the schema is enabled in Supabase API settings

### Duplicate Key Errors

If you see duplicate key errors:
- The scraper uses upsert operations, so this shouldn't happen
- If it does, check that your primary keys are correctly defined
- For `prices_history`, ensure `fetched_at` uses hourly granularity (handled automatically)

### Performance Issues

If scraping is slow:
- Use `CATEGORY_WHITELIST` to limit the scope
- Check your Supabase connection and rate limits
- The scraper already uses bulk operations, but very large datasets may take time

## License

[Add your license here]

## Contributing

[Add contribution guidelines here]

