"""
FastAPI application main module.
"""
import logging
import os
import time
from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException
from dotenv import load_dotenv
from src.routers import (
    categories,
    groups,
    products,
    product_extended_data,
    prices_current,
    prices_history,
    category_extended_data_keys,
    favorites,
    user_inventory,
    deck_lists,
    profiles,
    vendor_prices,
)

# Load environment variables from .env file (if present)
# Environment variables take precedence over .env file values
load_dotenv(override=False)

# Configure logging to output to console
# Log level can be set via LOG_LEVEL environment variable (default: INFO)
# Options: DEBUG, INFO, WARNING, ERROR, CRITICAL
log_level = os.getenv("LOG_LEVEL", "INFO").upper()
logging.basicConfig(
    level=getattr(logging, log_level, logging.INFO),
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)

logger = logging.getLogger(__name__)

# Toggleable HTTPX logging (disabled by default)
# Set ENABLE_HTTPX_LOGS=true to see HTTPX request logs (at INFO level)
enable_httpx_logs = os.getenv("ENABLE_HTTPX_LOGS", "false").lower() == "true"
httpx_logger = logging.getLogger("httpx")
httpx_logger.setLevel(logging.INFO if enable_httpx_logs else logging.WARNING)

# Parse CORS origins from environment variable
# Supports comma-separated list: CORS_ORIGINS=http://localhost:3000,https://example.com
# If not set, defaults to ["*"] (allow all) for development
cors_origins_env = os.getenv("CORS_ORIGINS", "").strip()
if cors_origins_env:
    # Parse comma-separated origins and strip whitespace
    cors_origins = [origin.strip() for origin in cors_origins_env.split(",") if origin.strip()]
    logger.info(f"CORS configured with origins: {cors_origins}")
else:
    # Default to allow all origins (development mode)
    cors_origins = ["*"]
    logger.warning(
        "CORS_ORIGINS not set - allowing all origins (*). "
        "For production, set CORS_ORIGINS in environment variables or .env file"
    )

app = FastAPI(
    title="TCGHermit API",
    description="Backend API for card deck building and trading app",
    version="1.0.0",
    redirect_slashes=False  # Disable automatic redirects for trailing slashes
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Request logging middleware (debug-level, minimal noise by default)
@app.middleware("http")
async def log_requests(request: Request, call_next):
    """Lightweight request logging; detailed logs only when LOG_LEVEL=DEBUG."""
    start_time = time.time()

    method = request.method
    path = request.url.path
    query_params = str(request.query_params) if request.query_params else None

    # Debug-level request log (no body to avoid noisy/large logs)
    logger.debug(
        "INCOMING REQUEST: %s %s%s",
        method,
        path,
        f"?{query_params}" if query_params else "",
    )

    # Process request
    try:
        response = await call_next(request)
    except Exception as e:
        logger.error("EXCEPTION in request handler: %s %s | Error: %s", method, path, e, exc_info=True)
        raise

    # Debug-level response log
    process_time = time.time() - start_time
    logger.debug(
        "RESPONSE: %s %s -> %s (took %.3fs)",
        method,
        path,
        response.status_code,
        process_time,
    )

    return response

# Include routers
app.include_router(categories.router)
app.include_router(groups.router)
app.include_router(products.router)
app.include_router(product_extended_data.router)
app.include_router(prices_current.router)
app.include_router(prices_history.router)
app.include_router(category_extended_data_keys.router)
app.include_router(favorites.router)
app.include_router(user_inventory.router)
app.include_router(deck_lists.router)
app.include_router(profiles.router)
app.include_router(vendor_prices.router)

# Serve static files (HTML documentation)
app.mount("/static", StaticFiles(directory="src/static"), name="static")


@app.get("/")
async def root():
    """Serve the frontend documentation page."""
    return FileResponse("src/static/index.html")


@app.get("/api")
async def api_info():
    """API information endpoint."""
    return {
        "title": "TCGHermit API",
        "description": "Backend API for card deck building and trading app",
        "version": "1.0.0"
    }


@app.get("/health")
async def health():
    """Health check endpoint."""
    return {"status": "healthy"}


# Exception handlers for better logging
@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    """Handle HTTP exceptions with detailed logging."""
    logger.warning(
        f"HTTP {exc.status_code} ERROR: {request.method} {request.url.path} | "
        f"Detail: {exc.detail}"
    )
    
    # Special logging for 404s to help debug routing issues
    if exc.status_code == 404:
        logger.error(
            f"404 NOT FOUND: Client tried to access '{request.method} {request.url.path}' "
            f"| Query params: {request.query_params} | "
            f"Available routes: /prices-current/bulk, /prices-history/*"
        )
    
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail}
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """Handle validation errors with detailed logging."""
    # Try to get body from request if available
    body_preview = "N/A"
    try:
        if hasattr(request, '_body'):
            body_preview = str(request._body)[:500]
    except:
        pass
    
    logger.error(
        f"VALIDATION ERROR: {request.method} {request.url.path} | "
        f"Errors: {exc.errors()} | "
        f"Body preview: {body_preview}"
    )
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={"detail": exc.errors()}
    )

