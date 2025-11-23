"""
Product card HTML generator.
Renders product data as HTML cards with special handling for card text attributes.
"""

import json
from typing import Dict, Any, Optional, List
from supabase import Client
from db_config import get_db_schema


def is_card_text_attribute(key: str, value: Optional[str]) -> bool:
    """
    Determines if an extended data attribute should be treated as card text.
    Card text attributes are:
    - Named "DESCRIPTION", "TRIGGER", or "EFFECT" (case-insensitive)
    - Have a value longer than 50 characters
    """
    if value is None:
        return False
    
    key_lower = key.lower()
    if key_lower in ["description", "trigger", "effect"]:
        return True
    
    return len(value) > 50


def render_product_card_html(product: Dict[str, Any], extended_data: List[Dict[str, Any]]) -> str:
    """
    Render a product as an HTML card page.
    
    Args:
        product: Product dictionary from database
        extended_data: List of extended data dictionaries with 'key' and 'value'
        
    Returns:
        HTML string for the product card page
    """
    # Separate attributes into regular and card text
    regular_attrs = []
    card_text_attrs = []
    
    for attr in extended_data:
        key = attr.get("key", "")
        value = attr.get("value", "")
        
        if is_card_text_attribute(key, value):
            card_text_attrs.append({"key": key, "value": value})
        else:
            regular_attrs.append({"key": key, "value": value})
    
    # Build HTML
    html_parts = [
        "<!DOCTYPE html>",
        "<html lang='en'>",
        "<head>",
        "  <meta charset='UTF-8'>",
        "  <meta name='viewport' content='width=device-width, initial-scale=1.0'>",
        f"  <title>{product.get('name', 'Product')}</title>",
        "  <style>",
        "    body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }",
        "    .card { border: 1px solid #ddd; border-radius: 8px; padding: 20px; margin: 20px 0; }",
        "    .card-header { display: flex; align-items: center; margin-bottom: 20px; }",
        "    .card-image { max-width: 200px; margin-right: 20px; }",
        "    .card-title { font-size: 24px; margin: 0; }",
        "    .section { margin: 20px 0; }",
        "    .section-title { font-size: 18px; font-weight: bold; margin-bottom: 10px; }",
        "    .attributes { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; }",
        "    .attribute { padding: 10px; background: #f5f5f5; border-radius: 4px; }",
        "    .attribute-key { font-weight: bold; color: #333; }",
        "    .attribute-value { color: #666; margin-top: 5px; }",
        "    .card-text { background: #fff9e6; padding: 15px; border-radius: 4px; margin: 10px 0; }",
        "    .card-text-key { font-weight: bold; color: #8b6914; margin-bottom: 5px; }",
        "    .card-text-value { color: #333; white-space: pre-wrap; }",
        "  </style>",
        "</head>",
        "<body>",
        "  <div class='card'>",
        "    <div class='card-header'>",
    ]
    
    # Add product image if available
    image_url = product.get("image_url")
    if image_url:
        html_parts.append(f"      <img src='{image_url}' alt='{product.get('name', '')}' class='card-image'>")
    
    html_parts.extend([
        "      <div>",
        f"        <h1 class='card-title'>{product.get('name', 'Unknown Product')}</h1>",
        f"        <p><strong>Product ID:</strong> {product.get('product_id', 'N/A')}</p>",
    ])
    
    clean_name = product.get("clean_name")
    if clean_name:
        html_parts.append(f"        <p><strong>Clean Name:</strong> {clean_name}</p>")
    
    url = product.get("url")
    if url:
        html_parts.append(f"        <p><a href='{url}' target='_blank'>View on TCGPlayer</a></p>")
    
    html_parts.extend([
        "      </div>",
        "    </div>",
    ])
    
    # Card Text Section
    if card_text_attrs:
        html_parts.extend([
        "    <div class='section'>",
        "      <div class='section-title'>Card Text</div>",
        ])
        
        for attr in card_text_attrs:
            html_parts.extend([
                "      <div class='card-text'>",
                f"        <div class='card-text-key'>{attr['key']}</div>",
                f"        <div class='card-text-value'>{attr['value']}</div>",
                "      </div>",
            ])
        
        html_parts.append("    </div>")
    
    # Regular Attributes Section
    if regular_attrs:
        html_parts.extend([
            "    <div class='section'>",
            "      <div class='section-title'>Attributes</div>",
            "      <div class='attributes'>",
        ])
        
        for attr in regular_attrs:
            html_parts.extend([
                "        <div class='attribute'>",
                f"          <div class='attribute-key'>{attr['key']}</div>",
                f"          <div class='attribute-value'>{attr['value'] or 'N/A'}</div>",
                "        </div>",
            ])
        
        html_parts.extend([
            "      </div>",
            "    </div>",
        ])
    
    html_parts.extend([
        "  </div>",
        "</body>",
        "</html>",
    ])
    
    return "\n".join(html_parts)


def generate_product_card_html(client: Client, product_id: int) -> Optional[str]:
    """
    Generate HTML for a product card by fetching product and extended data from database.
    
    Args:
        client: Supabase client instance
        product_id: Product ID to generate card for
        
    Returns:
        HTML string or None if product not found
    """
    schema = get_db_schema()
    products_table = client.schema(schema).from_("products") if schema != "public" else client.table("products")
    ext_data_table = client.schema(schema).from_("product_extended_data") if schema != "public" else client.table("product_extended_data")
    
    # Fetch product
    response = products_table.select("*").eq("product_id", product_id).execute()
    if not response.data:
        return None
    
    product = response.data[0]
    
    # Fetch extended data
    ext_response = ext_data_table.select("key,value").eq("product_id", product_id).execute()
    extended_data = ext_response.data
    
    return render_product_card_html(product, extended_data)


def save_product_card_html(html: str, output_path: str) -> None:
    """
    Save HTML to a file.
    
    Args:
        html: HTML string to save
        output_path: File path to save HTML to
    """
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(html)

