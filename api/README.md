# TCGHermit API

Backend API for card deck building and trading app. Built with FastAPI and Supabase.

## Setup

### 1. Install Dependencies

```bash
pip install -r requirements.txt
```

### 2. Configure Environment Variables

The API supports configuration through **either** environment variables **or** a `.env` file. Environment variables take precedence over `.env` file values.

**Option A: Using a `.env` file (recommended for local development)**

Create a `.env` file in the root directory with your Supabase credentials:

```env
SUPABASE_URL=your_supabase_project_url
SUPABASE_KEY=your_supabase_service_role_key
PORT=8000
HOST=0.0.0.0
RELOAD=true
CORS_ORIGINS=http://localhost:3000,https://yourdomain.com
```

**Option B: Using environment variables (recommended for production)**

Set environment variables directly:

```bash
export SUPABASE_URL=your_supabase_project_url
export SUPABASE_KEY=your_supabase_service_role_key
export PORT=8000
export HOST=0.0.0.0
export RELOAD=true
export CORS_ORIGINS=http://localhost:3000,https://yourdomain.com
```

You can find these values in your Supabase project settings under API.

**Configuration Options:**
- `SUPABASE_URL` (required) - Your Supabase project URL
- `SUPABASE_KEY` (required, recommended) - Your Supabase **service_role** key
  - **Important:** Use the `service_role` key for backend APIs as it bypasses RLS policies
  - Find it in: Supabase Dashboard → Settings → API → Project API keys → `service_role` key
  - ⚠️ **Never expose this key in client-side code** - it has full database access
  - This key bypasses Row Level Security (RLS) policies, which is required for backend API access
  - **Note:** This key is also used by the authentication system to validate JWT tokens via Supabase's auth client
- `SUPABASE_ANON_KEY` (optional, fallback) - Your Supabase anon key
  - Only used if `SUPABASE_KEY` is not set (for backward compatibility)
  - **Warning:** Using anon key may cause RLS issues and prevent access to some data
- `PORT` (optional, default: 8000) - Port number for the API server
- `HOST` (optional, default: 0.0.0.0) - Host address to bind to
- `RELOAD` (optional, default: true) - Enable auto-reload on code changes
- `CORS_ORIGINS` (optional, default: `*` - allow all) - Comma-separated list of allowed CORS origins
  - **Production:** Set this to your frontend domain(s), e.g., `https://yourdomain.com,https://www.yourdomain.com`
  - **Development:** Can be omitted (defaults to `*` to allow all origins) or set to `http://localhost:3000,http://localhost:5173`
  - **Multiple origins:** Separate with commas: `https://app.example.com,https://admin.example.com`
  - **Warning:** If not set in production, the API will allow all origins (`*`), which is insecure

**Note:** JWT token validation is handled automatically by Supabase's auth client using your `SUPABASE_KEY`. No additional JWT secret configuration is required.

### Authentication

The API uses Supabase JWT tokens for authentication. Authentication is handled automatically by Supabase's auth client - no additional JWT secret configuration is required.

#### How Authentication Works

1. **Get a JWT token** from Supabase Auth (via your frontend/client application)
   - When a user signs in through Supabase Auth, they receive an access token
   - This token is a JWT that contains the user's ID and other claims

2. **Include the token in API requests** using the `Authorization` header:
   ```
   Authorization: Bearer <your-supabase-jwt-token>
   ```

#### Example Requests

**JavaScript/Fetch:**
```javascript
const response = await fetch('https://your-api.com/favorites/', {
  method: 'GET',
  headers: {
    'Authorization': `Bearer ${supabaseToken}`,
    'Content-Type': 'application/json'
  }
});
```

**cURL:**
```bash
curl -X GET "https://your-api.com/favorites/" \
  -H "Authorization: Bearer YOUR_SUPABASE_JWT_TOKEN"
```

**Python/Requests:**
```python
import requests

headers = {
    'Authorization': f'Bearer {supabase_token}',
    'Content-Type': 'application/json'
}
response = requests.get('https://your-api.com/favorites/', headers=headers)
```

#### Protected vs Public Endpoints

- **Protected endpoints** require authentication and will return `401 Unauthorized` if:
  - No `Authorization` header is provided
  - The JWT token is invalid or expired
  - The JWT token cannot be verified by Supabase

- **Public endpoints** work without authentication but may provide additional features when authenticated

#### Getting a Supabase JWT Token

In your frontend/client application using Supabase:

```javascript
// Sign in
const { data, error } = await supabase.auth.signInWithPassword({
  email: 'user@example.com',
  password: 'password'
});

// Get the access token
const token = data.session.access_token;

// Use it in API requests
fetch('https://your-api.com/favorites/', {
  headers: {
    'Authorization': `Bearer ${token}`
  }
});
```

**Note:** The API validates tokens using Supabase's auth client, which automatically handles all JWT validation (signature, expiration, audience, etc.). No additional configuration needed beyond your Supabase credentials.

**Note:** If both environment variables and `.env` file are present, environment variables take precedence.

### 3. Run the API

**Option 1: Using the run script (recommended)**
```bash
python run.py
```

**Option 2: Using uvicorn directly**
```bash
uvicorn src.main:app --reload --port ${PORT:-8000}
```

