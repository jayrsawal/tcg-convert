"""
Price History endpoint router.
"""
from typing import Optional
from datetime import datetime
from fastapi import APIRouter, HTTPException, Depends, Query
from supabase import Client
from src.database import get_db_client
from src.models import PaginationParams, PaginatedResponse

router = APIRouter(prefix="/prices-history", tags=["prices-history"])


@router.get("/", response_model=PaginatedResponse[dict])
async def list_prices_history(
    pagination: PaginationParams = Depends(),
    start_date: Optional[datetime] = Query(
        None, 
        description="Start date for filtering (ISO format: YYYY-MM-DDTHH:MM:SS or YYYY-MM-DD). Returns entries with fetched_at >= start_date."
    ),
    end_date: Optional[datetime] = Query(
        None, 
        description="End date for filtering (ISO format: YYYY-MM-DDTHH:MM:SS or YYYY-MM-DD). Returns entries with fetched_at <= end_date."
    ),
    product_id: Optional[int] = Query(None, description="Filter by specific product ID"),
    db: Client = Depends(get_db_client)
):
    """
    List price history with pagination and optional date/product filtering.
    Results are sorted by product_id, then fetched_at.
    """
    try:
        offset = (pagination.page - 1) * pagination.limit
        
        query = db.table("prices_history").select("*")
        
        # Apply filters
        if start_date:
            query = query.gte("fetched_at", start_date.isoformat())
        if end_date:
            query = query.lte("fetched_at", end_date.isoformat())
        if product_id:
            query = query.eq("product_id", product_id)
        
        # Apply sorting and pagination
        response = (
            query
            .order("product_id", desc=False)
            .order("fetched_at", desc=False)
            .range(offset, offset + pagination.limit - 1)
            .execute()
        )
        
        # Get total count
        count_query = db.table("prices_history").select("*", count="exact")
        if start_date:
            count_query = count_query.gte("fetched_at", start_date.isoformat())
        if end_date:
            count_query = count_query.lte("fetched_at", end_date.isoformat())
        if product_id:
            count_query = count_query.eq("product_id", product_id)
        
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
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching price history: {str(e)}")


@router.get("/by-product/{product_id}", response_model=PaginatedResponse[dict])
async def get_prices_history_by_product(
    product_id: int,
    pagination: PaginationParams = Depends(),
    start_date: Optional[datetime] = Query(
        None,
        description="Start date for filtering (ISO format: YYYY-MM-DDTHH:MM:SS or YYYY-MM-DD). Returns entries with fetched_at >= start_date."
    ),
    end_date: Optional[datetime] = Query(
        None,
        description="End date for filtering (ISO format: YYYY-MM-DDTHH:MM:SS or YYYY-MM-DD). Returns entries with fetched_at <= end_date."
    ),
    db: Client = Depends(get_db_client)
):
    """
    Get all price history for a specific product (filtered by foreign key product_id).
    Results are sorted by product_id, then fetched_at and support pagination.
    Supports optional date filtering via query parameters.
    """
    try:
        offset = (pagination.page - 1) * pagination.limit
        
        query = (
            db.table("prices_history")
            .select("*")
            .eq("product_id", product_id)
        )
        
        # Apply date filters if provided
        if start_date:
            query = query.gte("fetched_at", start_date.isoformat())
        if end_date:
            query = query.lte("fetched_at", end_date.isoformat())
        
        # Apply sorting and pagination
        response = (
            query
            .order("product_id", desc=False)
            .order("fetched_at", desc=False)
            .range(offset, offset + pagination.limit - 1)
            .execute()
        )
        
        # Get total count
        count_query = (
            db.table("prices_history")
            .select("*", count="exact")
            .eq("product_id", product_id)
        )
        if start_date:
            count_query = count_query.gte("fetched_at", start_date.isoformat())
        if end_date:
            count_query = count_query.lte("fetched_at", end_date.isoformat())
        
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
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching price history by product: {str(e)}")


@router.get("/by-product-date")
async def get_price_history_by_product_date(
    product_id: int = Query(..., description="Product ID"),
    fetched_at: datetime = Query(..., description="Fetched at timestamp (ISO format)"),
    db: Client = Depends(get_db_client)
):
    """
    Get a single price history entry by composite primary key (product_id, fetched_at).
    """
    try:
        response = (
            db.table("prices_history")
            .select("*")
            .eq("product_id", product_id)
            .eq("fetched_at", fetched_at.isoformat())
            .execute()
        )
        
        if not response.data:
            raise HTTPException(
                status_code=404,
                detail=f"Price history with product_id {product_id} and fetched_at {fetched_at.isoformat()} not found"
            )
        
        return response.data[0]
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching price history: {str(e)}")

