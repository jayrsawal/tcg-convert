"""
Vendor Prices endpoint router.
"""
from typing import Optional, List
from datetime import datetime
from fastapi import APIRouter, HTTPException, Depends, Query
from supabase import Client
from src.database import get_db_client
from src.models import PaginationParams, PaginatedResponse

router = APIRouter(prefix="/vendor-prices", tags=["vendor-prices"])


@router.get("/by-product", response_model=PaginatedResponse[dict])
async def get_vendor_prices_by_product(
    product_ids: List[int] = Query(..., description="List of product IDs to fetch vendor prices for"),
    pagination: PaginationParams = Depends(),
    vendor: Optional[str] = Query(None, description="Optional filter by vendor name"),
    db: Client = Depends(get_db_client)
):
    """
    Get all vendor prices for a list of products.
    Optionally filter by vendor name.
    Results are sorted by product_id, vendor, then title and support pagination.
    Returns: vendor, low_price, high_price, market_price, quickshop_url, fetched_at
    """
    try:
        if not product_ids:
            raise HTTPException(status_code=400, detail="At least one product_id is required")
        
        offset = (pagination.page - 1) * pagination.limit
        
        query = (
            db.table("vendor_prices")
            .select("vendor,title,low_price,high_price,market_price,quickshop_url,fetched_at,product_id")
            .in_("product_id", product_ids)
        )
        
        # Apply optional vendor filter
        if vendor:
            query = query.eq("vendor", vendor)
        
        # Apply sorting and pagination
        response = (
            query
            .order("product_id", desc=False)
            .order("vendor", desc=False)
            .order("title", desc=False)
            .range(offset, offset + pagination.limit - 1)
            .execute()
        )
        
        # Get total count
        count_query = (
            db.table("vendor_prices")
            .select("*", count="exact")
            .in_("product_id", product_ids)
        )
        if vendor:
            count_query = count_query.eq("vendor", vendor)
        
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
        raise HTTPException(status_code=500, detail=f"Error fetching vendor prices by product: {str(e)}")


# Vendor Prices History endpoints

@router.get("/history/by-product", response_model=PaginatedResponse[dict])
async def get_vendor_prices_history_by_product(
    product_ids: List[int] = Query(..., description="List of product IDs to fetch vendor price history for"),
    pagination: PaginationParams = Depends(),
    vendor: Optional[str] = Query(None, description="Optional filter by vendor name"),
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
    Get all vendor price history for a list of products.
    Optionally filter by vendor name and/or date range.
    Results are sorted by fetched_at (descending) and support pagination.
    Returns: vendor, low_price, high_price, market_price, quickshop_url, fetched_at
    """
    try:
        if not product_ids:
            raise HTTPException(status_code=400, detail="At least one product_id is required")
        
        offset = (pagination.page - 1) * pagination.limit
        
        query = (
            db.table("vendor_prices_history")
            .select("id,vendor,title,low_price,high_price,market_price,quickshop_url,fetched_at,product_id")
            .in_("product_id", product_ids)
        )
        
        # Apply optional vendor filter
        if vendor:
            query = query.eq("vendor", vendor)
        
        # Apply date filters if provided
        if start_date:
            query = query.gte("fetched_at", start_date.isoformat())
        if end_date:
            query = query.lte("fetched_at", end_date.isoformat())
        
        # Apply sorting and pagination
        response = (
            query
            .order("fetched_at", desc=True)
            .order("id", desc=False)
            .range(offset, offset + pagination.limit - 1)
            .execute()
        )
        
        # Get total count
        count_query = (
            db.table("vendor_prices_history")
            .select("*", count="exact")
            .in_("product_id", product_ids)
        )
        if vendor:
            count_query = count_query.eq("vendor", vendor)
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
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching vendor price history by product: {str(e)}")

