"""Post-process a python-pptx-saved .pptx to inject real native SmartArt.

Why post-process: python-pptx has no awareness of `ppt/diagrams/` parts; we
need to add diagram XML files, register their content types, wire up the
relationships from the slide, and inject a `<p:graphicFrame>` element into
the slide's spTree. python-pptx's package model isn't designed to be extended
to new part types without monkey-patching its internals — post-processing the
saved zip is cleaner and easier to test in isolation.

Flow per pending SmartArt:
1. python-pptx writes the deck normally; each slide that requested a SmartArt
   contains a marker shape (a hidden rectangle) tagged with a sentinel name.
2. After save, we open the zip, replace each marker with a `<p:graphicFrame>`
   pointing to fresh diagram parts we add to `ppt/diagrams/`.
3. Update `[Content_Types].xml` with the new diagram content types.
4. Update each affected slide's `_rels/slideN.xml.rels` with 4 new rels:
   diagramData, diagramLayout, diagramColors, diagramQuickStyle.
"""

from __future__ import annotations

import io
import shutil
import zipfile
from dataclasses import dataclass, field
from pathlib import Path

from lxml import etree

DGM_NS = "http://schemas.openxmlformats.org/drawingml/2006/diagram"
A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"
P_NS = "http://schemas.openxmlformats.org/presentationml/2006/main"
R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
CT_NS = "http://schemas.openxmlformats.org/package/2006/content-types"
PR_NS = "http://schemas.openxmlformats.org/package/2006/relationships"

REL_TYPES = {
    "data":       "http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramData",
    "layout":     "http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramLayout",
    "colors":     "http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramColors",
    "quickStyle": "http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramQuickStyle",
}

CONTENT_TYPES = {
    "data":       "application/vnd.openxmlformats-officedocument.drawingml.diagramData+xml",
    "layout":     "application/vnd.openxmlformats-officedocument.drawingml.diagramLayout+xml",
    "colors":     "application/vnd.openxmlformats-officedocument.drawingml.diagramColors+xml",
    "quickStyle": "application/vnd.openxmlformats-officedocument.drawingml.diagramStyle+xml",
}

# Marker name we set on the placeholder rectangle so we can find and replace it
MARKER_PREFIX = "__smart_art_marker__"


@dataclass
class PendingSmartArt:
    slide_index: int          # 1-based, matches ppt/slides/slideN.xml
    layout_key: str           # "cycle1", "orgChart1", ...
    marker_id: str            # e.g. "smartart_0" — appended to MARKER_PREFIX
    data_xml: bytes           # ready-to-write data1.xml
    layout_xml: bytes
    colors_xml: bytes
    quick_style_xml: bytes
    cx_emu: int               # graphicFrame width
    cy_emu: int               # graphicFrame height
    x_emu: int                # graphicFrame x
    y_emu: int                # graphicFrame y


@dataclass
class _ZipState:
    """In-memory representation of the .pptx zip while we patch it."""
    files: dict[str, bytes] = field(default_factory=dict)
    next_diagram_index: int = 1   # ppt/diagrams/data{N}.xml — start at 1

    def has(self, name: str) -> bool:
        return name in self.files

    def claim_diagram_index(self) -> int:
        # Probe existing data{N}.xml; pick the next free integer.
        used = set()
        for n in self.files:
            if n.startswith("ppt/diagrams/data") and n.endswith(".xml"):
                stem = n[len("ppt/diagrams/data"):-len(".xml")]
                if stem.isdigit():
                    used.add(int(stem))
        i = 1
        while i in used:
            i += 1
        return i


def _read_pptx(src: Path) -> _ZipState:
    state = _ZipState()
    with zipfile.ZipFile(src, "r") as z:
        for info in z.infolist():
            state.files[info.filename] = z.read(info.filename)
    return state


def _write_pptx(state: _ZipState, dst: Path) -> None:
    with zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in state.files.items():
            z.writestr(name, data)


def _next_rid_for_slide(rels_xml: bytes) -> int:
    """Pick the smallest unused rId integer in this slide's rels file."""
    if not rels_xml:
        return 1
    root = etree.fromstring(rels_xml)
    used = set()
    for rel in root:
        rid = rel.get("Id", "")
        if rid.startswith("rId") and rid[3:].isdigit():
            used.add(int(rid[3:]))
    i = 1
    while i in used:
        i += 1
    return i


