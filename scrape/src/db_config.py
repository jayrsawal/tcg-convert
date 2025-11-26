"""
Database configuration and Supabase client setup.
Handles environment variable loading and provides database connection utilities.

Environment variables can be loaded from:
1. A .env file in the project root (loaded automatically)
2. System environment variables (takes precedence over .env file)

The .env file should contain:
    SUPABASE_URL=https://your-project.supabase.co
    SUPABASE_ANON_KEY=your-anon-key
    DB_SCHEMA=public  # Optional, defaults to 'public'
    CATEGORY_WHITELIST=1,2,3  # Optional, comma-separated IDs or names
"""

import os
from pathlib import Path
from typing import Optional, List
from dotenv import load_dotenv
from supabase import create_client, Client

# Load environment variables from .env file
# This will look for .env in the current directory and parent directories
# It will NOT override existing environment variables (env vars take precedence)
env_path = Path(__file__).parent.parent / ".env"
load_dotenv(dotenv_path=env_path, override=False)


def get_supabase_client() -> Client:
    """
    Create and return a Supabase client instance.
    
    Reads configuration from:
    - Environment variables (SUPABASE_URL, SUPABASE_ANON_KEY) - takes precedence
    - .env file in project root - used if env vars not set
    
    Supports both SUPABASE_ANON_KEY (preferred) and SUPABASE_KEY (backward compatibility).
    
    Returns:
        Supabase client configured with URL and key from environment variables.
        
    Raises:
        ValueError: If SUPABASE_URL or SUPABASE_ANON_KEY/SUPABASE_KEY are not set in either
                    environment variables or .env file.
    """
    supabase_url = os.getenv("SUPABASE_URL")
    # Support both SUPABASE_ANON_KEY (preferred) and SUPABASE_KEY (backward compatibility)
    supabase_key = os.getenv("SUPABASE_ANON_KEY") or os.getenv("SUPABASE_KEY")
    
    if not supabase_url or not supabase_key:
        env_file_exists = (Path(__file__).parent.parent / ".env").exists()
        error_msg = (
            "SUPABASE_URL and SUPABASE_ANON_KEY (or SUPABASE_KEY) must be set.\n"
            f"  - Check environment variables: SUPABASE_URL, SUPABASE_ANON_KEY\n"
            f"  - Check .env file: {'exists' if env_file_exists else 'not found'} at {Path(__file__).parent.parent / '.env'}\n"
            "  Note: Environment variables take precedence over .env file values.\n"
            "  Note: SUPABASE_ANON_KEY is preferred, but SUPABASE_KEY is also supported for backward compatibility."
        )
        raise ValueError(error_msg)
    
    return create_client(supabase_url, supabase_key)


def get_db_schema() -> str:
    """
    Get the database schema name from environment variables or .env file.
    Defaults to 'public' if not specified.
    
    Reads from:
    - Environment variable DB_SCHEMA (takes precedence)
    - .env file DB_SCHEMA entry
    - Defaults to 'public' if neither is set
    
    Returns:
        Schema name as string (e.g., 'public' or 'tcg')
    """
    return os.getenv("DB_SCHEMA", "public")


def get_category_whitelist() -> Optional[List[str]]:
    """
    Parse and return the category whitelist from environment variables or .env file.
    
    Reads from:
    - Environment variable CATEGORY_WHITELIST (takes precedence)
    - .env file CATEGORY_WHITELIST entry
    
    The CATEGORY_WHITELIST can contain:
    - Comma-separated category IDs (e.g., "1,2,3")
    - Comma-separated category names (e.g., "Pokemon,Magic")
    - Mix of IDs and names
    
    Examples:
        CATEGORY_WHITELIST=1,2,3
        CATEGORY_WHITELIST=Pokemon,Magic
        CATEGORY_WHITELIST=1,Pokemon,3
    
    Returns:
        List of whitelisted category identifiers (IDs or names), or None if not set.
    """
    whitelist_str = os.getenv("CATEGORY_WHITELIST")
    if not whitelist_str:
        return None
    
    # Split by comma and strip whitespace
    items = [item.strip() for item in whitelist_str.split(",") if item.strip()]
    return items if items else None


def is_mock_mode() -> bool:
    """
    Check if mock mode is enabled.
    When enabled, database operations will be mocked and data will be dumped instead of written.
    
    Reads from:
    - Environment variable MOCK_DB_OPERATIONS (takes precedence)
    - .env file MOCK_DB_OPERATIONS entry
    
    Returns:
        True if mock mode is enabled, False otherwise.
    """
    mock_str = os.getenv("MOCK_DB_OPERATIONS", "false").lower()
    return mock_str in ("true", "1", "yes", "on")

