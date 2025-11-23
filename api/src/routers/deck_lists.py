"""
Deck Lists endpoint router.
"""
from typing import Optional, List, Dict
from uuid import UUID
from fastapi import APIRouter, HTTPException, Depends, Body, Header, Query
from pydantic import BaseModel, Field
from supabase import Client
from src.database import get_db_client
from src.models import PaginationParams, PaginatedResponse
from src.auth import require_auth

router = APIRouter(prefix="/deck-lists", tags=["deck-lists"])


class DeckListCreate(BaseModel):
    """Model for creating a deck list."""
    category_id: int
    name: str
    items: Dict[str, int] = Field(default_factory=dict, description="Dictionary of product_id -> quantity")


class DeckListUpdate(BaseModel):
    """Model for updating a deck list (name only). Items should be updated via POST /items endpoint."""
    name: Optional[str] = None


class DeckListItemsUpdate(BaseModel):
    """Model for updating deck list items."""
    items: Dict[str, int] = Field(..., description="Dictionary of product_id -> quantity")


class DeckListItemsDelete(BaseModel):
    """Model for deleting deck list items."""
    product_ids: List[int] = Field(..., min_items=1, description="List of product IDs to remove")


def calculate_card_count(items: Dict[str, int]) -> int:
    """Calculate total card count from items dictionary."""
    return sum(items.values()) if items else 0


