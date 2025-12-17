"""
Products endpoint router.
"""
import logging
from typing import Optional, Dict, List, Union
from fastapi import APIRouter, HTTPException, Depends, Body, Query
from pydantic import BaseModel, Field
from supabase import Client
from src.database import get_db_client
from src.models import PaginationParams, PaginatedResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/products", tags=["products"])


def map_sort_columns(sort_columns: List[str]) -> List[str]:
    """
    Map sort column names to their database column names.
    Currently maps "number" to "short_number" for proper numeric sorting.
    
    Args:
        sort_columns: List of column names to sort by
    
    Returns:
        List of mapped column names
    """
    return ["short_number" if col == "number" else col for col in sort_columns]


def apply_sorting(query, sort_columns: List[str], sort_direction: Union[str, List[str]] = "asc"):
    """
    Apply multiple order clauses to a Supabase query.
    Maps "number" to "short_number" for proper numeric sorting.
    
    Args:
        query: The Supabase query object
        sort_columns: List of column names to sort by (in order)
        sort_direction: "asc" or "desc" (default: "asc"), or a list of directions (one per column)
    
    Returns:
        The query object with order clauses applied
    """
    # Map "number" to "short_number" for numeric sorting
    final_sort_columns = map_sort_columns(sort_columns)
    
    # Determine directions for each column
    if isinstance(sort_direction, str):
        # Single direction for all columns
        directions = [sort_direction.lower()] * len(final_sort_columns)
    else:
        # Per-column directions
        if len(sort_direction) != len(sort_columns):
            raise ValueError(f"sort_direction list length ({len(sort_direction)}) must match sort_columns length ({len(sort_columns)})")
        directions = [d.lower() for d in sort_direction]
    
    # Apply each order clause using multiple .order() calls
    for column, direction in zip(final_sort_columns, directions):
        desc = direction == "desc"
        query = query.order(column, desc=desc)
    
    return query


def map_filter_key_to_column(key: str) -> Optional[str]:
    """
    Map a filter key to its corresponding column in the products table.
    
    Args:
        key: Filter key (e.g., "Rarity", "Type", "CardType", "Color")
    
    Returns:
        Column name in products table, or None if not a cached column
    """
    key_lower = key.lower()
    mapping = {
        "rarity": "rarity",
        "color": "color",
        "type": "type",
        "cardtype": "type",  # Accept "CardType" as an alias for "type"
        "level": "level",
        "cost": "cost",
        "atk": "atk",
        "attack": "atk",
        "hp": "hp",
    }
    return mapping.get(key_lower)


class ProductFilter(BaseModel):
    """Model for filtering products by extended data key-value pairs."""
    category_id: Optional[int] = None
    group_id: Optional[Union[int, List[int]]] = None  # Filter by group_id. Single value or list of values. Multiple values use OR logic (e.g., [1, 2, 3])
    product_ids: Optional[List[int]] = None  # Filter by product_id. Multiple values use OR logic (e.g., [1, 2, 3])
    numbers: Optional[List[Union[str, int]]] = None  # Filter by number column. Multiple values use OR logic (e.g., ["001", "002", "003"])
    filters: Dict[str, Union[str, List[str]]] = {}  # Key-value pairs for extended data filtering. Single values or lists of values. Multiple values for a key use OR logic, different keys use AND logic (e.g., {"Rarity": ["Common", "Rare"], "Number": "001"})
    sort_columns: Optional[List[str]] = Field(default=["color", "type", "rarity", "level", "cost"], description="List of column names to sort by (in order)")
    sort_direction: Optional[Union[str, List[str]]] = Field(default="asc", description="Sort direction: 'asc' or 'desc', or a list of directions (one per column in sort_columns). If a list, length must match sort_columns length.")


class ProductSearchRequest(BaseModel):
    """Model for searching products with filters."""
    q: Optional[str] = Field(None, min_length=1, description="Search query for partial name matching (case-insensitive). If not provided, only filters are applied.")
    category_id: Optional[int] = None
    group_id: Optional[Union[int, List[int]]] = None
    product_ids: Optional[List[int]] = None
    numbers: Optional[List[Union[str, int]]] = None
    filters: Optional[Dict[str, Union[str, List[str]]]] = Field(default_factory=dict, description="Key-value pairs for attribute filtering. Optional - can be omitted entirely.")
    sort_columns: Optional[List[str]] = Field(default=["color", "type", "rarity", "level", "cost"], description="List of column names to sort by (in order)")
    sort_direction: Optional[Union[str, List[str]]] = Field(default="asc", description="Sort direction: 'asc' or 'desc', or a list of directions (one per column in sort_columns). If a list, length must match sort_columns length.")


