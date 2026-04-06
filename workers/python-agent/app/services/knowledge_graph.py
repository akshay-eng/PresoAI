"""Knowledge Graph service — builds and queries a per-user design knowledge graph.

Each time a user uploads PPTX files (via style profiles or templates), we extract
design knowledge and store it as graph nodes + edges. Over time, the graph
accumulates the user's design preferences and patterns.

Node categories:
  - palette: Color combinations used across files
  - font: Font pairings (heading + body)
  - layout: Recurring slide layout patterns
  - spacing: Spacing and whitespace patterns
  - visual_element: Icons, shapes, image treatments
  - content_pattern: Content density, bullet styles, chart preferences
  - brand_trait: High-level brand personality traits

Edges relate nodes:
  - pairs_with: Font pairing, color combinations
  - used_in: Element used in a layout
  - follows: Slide A layout typically followed by slide B layout
  - contrasts_with: Contrasting design choice
"""

from __future__ import annotations

import json
from typing import Any

import structlog
import psycopg

from app.config import settings
from app.models.schemas import ThemeConfig
from app.models.style_profile import VisualStyleAnalysis, LayoutPattern

logger = structlog.get_logger()


class KnowledgeGraphService:
    """Manages the per-user design knowledge graph in PostgreSQL."""

    def __init__(self, user_id: str) -> None:
        self.user_id = user_id

    def _get_conn(self) -> psycopg.Connection:
        return psycopg.connect(settings.database_url)

    def upsert_node(
        self,
        category: str,
        label: str,
        properties: dict,
        confidence: float = 1.0,
    ) -> str:
        """Insert or update a knowledge graph node. Returns the node ID."""
        with self._get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO knowledge_graph_nodes ("id", "userId", category, label, properties, confidence, "sourceCount", "createdAt", "updatedAt")
                    VALUES (gen_random_uuid()::text, %s, %s, %s, %s, %s, 1, NOW(), NOW())
                    ON CONFLICT ("userId", category, label) DO UPDATE SET
                        properties = EXCLUDED.properties,
                        confidence = LEAST(1.0, knowledge_graph_nodes.confidence + 0.1),
                        "sourceCount" = knowledge_graph_nodes."sourceCount" + 1,
                        "updatedAt" = NOW()
                    RETURNING id
                    """,
                    (self.user_id, category, label, json.dumps(properties), confidence),
                )
                row = cur.fetchone()
                conn.commit()
                return row[0] if row else ""

    def upsert_edge(
        self,
        from_node_id: str,
        to_node_id: str,
        relation: str,
        weight: float = 1.0,
        properties: dict | None = None,
    ) -> None:
        """Insert or update an edge between two nodes."""
        with self._get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO knowledge_graph_edges (id, "fromNodeId", "toNodeId", relation, weight, properties, "createdAt")
                    VALUES (gen_random_uuid()::text, %s, %s, %s, %s, %s, NOW())
                    ON CONFLICT ("fromNodeId", "toNodeId", relation) DO UPDATE SET
                        weight = knowledge_graph_edges.weight + 0.5
                    """,
                    (from_node_id, to_node_id, relation, weight, json.dumps(properties) if properties else None),
                )
                conn.commit()

    def get_user_graph(self) -> dict:
        """Get the full knowledge graph for a user (nodes + edges)."""
        with self._get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    'SELECT id, category, label, properties, confidence, "sourceCount" FROM knowledge_graph_nodes WHERE "userId" = %s ORDER BY confidence DESC',
                    (self.user_id,),
                )
                nodes = [
                    {
                        "id": r[0],
                        "category": r[1],
                        "label": r[2],
                        "properties": r[3] if isinstance(r[3], dict) else json.loads(r[3]) if r[3] else {},
                        "confidence": r[4],
                        "sourceCount": r[5],
                    }
                    for r in cur.fetchall()
                ]

                node_ids = [n["id"] for n in nodes]
                edges = []
                if node_ids:
                    placeholders = ",".join(["%s"] * len(node_ids))
                    cur.execute(
                        f'SELECT id, "fromNodeId", "toNodeId", relation, weight FROM knowledge_graph_edges WHERE "fromNodeId" IN ({placeholders})',
                        node_ids,
                    )
                    edges = [
                        {
                            "id": r[0],
                            "from": r[1],
                            "to": r[2],
                            "relation": r[3],
                            "weight": r[4],
                        }
                        for r in cur.fetchall()
                    ]

                return {"nodes": nodes, "edges": edges}

    def get_design_context(self) -> str:
        """Generate a natural language summary of the user's design knowledge for LLM context."""
        graph = self.get_user_graph()
        if not graph["nodes"]:
            return ""

        sections: list[str] = []
        sections.append("# User's Design Knowledge Graph\n")

        by_category: dict[str, list[dict]] = {}
        for node in graph["nodes"]:
            by_category.setdefault(node["category"], []).append(node)

        category_labels = {
            "palette": "Color Palettes",
            "font": "Typography",
            "layout": "Layout Patterns",
            "spacing": "Spacing & Whitespace",
            "visual_element": "Visual Elements",
            "content_pattern": "Content Patterns",
            "brand_trait": "Brand Traits",
        }

        for cat, label in category_labels.items():
            nodes = by_category.get(cat, [])
            if not nodes:
                continue
            sections.append(f"## {label}")
            for node in nodes[:5]:  # Top 5 by confidence
                props = node["properties"]
                sections.append(
                    f"- **{node['label']}** (seen in {node['sourceCount']} files, confidence: {node['confidence']:.1f})"
                )
                if isinstance(props, dict):
                    for k, v in list(props.items())[:3]:
                        sections.append(f"  - {k}: {v}")
            sections.append("")

        return "\n".join(sections)

    def ingest_from_style_analysis(
        self,
        theme: ThemeConfig | dict,
        visual_style: VisualStyleAnalysis | dict | None,
        layout_patterns: list[LayoutPattern | dict],
        file_name: str = "",
    ) -> None:
        """Extract knowledge from a style analysis and add to the graph."""
        theme_dict = theme.model_dump() if hasattr(theme, "model_dump") else theme
        colors = theme_dict.get("colors", {})

        # --- Palette node ---
        palette_label = self._classify_palette(colors)
        palette_id = self.upsert_node(
            "palette",
            palette_label,
            {
                "colors": colors,
                "primary": colors.get("accent1", ""),
                "secondary": colors.get("accent2", ""),
                "background": colors.get("lt1", ""),
            },
        )

        # --- Font node ---
        heading = theme_dict.get("heading_font", "Calibri")
        body = theme_dict.get("body_font", "Calibri")
        font_label = f"{heading} + {body}" if heading != body else heading
        font_id = self.upsert_node(
            "font",
            font_label,
            {"heading": heading, "body": body},
        )

        # Connect palette <-> font
        if palette_id and font_id:
            self.upsert_edge(palette_id, font_id, "pairs_with")

        # --- Layout nodes ---
        for lp in layout_patterns:
            lp_dict = lp.model_dump() if hasattr(lp, "model_dump") else lp
            layout_type = lp_dict.get("layout_type", "content")
            layout_id = self.upsert_node(
                "layout",
                layout_type,
                {
                    "frequency": lp_dict.get("frequency", 0),
                    "description": lp_dict.get("description", ""),
                    "content_density": lp_dict.get("content_density", "moderate"),
                },
            )
            if palette_id and layout_id:
                self.upsert_edge(palette_id, layout_id, "used_in")

        # --- Visual style nodes (from multimodal analysis) ---
        if visual_style:
            vs_dict = visual_style.model_dump() if hasattr(visual_style, "model_dump") else visual_style

            if vs_dict.get("design_language"):
                self.upsert_node(
                    "brand_trait",
                    vs_dict["design_language"],
                    {"source": "visual_analysis", "file": file_name},
                )

            if vs_dict.get("brand_personality"):
                self.upsert_node(
                    "brand_trait",
                    vs_dict["brand_personality"],
                    {"aspect": "personality"},
                )

            if vs_dict.get("spacing_pattern"):
                self.upsert_node(
                    "spacing",
                    vs_dict["spacing_pattern"],
                    {"content_density": vs_dict.get("content_density", "")},
                )

            if vs_dict.get("graphic_elements"):
                self.upsert_node(
                    "visual_element",
                    vs_dict["graphic_elements"][:100],
                    {"chart_style": vs_dict.get("chart_style", "")},
                )

            if vs_dict.get("typography_treatment"):
                self.upsert_node(
                    "content_pattern",
                    vs_dict["typography_treatment"][:100],
                    {"visual_hierarchy": vs_dict.get("visual_hierarchy", "")},
                )

        logger.info(
            "knowledge_graph_updated",
            user_id=self.user_id,
            palette=palette_label,
            font=font_label,
            layouts=len(layout_patterns),
        )

    @staticmethod
    def _classify_palette(colors: dict) -> str:
        """Classify a color palette into a human-readable label."""
        bg = colors.get("lt1", "#FFFFFF").lower()
        accent = colors.get("accent1", "#4472C4").lower()

        if bg in ("#ffffff", "#fff", "#fafafa", "#f5f5f5"):
            bg_label = "Light"
        elif bg in ("#000000", "#1a1a1a", "#0a0a0a"):
            bg_label = "Dark"
        else:
            bg_label = "Colored"

        # Simple hue classification for accent
        if accent.startswith("#"):
            try:
                r = int(accent[1:3], 16)
                g = int(accent[3:5], 16)
                b = int(accent[5:7], 16)
                if r > g and r > b:
                    accent_label = "warm"
                elif b > r and b > g:
                    accent_label = "cool"
                elif g > r and g > b:
                    accent_label = "natural"
                else:
                    accent_label = "neutral"
            except (ValueError, IndexError):
                accent_label = "neutral"
        else:
            accent_label = "neutral"

        return f"{bg_label} background, {accent_label} accent ({accent})"