The API will be available at `http://localhost:8000` (or the port specified in your `.env` file)

### 4. API Documentation

Once running, visit (replace `8000` with your configured port if different):
- **Frontend Documentation**: `http://localhost:8000/` - Beautiful, user-friendly API documentation
- **Swagger UI**: `http://localhost:8000/docs` - Interactive API explorer

## Features

- ✅ Feature 1: Load database configurations through .env file and setup connections
- ✅ Feature 2: Endpoints for each table with pagination and primary key sorting
- ✅ Feature 3: Price history endpoint with date filtering
- ✅ Feature 4: Pretty frontend that lists and describes all available endpoints with examples

## API Endpoints

### Categories
- `GET /categories` - List all categories (paginated, sorted by category_id)
- `GET /categories/{category_id}` - Get category by primary key

### Groups
- `GET /groups` - List all groups (paginated, sorted by group_id)
- `GET /groups/{group_id}` - Get group by primary key
- `GET /groups/by-category/{category_id}` - Get all groups for a category (filtered by foreign key, paginated)

### Products
- `GET /products` - List all products (paginated, sorted by product_id)
- `POST /products/filter` - Filter products by extended data key-value pairs, category, and/or group. Multiple values for a single key use OR logic, different keys use AND logic. Supports configurable sorting by name or product_id (ascending/descending)
- `GET /products/{product_id}` - Get product by primary key
- `GET /products/by-category/{category_id}` - Get all products for a category (filtered by foreign key, paginated)
- `GET /products/by-group/{group_id}` - Get all products for a group (filtered by foreign key, paginated)

### Category Extended Data Keys
- `GET /category-extended-data-keys` - List all category extended data keys (paginated, sorted by category_id, key)
- `GET /category-extended-data-keys/by-category/{category_id}` - Get all extended data keys for a category (filtered by foreign key, paginated)
- `GET /category-extended-data-keys/by-category-key?category_id={id}&key={key}` - Get by composite primary key

### Product Extended Data
- `GET /product-extended-data` - List all extended data (paginated, sorted by product_id, key)
- `GET /product-extended-data/by-category/{category_id}` - Get all extended data for products in a category (filtered by category_id through products, paginated)
- `GET /product-extended-data/by-category/{category_id}/keys` - Get unique list of extended data keys for products in a category (returns distinct key names)
- `GET /product-extended-data/by-category/{category_id}/key-values` - Get unique key-value pairs for products in a category (returns dictionary of key -> list of unique values, useful for filtering)
- `GET /product-extended-data/by-product/{product_id}` - Get all extended data for a product (filtered by foreign key, paginated)
- `GET /product-extended-data/by-product-key?product_id={id}&key={key}` - Get by composite primary key

### Current Prices
- `GET /prices-current` - List all current prices (paginated, sorted by product_id)
- `GET /prices-current/{product_id}` - Get current price by product_id

### Price History
- `GET /prices-history` - List price history (paginated, sorted by product_id, fetched_at)
  - Query params: 
    - `start_date` (datetime, optional) - Filter entries where fetched_at >= start_date
    - `end_date` (datetime, optional) - Filter entries where fetched_at <= end_date
    - `product_id` (int, optional) - Filter by specific product
    - `page` (int, default: 1) - Page number
    - `limit` (int, default: 10, max: 100) - Items per page
  - Date format: ISO format (YYYY-MM-DDTHH:MM:SS or YYYY-MM-DD)
  - Examples:
    - `GET /prices-history?start_date=2024-01-01`
    - `GET /prices-history?start_date=2024-01-01&end_date=2024-01-31`
    - `GET /prices-history?product_id=12345&start_date=2024-01-01&end_date=2024-01-31`
- `GET /prices-history/by-product/{product_id}` - Get all price history for a product (filtered by foreign key, paginated)
  - Supports optional `start_date` and `end_date` query parameters for date filtering
- `GET /prices-history/by-product-date?product_id={id}&fetched_at={datetime}` - Get by composite primary key

### Pagination

All list endpoints support pagination via query parameters:
- `page` (default: 1) - Page number (1-indexed)
- `limit` (default: 100, max: 1000) - Number of items per page

Example: `GET /categories?page=2&limit=50`

### Sorting

Results are automatically sorted as follows:
- **Categories**: Sorted by `category_id` (ascending)
- **Groups**: Sorted by `published_on` (release date, descending), then by `group_id` (ascending)
- **Products**: Sorted by `name` (ascending), then by `product_id` (ascending)
- **Other tables**: Sorted by primary key(s)

## Project Structure

```
api/
├── src/
│   ├── __init__.py
│   ├── main.py                    # FastAPI application
│   ├── database.py                # Database connection module
│   ├── models.py                  # Pydantic models for requests/responses
│   ├── static/
│   │   └── index.html             # Frontend documentation page
│   └── routers/
│       ├── __init__.py
│       ├── categories.py
│       ├── groups.py
│       ├── products.py
│       ├── product_extended_data.py
│       ├── prices_current.py
│       └── prices_history.py
├── docs/
│   ├── spec.md                    # API specification
│   └── schema_public.sql          # Database schema
├── requirements.txt
├── run.py                         # Run script with configurable port
└── README.md
```

