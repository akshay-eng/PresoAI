"""Validator — hard-fails slide_spec JSON that drifts from deck_context.

Rules:
  - All fn names must be in the shape-kit registry.
  - All `role` args must be valid palette role keys present in deck_context.
  - All `tier` args (if present) must be valid typography tiers.
  - All anchor args (`anchor`, `position`) must be valid anchor names.
  - No raw hex codes anywhere in args.
"""

from __future__ import annotations

import re
from typing import Any

from app.preso_pro.planning.slide_spec import DeckContext, SlideSpec
from app.preso_pro.shape_kit import is_registered
from app.preso_pro.shape_kit.anchors import ANCHOR_TABLE

VALID_ROLES = {
    "background",
    "surface",
    "primary",
    "accent_1",
    "accent_2",
    "text_primary",
    "text_muted",
    "text_inverse",
}
VALID_TIERS = {"display", "h1", "h2", "body", "caption"}
HEX_RE = re.compile(r"^#[0-9a-fA-F]{3,8}$")


class ValidationError(Exception):
    pass


def _check_value(name: str, value: Any) -> list[str]:
    """Return list of error strings for a single arg name/value."""
    errors: list[str] = []
    if isinstance(value, str):
        if HEX_RE.match(value):
            errors.append(f"raw hex code in arg '{name}': {value}")
        if name in ("role", "role_a", "role_b") and value not in VALID_ROLES:
            errors.append(f"unknown palette role for '{name}': {value}")
        if name == "tier" and value not in VALID_TIERS:
            errors.append(f"unknown typography tier: {value}")
        if name in ("anchor", "position") and value not in ANCHOR_TABLE:
            errors.append(f"unknown anchor name: {value}")
    return errors


def validate_slide_spec(spec: SlideSpec, ctx: DeckContext) -> None:
    """Raise ValidationError listing all problems with this slide_spec."""
    errors: list[str] = []

    calls = []
    if spec.background:
        calls.append(("background", spec.background))
    for i, elem in enumerate(spec.elements):
        calls.append((f"elements[{i}]", elem))

    for path, call in calls:
        if not is_registered(call.fn):
            errors.append(f"{path}: unknown function '{call.fn}'")
            continue
        for arg_name, arg_val in call.args.items():
            errors.extend(f"{path}.{e}" for e in _check_value(arg_name, arg_val))

    if errors:
        raise ValidationError("; ".join(errors))
