"""
Utility functions for mocking database operations.
Used to dump example data instead of writing to the database.
"""

import json
from typing import Dict, Any, List, Optional


def dump_data_examples(
    table_name: str,
    data: List[Dict[str, Any]],
    operation: str = "INSERT",
    max_examples: int = 3
) -> None:
    """
    Dump examples of data that would be inserted/updated.
    
    Args:
        table_name: Name of the table
        data: List of dictionaries to dump
        operation: Type of operation (INSERT, UPDATE, UPSERT, DELETE)
        max_examples: Maximum number of examples to show
    """
    if not data:
        print(f"      [MOCK] {operation} {table_name}: No data to {operation.lower()}")
        return
    
    print(f"\n      [MOCK] {operation} {table_name}: {len(data)} record(s)")
    print(f"      {'=' * 70}")
    
    # Show examples
    examples_to_show = min(max_examples, len(data))
    for i, record in enumerate(data[:examples_to_show], 1):
        print(f"\n      Example {i}/{examples_to_show}:")
        # Pretty print the record
        formatted = json.dumps(record, indent=8, default=str, ensure_ascii=False)
        # Indent each line
        for line in formatted.split('\n'):
            print(f"      {line}")
    
    if len(data) > max_examples:
        print(f"\n      ... and {len(data) - max_examples} more record(s)")
    
    print(f"      {'=' * 70}\n")


def mock_table_operations(table_name: str) -> Dict[str, Any]:
    """
    Create a mock table object that intercepts database operations.
    
    Args:
        table_name: Name of the table being mocked
        
    Returns:
        Mock table object with methods that dump data instead of executing
    """
    class MockTable:
        def __init__(self, name: str):
            self.name = name
        
        def select(self, *args, **kwargs):
            # Return empty results for selects in mock mode
            class MockResponse:
                def __init__(self):
                    self.data = []
                
                def execute(self):
                    return self
            
            return MockResponse()
        
        def insert(self, data: List[Dict[str, Any]]):
            if isinstance(data, dict):
                data = [data]
            dump_data_examples(self.name, data, "INSERT")
            
            class MockResponse:
                def execute(self):
                    return self
            
            return MockResponse()
        
        def upsert(self, data: List[Dict[str, Any]], *args, **kwargs):
            if isinstance(data, dict):
                data = [data]
            dump_data_examples(self.name, data, "UPSERT")
            
            class MockResponse:
                def execute(self):
                    return self
            
            return MockResponse()
        
        def delete(self, *args, **kwargs):
            class MockDelete:
                def in_(self, *args, **kwargs):
                    return self
                
                def eq(self, *args, **kwargs):
                    return self
                
                def execute(self):
                    print(f"      [MOCK] DELETE {self.name}: Would delete matching records")
                    return self
            
            return MockDelete()
        
        def eq(self, *args, **kwargs):
            return self
        
        def in_(self, *args, **kwargs):
            return self
    
    return MockTable(table_name)

