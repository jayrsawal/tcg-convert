"""
Profiles endpoint router.
Public read access, authenticated write access to user profiles.
"""
from typing import Optional, Dict
from uuid import UUID
from fastapi import APIRouter, HTTPException, Depends, Body, Query
from pydantic import BaseModel, Field
from supabase import Client
from src.database import get_db_client
from src.auth import require_auth

router = APIRouter(prefix="/profiles", tags=["profiles"])


class ProfileUpdate(BaseModel):
    """Model for updating a profile."""
    username: Optional[str] = Field(None, description="Username")
    full_name: Optional[str] = Field(None, description="Full name")
    avatar_url: Optional[str] = Field(None, description="Avatar URL")
    currency: Optional[str] = Field(None, description="Default currency code (e.g., USD, EUR, GBP)")
    items: Optional[Dict[str, int]] = Field(None, description="Inventory items (product_id string -> quantity integer)")
    favorites: Optional[Dict[str, int]] = Field(None, description="Favorites (product_id string -> quantity integer, typically 1)")
    total_count: Optional[int] = Field(None, description="Total inventory count (auto-calculated, but can be set manually)")


@router.get("")
@router.get("/")
async def get_profile(
    user_id: str = Query(..., description="User ID (UUID) to get profile for"),
    db: Client = Depends(get_db_client)
):
    """
    Get a user's profile. Public read access - no authentication required.
    Returns profile data including username, avatar_url, currency, items (inventory), favorites, and timestamps.
    Note: full_name is excluded from public responses for privacy.
    """
    try:
        # Validate UUID format
        try:
            UUID(user_id)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid user_id format: {user_id}")
        
        response = (
            db.table("profiles")
            .select("id,username,avatar_url,currency,items,favorites,total_count,created_at,updated_at")
            .eq("id", user_id)
            .execute()
        )
        
        if not response.data or len(response.data) == 0:
            raise HTTPException(status_code=404, detail="Profile not found")
        
        return response.data[0]
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching profile: {str(e)}")


@router.post("")
@router.post("/")
async def update_profile(
    profile_update: ProfileUpdate = Body(...),
    authenticated_user_id: UUID = Depends(require_auth),
    db: Client = Depends(get_db_client)
):
    """
    Update the current user's profile. Requires authentication - users can only update their own profile.
    Updates any provided fields (username, full_name, avatar_url, currency, items, favorites, total_count).
    Note: Database triggers will automatically update updated_at and calculate total_count from items.
    """
    try:
        user_id = str(authenticated_user_id)
        
        # Build update payload with only provided fields
        update_payload = {}
        
        if profile_update.username is not None:
            update_payload["username"] = profile_update.username
        if profile_update.full_name is not None:
            update_payload["full_name"] = profile_update.full_name
        if profile_update.avatar_url is not None:
            update_payload["avatar_url"] = profile_update.avatar_url
        if profile_update.currency is not None:
            update_payload["currency"] = profile_update.currency
        if profile_update.items is not None:
            # Normalize items: ensure keys are strings and values are integers
            normalized_items = {}
            for k, v in profile_update.items.items():
                try:
                    key_str = str(k)
                    if isinstance(v, (int, float)):
                        val_int = int(v)
                        if val_int > 0:  # Only keep positive quantities
                            normalized_items[key_str] = val_int
                except (ValueError, TypeError):
                    continue
            update_payload["items"] = normalized_items
        if profile_update.favorites is not None:
            # Normalize favorites: ensure keys are strings and values are integers
            normalized_favorites = {}
            for k, v in profile_update.favorites.items():
                try:
                    key_str = str(k)
                    if isinstance(v, (int, float)):
                        val_int = int(v)
                        if val_int > 0:  # Only keep positive quantities
                            normalized_favorites[key_str] = val_int
                except (ValueError, TypeError):
                    continue
            update_payload["favorites"] = normalized_favorites
        if profile_update.total_count is not None:
            update_payload["total_count"] = profile_update.total_count
        
        if not update_payload:
            raise HTTPException(status_code=400, detail="No fields provided to update")
        
        # Check if profile exists
        existing = (
            db.table("profiles")
            .select("id")
            .eq("id", user_id)
            .execute()
        )
        
        if existing.data and len(existing.data) > 0:
            # Update existing profile (only for authenticated user's own profile)
            response = (
                db.table("profiles")
                .update(update_payload)
                .eq("id", user_id)
                .execute()
            )
        else:
            # Insert new profile
            update_payload["id"] = user_id
            response = (
                db.table("profiles")
                .insert(update_payload)
                .execute()
            )
        
        if not response.data or len(response.data) == 0:
            raise HTTPException(
                status_code=500, 
                detail="Failed to update profile. The update may have been rejected by the database."
            )
        
        # Return full profile including full_name (user viewing their own profile)
        return response.data[0]
    except HTTPException:
        raise
    except Exception as e:
        error_msg = str(e)
        raise HTTPException(
            status_code=500, 
            detail=f"Error updating profile: {error_msg}"
        )

