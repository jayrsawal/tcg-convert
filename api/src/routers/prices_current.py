"""
Current Prices endpoint router.
"""
import logging
from typing import List
from fastapi import APIRouter, HTTPException, Depends, Body, Request
from pydantic import BaseModel, Field
from supabase import Client
from src.database import get_db_client
from src.models import PaginationParams, PaginatedResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/prices-current", tags=["prices-current"])


class BulkPriceRequest(BaseModel):
    """Model for bulk price lookup request."""
    product_ids: List[int] = Field(..., min_items=1, max_items=1000, description="List of product IDs to fetch")


@router.get("")
@router.get("/")
async def list_prices_current(
    db: Client = Depends(get_db_client)
):
    """
    List all current prices.
    Results are sorted by product_id.
    """
    try:
        response = (
            db.table("prices_current")
            .select("*")
            .order("product_id", desc=False)
            .execute()
        )
        
        return response.data
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching current prices: {str(e)}")


@router.get("/{product_id}")
async def get_price_current(
    product_id: int,
    db: Client = Depends(get_db_client)
):
    """
    Get current price for a single product by primary key (product_id).
    """
    try:
        response = (
            db.table("prices_current")
            .select("*")
            .eq("product_id", product_id)
            .execute()
        )
        
        if not response.data:
            raise HTTPException(status_code=404, detail=f"Current price for product_id {product_id} not found")
        
        return response.data[0]
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching current price: {str(e)}")


@router.post("/bulk")
async def get_prices_current_bulk(
    request: BulkPriceRequest = Body(...),
    db: Client = Depends(get_db_client)
):
    """
    Get multiple current prices by their product IDs in bulk.
    
    Accepts a list of product IDs and returns current prices for all matching products.
    Products that don't have prices will not be included in the response.
    
    **Limits:**
    - Maximum 1000 product IDs per request
    
    **Example:**
    ```json
    {
      "product_ids": [12345, 67890, 11111]
    }
    ```
    """
    try:
        # Log incoming request details
        logger.info(
            f"BULK PRICES REQUEST: Received {len(request.product_ids)} product IDs. "
            f"First 10 IDs: {request.product_ids[:10]}"
        )
        # Remove duplicates and validate
        unique_product_ids = list(set(request.product_ids))
        
        if len(unique_product_ids) > 1000:
            raise HTTPException(
                status_code=400,
                detail="Maximum 1000 product IDs allowed per request"
            )
        
        # Batch process if needed
        batch_size = 1000
        all_prices = []
        
        for i in range(0, len(unique_product_ids), batch_size):
            batch = unique_product_ids[i:i + batch_size]
            
            response = (
                db.table("prices_current")
                .select("*")
                .in_("product_id", batch)
                .execute()
            )
            
            all_prices.extend(response.data)
        
        # Create a map for quick lookup
        price_map = {price["product_id"]: price for price in all_prices}
        
        # Return prices in the order requested (preserving order)
        result = []
        for product_id in request.product_ids:
            if product_id in price_map:
                result.append(price_map[product_id])
        
        return {
            "prices": result,
            "requested_count": len(request.product_ids),
            "found_count": len(result),
            "missing_count": len(request.product_ids) - len(result)
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching bulk prices: {str(e)}")

