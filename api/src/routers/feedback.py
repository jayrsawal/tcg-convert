"""
Feedback endpoint router.
Allows users to submit feedback and notes to developers.
"""
from typing import Optional
from uuid import UUID
from fastapi import APIRouter, HTTPException, Depends, Body
from pydantic import BaseModel, Field
from supabase import Client
from src.database import get_db_client
from src.auth import get_user_id_from_token
from fastapi import Header

router = APIRouter(prefix="/feedback", tags=["feedback"])


class FeedbackCreate(BaseModel):
    """Model for creating feedback."""
    message: str = Field(..., min_length=1, description="Feedback message (required)")
    subject: Optional[str] = Field(None, description="Optional subject line for the feedback")
    email: Optional[str] = Field(None, description="Optional email address (stored in database for manual review, no automatic emails sent)")


@router.post("")
@router.post("/")
async def create_feedback(
    feedback: FeedbackCreate = Body(...),
    authorization: Optional[str] = Header(None),
    db: Client = Depends(get_db_client)
):
    """
    Submit feedback or a note to the developers.
    
    Public endpoint - authentication is optional. If authenticated, user_id will be automatically included.
    All feedback is saved to the database. Email addresses are stored for manual review only - no automatic emails are sent.
    """
    try:
        # Get user_id from token if authenticated
        user_id = get_user_id_from_token(authorization)
        
        # Build insert payload
        insert_payload = {
            "message": feedback.message
        }
        
        # Include user_id if authenticated
        if user_id:
            insert_payload["user_id"] = str(user_id)
        
        # Add optional fields if provided
        if feedback.subject:
            insert_payload["subject"] = feedback.subject
        if feedback.email:
            insert_payload["email"] = feedback.email
        
        response = (
            db.table("feedback")
            .insert(insert_payload)
            .execute()
        )
        
        if not response.data:
            raise HTTPException(status_code=500, detail="Failed to submit feedback")
        
        feedback_result = response.data[0]
        
        return {
            "feedback_id": feedback_result.get("feedback_id"),
            "message": "Feedback submitted successfully",
            "created_at": feedback_result.get("created_at")
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error submitting feedback: {str(e)}")


@router.post("/anonymous")
@router.post("/anonymous/")
async def create_feedback_anonymous(
    feedback: FeedbackCreate = Body(...),
    db: Client = Depends(get_db_client)
):
    """
    Submit feedback anonymously (without authentication).
    
    This endpoint does not require authentication and will not include a user_id.
    Useful for users who want to provide feedback without logging in.
    """
    try:
        # Build insert payload (no user_id for anonymous feedback)
        insert_payload = {
            "message": feedback.message
        }
        
        # Add optional fields if provided
        if feedback.subject:
            insert_payload["subject"] = feedback.subject
        if feedback.email:
            insert_payload["email"] = feedback.email
        
        response = (
            db.table("feedback")
            .insert(insert_payload)
            .execute()
        )
        
        if not response.data:
            raise HTTPException(status_code=500, detail="Failed to submit feedback")
        
        feedback_result = response.data[0]
        
        return {
            "feedback_id": feedback_result.get("feedback_id"),
            "message": "Feedback submitted successfully",
            "created_at": feedback_result.get("created_at")
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error submitting feedback: {str(e)}")

