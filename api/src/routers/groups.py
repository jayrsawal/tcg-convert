"""
Groups endpoint router.
"""
from fastapi import APIRouter, HTTPException, Depends
from supabase import Client
from src.database import get_db_client
from src.models import PaginationParams, PaginatedResponse

router = APIRouter(prefix="/groups", tags=["groups"])


@router.get("", response_model=PaginatedResponse[dict])
@router.get("/", response_model=PaginatedResponse[dict])
async def list_groups(
    pagination: PaginationParams = Depends(),
    db: Client = Depends(get_db_client)
):
    """
    List all groups with pagination.
    Results are sorted by published_on (descending), then by group_id.
    """
    try:
        offset = (pagination.page - 1) * pagination.limit
        
        response = (
            db.table("groups")
            .select("*")
            .order("published_on", desc=True)
            .order("group_id", desc=False)
            .range(offset, offset + pagination.limit - 1)
            .execute()
        )
        
        count_response = (
            db.table("groups")
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
        raise HTTPException(status_code=500, detail=f"Error fetching groups: {str(e)}")


@router.get("/{group_id}")
async def get_group(
    group_id: int,
    db: Client = Depends(get_db_client)
):
    """
    Get a single group by primary key (group_id).
    """
    try:
        response = (
            db.table("groups")
            .select("*")
            .eq("group_id", group_id)
            .execute()
        )
        
        if not response.data:
            raise HTTPException(status_code=404, detail=f"Group with id {group_id} not found")
        
        return response.data[0]
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching group: {str(e)}")


@router.get("/by-category/{category_id}", response_model=PaginatedResponse[dict])
async def get_groups_by_category(
    category_id: int,
    pagination: PaginationParams = Depends(),
    db: Client = Depends(get_db_client)
):
    """
    Get all groups for a specific category (filtered by foreign key category_id).
    Results are sorted by published_on (descending), then by group_id.
    """
    try:
        offset = (pagination.page - 1) * pagination.limit
        
        response = (
            db.table("groups")
            .select("*")
            .eq("category_id", category_id)
            .order("published_on", desc=True)
            .order("group_id", desc=False)
            .range(offset, offset + pagination.limit - 1)
            .execute()
        )
        
        count_response = (
            db.table("groups")
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
        raise HTTPException(status_code=500, detail=f"Error fetching groups by category: {str(e)}")

