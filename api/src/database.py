"""
Database connection module.
"""
from supabase import create_client, Client
import os
from functools import lru_cache
from dotenv import load_dotenv

# Load environment variables from .env file (if present)
# Environment variables take precedence over .env file values
# This allows configuration via either:
# 1. Environment variables (e.g., set in shell or deployment platform)
# 2. .env file (for local development)
load_dotenv(override=False)  # override=False means env vars take precedence


@lru_cache()
def get_supabase_client() -> Client:
    """
    Create and return a Supabase client instance.
    Uses SUPABASE_KEY (service_role) which bypasses RLS for backend API access.
    This is required for backend APIs to access all data regardless of RLS policies.
    Falls back to SUPABASE_ANON_KEY only if SUPABASE_KEY is not set (for backward compatibility).
    """
    supabase_url = os.getenv("SUPABASE_URL")
    # For backend API, we need service_role key to bypass RLS
    # Prefer SUPABASE_KEY (service_role), fall back to SUPABASE_ANON_KEY only for compatibility
    supabase_key = os.getenv("SUPABASE_KEY") or os.getenv("SUPABASE_ANON_KEY")
    
    if not supabase_url or not supabase_key:
        raise ValueError(
            "SUPABASE_URL and SUPABASE_KEY (or SUPABASE_ANON_KEY) must be set in environment variables or .env file"
        )
    
    # Warn if using anon key (which respects RLS and may cause access issues)
    if os.getenv("SUPABASE_KEY") is None and os.getenv("SUPABASE_ANON_KEY") is not None:
        import warnings
        warnings.warn(
            "Using SUPABASE_ANON_KEY instead of SUPABASE_KEY. "
            "This may cause RLS (Row Level Security) issues. "
            "For backend APIs, use SUPABASE_KEY (service_role) to bypass RLS.",
            UserWarning
        )
    
    return create_client(supabase_url, supabase_key)


def get_db_client() -> Client:
    """
    Dependency function for FastAPI to get database client.
    """
    return get_supabase_client()