@router.get("", response_model=PaginatedResponse[dict])
@router.get("/", response_model=PaginatedResponse[dict])
async def list_products(
    pagination: PaginationParams = Depends(),
    sort_columns: Optional[List[str]] = Query(default=["color", "type", "rarity", "level", "cost"], description="List of column names to sort by (in order)"),
    sort_direction: Optional[Union[str, List[str]]] = Query(default="asc", description="Sort direction: 'asc' or 'desc', or a list of directions (one per column in sort_columns). If a list, length must match sort_columns length."),
    db: Client = Depends(get_db_client)
):
    """
    List all products with pagination.
    Results are sorted by the specified columns (default: color, type, rarity, level, cost in ascending order).
    """
    try:
        # Calculate offset for pagination
        offset = (pagination.page - 1) * pagination.limit
        
        # Query with pagination and custom sorting
        # Include number column (synced via trigger from product_extended_data) and extended_data_raw
        try:
            query = (
                db.table("products")
                .select("product_id,category_id,group_id,name,clean_name,image_url,url,fixed_amount,number,short_number,extended_data_raw,rarity,color,type,level,cost,atk,hp,modified_on,fetched_at")
                .not_.is_("number", "null")
            )
            query = apply_sorting(query, sort_columns, sort_direction)
            response = query.range(offset, offset + pagination.limit - 1).execute()
        except Exception as col_error:
            logger.error(f"Error querying products: {str(col_error)}", exc_info=True)
            raise HTTPException(status_code=500, detail=f"Error fetching products: {str(col_error)}")
        
        # Get total count for pagination metadata
        count_response = (
            db.table("products")
            .select("*", count="exact")
            .not_.is_("type", "null")
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
    sort_columns: Optional[List[str]] = Query(default=["color", "type", "rarity", "level", "cost"], description="List of column names to sort by (in order)"),
    sort_direction: Optional[Union[str, List[str]]] = Query(default="asc", description="Sort direction: 'asc' or 'desc', or a list of directions (one per column in sort_columns). If a list, length must match sort_columns length."),
    db: Client = Depends(get_db_client)
):
    """
    Get all products for a specific category (filtered by foreign key category_id).
    Results are sorted by the specified columns (default: color, type, rarity, level, cost in ascending order).
    """
    try:
        # Calculate offset for pagination
        offset = (pagination.page - 1) * pagination.limit
        
        # Query products by category_id with pagination and custom sorting
        # Include number column (synced via trigger from product_extended_data) and extended_data_raw
        try:
            query = (
                db.table("products")
                .select("product_id,category_id,group_id,name,clean_name,image_url,url,fixed_amount,number,short_number,extended_data_raw,rarity,color,type,level,cost,atk,hp,modified_on,fetched_at")
                .eq("category_id", category_id)
                .not_.is_("number", "null")
            )
            query = apply_sorting(query, sort_columns, sort_direction)
            response = query.range(offset, offset + pagination.limit - 1).execute()
        except Exception as col_error:
            logger.error(f"Error querying products by category: {str(col_error)}", exc_info=True)
            raise HTTPException(status_code=500, detail=f"Error fetching products by category: {str(col_error)}")
        
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
    sort_columns: Optional[List[str]] = Query(default=["color", "type", "rarity", "level", "cost"], description="List of column names to sort by (in order)"),
    sort_direction: Optional[Union[str, List[str]]] = Query(default="asc", description="Sort direction: 'asc' or 'desc', or a list of directions (one per column in sort_columns). If a list, length must match sort_columns length."),
    db: Client = Depends(get_db_client)
):
    """
    Get all products for a specific group (filtered by foreign key group_id).
    Results are sorted by the specified columns (default: color, type, rarity, level, cost in ascending order).
    """
    try:
        # Calculate offset for pagination
        offset = (pagination.page - 1) * pagination.limit
        
        # Query products by group_id with pagination and custom sorting
        # Include number column (synced via trigger from product_extended_data) and extended_data_raw
        try:
            query = (
                db.table("products")
                .select("product_id,category_id,group_id,name,clean_name,image_url,url,fixed_amount,number,short_number,extended_data_raw,rarity,color,type,level,cost,atk,hp,modified_on,fetched_at")
                .eq("group_id", group_id)
                .not_.is_("number", "null")
            )
            query = apply_sorting(query, sort_columns, sort_direction)
            response = query.range(offset, offset + pagination.limit - 1).execute()
        except Exception as col_error:
            logger.error(f"Error querying products by group: {str(col_error)}", exc_info=True)
            raise HTTPException(status_code=500, detail=f"Error fetching products by group: {str(col_error)}")
        
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
    Filter products by cached attribute columns, category, group, product IDs, and/or numbers.
    
    **Filter Logic:**
    - Different filter keys are combined with AND logic (e.g., Rarity AND Type)
    - Multiple values for a single key are combined with OR logic (e.g., Rarity=Common OR Rarity=Rare)
    - If category_id is provided, products are filtered by category
    - If group_id is provided (single value or list), products are filtered by group(s). Multiple group_ids use OR logic
    - If product_ids is provided, products are filtered by product_id (multiple product_ids use OR logic)
    - If numbers is provided, products are filtered by number column (multiple numbers use OR logic)
    - All filters (category_id, group_id, product_ids, numbers, and filters dict) are combined with AND logic
    - Results are sorted by the specified columns (default: color, type, rarity, level, cost in ascending order)
    
    **Supported Filter Keys (mapped to cached columns):**
    - "Rarity" -> rarity column
    - "Color" -> color column
    - "Type" or "CardType" -> type column
    - "Level" -> level column (integer)
    - "Cost" -> cost column (integer)
    - "ATK" or "Attack" -> atk column (integer)
    - "HP" -> hp column (integer)
    
    **Examples:**
    - {"Rarity": "Common", "Type": "Pokémon"} - Products with Rarity=Common AND Type=Pokémon
    - {"Rarity": ["Common", "Rare"], "Type": "Pokémon"} - Products with (Rarity=Common OR Rarity=Rare) AND Type=Pokémon
    - {"Rarity": ["Common", "Rare"], "Level": [1, 2]} - Products with (Rarity=Common OR Rarity=Rare) AND (Level=1 OR Level=2)
    - {"numbers": ["001", "002", "003"]} - Products with number=001 OR number=002 OR number=003
    - {"numbers": ["001", "002"], "category_id": 5} - Products with (number=001 OR number=002) AND category_id=5
    - {"product_ids": [12345, 67890, 11111]} - Products with product_id=12345 OR product_id=67890 OR product_id=11111
    - {"product_ids": [12345, 67890], "category_id": 5} - Products with (product_id=12345 OR product_id=67890) AND category_id=5
    """
    try:
        # Log incoming request at debug level to avoid noisy logs in production
        logger.debug(
            "POST /products/filter - "
            f"category_id={filter_data.category_id}, "
            f"group_id={filter_data.group_id}, "
            f"product_ids={filter_data.product_ids}, "
            f"numbers={filter_data.numbers}, "
            f"filters={filter_data.filters}, "
            f"sort_columns={filter_data.sort_columns}, "
            f"sort_direction={filter_data.sort_direction}, "
            f"page={pagination.page}, "
            f"limit={pagination.limit}"
        )
        
        # Validate sort direction
        if isinstance(filter_data.sort_direction, str):
            if filter_data.sort_direction not in ["asc", "desc"]:
                logger.warning(f"  Invalid sort_direction: {filter_data.sort_direction}")
                raise HTTPException(status_code=400, detail="sort_direction must be 'asc' or 'desc'")
        elif isinstance(filter_data.sort_direction, list):
            if len(filter_data.sort_direction) != len(filter_data.sort_columns):
                logger.warning(f"  sort_direction length mismatch: {len(filter_data.sort_direction)} != {len(filter_data.sort_columns)}")
                raise HTTPException(status_code=400, detail=f"sort_direction list length ({len(filter_data.sort_direction)}) must match sort_columns length ({len(filter_data.sort_columns)})")
            for direction in filter_data.sort_direction:
                if direction not in ["asc", "desc"]:
                    logger.warning(f"  Invalid sort_direction value: {direction}")
                    raise HTTPException(status_code=400, detail="Each sort_direction value must be 'asc' or 'desc'")
        
        # Calculate offset for pagination
        offset = (pagination.page - 1) * pagination.limit
        
        # Build a single query that applies all filters directly on the products table
        try:
            query = (
                db.table("products")
                .select("product_id,category_id,group_id,name,clean_name,image_url,url,fixed_amount,number,short_number,extended_data_raw,rarity,color,type,level,cost,atk,hp,modified_on,fetched_at")
                .not_.is_("number", "null")
            )
            
            # Apply category filter if provided
            if filter_data.category_id:
                query = query.eq("category_id", filter_data.category_id)
            
            # Apply group filter if
            if filter_data.group_id:
                if isinstance(filter_data.group_id, list):
                    # Multiple group_ids - use OR logic
                    query = query.in_("group_id", filter_data.group_id)
                else:
                    # Single group_id
                    query = query.eq("group_id", filter_data.group_id)
            
            # Apply product_ids filter if provided
            if filter_data.product_ids:
                query = query.in_("product_id", filter_data.product_ids)
            
            # Apply number filter if provided
            if filter_data.numbers:
                number_values = [str(num) for num in filter_data.numbers if num is not None]
                if number_values:
                    query = query.in_("number", number_values)
            
            # Apply attribute filters directly on cached columns
            if filter_data.filters:
                for key, value in filter_data.filters.items():
                    # Skip None values
                    if value is None:
                        continue
                    
                    # Map filter key to column name
                    column = map_filter_key_to_column(key)
                    if column is None:
                        logger.warning(f"  Filter key '{key}' does not map to a cached column, skipping")
                        continue
                    
                    # Normalize value to a list for consistent processing
                    values = [value] if isinstance(value, str) else value
                    
                    if not values:
                        # Skip empty lists
                        continue
                    
                    # For integer columns, convert values to integers
                    if column in ["level", "cost", "atk", "hp"]:
                        try:
                            values = [int(v) for v in values if v is not None]
                        except (ValueError, TypeError) as e:
                            logger.warning(f"  Invalid value for integer column '{column}': {values}, skipping")
                            continue
                    
                    # Apply filter: multiple values use OR logic (in_)
                    if len(values) == 1:
                        query = query.eq(column, values[0])
                    else:
                        query = query.in_(column, values)
            
            # Apply custom sorting
            query = apply_sorting(query, filter_data.sort_columns, filter_data.sort_direction)
            
            # Execute the sorted query and store the response
            sorted_response = query.range(offset, offset + pagination.limit - 1).execute()
            
            # Optionally log the first result at debug level to verify sorting
            if logger.isEnabledFor(logging.DEBUG) and sorted_response.data:
                first_product = sorted_response.data[0]
                logger.debug(
                    "  First product in results: "
                    f"product_id={first_product.get('product_id')}, "
                    f"number={first_product.get('number')}, "
                    f"short_number={first_product.get('short_number')}, "
                    f"group_id={first_product.get('group_id')}"
                )
            
            # Get total count for pagination metadata (separate query, doesn't affect sorted data)
            try:
                # Build count query with same filters
                count_query = db.table("products").select("product_id", count="exact").not_.is_("number", "null")
                
                if filter_data.category_id:
                    count_query = count_query.eq("category_id", filter_data.category_id)
                if filter_data.group_id:
                    if isinstance(filter_data.group_id, list):
                        # Multiple group_ids - use OR logic
                        count_query = count_query.in_("group_id", filter_data.group_id)
                    else:
                        # Single group_id
                        count_query = count_query.eq("group_id", filter_data.group_id)
                if filter_data.product_ids:
                    count_query = count_query.in_("product_id", filter_data.product_ids)
                if filter_data.numbers:
                    number_values = [str(num) for num in filter_data.numbers if num is not None]
                    if number_values:
                        count_query = count_query.in_("number", number_values)
                if filter_data.filters:
                    for key, value in filter_data.filters.items():
                        if value is None:
                            continue
                        column = map_filter_key_to_column(key)
                        if column is None:
                            continue
                        values = [value] if isinstance(value, str) else value
                        if not values:
                            continue
                        if column in ["level", "cost", "atk", "hp"]:
                            try:
                                values = [int(v) for v in values if v is not None]
                            except (ValueError, TypeError):
                                continue
                        if len(values) == 1:
                            count_query = count_query.eq(column, values[0])
                        else:
                            count_query = count_query.in_(column, values)
                
                count_response = count_query.execute()
                total = count_response.count if count_response.count is not None else 0
            except Exception:
                # If count fails, we can't provide total
                total = None
            
            has_more = total is not None and (offset + pagination.limit) < total
            
            # Log summary at debug level only
            logger.debug(
                f"  Returning {len(sorted_response.data)} products "
                f"(page={pagination.page}, limit={pagination.limit}, total={total}, has_more={has_more})"
            )
            
            return PaginatedResponse(
                data=sorted_response.data,
                page=pagination.page,
                limit=pagination.limit,
                total=total,
                has_more=has_more
            )
        except Exception as col_error:
            logger.error(f"Error querying filtered products: {str(col_error)}", exc_info=True)
            raise HTTPException(status_code=500, detail=f"Error filtering products: {str(col_error)}")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"  Error filtering products: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error filtering products: {str(e)}")


@router.post("/search", response_model=PaginatedResponse[dict])
async def search_products(
    search_data: ProductSearchRequest = Body(...),
    pagination: PaginationParams = Depends(),
    db: Client = Depends(get_db_client)
):
    """
    Search products by partial name matching with optional filters.
    
    Performs case-insensitive partial matching on product names (matches anywhere in the name) if a search query is provided.
    Can be combined with filters for category, group, product_ids, numbers, and attribute filters.
    If no search query is provided, only the filters are applied (similar to /products/filter).
    Results are sorted by the specified columns (default: color, type, rarity, level, cost in ascending order).
    
    **Filter Logic:**
    - If `q` is provided, name search uses partial matching (e.g., "pika" matches "Pikachu", "Pikachu VMAX")
    - All filters (category_id, group_id, product_ids, numbers, filters dict) are combined with AND logic
    - Name search (if provided) is combined with other filters using AND logic
    
    **Supported Filter Keys (mapped to cached columns):**
    - "Rarity" -> rarity column
    - "Color" -> color column
    - "Type" or "CardType" -> type column
    - "Level" -> level column (integer)
    - "Cost" -> cost column (integer)
    - "ATK" or "Attack" -> atk column (integer)
    - "HP" -> hp column (integer)
    
    **Examples:**
    - {"q": "pika"} - Products with "pika" anywhere in the name
    - {"filters": {"Color": ["Blue", "White"], "CardType": ["Unit"]}} - Products with Color=Blue OR Color=White AND CardType=Unit (no name search)
    - {"q": "char", "filters": {"Rarity": "Rare"}} - Products with "char" in name AND Rarity=Rare
    - {"q": "pika", "category_id": 5} - Products with "pika" in name AND category_id=5
    """
    try:
        # Validate sort direction
        if isinstance(search_data.sort_direction, str):
            if search_data.sort_direction not in ["asc", "desc"]:
                raise HTTPException(status_code=400, detail="sort_direction must be 'asc' or 'desc'")
        elif isinstance(search_data.sort_direction, list):
            if len(search_data.sort_direction) != len(search_data.sort_columns):
                raise HTTPException(status_code=400, detail=f"sort_direction list length ({len(search_data.sort_direction)}) must match sort_columns length ({len(search_data.sort_columns)})")
            for direction in search_data.sort_direction:
                if direction not in ["asc", "desc"]:
                    raise HTTPException(status_code=400, detail="Each sort_direction value must be 'asc' or 'desc'")
        
        # Calculate offset for pagination
        offset = (pagination.page - 1) * pagination.limit
        
        # Build query with optional name search and all filters
        try:
            query = (
                db.table("products")
                .select("product_id,category_id,group_id,name,clean_name,image_url,url,fixed_amount,number,short_number,extended_data_raw,rarity,color,type,level,cost,atk,hp,modified_on,fetched_at")
                .not_.is_("number", "null")
            )
            
            # Apply name search filter if query is provided
            # Search against clean_name column with normalized query
            if search_data.q:
                # Normalize the search query:
                # - Remove special characters: parentheses, brackets, single/double quotes
                # - Replace + with "plus"
                # - Replace dashes with spaces
                normalized_q = search_data.q
                # Remove special characters
                for char in ['(', ')', '[', ']', "'", '"', "`"]:
                    normalized_q = normalized_q.replace(char, '')
                # Replace + with "plus"
                normalized_q = normalized_q.replace('+', 'plus')
                # Replace dashes with spaces
                normalized_q = normalized_q.replace('-', ' ')
                # Escape any existing % or _ in the normalized query to treat them as literals
                escaped_q = normalized_q.replace("%", "\\%").replace("_", "\\_")
                # Add wildcards on both sides for partial matching anywhere
                # This pattern will match "chu" in "pikachu", "pikachu vmax", etc.
                pattern = f"%{escaped_q}%"
                # Use OR logic to match against clean_name OR number column
                # PostgREST syntax: or=(clean_name.ilike.*pattern*,number.ilike.*pattern*)
                # We'll use ilike for both to support partial matching on number as well
                number_pattern = f"%{escaped_q}%"
                # Try to use PostgREST's or filter syntax by setting it on session params
                try:
                    # Access the query's session to set the or filter directly
                    if hasattr(query, 'session'):
                        session = query.session
                        # Try different ways to set the or parameter
                        if hasattr(session, 'params'):
                            # PostgREST or filter format: or=(condition1,condition2)
                            or_filter = f"clean_name.ilike.{pattern},number.ilike.{number_pattern}"
                            session.params['or'] = or_filter
                        elif hasattr(session, '_params'):
                            or_filter = f"clean_name.ilike.{pattern},number.ilike.{number_pattern}"
                            session._params['or'] = or_filter
                        else:
                            # Fallback: just match clean_name
                            query = query.ilike("clean_name", pattern)
                    else:
                        # Fallback: just match clean_name
                        query = query.ilike("clean_name", pattern)
                except Exception:
                    # Fallback: just match clean_name if or filter doesn't work
                    query = query.ilike("clean_name", pattern)
            
            # Apply category filter if provided
            if search_data.category_id:
                query = query.eq("category_id", search_data.category_id)
            
            # Apply group filter if provided
            if search_data.group_id:
                if isinstance(search_data.group_id, list):
                    query = query.in_("group_id", search_data.group_id)
                else:
                    query = query.eq("group_id", search_data.group_id)
            
            # Apply product_ids filter if provided
            if search_data.product_ids:
                query = query.in_("product_id", search_data.product_ids)
            
            # Apply number filter if provided
            if search_data.numbers:
                number_values = [str(num) for num in search_data.numbers if num is not None]
                if number_values:
                    query = query.in_("number", number_values)
            
            # Apply attribute filters directly on cached columns
            if search_data.filters and len(search_data.filters) > 0:
                for key, value in search_data.filters.items():
                    if value is None:
                        continue
                    
                    column = map_filter_key_to_column(key)
                    if column is None:
                        logger.warning(f"  Filter key '{key}' does not map to a cached column, skipping")
                        continue
                    
                    values = [value] if isinstance(value, str) else value
                    if not values:
                        continue
                    
                    # For integer columns, convert values to integers
                    if column in ["level", "cost", "atk", "hp"]:
                        try:
                            values = [int(v) for v in values if v is not None]
                        except (ValueError, TypeError) as e:
                            logger.warning(f"  Invalid value for integer column '{column}': {values}, skipping")
                            continue
                    
                    # Apply filter: multiple values use OR logic (in_)
                    if len(values) == 1:
                        query = query.eq(column, values[0])
                    else:
                        query = query.in_(column, values)
            
            # Apply custom sorting
            query = apply_sorting(query, search_data.sort_columns, search_data.sort_direction)
            
            # Execute the sorted query
            sorted_response = query.range(offset, offset + pagination.limit - 1).execute()
            
            # Get total count for pagination metadata (with same filters)
            try:
                count_query = db.table("products").select("product_id", count="exact").not_.is_("number", "null")
                
                # Apply name search filter if query is provided
                # Search against clean_name column with normalized query (same normalization as main query)
                if search_data.q:
                    # Normalize the search query (same as main query):
                    # - Remove special characters: parentheses, brackets, single/double quotes
                    # - Replace + with "plus"
                    # - Replace dashes with spaces
                    normalized_q = search_data.q
                    # Remove special characters
                    for char in ['(', ')', '[', ']', "'", '"']:
                        normalized_q = normalized_q.replace(char, '')
                    # Replace + with "plus"
                    normalized_q = normalized_q.replace('+', 'plus')
                    # Replace dashes with spaces
                    normalized_q = normalized_q.replace('-', ' ')
                    # Escape any existing % or _ in the normalized query to treat them as literals
                    escaped_q = normalized_q.replace("%", "\\%").replace("_", "\\_")
                    # Add wildcards on both sides for partial matching anywhere
                    pattern = f"%{escaped_q}%"
                    # Use OR logic to match against clean_name OR number column (same as main query)
                    number_pattern = f"%{escaped_q}%"
                    # Try to use PostgREST's or filter syntax by setting it on session params
                    try:
                        if hasattr(count_query, 'session'):
                            session = count_query.session
                            if hasattr(session, 'params'):
                                or_filter = f"clean_name.ilike.{pattern},number.ilike.{number_pattern}"
                                session.params['or'] = or_filter
                            elif hasattr(session, '_params'):
                                or_filter = f"clean_name.ilike.{pattern},number.ilike.{number_pattern}"
                                session._params['or'] = or_filter
                            else:
                                count_query = count_query.ilike("clean_name", pattern)
                        else:
                            count_query = count_query.ilike("clean_name", pattern)
                    except Exception:
                        # Fallback: just use clean_name
                        count_query = count_query.ilike("clean_name", pattern)
                
                if search_data.category_id:
                    count_query = count_query.eq("category_id", search_data.category_id)
                if search_data.group_id:
                    if isinstance(search_data.group_id, list):
                        count_query = count_query.in_("group_id", search_data.group_id)
                    else:
                        count_query = count_query.eq("group_id", search_data.group_id)
                if search_data.product_ids:
                    count_query = count_query.in_("product_id", search_data.product_ids)
                if search_data.numbers:
                    number_values = [str(num) for num in search_data.numbers if num is not None]
                    if number_values:
                        count_query = count_query.in_("number", number_values)
                if search_data.filters and len(search_data.filters) > 0:
                    for key, value in search_data.filters.items():
                        if value is None:
                            continue
                        column = map_filter_key_to_column(key)
                        if column is None:
                            continue
                        values = [value] if isinstance(value, str) else value
                        if not values:
                            continue
                        if column in ["level", "cost", "atk", "hp"]:
                            try:
                                values = [int(v) for v in values if v is not None]
                            except (ValueError, TypeError):
                                continue
                        if len(values) == 1:
                            count_query = count_query.eq(column, values[0])
                        else:
                            count_query = count_query.in_(column, values)
                
                count_response = count_query.execute()
                total = count_response.count if count_response.count is not None else 0
            except Exception:
                total = None
            
            has_more = total is not None and (offset + pagination.limit) < total
            
            return PaginatedResponse(
                data=sorted_response.data,
                page=pagination.page,
                limit=pagination.limit,
                total=total,
                has_more=has_more
            )
        except Exception as col_error:
            logger.error(f"Error searching products: {str(col_error)}", exc_info=True)
            raise HTTPException(status_code=500, detail=f"Error searching products: {str(col_error)}")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"  Error searching products: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error searching products: {str(e)}")


@router.get("/{product_id}")
async def get_product(
    product_id: int,
    db: Client = Depends(get_db_client)
):
    """
    Get a single product by primary key (product_id).
    """
    try:
        try:
            response = (
                db.table("products")
                .select("product_id,category_id,group_id,name,clean_name,image_url,url,fixed_amount,number,short_number,extended_data_raw,rarity,color,type,level,cost,atk,hp,modified_on,fetched_at")
                .eq("product_id", product_id)
                .not_.is_("number", "null")
                .execute()
            )
        except Exception as col_error:
            logger.error(f"Error querying product: {str(col_error)}", exc_info=True)
            raise HTTPException(status_code=500, detail=f"Error fetching product: {str(col_error)}")
        
        if not response.data:
            raise HTTPException(status_code=404, detail=f"Product with id {product_id} not found")
        
        return response.data[0]
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching product: {str(e)}")