@router.get("/", response_model=PaginatedResponse[dict])
async def list_deck_lists(
    pagination: PaginationParams = Depends(),
    user_id: Optional[str] = Query(None, description="Filter by user_id (UUID)"),
    category_id: Optional[int] = Query(None, description="Filter by category_id"),
    authorization: Optional[str] = Header(None),
    db: Client = Depends(get_db_client)
):
    """
    List deck lists with optional filtering.
    - Public read access: Anyone can view all deck lists
    - Optional filters: user_id and/or category_id
    - Results are sorted by updated_at (descending).
    """
    try:
        offset = (pagination.page - 1) * pagination.limit
        
        query = db.table("deck_lists").select("*")
        
        # Apply optional filters
        if user_id:
            try:
                # Validate UUID format
                UUID(user_id)
                query = query.eq("user_id", user_id)
            except ValueError:
                raise HTTPException(status_code=400, detail=f"Invalid user_id format: {user_id}")
        
        if category_id is not None:
            query = query.eq("category_id", category_id)
        
        response = (
            query
            .order("updated_at", desc=True)
            .range(offset, offset + pagination.limit - 1)
            .execute()
        )
        
        # Get count with same filters
        count_query = db.table("deck_lists").select("*", count="exact")
        if user_id:
            try:
                UUID(user_id)
                count_query = count_query.eq("user_id", user_id)
            except ValueError:
                pass  # Already validated above
        if category_id is not None:
            count_query = count_query.eq("category_id", category_id)
        
        count_response = count_query.execute()
        total = count_response.count if count_response.count is not None else None
        
        has_more = total is not None and (offset + pagination.limit) < total
        
        return PaginatedResponse(
            data=response.data,
            page=pagination.page,
            limit=pagination.limit,
            total=total,
            has_more=has_more
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching deck lists: {str(e)}")


@router.post("/")
async def create_deck_list(
    deck_list: DeckListCreate = Body(...),
    user_id: UUID = Depends(require_auth),
    db: Client = Depends(get_db_client)
):
    """
    Create a new deck list for the current user.
    """
    try:
        
        card_count = calculate_card_count(deck_list.items)
        
        response = (
            db.table("deck_lists")
            .insert({
                "user_id": str(user_id),
                "category_id": deck_list.category_id,
                "name": deck_list.name,
                "items": deck_list.items,
                "card_count": card_count
            })
            .execute()
        )
        
        if not response.data:
            raise HTTPException(status_code=500, detail="Failed to create deck list")
        
        return response.data[0]
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error creating deck list: {str(e)}")


@router.get("/{deck_list_id}")
async def get_deck_list(
    deck_list_id: int,
    db: Client = Depends(get_db_client)
):
    """
    Get a single deck list by primary key (deck_list_id).
    Public read access - no authentication required.
    """
    try:
        # First, try to get the deck list directly
        response = (
            db.table("deck_lists")
            .select("*")
            .eq("deck_list_id", deck_list_id)
            .execute()
        )
        
        # Check response
        if not response or not hasattr(response, 'data'):
            raise HTTPException(
                status_code=500,
                detail=f"Invalid response object from database query"
            )
        
        if response.data is None:
            raise HTTPException(
                status_code=404, 
                detail=f"Deck list with id {deck_list_id} not found"
            )
        
        if not isinstance(response.data, list):
            raise HTTPException(
                status_code=500,
                detail=f"Unexpected response format: expected list, got {type(response.data)}"
            )
        
        if len(response.data) == 0:
            raise HTTPException(
                status_code=404, 
                detail=f"Deck list with id {deck_list_id} not found"
            )
        
        return response.data[0]
    except HTTPException:
        raise
    except Exception as e:
        # Re-raise HTTPExceptions
        if isinstance(e, HTTPException):
            raise
        # For other exceptions, provide detailed error info
        error_detail = f"Error fetching deck list: {str(e)}"
        raise HTTPException(status_code=500, detail=error_detail)


@router.patch("/{deck_list_id}")
async def update_deck_list(
    deck_list_id: int,
    deck_list: DeckListUpdate = Body(...),
    user_id: UUID = Depends(require_auth),
    db: Client = Depends(get_db_client)
):
    """
    Update a deck list name for the current user.
    Note: To update items, use POST /deck-lists/{deck_list_id}/items endpoint.
    """
    try:
        # Verify ownership
        existing = (
            db.table("deck_lists")
            .select("*")
            .eq("deck_list_id", deck_list_id)
            .eq("user_id", str(user_id))
            .execute()
        )
        
        if not existing.data:
            raise HTTPException(status_code=404, detail="Deck list not found")
        
        # Only update name if provided
        if deck_list.name is None:
            return existing.data[0]
        
        response = (
            db.table("deck_lists")
            .update({"name": deck_list.name})
            .eq("deck_list_id", deck_list_id)
            .eq("user_id", str(user_id))
            .execute()
        )
        
        if not response.data:
            raise HTTPException(status_code=500, detail="Failed to update deck list")
        
        return response.data[0]
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error updating deck list: {str(e)}")


@router.delete("/{deck_list_id}")
async def delete_deck_list(
    deck_list_id: int,
    user_id: UUID = Depends(require_auth),
    db: Client = Depends(get_db_client)
):
    """
    Delete a deck list for the current user.
    """
    try:
        
        response = (
            db.table("deck_lists")
            .delete()
            .eq("deck_list_id", deck_list_id)
            .eq("user_id", str(user_id))
            .execute()
        )
        
        if not response.data:
            raise HTTPException(status_code=404, detail="Deck list not found")
        
        return {"message": "Deck list deleted successfully"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error deleting deck list: {str(e)}")


@router.post("/{deck_list_id}/items")
async def update_deck_list_items(
    deck_list_id: int,
    items_update: DeckListItemsUpdate = Body(...),
    user_id: UUID = Depends(require_auth),
    db: Client = Depends(get_db_client)
):
    """
    Update items in a deck list for the current user.
    Merges new items with existing items.
    Items format: JSON object where keys are product_id strings and values are integer quantities.
    """
    try:
        # Get existing deck list
        existing = (
            db.table("deck_lists")
            .select("*")
            .eq("deck_list_id", deck_list_id)
            .eq("user_id", str(user_id))
            .execute()
        )
        
        if not existing.data or len(existing.data) == 0:
            raise HTTPException(status_code=404, detail="Deck list not found")
        
        # Get current items from database
        current_items_raw = existing.data[0].get("items")
        
        # Handle current items - ensure it's a dict
        if current_items_raw is None:
            current_items = {}
        elif isinstance(current_items_raw, dict):
            current_items = current_items_raw
        else:
            # If it's not a dict, initialize as empty
            current_items = {}
        
        # Normalize current items: ensure keys are strings and values are integers
        normalized_current = {}
        for k, v in current_items.items():
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
        
        # Normalize new items: ensure keys are strings and values are integers
        normalized_new = {}
        for k, v in items_update.items.items():
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
        
        # Merge (new items override existing)
        merged_items = {**normalized_current, **normalized_new}
        
        # Calculate card count
        card_count = sum(merged_items.values())
        
        # Update the deck list
        # Note: Database trigger will also update card_count, but we calculate it here for consistency
        response = (
            db.table("deck_lists")
            .update({
                "items": merged_items,
                "card_count": card_count
            })
            .eq("deck_list_id", deck_list_id)
            .eq("user_id", str(user_id))
            .execute()
        )
        
        if not response.data or len(response.data) == 0:
            raise HTTPException(
                status_code=500, 
                detail="Failed to update deck list items. The update may have been rejected by the database."
            )
        
        return response.data[0]
    except HTTPException:
        raise
    except Exception as e:
        # Provide more detailed error information
        error_msg = str(e)
        raise HTTPException(
            status_code=500, 
            detail=f"Error updating deck list items: {error_msg}"
        )


@router.delete("/{deck_list_id}/items")
async def delete_deck_list_items(
    deck_list_id: int,
    items_delete: DeckListItemsDelete = Body(...),
    user_id: UUID = Depends(require_auth),
    db: Client = Depends(get_db_client)
):
    """
    Delete items from a deck list for the current user.
    """
    try:
        # Get existing deck list
        existing = (
            db.table("deck_lists")
            .select("*")
            .eq("deck_list_id", deck_list_id)
            .eq("user_id", str(user_id))
            .execute()
        )
        
        if not existing.data or len(existing.data) == 0:
            raise HTTPException(status_code=404, detail="Deck list not found")
        
        # Get current items from database
        current_items_raw = existing.data[0].get("items")
        
        # Handle current items - ensure it's a dict
        if current_items_raw is None:
            current_items = {}
        elif isinstance(current_items_raw, dict):
            current_items = current_items_raw
        else:
            current_items = {}
        
        # Normalize current items: ensure keys are strings
        normalized_current = {}
        for k, v in current_items.items():
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
        product_ids_to_remove = set(str(pid) for pid in items_delete.product_ids)
        
        # Remove requested items
        updated_items = {k: v for k, v in normalized_current.items() if k not in product_ids_to_remove}
        
        # Calculate card count
        card_count = sum(updated_items.values())
        
        response = (
            db.table("deck_lists")
            .update({
                "items": updated_items,
                "card_count": card_count
            })
            .eq("deck_list_id", deck_list_id)
            .eq("user_id", str(user_id))
            .execute()
        )
        
        if not response.data or len(response.data) == 0:
            raise HTTPException(
                status_code=500, 
                detail="Failed to delete deck list items. The update may have been rejected by the database."
            )
        
        return response.data[0]
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, 
            detail=f"Error deleting deck list items: {str(e)}"
        )

