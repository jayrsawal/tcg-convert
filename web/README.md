# TCGJump Web Application

A React-based web application for managing trading card game collections, deck building, and inventory tracking.

## Features

### Inventory Management
- View and manage your card collection
- Bulk import/export cards
- Track quantities and market values
- Filter by attributes (card type, color, level, cost, etc.)
- Market price tracking with currency conversion (USD, CAD, EUR)
- Distribution histograms for card types and market values

### Deck Building
- Create and manage multiple deck lists
- Visual deck builder with drag-and-drop interface
- Real-time deck statistics and validation
- Distribution histograms (Cost, Level, Card Type, Market Value)
- Export/import deck lists
- Integration with Mobile Suit Arena
- Support for exceeding deck limits with visual indicators

### Deck Lists
- View all your decks in a grid layout
- Deck metadata visualization (color distribution pie charts, market values)
- Background images from highest level cards
- Created date tracking
- Quick navigation to deck builder

### Home Page
- Recent decks from all users (top 4)
- Your recent decks (last 3)
- Category statistics for category 86
- Total inventory value display

## Technology Stack

- **React** - UI framework
- **React Router** - Navigation
- **CSS3** - Styling with modern features (Flexbox, Grid, Animations)

## Project Structure

```
src/
├── components/          # React components
│   ├── DeckBuilderPage.js
│   ├── DeckListsPage.js
│   ├── DecksSection.js
│   ├── ExportDeckModal.js
│   ├── LandingPage.js
│   ├── ProductsPage.js
│   ├── ProductListingContent.js
│   ├── NotificationModal.js
│   └── ConfirmationModal.js
├── lib/                 # Utility libraries
│   └── api.js          # API service functions
└── ...
```

## Setup

1. Install dependencies:
```bash
npm install
```

2. Set environment variables:
```bash
REACT_APP_API_URL=http://localhost:8000  # Optional, defaults to relative paths
```

3. Start development server:
```bash
npm start
```

## API Integration

The application communicates with a backend API. See `docs/API_DOCS.md` for detailed API documentation.

### Key API Endpoints

- `POST /products/filter` - Filter products by attributes
- `GET /deck-lists` - Fetch deck lists
- `POST /deck-lists` - Create new deck list
- `GET /user-inventory` - Get user inventory
- `POST /user-inventory/bulk` - Bulk update inventory
- `POST /prices-current/bulk` - Fetch market prices
- And more...

## Features in Detail

### Attribute Filters
- Multi-select checkboxes for each attribute
- Support for multiple values per attribute key
- Clear all filters functionality
- Sidebar shows unfiltered holistic view

### Market Pricing
- Real-time market price fetching
- Currency conversion (USD, CAD, EUR)
- Max percentage slider for market histogram
- Price display on product cards and deck sidebar

### Deck Import/Export
- Export format: `{quantity}x {card number} {card name}`
- Import supports flexible formatting (optional 'x', optional card name)
- Mobile Suit Arena integration
- Additive import for inventory
- Subtractive remove for inventory

### Histograms
- Cost frequency distribution
- Level frequency distribution
- Card Type distribution (Base, Command, Pilot, Unit)
- Market value distribution by percentage
- Expandable view to show all histograms at once
- Minimize/maximize functionality

## Category 86 Focus

The application is currently focused on category 86 (Gundam cards):
- Default category for deck lists
- Inventory filtering
- Home page statistics
- Navigation links

## Development

### Adding New Features

1. Create component in `src/components/`
2. Add API functions to `src/lib/api.js` if needed
3. Update routing in main App component
4. Add styles in corresponding `.css` file

### Code Style

- Use functional components with hooks
- Follow React best practices
- Maintain consistent naming conventions
- Add error handling for API calls
- Use NotificationModal for user feedback

## License

[Your License Here]