def _add_rel_to_slide(rels_xml: bytes, rid: str, rel_type: str, target: str) -> bytes:
    """Append a Relationship element to a slide's _rels file."""
    if rels_xml:
        root = etree.fromstring(rels_xml)
    else:
        root = etree.Element(
            f"{{{PR_NS}}}Relationships",
            nsmap={None: PR_NS},
        )
    rel = etree.SubElement(
        root, f"{{{PR_NS}}}Relationship",
        Id=rid, Type=rel_type, Target=target,
    )
    return etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone=True)


def _register_content_types(state: _ZipState) -> None:
    """Make sure [Content_Types].xml has the diagram types declared.
    We use Default elements (by extension=xml) where possible, but the diagram
    parts each need explicit Override entries because they share .xml with
    many other types. PowerPoint requires this."""
    ct_xml = state.files["[Content_Types].xml"]
    root = etree.fromstring(ct_xml)
    existing_overrides = {
        el.get("PartName"): el for el in root if el.tag == f"{{{CT_NS}}}Override"
    }

    for diag_part_name, ct in [
        # We register specific overrides for each diagram file we add later
        # via _ensure_override.
    ]:
        pass

    # Persist any existing changes (no-op if nothing changed)
    state.files["[Content_Types].xml"] = etree.tostring(
        root, xml_declaration=True, encoding="UTF-8", standalone=True,
    )


def _ensure_override(state: _ZipState, partname: str, content_type: str) -> None:
    """Add an Override entry to [Content_Types].xml if not already present."""
    ct_xml = state.files["[Content_Types].xml"]
    root = etree.fromstring(ct_xml)
    abs_name = "/" + partname.lstrip("/")
    for el in root:
        if el.tag == f"{{{CT_NS}}}Override" and el.get("PartName") == abs_name:
            return  # already declared
    override = etree.SubElement(
        root, f"{{{CT_NS}}}Override",
        PartName=abs_name, ContentType=content_type,
    )
    state.files["[Content_Types].xml"] = etree.tostring(
        root, xml_declaration=True, encoding="UTF-8", standalone=True,
    )


def _find_marker_shape(slide_xml: bytes, marker_id: str) -> etree._Element | None:
    """Find the placeholder shape we inserted to mark the SmartArt drop point.
    The marker's <p:nvSpPr><p:cNvPr name=...> matches MARKER_PREFIX + marker_id.
    Returns the <p:sp> element."""
    root = etree.fromstring(slide_xml)
    needle = MARKER_PREFIX + marker_id
    for sp in root.iter(f"{{{P_NS}}}sp"):
        cnvpr = sp.find(f".//{{{P_NS}}}cNvPr")
        if cnvpr is not None and cnvpr.get("name", "") == needle:
            return sp
    return None


def _make_graphic_frame(
    *, frame_id: int, name: str,
    x: int, y: int, cx: int, cy: int,
    rid_data: str, rid_layout: str, rid_colors: str, rid_qs: str,
) -> etree._Element:
    """Build the <p:graphicFrame> element that represents a SmartArt diagram
    on a slide."""
    frame = etree.Element(f"{{{P_NS}}}graphicFrame")
    nv = etree.SubElement(frame, f"{{{P_NS}}}nvGraphicFramePr")
    cnv_pr = etree.SubElement(nv, f"{{{P_NS}}}cNvPr", id=str(frame_id), name=name)
    etree.SubElement(nv, f"{{{P_NS}}}cNvGraphicFramePr")
    etree.SubElement(nv, f"{{{P_NS}}}nvPr")

    xfrm = etree.SubElement(frame, f"{{{P_NS}}}xfrm")
    etree.SubElement(xfrm, f"{{{A_NS}}}off", x=str(x), y=str(y))
    etree.SubElement(xfrm, f"{{{A_NS}}}ext", cx=str(cx), cy=str(cy))

    graphic = etree.SubElement(frame, f"{{{A_NS}}}graphic")
    graphic_data = etree.SubElement(
        graphic, f"{{{A_NS}}}graphicData",
        uri="http://schemas.openxmlformats.org/drawingml/2006/diagram",
    )
    rel_ids = etree.SubElement(
        graphic_data,
        f"{{{DGM_NS}}}relIds",
        nsmap={"dgm": DGM_NS, "r": R_NS},
    )
    rel_ids.set(f"{{{R_NS}}}dm", rid_data)
    rel_ids.set(f"{{{R_NS}}}lo", rid_layout)
    rel_ids.set(f"{{{R_NS}}}qs", rid_qs)
    rel_ids.set(f"{{{R_NS}}}cs", rid_colors)
    return frame


