"""
Category Extended Data Keys endpoint router.
"""
from fastapi import APIRouter, HTTPException, Depends, Query
from supabase import Client
from src.database import get_db_client
from src.models import PaginationParams, PaginatedResponse

router = APIRouter(prefix="/category-extended-data-keys", tags=["category-extended-data-keys"])


@router.get("/", response_model=PaginatedResponse[dict])
async def list_category_extended_data_keys(
    pagination: PaginationParams = Depends(),
    db: Client = Depends(get_db_client)
):
    """
    List all category extended data keys with pagination.
    Results are sorted by category_id, then key (composite primary key).
    """
    try:
        offset = (pagination.page - 1) * pagination.limit
        
        response = (
            db.table("category_extended_data_keys")
            .select("*")
            .order("category_id", desc=False)
            .order("key", desc=False)
            .range(offset, offset + pagination.limit - 1)
            .execute()
        )
        
        count_response = (
            db.table("category_extended_data_keys")
            .select("*", count="exact")
            .execute()
        )
        total = count_response.count if count_response.count is not None else None
        
        has_more = total is not None and (offset + pagination.limit) < total
        
        return PaginatedResponse(
            data=response.data,
            page=pagination.page,
            limit=pagination.limit,
            total=total,
            has_more=has_more
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching category extended data keys: {str(e)}")


@router.get("/by-category/{category_id}", response_model=PaginatedResponse[dict])
async def get_keys_by_category(
    category_id: int,
    pagination: PaginationParams = Depends(),
    db: Client = Depends(get_db_client)
):
    """
    Get all extended data keys for a specific category (filtered by foreign key category_id).
    Results are sorted by key and support pagination.
    """
    try:
        offset = (pagination.page - 1) * pagination.limit
        
        response = (
            db.table("category_extended_data_keys")
            .select("*")
            .eq("category_id", category_id)
            .order("key", desc=False)
            .range(offset, offset + pagination.limit - 1)
            .execute()
        )
        
        count_response = (
            db.table("category_extended_data_keys")
            .select("*", count="exact")
            .eq("category_id", category_id)
            .execute()
        )
        total = count_response.count if count_response.count is not None else None
        
        has_more = total is not None and (offset + pagination.limit) < total
        
        return PaginatedResponse(
            data=response.data,
            page=pagination.page,
            limit=pagination.limit,
            total=total,
            has_more=has_more
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching keys by category: {str(e)}")


@router.get("/by-category-key")
async def get_category_extended_data_key(
    category_id: int = Query(..., description="Category ID"),
    key: str = Query(..., description="Extended data key name"),
    db: Client = Depends(get_db_client)
):
    """
    Get a single category extended data key by composite primary key (category_id, key).
    """
    try:
        response = (
            db.table("category_extended_data_keys")
            .select("*")
            .eq("category_id", category_id)
            .eq("key", key)
            .execute()
        )
        
        if not response.data:
            raise HTTPException(
                status_code=404,
                detail=f"Category extended data key with category_id {category_id} and key '{key}' not found"
            )
        
        return response.data[0]
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching category extended data key: {str(e)}")

