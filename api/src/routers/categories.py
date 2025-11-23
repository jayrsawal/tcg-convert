"""
Categories endpoint router.
"""
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends, Query
from supabase import Client
from src.database import get_db_client
from src.models import PaginationParams, PaginatedResponse

router = APIRouter(prefix="/categories", tags=["categories"])


@router.get("/", response_model=PaginatedResponse[dict])
async def list_categories(
    pagination: PaginationParams = Depends(),
    db: Client = Depends(get_db_client)
):
    """
    List all categories with pagination.
    Results are sorted by category_id.
    """
    try:
        offset = (pagination.page - 1) * pagination.limit
        
        response = (
            db.table("categories")
            .select("*")
            .order("category_id", desc=False)
            .range(offset, offset + pagination.limit - 1)
            .execute()
        )
        
        count_response = (
            db.table("categories")
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
        raise HTTPException(status_code=500, detail=f"Error fetching categories: {str(e)}")


@router.get("/product-counts")
async def get_product_counts_by_category(
    db: Client = Depends(get_db_client)
):
    """
    Get product counts by category.
    Returns a dictionary mapping category_id to product count.
    """
    try:
        # Get all categories
        categories_response = db.table("categories").select("category_id").execute()
        category_ids = [cat["category_id"] for cat in categories_response.data] if categories_response.data else []
        
        # Get product counts for each category
        counts = {}
        for category_id in category_ids:
            count_response = (
                db.table("products")
                .select("*", count="exact")
                .eq("category_id", category_id)
                .execute()
            )
            counts[category_id] = count_response.count if count_response.count is not None else 0
        
        return counts
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching product counts by category: {str(e)}")


@router.get("/rules")
async def get_category_rules(
    category_id: Optional[int] = Query(None, description="Filter by category_id. If not provided, returns all category rules."),
    db: Client = Depends(get_db_client)
):
    """
    Get category rules (game rules for deck building).
    - If category_id is provided: Returns rules for that specific category
    - If category_id is not provided: Returns all category game rules
    """
    try:
        query = db.table("category_game_rules").select("*")
        
        # Filter by category_id if provided
        if category_id is not None:
            query = query.eq("category_id", category_id)
        
        response = query.execute()
        
        # If filtering by category_id and not found, return 404
        if category_id is not None:
            if not response.data:
                raise HTTPException(
                    status_code=404, 
                    detail=f"Category rules for category_id {category_id} not found"
                )
            # Return single object when filtering by category_id
            return response.data[0]
        
        # Return list when getting all rules
        return response.data if response.data else []
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching category rules: {str(e)}")


@router.get("/{category_id}")
async def get_category(
    category_id: int,
    db: Client = Depends(get_db_client)
):
    """
    Get a single category by primary key (category_id).
    """
    try:
        response = (
            db.table("categories")
            .select("*")
            .eq("category_id", category_id)
            .execute()
        )
        
        if not response.data:
            raise HTTPException(status_code=404, detail=f"Category with id {category_id} not found")
        
        return response.data[0]
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching category: {str(e)}")

