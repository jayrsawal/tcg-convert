# TCG Convert

A comprehensive trading card game data management system consisting of three main components: a data scraper, a REST API, and a web application.

## Project Overview

This project provides a complete solution for collecting, storing, and managing trading card game data, with support for deck building, inventory tracking, and market price monitoring.

## Components

### 1. Scrape (`/scrape`)

A Python scraper that extracts trading card game data from [tcgcsv.com](https://tcgcsv.com) and stores it in a Supabase database.

**Key Features:**
- Fetches and stores categories, groups, products, and pricing data
- Tracks historical prices with hourly granularity
- Supports category whitelisting for targeted scraping
- Generates HTML product card pages
- Handles extended data tracking and storage

**Tech Stack:** Python 3.8+, Supabase

### 2. API (`/api`)

A FastAPI backend API for card deck building and trading functionality.

**Key Features:**
- RESTful endpoints for all database tables with pagination
- Product filtering by extended data attributes
- Price history with date range filtering
- JWT authentication via Supabase
- Interactive API documentation (Swagger UI)
- Bulk operations for efficient data retrieval

**Tech Stack:** FastAPI, Supabase, Python

### 3. Web (`/web`)

A React-based web application for managing trading card game collections and deck building.

**Key Features:**
- Inventory management with bulk import/export
- Visual deck builder with drag-and-drop interface
- Real-time deck statistics and validation
- Market price tracking with multi-currency support (USD, CAD, EUR)
- Distribution histograms for cards and market values
- Deck list management with metadata visualization

**Tech Stack:** React, React Router, CSS3

## Architecture

```
┌─────────────┐
│   Scrape    │ → Extracts data from tcgcsv.com
└──────┬──────┘
       │
       ↓
┌─────────────┐
│   Supabase  │ → Central database storage
└──────┬──────┘
       │
       ├──────────────┐
       ↓              ↓
┌─────────────┐  ┌─────────────┐
│     API     │  │     Web     │
│  (FastAPI)  │  │   (React)   │
└─────────────┘  └─────────────┘
```

## Getting Started

Each component has its own setup instructions. Please refer to the individual README files:

- [Scrape README](scrape/README.md) - Data scraping setup
- [API README](api/README.md) - Backend API setup
- [Web README](web/README.md) - Frontend application setup

## Data Flow

1. **Scrape** collects trading card data from tcgcsv.com and stores it in Supabase
2. **API** provides REST endpoints to query and filter the stored data
3. **Web** consumes the API to provide a user-friendly interface for deck building and inventory management

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

**MIT License** is a permissive open-source license that allows:
- Commercial use
- Modification
- Distribution
- Private use

The only requirement is that the license and copyright notice be included in copies of the software.

