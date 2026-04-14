"""Shared test bootstrap helpers for local unittest discovery."""

from __future__ import annotations

import sys
from pathlib import Path


def ensure_package_parent_on_path() -> None:
    """Adds the repository path that contains the brain package to sys.path."""

    package_parent = Path(__file__).resolve().parents[2]
    package_parent_str = str(package_parent)

    if package_parent_str not in sys.path:
        sys.path.insert(0, package_parent_str)
