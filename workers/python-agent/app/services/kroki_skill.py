"""Kroki Diagram Skill — knowledge base for the slide generation agent.

This module provides the diagram type reference as a string that can be
injected into the LLM prompt. The agent decides WHEN a diagram is appropriate
based on the slide content — not every slide needs one.

Usage:
    from app.services.kroki_skill import KROKI_SKILL_REFERENCE
"""

KROKI_SKILL_REFERENCE = """
## Kroki Diagram Capability (use ONLY when a visual diagram adds clarity)

You have access to Kroki for rendering diagrams as images. Use a diagram ONLY when:
- The content describes a PROCESS, FLOW, or SEQUENCE that's hard to understand as text
- The content shows RELATIONSHIPS between entities (architecture, data models)
- The content has a TIMELINE, ROADMAP, or PHASES
- The user explicitly asked for a diagram or visual representation

Do NOT use a diagram when:
- The slide is about metrics/stats (use addTable or addChart instead)
- The slide is a comparison (use a table with zebra striping)
- The slide is a list of features/benefits (use card-based layout)
- The slide already has rich text content that speaks for itself
- Adding a diagram would mean removing important text content

### How to embed a diagram:
Write the diagram source as JavaScript comments with exact markers:

```javascript
// KROKI_DIAGRAM:mermaid
// graph TD
//     A[Service A] --> B[Service B]
//     B --> C[Database]
// END_KROKI_DIAGRAM
```

The system renders the PNG and embeds it automatically. ONLY use title + diagram + caption on diagram slides.

### Diagram Type Quick Reference (all use `mermaid` type):

| Use When... | Mermaid Syntax |
|---|---|
| System architecture, decision trees | `graph TD` or `graph LR` |
| API calls, service interactions | `sequenceDiagram` |
| Project timeline, migration phases | `gantt` |
| Distribution, market share | `pie title "Title"` |
| Concept map, brainstorming | `mindmap` |
| Historical milestones | `timeline` |
| 2x2 strategic matrix | `quadrantChart` |
| Customer experience | `journey` |
| Data model, schema | `erDiagram` |
| Lifecycle, workflow states | `stateDiagram-v2` |
| Bar/line chart with axes | `xychart-beta` |

### Other supported types (via // KROKI_DIAGRAM:<type>):
- `plantuml` — detailed UML (sequence, component, activity)
- `blockdiag` / `nwdiag` — block and network topology diagrams

### Rules:
- Every diagram line MUST start with `// ` (two slashes + space)
- Keep diagram source under 20 lines
- Use descriptive node labels, not single letters
- Diagram slides: title (y:0.3-1.2) + diagram (auto-placed) + optional caption
"""
