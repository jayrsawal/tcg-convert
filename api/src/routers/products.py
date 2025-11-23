"""
Products endpoint router.
"""
from typing import Optional, Dict, List, Union
from fastapi import APIRouter, HTTPException, Depends, Body, Query
from pydantic import BaseModel, Field
from supabase import Client
from src.database import get_db_client
from src.models import PaginationParams, PaginatedResponse

router = APIRouter(prefix="/products", tags=["products"])




class ProductFilter(BaseModel):
    """Model for filtering products by extended data key-value pairs."""
    category_id: Optional[int] = None
    group_id: Optional[int] = None
    filters: Dict[str, Union[str, List[str]]] = {}  # Key-value pairs for extended data filtering. Single values or lists of values. Multiple values for a key use OR logic, different keys use AND logic (e.g., {"Rarity": ["Common", "Rare"], "Number": "001"})
    sort_by: Optional[str] = "name"  # Sort field: "name" or "product_id"
    sort_order: Optional[str] = "asc"  # Sort order: "asc" or "desc"


class BulkProductRequest(BaseModel):
    """Model for bulk product lookup request."""
    product_ids: List[int] = Field(..., min_items=1, max_items=1000, description="List of product IDs to fetch")


@router.get("/", response_model=PaginatedResponse[dict])
async def list_products(
    pagination: PaginationParams = Depends(),
    db: Client = Depends(get_db_client)
):
    """
    List all products with pagination.
    Results are sorted by name, then by product_id.
    """
    try:
        # Calculate offset for pagination
        offset = (pagination.page - 1) * pagination.limit
        
        # Try to select with all columns first, fall back if columns don't exist
        try:
            # Query with pagination and sorting by name, then product_id (excluding raw column)
            # Include number column (synced via trigger from product_extended_data) and extended_data_raw
            response = (
                db.table("products")
                .select("product_id,category_id,group_id,name,clean_name,image_url,url,fixed_amount,number,extended_data_raw,modified_on,fetched_at")
                .order("name", desc=False)
                .order("product_id", desc=False)
                .range(offset, offset + pagination.limit - 1)
                .execute()
            )
        except Exception as col_error:
            # If columns don't exist yet, select without them
            error_str = str(col_error).lower()
            if "fixed_amount" in error_str or "number" in error_str or "extended_data_raw" in error_str or "column" in error_str:
                # Try without extended_data_raw first
                try:
                    response = (
                        db.table("products")
                        .select("product_id,category_id,group_id,name,clean_name,image_url,url,fixed_amount,number,modified_on,fetched_at")
                        .order("name", desc=False)
                        .order("product_id", desc=False)
                        .range(offset, offset + pagination.limit - 1)
                        .execute()
                    )
                except Exception:
                    # Try without number
                    try:
                        response = (
                            db.table("products")
                            .select("product_id,category_id,group_id,name,clean_name,image_url,url,fixed_amount,modified_on,fetched_at")
                            .order("name", desc=False)
                            .order("product_id", desc=False)
                            .range(offset, offset + pagination.limit - 1)
                            .execute()
                        )
                    except Exception:
                        # If fixed_amount also doesn't exist, select without all optional columns
                        response = (
                            db.table("products")
                            .select("product_id,category_id,group_id,name,clean_name,image_url,url,modified_on,fetched_at")
                            .order("name", desc=False)
                            .order("product_id", desc=False)
                            .range(offset, offset + pagination.limit - 1)
                            .execute()
                        )
            else:
                raise
        
        # Get total count for pagination metadata
        count_response = (
            db.table("products")
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
        raise HTTPException(status_code=500, detail=f"Error fetching products: {str(e)}")


@router.get("/by-category/{category_id}", response_model=PaginatedResponse[dict])
async def get_products_by_category(
    category_id: int,
    pagination: PaginationParams = Depends(),
    db: Client = Depends(get_db_client)
):
    """
    Get all products for a specific category (filtered by foreign key category_id).
    Results are sorted by name, then by product_id and support pagination.
    """
    try:
        # Calculate offset for pagination
        offset = (pagination.page - 1) * pagination.limit
        
        # Try to select with all columns first, fall back if columns don't exist
        try:
            # Query products by category_id with pagination, sorted by name
            # Include number column (synced via trigger from product_extended_data) and extended_data_raw
            response = (
                db.table("products")
                .select("product_id,category_id,group_id,name,clean_name,image_url,url,fixed_amount,number,extended_data_raw,modified_on,fetched_at")
                .eq("category_id", category_id)
                .order("name", desc=False)
                .order("product_id", desc=False)
                .range(offset, offset + pagination.limit - 1)
                .execute()
            )
        except Exception as col_error:
            # If columns don't exist yet, select without them
            error_str = str(col_error).lower()
            if "fixed_amount" in error_str or "number" in error_str or "extended_data_raw" in error_str or "column" in error_str:
                # Try without extended_data_raw first
                try:
                    response = (
                        db.table("products")
                        .select("product_id,category_id,group_id,name,clean_name,image_url,url,fixed_amount,number,modified_on,fetched_at")
                        .eq("category_id", category_id)
                        .order("name", desc=False)
                        .order("product_id", desc=False)
                        .range(offset, offset + pagination.limit - 1)
                        .execute()
                    )
                except Exception:
                    # Try without number
                    try:
                        response = (
                            db.table("products")
                            .select("product_id,category_id,group_id,name,clean_name,image_url,url,fixed_amount,modified_on,fetched_at")
                            .eq("category_id", category_id)
                            .order("name", desc=False)
                            .order("product_id", desc=False)
                            .range(offset, offset + pagination.limit - 1)
                            .execute()
                        )
                    except Exception:
                        # If fixed_amount also doesn't exist, select without all optional columns
                        response = (
                            db.table("products")
                            .select("product_id,category_id,group_id,name,clean_name,image_url,url,modified_on,fetched_at")
                            .eq("category_id", category_id)
                            .order("name", desc=False)
                            .order("product_id", desc=False)
                            .range(offset, offset + pagination.limit - 1)
                            .execute()
                        )
            else:
                raise
        
        # Get total count for pagination metadata
        count_response = (
            db.table("products")
            .select("*", count="exact")
            .eq("category_id", category_id)
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
        raise HTTPException(status_code=500, detail=f"Error fetching products by category: {str(e)}")


@router.get("/by-group/{group_id}", response_model=PaginatedResponse[dict])
async def get_products_by_group(
    group_id: int,
    pagination: PaginationParams = Depends(),
    db: Client = Depends(get_db_client)
):
    """
    Get all products for a specific group (filtered by foreign key group_id).
    Results are sorted by name, then by product_id and support pagination.
    """
    try:
        # Calculate offset for pagination
        offset = (pagination.page - 1) * pagination.limit
        
        # Try to select with all columns first, fall back if columns don't exist
        try:
            # Query products by group_id with pagination, sorted by name
            # Include number column (synced via trigger from product_extended_data) and extended_data_raw
            response = (
                db.table("products")
                .select("product_id,category_id,group_id,name,clean_name,image_url,url,fixed_amount,number,extended_data_raw,modified_on,fetched_at")
                .eq("group_id", group_id)
                .order("name", desc=False)
                .order("product_id", desc=False)
                .range(offset, offset + pagination.limit - 1)
                .execute()
            )
        except Exception as col_error:
            # If columns don't exist yet, select without them
            error_str = str(col_error).lower()
            if "fixed_amount" in error_str or "number" in error_str or "extended_data_raw" in error_str or "column" in error_str:
                # Try without extended_data_raw first
                try:
                    response = (
                        db.table("products")
                        .select("product_id,category_id,group_id,name,clean_name,image_url,url,fixed_amount,number,modified_on,fetched_at")
                        .eq("group_id", group_id)
                        .order("name", desc=False)
                        .order("product_id", desc=False)
                        .range(offset, offset + pagination.limit - 1)
                        .execute()
                    )
                except Exception:
                    # Try without number
                    try:
                        response = (
                            db.table("products")
                            .select("product_id,category_id,group_id,name,clean_name,image_url,url,fixed_amount,modified_on,fetched_at")
                            .eq("group_id", group_id)
                            .order("name", desc=False)
                            .order("product_id", desc=False)
                            .range(offset, offset + pagination.limit - 1)
                            .execute()
                        )
                    except Exception:
                        # If fixed_amount also doesn't exist, select without all optional columns
                        response = (
                            db.table("products")
                            .select("product_id,category_id,group_id,name,clean_name,image_url,url,modified_on,fetched_at")
                            .eq("group_id", group_id)
                            .order("name", desc=False)
                            .order("product_id", desc=False)
                            .range(offset, offset + pagination.limit - 1)
                            .execute()
                        )
            else:
                raise
        
        # Get total count for pagination metadata
        count_response = (
            db.table("products")
            .select("*", count="exact")
            .eq("group_id", group_id)
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
        raise HTTPException(status_code=500, detail=f"Error fetching products by group: {str(e)}")


@router.post("/filter", response_model=PaginatedResponse[dict])
async def filter_products(
    filter_data: ProductFilter = Body(...),
    pagination: PaginationParams = Depends(),
    db: Client = Depends(get_db_client)
):
    """
    Filter products by extended data key-value pairs, category, and/or group.
    
    **Filter Logic:**
    - Different filter keys are combined with AND logic (e.g., Rarity AND Number)
    - Multiple values for a single key are combined with OR logic (e.g., Rarity=Common OR Rarity=Rare)
    - If category_id is provided, products are filtered by category
    - If group_id is provided, products are filtered by group
    - Results can be sorted by name or product_id, ascending or descending
    
    **Examples:**
    - {"Rarity": "Common", "Number": "001"} - Products with Rarity=Common AND Number=001
    - {"Rarity": ["Common", "Rare"], "Number": "001"} - Products with (Rarity=Common OR Rarity=Rare) AND Number=001
    - {"Rarity": ["Common", "Rare"], "Number": ["001", "002"]} - Products with (Rarity=Common OR Rarity=Rare) AND (Number=001 OR Number=002)
    """
    try:
        # Validate sort parameters
        if filter_data.sort_by not in ["name", "product_id"]:
            raise HTTPException(status_code=400, detail="sort_by must be 'name' or 'product_id'")
        if filter_data.sort_order not in ["asc", "desc"]:
            raise HTTPException(status_code=400, detail="sort_order must be 'asc' or 'desc'")
        
        # Calculate offset for pagination
        offset = (pagination.page - 1) * pagination.limit
        
        # Build base query for products
        base_query = db.table("products").select("product_id")
        
        # Apply category filter if provided
        if filter_data.category_id:
            base_query = base_query.eq("category_id", filter_data.category_id)
        
        # Apply group filter if provided
        if filter_data.group_id:
            base_query = base_query.eq("group_id", filter_data.group_id)
        
        # Get candidate product_ids

        products_response = base_query.execute()
        candidate_product_ids = [p["product_id"] for p in products_response.data] if products_response.data else []
        
        if not candidate_product_ids:
            # No products match the category filter
            return PaginatedResponse(
                data=[],
                page=pagination.page,
                limit=pagination.limit,
                total=0,
                has_more=False
            )
        
        # Apply extended data filters
        if filter_data.filters:
            # For each filter key, find product_ids that match
            matching_product_ids = None
            
            for key, value in filter_data.filters.items():
                # Skip None values
                if value is None:
                    continue
                
                # Normalize value to a list for consistent processing
                values = [value] if isinstance(value, str) else value
                
                if not values:
                    # Skip empty lists
                    continue
                
                # For this key, find product_ids matching any of the values (OR logic)
                key_matching_ids = set()
                
                for val in values:
                    # Get product_ids that have this key-value pair
                    extended_data_response = (
                        db.table("product_extended_data")
                        .select("product_id")
                        .eq("key", key)
                        .eq("value", val)
                        .in_("product_id", candidate_product_ids)
                        .execute()
                    )
                    
                    val_matching_ids = {item["product_id"] for item in extended_data_response.data if item.get("product_id")}
                    # Union with previous values for this key (OR logic)
                    key_matching_ids = key_matching_ids.union(val_matching_ids)
                
                if matching_product_ids is None:
                    # First filter key - initialize with these IDs
                    matching_product_ids = key_matching_ids
                else:
                    # Intersect with previous filter keys (AND logic between keys)
                    matching_product_ids = matching_product_ids.intersection(key_matching_ids)
            
            if matching_product_ids is None or not matching_product_ids:
                # No products match all filters
                return PaginatedResponse(
                    data=[],
                    page=pagination.page,
                    limit=pagination.limit,
                    total=0,
                    has_more=False
                )
            
            # Convert back to list
            filtered_product_ids = list(matching_product_ids)
        else:
            # No extended data filters, use category filter results
            filtered_product_ids = candidate_product_ids
        
        if not filtered_product_ids:
            return PaginatedResponse(
                data=[],
                page=pagination.page,
                limit=pagination.limit,
                total=0,
                has_more=False
            )
        
        # Build sorting
        sort_desc = filter_data.sort_order == "desc"
        
        # Query products with filtered product_ids
        try:
            query = (
                db.table("products")
                .select("product_id,category_id,group_id,name,clean_name,image_url,url,fixed_amount,number,extended_data_raw,modified_on,fetched_at")
                .in_("product_id", filtered_product_ids)
            )
            
            # Apply sorting
            if filter_data.sort_by == "name":
                query = query.order("name", desc=sort_desc)
                # Secondary sort by product_id for consistency
                query = query.order("product_id", desc=False)
            else:  # product_id
                query = query.order("product_id", desc=sort_desc)
            
            response = query.range(offset, offset + pagination.limit - 1).execute()
        except Exception as col_error:
            # If columns don't exist yet, select without them
            error_str = str(col_error).lower()
            if "fixed_amount" in error_str or "number" in error_str or "extended_data_raw" in error_str or "column" in error_str:
                # Try without extended_data_raw first
                try:
                    query = (
                        db.table("products")
                        .select("product_id,category_id,group_id,name,clean_name,image_url,url,fixed_amount,number,modified_on,fetched_at")
                        .in_("product_id", filtered_product_ids)
                    )
                except Exception:
                    # Try without number
                    try:
                        query = (
                            db.table("products")
                            .select("product_id,category_id,group_id,name,clean_name,image_url,url,fixed_amount,modified_on,fetched_at")
                            .in_("product_id", filtered_product_ids)
                        )
                    except Exception:
                        # If fixed_amount also doesn't exist, select without all optional columns
                        query = (
                            db.table("products")
                            .select("product_id,category_id,group_id,name,clean_name,image_url,url,modified_on,fetched_at")
                            .in_("product_id", filtered_product_ids)
                        )
                
                # Apply sorting
                if filter_data.sort_by == "name":
                    query = query.order("name", desc=sort_desc)
                    query = query.order("product_id", desc=False)
                else:  # product_id
                    query = query.order("product_id", desc=sort_desc)
                
                response = query.range(offset, offset + pagination.limit - 1).execute()
            else:
                raise
        
        # Get total count for pagination metadata
        try:
            count_response = (
                db.table("products")
                .select("*", count="exact")
                .in_("product_id", filtered_product_ids)
                .execute()
            )
        except Exception:
            # Fallback count
            count_response = None
        
        total = count_response.count if count_response and count_response.count is not None else len(filtered_product_ids)
        
        # Determine if there are more pages
        has_more = (offset + pagination.limit) < total
        
        return PaginatedResponse(
            data=response.data,
            page=pagination.page,
            limit=pagination.limit,
            total=total,
            has_more=has_more
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error filtering products: {str(e)}")


@router.get("/search", response_model=PaginatedResponse[dict])
async def search_products(
    q: str = Query(..., min_length=1, description="Search query for partial name matching (case-insensitive)"),
    pagination: PaginationParams = Depends(),
    db: Client = Depends(get_db_client)
):
    """
    Search products by partial name matching.
    
    Performs case-insensitive partial matching on product names.
    Results are sorted by name, then by product_id.
    
    **Example:**
    - Searching for "pika" will match "Pikachu", "Pikachu VMAX", etc.
    - Searching for "char" will match "Charizard", "Charmander", etc.
    """
    try:
        # Calculate offset for pagination
        offset = (pagination.page - 1) * pagination.limit
        
        # Try to select with all columns first, fall back if columns don't exist
        try:
            # Query with case-insensitive partial name matching using ilike
            # Include number column (synced via trigger from product_extended_data) and extended_data_raw
            response = (
                db.table("products")
                .select("product_id,category_id,group_id,name,clean_name,image_url,url,fixed_amount,number,extended_data_raw,modified_on,fetched_at")
                .ilike("name", f"%{q}%")
                .order("name", desc=False)
                .order("product_id", desc=False)
                .range(offset, offset + pagination.limit - 1)
                .execute()
            )
        except Exception as col_error:
            # If columns don't exist yet, select without them
            error_str = str(col_error).lower()
            if "fixed_amount" in error_str or "number" in error_str or "extended_data_raw" in error_str or "column" in error_str:
                # Try without extended_data_raw first
                try:
                    response = (
                        db.table("products")
                        .select("product_id,category_id,group_id,name,clean_name,image_url,url,fixed_amount,number,modified_on,fetched_at")
                        .ilike("name", f"%{q}%")
                        .order("name", desc=False)
                        .order("product_id", desc=False)
                        .range(offset, offset + pagination.limit - 1)
                        .execute()
                    )
                except Exception:
                    # Try without number
                    try:
                        response = (
                            db.table("products")
                            .select("product_id,category_id,group_id,name,clean_name,image_url,url,fixed_amount,modified_on,fetched_at")
                            .ilike("name", f"%{q}%")
                            .order("name", desc=False)
                            .order("product_id", desc=False)
                            .range(offset, offset + pagination.limit - 1)
                            .execute()
                        )
                    except Exception:
                        # If fixed_amount also doesn't exist, select without all optional columns
                        response = (
                            db.table("products")
                            .select("product_id,category_id,group_id,name,clean_name,image_url,url,modified_on,fetched_at")
                            .ilike("name", f"%{q}%")
                            .order("name", desc=False)
                            .order("product_id", desc=False)
                            .range(offset, offset + pagination.limit - 1)
                            .execute()
                        )
            else:
                raise
        
        # Get total count for pagination metadata
        try:
            count_response = (
                db.table("products")
                .select("*", count="exact")
                .ilike("name", f"%{q}%")
                .execute()
            )
            total = count_response.count if count_response.count is not None else None
        except Exception:
            # If count fails, we can't provide total
            total = None
        
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
        raise HTTPException(status_code=500, detail=f"Error searching products: {str(e)}")


@router.post("/bulk", response_model=PaginatedResponse[dict])
async def get_products_bulk(
    request: BulkProductRequest = Body(...),
    pagination: PaginationParams = Depends(),
    db: Client = Depends(get_db_client)
):
    """
    Get multiple products by their IDs in bulk with pagination.
    
    Accepts a list of product IDs and returns product details for matching products.
    Products that don't exist will not be included in the response.
    Results are paginated and returned in the order of requested IDs.
    
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
        # Remove duplicates and validate
        unique_product_ids = list(set(request.product_ids))
        
        if len(unique_product_ids) > 1000:
            raise HTTPException(
                status_code=400,
                detail="Maximum 1000 product IDs allowed per request"
            )
        
        # Batch process if needed (Supabase .in_() typically supports up to 1000 items)
        batch_size = 1000
        all_products = []
        
        for i in range(0, len(unique_product_ids), batch_size):
            batch = unique_product_ids[i:i + batch_size]
            
            # Try to select with all columns first, fall back if columns don't exist
            try:
                response = (
                    db.table("products")
                    .select("product_id,category_id,group_id,name,clean_name,image_url,url,fixed_amount,number,extended_data_raw,modified_on,fetched_at")
                    .in_("product_id", batch)
                    .order("name", desc=False)
                    .order("product_id", desc=False)
                    .execute()
                )
            except Exception as col_error:
                # If columns don't exist yet, select without them
                error_str = str(col_error).lower()
                if "fixed_amount" in error_str or "number" in error_str or "extended_data_raw" in error_str or "column" in error_str:
                    # Try without extended_data_raw first
                    try:
                        response = (
                            db.table("products")
                            .select("product_id,category_id,group_id,name,clean_name,image_url,url,fixed_amount,number,modified_on,fetched_at")
                            .in_("product_id", batch)
                            .order("name", desc=False)
                            .order("product_id", desc=False)
                            .execute()
                        )
                    except Exception:
                        # Try without number
                        try:
                            response = (
                                db.table("products")
                                .select("product_id,category_id,group_id,name,clean_name,image_url,url,fixed_amount,modified_on,fetched_at")
                                .in_("product_id", batch)
                                .order("name", desc=False)
                                .order("product_id", desc=False)
                                .execute()
                            )
                        except Exception:
                            # If fixed_amount also doesn't exist, select without all optional columns
                            response = (
                                db.table("products")
                                .select("product_id,category_id,group_id,name,clean_name,image_url,url,modified_on,fetched_at")
                                .in_("product_id", batch)
                                .order("name", desc=False)
                                .order("product_id", desc=False)
                                .execute()
                            )
                else:
                    raise
            
            all_products.extend(response.data)
        
        # Create a map for quick lookup
        product_map = {product["product_id"]: product for product in all_products}
        
        # Return products in the order requested (preserving order)
        all_results = []
        for product_id in request.product_ids:
            if product_id in product_map:
                all_results.append(product_map[product_id])
        
        # Apply pagination to results
        offset = (pagination.page - 1) * pagination.limit
        paginated_results = all_results[offset:offset + pagination.limit]
        total = len(all_results)
        has_more = (offset + pagination.limit) < total
        
        return PaginatedResponse(
            data=paginated_results,
            page=pagination.page,
            limit=pagination.limit,
            total=total,
            has_more=has_more
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching bulk products: {str(e)}")


@router.get("/{product_id}")
async def get_product(
    product_id: int,
    db: Client = Depends(get_db_client)
):
    """
    Get a single product by primary key (product_id).
    """
    try:
        # Try to select with all columns first, fall back if columns don't exist
        try:
            response = (
                db.table("products")
                .select("product_id,category_id,group_id,name,clean_name,image_url,url,fixed_amount,number,extended_data_raw,modified_on,fetched_at")
                .eq("product_id", product_id)
                .execute()
            )
        except Exception as col_error:
            # If columns don't exist yet, select without them
            error_str = str(col_error).lower()
            if "fixed_amount" in error_str or "number" in error_str or "extended_data_raw" in error_str or "column" in error_str:
                # Try without extended_data_raw first
                try:
                    response = (
                        db.table("products")
                        .select("product_id,category_id,group_id,name,clean_name,image_url,url,fixed_amount,number,modified_on,fetched_at")
                        .eq("product_id", product_id)
                        .execute()
                    )
                except Exception:
                    # Try without number
                    try:
                        response = (
                            db.table("products")
                            .select("product_id,category_id,group_id,name,clean_name,image_url,url,fixed_amount,modified_on,fetched_at")
                            .eq("product_id", product_id)
                            .execute()
                        )
                    except Exception:
                        # If fixed_amount also doesn't exist, select without all optional columns
                        response = (
                            db.table("products")
                            .select("product_id,category_id,group_id,name,clean_name,image_url,url,modified_on,fetched_at")
                            .eq("product_id", product_id)
                            .execute()
                        )
            else:
                raise
        
        if not response.data:
            raise HTTPException(status_code=404, detail=f"Product with id {product_id} not found")
        
        return response.data[0]
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching product: {str(e)}")

