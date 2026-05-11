"""Preso Pro engine — shape-kit-based marketing deck generator.

Lives under python-agent but does not modify any existing engine code paths.
Routed via worker.py when engine == "preso-pro".
"""

from app.preso_pro.orchestrator import generate_preso_pro_deck

__all__ = ["generate_preso_pro_deck"]
