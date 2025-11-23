"""
Favorites endpoint router.
Works with profiles table favorites column (JSONB structure).
"""
from typing import Optional, List, Dict
from uuid import UUID
from fastapi import APIRouter, HTTPException, Depends, Body, Query
from pydantic import BaseModel, Field
from supabase import Client
from src.database import get_db_client
from src.auth import require_auth

router = APIRouter(prefix="/favorites", tags=["favorites"])


class FavoritesUpdate(BaseModel):
    """Model for updating favorites."""
    favorites: Dict[str, int] = Field(..., description="Dictionary of product_id (string) -> quantity (integer, typically 1 for favorited)")


class FavoritesDelete(BaseModel):
    """Model for deleting favorites."""
    product_ids: List[int] = Field(..., min_items=1, description="List of product IDs to remove from favorites")


@router.get("")
@router.get("/")
async def get_favorites(
    user_id: Optional[str] = Query(None, description="Filter by user_id (UUID). Public read access - no authentication required."),
    db: Client = Depends(get_db_client)
):
    """
    Get favorites for a user. Public read access - no authentication required.
    Returns the user's favorites as JSONB (product_id string -> quantity integer, typically 1 for favorited).
    """
    try:
        if not user_id:
            raise HTTPException(
                status_code=400, 
                detail="user_id query parameter is required"
            )
        
        # Validate UUID format
        try:
            UUID(user_id)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid user_id format: {user_id}")
        
        response = (
            db.table("profiles")
            .select("id,favorites,created_at,updated_at")
            .eq("id", user_id)
            .execute()
        )
        
        if not response.data or len(response.data) == 0:
            # Return empty favorites structure if user has no profile
            return {
                "user_id": user_id,
                "favorites": {},
                "created_at": None,
                "updated_at": None
            }
        
        profile = response.data[0]
        return {
            "user_id": profile.get("id"),
            "favorites": profile.get("favorites", {}),
            "created_at": profile.get("created_at"),
            "updated_at": profile.get("updated_at")
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching favorites: {str(e)}")


@router.post("")
@router.post("/")
async def update_favorites(
    favorites_update: FavoritesUpdate = Body(...),
    user_id: UUID = Depends(require_auth),
    db: Client = Depends(get_db_client)
):
    """
    Update favorites for the current user.
    Merges new favorites with existing favorites.
    Items with quantity 0 are automatically removed.
    Format: JSON object where keys are product_id strings and values are integer quantities (typically 1 for favorited).
    """
    try:
        # Get existing profile
        existing = (
            db.table("profiles")
            .select("id,favorites")
            .eq("id", str(user_id))
            .execute()
        )
        
        # Get current favorites from database
        if existing.data and len(existing.data) > 0:
            current_favorites_raw = existing.data[0].get("favorites")
        else:
            current_favorites_raw = None
        
        # Handle current favorites - ensure it's a dict
        if current_favorites_raw is None:
            current_favorites = {}
        elif isinstance(current_favorites_raw, dict):
            current_favorites = current_favorites_raw
        else:
            # If it's not a dict, initialize as empty
            current_favorites = {}
        
        # Normalize current favorites: ensure keys are strings and values are integers
        normalized_current = {}
        for k, v in current_favorites.items():
            try:
                key_str = str(k)
                # Ensure value is an integer
                if isinstance(v, (int, float)):
                    val_int = int(v)
                    if val_int > 0:  # Only keep positive quantities
                        normalized_current[key_str] = val_int
            except (ValueError, TypeError):
                # Skip invalid entries
                continue
        
        # Normalize new favorites: ensure keys are strings and values are integers
        normalized_new = {}
        for k, v in favorites_update.favorites.items():
            try:
                key_str = str(k)
                # Ensure value is an integer
                if isinstance(v, (int, float)):
                    val_int = int(v)
                    if val_int > 0:  # Only keep positive quantities
                        normalized_new[key_str] = val_int
            except (ValueError, TypeError):
                # Skip invalid entries
                continue
        
        # Merge (new favorites override existing)
        merged_favorites = {**normalized_current, **normalized_new}
        
        # Update or insert profile
        # Note: Database trigger will update updated_at automatically
        if existing.data and len(existing.data) > 0:
            # Update existing profile
            response = (
                db.table("profiles")
                .update({
                    "favorites": merged_favorites
                })
                .eq("id", str(user_id))
                .execute()
            )
        else:
            # Insert new profile with favorites
            response = (
                db.table("profiles")
                .insert({
                    "id": str(user_id),
                    "favorites": merged_favorites
                })
                .execute()
            )
        
        if not response.data or len(response.data) == 0:
            raise HTTPException(
                status_code=500, 
                detail="Failed to update favorites. The update may have been rejected by the database."
            )
        
        profile = response.data[0]
        return {
            "user_id": profile.get("id"),
            "favorites": profile.get("favorites", {}),
            "created_at": profile.get("created_at"),
            "updated_at": profile.get("updated_at")
        }
    except HTTPException:
        raise
    except Exception as e:
        error_msg = str(e)
        raise HTTPException(
            status_code=500, 
            detail=f"Error updating favorites: {error_msg}"
        )


@router.delete("")
@router.delete("/")
async def delete_favorites(
    favorites_delete: FavoritesDelete = Body(...),
    user_id: UUID = Depends(require_auth),
    db: Client = Depends(get_db_client)
):
    """
    Delete favorites from the current user's favorites.
    """
    try:
        # Get existing profile
        existing = (
            db.table("profiles")
            .select("id,favorites")
            .eq("id", str(user_id))
            .execute()
        )
        
        if not existing.data or len(existing.data) == 0:
            raise HTTPException(status_code=404, detail="Profile not found")
        
        # Get current favorites from database
        current_favorites_raw = existing.data[0].get("favorites")
        
        # Handle current favorites - ensure it's a dict
        if current_favorites_raw is None:
            current_favorites = {}
        elif isinstance(current_favorites_raw, dict):
            current_favorites = current_favorites_raw
        else:
            current_favorites = {}
        
        # Normalize current favorites: ensure keys are strings
        normalized_current = {}
        for k, v in current_favorites.items():
            try:
                key_str = str(k)
                # Ensure value is an integer
                if isinstance(v, (int, float)):
                    val_int = int(v)
                    if val_int > 0:
                        normalized_current[key_str] = val_int
            except (ValueError, TypeError):
                continue
        
        # Convert product_ids to remove to strings
        product_ids_to_remove = set(str(pid) for pid in favorites_delete.product_ids)
        
        # Remove requested favorites
        updated_favorites = {k: v for k, v in normalized_current.items() if k not in product_ids_to_remove}
        
        response = (
            db.table("profiles")
            .update({
                "favorites": updated_favorites
            })
            .eq("id", str(user_id))
            .execute()
        )
        
        if not response.data or len(response.data) == 0:
            raise HTTPException(
                status_code=500, 
                detail="Failed to delete favorites. The update may have been rejected by the database."
            )
        
        profile = response.data[0]
        return {
            "user_id": profile.get("id"),
            "favorites": profile.get("favorites", {}),
            "created_at": profile.get("created_at"),
            "updated_at": profile.get("updated_at")
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, 
            detail=f"Error deleting favorites: {str(e)}"
        )
