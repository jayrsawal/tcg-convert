"""
Authentication module for Supabase JWT token validation.

This module handles authentication using Supabase JWT tokens. It uses Supabase's
built-in auth client to validate tokens, which properly handles all JWT validation
including signature, expiration, and audience checks.

Usage:
    For protected endpoints, use `require_auth` as a dependency:
    
    ```python
    from src.auth import require_auth
    
    @router.get("/protected")
    async def protected_endpoint(
        user_id: UUID = Depends(require_auth),
        db: Client = Depends(get_db_client)
    ):
        # user_id is guaranteed to be valid here
        ...
    ```
    
    For optional authentication, use `get_user_id_from_token`:
    
    ```python
    from src.auth import get_user_id_from_token
    
    @router.get("/public")
    async def public_endpoint(
        authorization: Optional[str] = Header(None),
        db: Client = Depends(get_db_client)
    ):
        user_id = get_user_id_from_token(authorization)
        if user_id:
            # User is authenticated
        else:
            # Public access
        ...
    ```
"""
import logging
from typing import Optional
from uuid import UUID
from fastapi import HTTPException, Header, status
from src.database import get_supabase_client

logger = logging.getLogger(__name__)


def get_user_id_from_token(authorization: Optional[str] = Header(None)) -> Optional[UUID]:
    """
    Extract and validate user_id from Supabase JWT token in Authorization header.
    
    This function validates the token using Supabase's auth client, which ensures
    the token is valid, not expired, and properly signed. Returns None if token
    is missing or invalid (for optional authentication).
    
    Args:
        authorization: Authorization header value (should be "Bearer <token>")
        
    Returns:
        UUID of the user if token is valid, None otherwise
    """
    if not authorization:
        return None
    
    # Extract token from "Bearer <token>" format
    if authorization.startswith("Bearer "):
        token = authorization[7:].strip()
    else:
        # Try without Bearer prefix (for backward compatibility)
        token = authorization.strip()
    
    if not token:
        return None
    
    try:
        # Use Supabase auth client to verify the token
        # This properly validates signature, expiration, and audience
        supabase = get_supabase_client()
        user_response = supabase.auth.get_user(token)
        
        if not user_response or not user_response.user:
            logger.debug("Token validation failed: No user returned from Supabase")
            return None
        
        # Extract user_id from the verified user object
        user_id = user_response.user.id
        
        try:
            return UUID(user_id)
        except (ValueError, TypeError) as e:
            logger.error(f"Invalid user_id format from token: {user_id}, error: {e}")
            return None
            
    except Exception as e:
        error_str = str(e).lower()
        if "expired" in error_str or "exp" in error_str:
            logger.debug(f"JWT token expired: {e}")
        elif "invalid" in error_str or "jwt" in error_str or "token" in error_str:
            logger.debug(f"JWT token validation failed: {e}")
        else:
            logger.warning(f"Unexpected error validating token: {e}")
        return None


def require_auth(authorization: Optional[str] = Header(None)) -> UUID:
    """
    Dependency function that requires valid authentication.
    Raises 401 if authentication is missing or invalid.
    
    This should be used as a FastAPI dependency for protected endpoints:
    
    ```python
    from src.auth import require_auth
    
    @router.get("/protected")
    async def protected_endpoint(
        user_id: UUID = Depends(require_auth),
        db: Client = Depends(get_db_client)
    ):
        # user_id is guaranteed to be valid here
        ...
    ```
    
    Args:
        authorization: Authorization header value (should be "Bearer <token>")
        
    Returns:
        UUID of the authenticated user
        
    Raises:
        HTTPException: 401 if authentication is missing or invalid
    """
    if not authorization:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required. Please provide a valid Supabase JWT token in the Authorization header as 'Bearer <token>'.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    user_id = get_user_id_from_token(authorization)
    
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired authentication token. Please provide a valid Supabase JWT token.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    return user_id