def inject_smart_arts(src_pptx: Path, pending: list[PendingSmartArt], dst_pptx: Path) -> None:
    """Apply all pending SmartArts to the deck. Reads src, writes dst."""
    if not pending:
        # No SmartArts to inject — just copy the file
        shutil.copy(src_pptx, dst_pptx)
        return

    state = _read_pptx(src_pptx)

    for sa in pending:
        idx = state.claim_diagram_index()
        slide_path = f"ppt/slides/slide{sa.slide_index}.xml"
        slide_rels_path = f"ppt/slides/_rels/slide{sa.slide_index}.xml.rels"

        # 1. Add the four diagram parts
        data_part = f"ppt/diagrams/data{idx}.xml"
        layout_part = f"ppt/diagrams/layout{idx}.xml"
        colors_part = f"ppt/diagrams/colors{idx}.xml"
        qs_part = f"ppt/diagrams/quickStyle{idx}.xml"

        state.files[data_part] = sa.data_xml
        state.files[layout_part] = sa.layout_xml
        state.files[colors_part] = sa.colors_xml
        state.files[qs_part] = sa.quick_style_xml

        # 2. Register content type overrides for each
        _ensure_override(state, data_part, CONTENT_TYPES["data"])
        _ensure_override(state, layout_part, CONTENT_TYPES["layout"])
        _ensure_override(state, colors_part, CONTENT_TYPES["colors"])
        _ensure_override(state, qs_part, CONTENT_TYPES["quickStyle"])

        # 3. Add relationships in the slide's rels file
        rels_xml = state.files.get(slide_rels_path, b"")
        n0 = _next_rid_for_slide(rels_xml)
        rid_data, rid_layout, rid_colors, rid_qs = (
            f"rId{n0}", f"rId{n0+1}", f"rId{n0+2}", f"rId{n0+3}",
        )
        rels_xml = _add_rel_to_slide(rels_xml, rid_data, REL_TYPES["data"], f"../diagrams/data{idx}.xml")
        rels_xml = _add_rel_to_slide(rels_xml, rid_layout, REL_TYPES["layout"], f"../diagrams/layout{idx}.xml")
        rels_xml = _add_rel_to_slide(rels_xml, rid_colors, REL_TYPES["colors"], f"../diagrams/colors{idx}.xml")
        rels_xml = _add_rel_to_slide(rels_xml, rid_qs, REL_TYPES["quickStyle"], f"../diagrams/quickStyle{idx}.xml")
        state.files[slide_rels_path] = rels_xml

        # 4. Replace the marker shape on the slide with a graphicFrame
        slide_xml = state.files[slide_path]
        marker = _find_marker_shape(slide_xml, sa.marker_id)
        if marker is None:
            raise RuntimeError(
                f"SmartArt marker '{sa.marker_id}' not found on slide {sa.slide_index}"
            )
        # We need a unique non-conflicting cnvPr id; reuse the marker's id if present
        marker_cnvpr = marker.find(f".//{{{P_NS}}}cNvPr")
        marker_id_attr = (marker_cnvpr.get("id") if marker_cnvpr is not None else "100") or "100"
        try:
            frame_id = int(marker_id_attr)
        except ValueError:
            frame_id = 100

        graphic_frame = _make_graphic_frame(
            frame_id=frame_id,
            name=f"SmartArt {idx}",
            x=sa.x_emu, y=sa.y_emu, cx=sa.cx_emu, cy=sa.cy_emu,
            rid_data=rid_data, rid_layout=rid_layout,
            rid_colors=rid_colors, rid_qs=rid_qs,
        )

        parent = marker.getparent()
        parent.replace(marker, graphic_frame)
        # Re-serialize the slide
        slide_root = parent.getroottree().getroot()
        state.files[slide_path] = etree.tostring(
            slide_root,
            xml_declaration=True, encoding="UTF-8", standalone=True,
        )

    _write_pptx(state, dst_pptx)
