"""
Product Extended Data endpoint router.
"""
import json
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends, Query
from supabase import Client
from src.database import get_db_client
from src.models import PaginationParams, PaginatedResponse

router = APIRouter(prefix="/product-extended-data", tags=["product-extended-data"])


@router.get("", response_model=PaginatedResponse[dict])
@router.get("/", response_model=PaginatedResponse[dict])
async def list_product_extended_data(
    pagination: PaginationParams = Depends(),
    db: Client = Depends(get_db_client)
):
    """
    List all product extended data entries with pagination.
    Results are sorted by product_id, then key (composite primary key).
    """
    try:
        # Calculate offset for pagination
        offset = (pagination.page - 1) * pagination.limit
        
        # Query with pagination and sorting by composite primary key
        # Sort by product_id first, then by key
        response = (
            db.table("product_extended_data")
            .select("*")
            .order("product_id", desc=False)
            .order("key", desc=False)
            .range(offset, offset + pagination.limit - 1)
            .execute()
        )
        
        # Get total count for pagination metadata
        count_response = (
            db.table("product_extended_data")
            .select("*", count="exact")
            .execute()
        )
        total = count_response.count if count_response.count is not None else None
        
        # Determine if there are more pages
        has_more = total is not None and (offset + pagination.limit) < total
        
        return PaginatedResponse(
            data=response.data,
            page=pagination.page,
            limit=pagination.limit,
            total=total,
            has_more=has_more
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching product extended data: {str(e)}")


@router.get("/by-category/{category_id}", response_model=PaginatedResponse[dict])
async def get_extended_data_by_category(
    category_id: int,
    pagination: PaginationParams = Depends(),
    db: Client = Depends(get_db_client)
):
    """
    Get all extended data entries for products in a specific category (filtered by category_id through products).
    Results are sorted by product_id, then key and support pagination.
    """
    try:
        # Calculate offset for pagination
        offset = (pagination.page - 1) * pagination.limit
        
        # Use inner join through products table to filter by category_id
        # First get product_ids for this category
        products_response = (
            db.table("products")
            .select("product_id")
            .eq("category_id", category_id)
            .execute()
        )
        
        product_ids = [p["product_id"] for p in products_response.data] if products_response.data else []
        
        if not product_ids:
            return PaginatedResponse(
                data=[],
                page=pagination.page,
                limit=pagination.limit,
                total=0,
                has_more=False
            )
        
        # Query extended data for these products
        response = (
            db.table("product_extended_data")
            .select("*")
            .in_("product_id", product_ids)
            .order("product_id", desc=False)
            .order("key", desc=False)
            .range(offset, offset + pagination.limit - 1)
            .execute()
        )
        
        # Get total count for pagination metadata
        count_response = (
            db.table("product_extended_data")
            .select("*", count="exact")
            .in_("product_id", product_ids)
            .execute()
        )
        total = count_response.count if count_response.count is not None else None
        
        # Determine if there are more pages
        has_more = total is not None and (offset + pagination.limit) < total
        
        return PaginatedResponse(
            data=response.data,
            page=pagination.page,
            limit=pagination.limit,
            total=total,
            has_more=has_more
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching extended data by category: {str(e)}")


@router.get("/by-category/{category_id}/keys")
async def get_keys_by_category(
    category_id: int,
    pagination: PaginationParams = Depends(),
    db: Client = Depends(get_db_client)
):
    """
    Get unique list of extended data keys for products in a specific category.
    Returns distinct key names.
    """
    try:
        # Use inner join through products table to filter by category_id
        # First get product_ids for this category
        products_response = (
            db.table("products")
            .select("product_id")
            .eq("category_id", category_id)
            .execute()
        )
        
        product_ids = [p["product_id"] for p in products_response.data] if products_response.data else []
        
        if not product_ids:
            return PaginatedResponse(
                data=[],
                page=pagination.page,
                limit=pagination.limit,
                total=0,
                has_more=False
            )
        
        # Get all extended data for these products
        all_data = (
            db.table("product_extended_data")
            .select("key")
            .in_("product_id", product_ids)
            .execute()
        )
        
        # Extract unique keys
        unique_keys = sorted(set(item["key"] for item in all_data.data if item.get("key")))
        
        # Apply pagination manually
        offset = (pagination.page - 1) * pagination.limit
        paginated_keys = unique_keys[offset:offset + pagination.limit]
        
        total = len(unique_keys)
        has_more = (offset + pagination.limit) < total
        
        # Format as list of objects with key field
        data = [{"key": key} for key in paginated_keys]
        
        return PaginatedResponse(
            data=data,
            page=pagination.page,
            limit=pagination.limit,
            total=total,
            has_more=has_more
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching keys by category: {str(e)}")


@router.get("/by-category/{category_id}/key-values")
async def get_unique_key_value_pairs_by_category(
    category_id: int,
    db: Client = Depends(get_db_client)
):
    """
    Get unique key-value pairs for products in a specific category.
    Returns a dictionary mapping each key to a list of unique values.
    Useful for building filter UIs.
    
    This endpoint parses extended_data_raw JSON from products directly,
    which is more efficient than querying the product_extended_data table.
    """
    try:
        # Query products with extended_data_raw field for this category
        # Use pagination to handle large datasets efficiently
        key_values = {}  # Dictionary to store key -> set of unique values
        
        # Fetch products in batches to handle large categories
        page = 1
        limit = 1000
        has_more = True
        
        while has_more:
            offset = (page - 1) * limit
            
            # Query products with extended_data_raw field
            products_response = (
                db.table("products")
                .select("extended_data_raw")
                .eq("category_id", category_id)
                .not_.is_("extended_data_raw", "null")
                .range(offset, offset + limit - 1)
                .execute()
            )
            
            if not products_response.data:
                break
            
            # Parse extended_data_raw for each product and build key-value map
            for product in products_response.data:
                extended_data_raw = product.get("extended_data_raw")
                
                # Skip if null, empty, or not present
                if not extended_data_raw:
                    continue
                
                # Parse JSON string (extended_data_raw is stored as a JSON string)
                try:
                    # Handle both string and already-parsed cases
                    if isinstance(extended_data_raw, str):
                        # Parse the JSON string
                        # Handle empty string case
                        if not extended_data_raw.strip():
                            continue
                        data = json.loads(extended_data_raw)
                    elif isinstance(extended_data_raw, dict):
                        # Already parsed (shouldn't happen with jsonb, but handle it)
                        data = extended_data_raw
                    else:
                        # Unexpected type, skip
                        continue
                    
                    # Process each key-value pair
                    if isinstance(data, list) and data:
                        for d in data:
                            key = d["name"]
                            value = d["value"]
                            if key in ("Description", "Number", "Trait"):
                                continue

                            # Initialize set for this key if not exists
                            if key not in key_values:
                                key_values[key] = set()
                            
                            # Add value to set (handles None, empty strings, etc.)
                            if value is not None:
                                # Convert value to string for consistency
                                value_str = str(value).strip()
                                if value_str:
                                    key_values[key].add(value_str)
                
                except (json.JSONDecodeError, TypeError, AttributeError, ValueError) as e:
                    # Skip products with invalid JSON in extended_data_raw
                    # Continue processing other products
                    continue
            
            # Check if there are more products to fetch
            has_more = len(products_response.data) == limit
            page += 1
        
        # Convert sets to sorted lists for final result
        result = {key: sorted(list(values)) for key, values in key_values.items()}
        
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching unique key-value pairs by category: {str(e)}")


@router.get("/by-product/{product_id}", response_model=PaginatedResponse[dict])
async def get_extended_data_by_product(
    product_id: int,
    pagination: PaginationParams = Depends(),
    db: Client = Depends(get_db_client)
):
    """
    Get all extended data entries for a specific product (filtered by foreign key product_id).
    Results are sorted by product_id, then key and support pagination.
    """
    try:
        # Calculate offset for pagination
        offset = (pagination.page - 1) * pagination.limit
        
        # Query extended data by product_id with pagination
        response = (
            db.table("product_extended_data")
            .select("*")
            .eq("product_id", product_id)
            .order("product_id", desc=False)
            .order("key", desc=False)
            .range(offset, offset + pagination.limit - 1)
            .execute()
        )
        
        # Get total count for pagination metadata
        count_response = (
            db.table("product_extended_data")
            .select("*", count="exact")
            .eq("product_id", product_id)
            .execute()
        )
        total = count_response.count if count_response.count is not None else None
        
        # Determine if there are more pages
        has_more = total is not None and (offset + pagination.limit) < total
        
        return PaginatedResponse(
            data=response.data,
            page=pagination.page,
            limit=pagination.limit,
            total=total,
            has_more=has_more
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching extended data by product: {str(e)}")


@router.get("/by-product-key")
async def get_product_extended_data(
    product_id: int = Query(..., description="Product ID"),
    key: str = Query(..., description="Extended data key"),
    db: Client = Depends(get_db_client)
):
    """
    Get a single product extended data entry by composite primary key (product_id, key).
    """
    try:
        response = (
            db.table("product_extended_data")
            .select("*")
            .eq("product_id", product_id)
            .eq("key", key)
            .execute()
        )
        
        if not response.data:
            raise HTTPException(
                status_code=404,
                detail=f"Product extended data with product_id {product_id} and key '{key}' not found"
            )
        
        return response.data[0]
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching product extended data: {str(e)}")

