"""
User Inventory endpoint router.
Works with profiles table items column (JSONB structure).
"""
from typing import Optional, List, Dict
from uuid import UUID
from fastapi import APIRouter, HTTPException, Depends, Body, Query
from pydantic import BaseModel, Field
from supabase import Client
from src.database import get_db_client
from src.auth import require_auth

router = APIRouter(prefix="/user-inventory", tags=["user-inventory"])


class InventoryItemsUpdate(BaseModel):
    """Model for updating inventory items."""
    items: Dict[str, int] = Field(..., description="Dictionary of product_id -> quantity")


class InventoryItemsDelete(BaseModel):
    """Model for deleting inventory items."""
    product_ids: List[int] = Field(..., min_items=1, description="List of product IDs to remove")


def calculate_total_count(items: Dict[str, int]) -> int:
    """Calculate total item count from items dictionary."""
    return sum(items.values()) if items else 0


@router.get("/")
async def get_inventory(
    user_id: Optional[str] = Query(None, description="Filter by user_id (UUID). Public read access - no authentication required."),
    db: Client = Depends(get_db_client)
):
    """
    Get inventory for a user. Public read access - no authentication required.
    Returns the user's inventory with items as JSONB (product_id string -> quantity integer).
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
            .select("id,items,total_count,created_at,updated_at")
            .eq("id", user_id)
            .execute()
        )
        
        if not response.data or len(response.data) == 0:
            # Return empty inventory structure if user has no profile
            return {
                "user_id": user_id,
                "items": {},
                "total_count": 0,
                "created_at": None,
                "updated_at": None
            }
        
        profile = response.data[0]
        return {
            "user_id": profile.get("id"),
            "items": profile.get("items", {}),
            "total_count": profile.get("total_count", 0),
            "created_at": profile.get("created_at"),
            "updated_at": profile.get("updated_at")
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching inventory: {str(e)}")


@router.post("/items")
async def update_inventory_items(
    items_update: InventoryItemsUpdate = Body(...),
    user_id: UUID = Depends(require_auth),
    db: Client = Depends(get_db_client)
):
    """
    Update items in inventory for the current user.
    Merges new items with existing items.
    Items format: JSON object where keys are product_id strings and values are integer quantities.
    """
    try:
        # Get existing profile
        existing = (
            db.table("profiles")
            .select("id,items,total_count")
            .eq("id", str(user_id))
            .execute()
        )
        
        # Get current items from database
        if existing.data and len(existing.data) > 0:
            current_items_raw = existing.data[0].get("items")
        else:
            current_items_raw = None
        
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
        
        # Calculate total count
        total_count = sum(merged_items.values())
        
        # Update or insert profile
        # Note: Database triggers will update total_count and updated_at automatically
        if existing.data and len(existing.data) > 0:
            # Update existing profile
            response = (
                db.table("profiles")
                .update({
                    "items": merged_items,
                    "total_count": total_count
                })
                .eq("id", str(user_id))
                .execute()
            )
        else:
            # Insert new profile with inventory
            response = (
                db.table("profiles")
                .insert({
                    "id": str(user_id),
                    "items": merged_items,
                    "total_count": total_count
                })
                .execute()
            )
        
        if not response.data or len(response.data) == 0:
            raise HTTPException(
                status_code=500, 
                detail="Failed to update inventory items. The update may have been rejected by the database."
            )
        
        profile = response.data[0]
        return {
            "user_id": profile.get("id"),
            "items": profile.get("items", {}),
            "total_count": profile.get("total_count", 0),
            "created_at": profile.get("created_at"),
            "updated_at": profile.get("updated_at")
        }
    except HTTPException:
        raise
    except Exception as e:
        error_msg = str(e)
        raise HTTPException(
            status_code=500, 
            detail=f"Error updating inventory items: {error_msg}"
        )


@router.delete("/items")
async def delete_inventory_items(
    items_delete: InventoryItemsDelete = Body(...),
    user_id: UUID = Depends(require_auth),
    db: Client = Depends(get_db_client)
):
    """
    Delete items from inventory for the current user.
    """
    try:
        # Get existing profile
        existing = (
            db.table("profiles")
            .select("id,items,total_count")
            .eq("id", str(user_id))
            .execute()
        )
        
        if not existing.data or len(existing.data) == 0:
            raise HTTPException(status_code=404, detail="Profile not found")
        
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
        
        # Calculate total count
        total_count = sum(updated_items.values())
        
        response = (
            db.table("profiles")
            .update({
                "items": updated_items,
                "total_count": total_count
            })
            .eq("id", str(user_id))
            .execute()
        )
        
        if not response.data or len(response.data) == 0:
            raise HTTPException(
                status_code=500, 
                detail="Failed to delete inventory items. The update may have been rejected by the database."
            )
        
        profile = response.data[0]
        return {
            "user_id": profile.get("id"),
            "items": profile.get("items", {}),
            "total_count": profile.get("total_count", 0),
            "created_at": profile.get("created_at"),
            "updated_at": profile.get("updated_at")
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, 
            detail=f"Error deleting inventory items: {str(e)}"
        )


@router.get("/by-category/stats")
async def get_inventory_stats_by_category(
    user_id: UUID = Depends(require_auth),
    db: Client = Depends(get_db_client)
):
    """
    Get inventory statistics grouped by category for the current user.
    Returns total quantity and unique product count per category.
    """
    try:
        # Get user's profile with inventory
        profile_response = (
            db.table("profiles")
            .select("items")
            .eq("id", str(user_id))
            .execute()
        )
        
        if not profile_response.data or len(profile_response.data) == 0:
            return []
        
        items = profile_response.data[0].get("items", {})
        if not isinstance(items, dict) or not items:
            return []
        
        # Get product details for all product IDs in inventory
        product_ids = [int(pid) for pid in items.keys() if pid.isdigit()]
        
        if not product_ids:
            return []
        
        # Fetch products in batches (Supabase has limits)
        all_products = []
        batch_size = 1000
        for i in range(0, len(product_ids), batch_size):
            batch = product_ids[i:i + batch_size]
            products_response = (
                db.table("products")
                .select("product_id,category_id")
                .in_("product_id", batch)
                .execute()
            )
            if products_response.data:
                all_products.extend(products_response.data)
        
        # Build product_id -> category_id map
        product_to_category = {
            p["product_id"]: p.get("category_id") 
            for p in all_products 
            if p.get("category_id") is not None
        }
        
        # Group by category
        category_stats: Dict[int, Dict] = {}
        
        for product_id_str, quantity in items.items():
            try:
                product_id = int(product_id_str)
                category_id = product_to_category.get(product_id)
                
                if category_id is None:
                    continue
                
                if category_id not in category_stats:
                    category_stats[category_id] = {
                        "category_id": category_id,
                        "total_quantity": 0,
                        "unique_products": 0
                    }
                
                category_stats[category_id]["total_quantity"] += quantity if isinstance(quantity, int) else 0
                category_stats[category_id]["unique_products"] += 1
            except (ValueError, TypeError):
                continue
        
        return list(category_stats.values())
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching inventory stats: {str(e)}")
