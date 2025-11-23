"""
Run script for the API server.
"""
import os
import uvicorn
from dotenv import load_dotenv

# Load environment variables from .env file (if present)
# Environment variables take precedence over .env file values
# This allows configuration via either:
# 1. Environment variables (e.g., set in shell or deployment platform)
# 2. .env file (for local development)
load_dotenv(override=False)  # override=False means env vars take precedence

if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    host = os.getenv("HOST", "0.0.0.0")
    reload = os.getenv("RELOAD", "true").lower() == "true"
    
    uvicorn.run(
        "src.main:app",
        host=host,
        port=port,
        reload=reload
    )
