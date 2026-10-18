import os


def greet(name: str) -> str:
    return f"hello {name} on {os.name}"
