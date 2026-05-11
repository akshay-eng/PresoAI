"""Emit a valid data1.xml for a SmartArt by cloning the layout's template and
substituting placeholder text with real content.

v1 strategy: fixed-count nodes per layout. Each template ships with N
placeholder data nodes (those carrying `phldrT="[Text]" phldr="1"` in their
`dgm:prSet`). At call time we replace those placeholders with real strings;
extra items are truncated, missing items leave the trailing nodes empty.

This avoids reverse-engineering the layout DSL — the layout/colors/quickStyle
parts stay byte-for-byte identical to what PowerPoint emits.
"""

from __future__ import annotations

from pathlib import Path

from lxml import etree

DGM_NS = "http://schemas.openxmlformats.org/drawingml/2006/diagram"
A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"

NSMAP = {"dgm": DGM_NS, "a": A_NS}


def _qn(ns: str, tag: str) -> str:
    return "{%s}%s" % (ns, tag)


def _is_placeholder_data_pt(pt: etree._Element) -> bool:
    """Data nodes carry `phldrT="[Text]" phldr="1"` in their prSet — that's
    PowerPoint's "this slot needs user content" marker. Doc/pres/parTrans/
    sibTrans points never have phldr=1."""
    pr = pt.find(_qn(DGM_NS, "prSet"))
    if pr is None:
        return False
    return pr.get("phldr") == "1"


def _set_run_text(pt: etree._Element, text: str) -> None:
    """Replace the empty `<a:p><a:endParaRPr/></a:p>` inside a placeholder pt
    with a real run carrying the given text. Also flips phldr→0 and removes
    phldrT so PowerPoint stops treating the slot as empty."""
    # Update the prSet markers
    pr = pt.find(_qn(DGM_NS, "prSet"))
    if pr is not None:
        if "phldrT" in pr.attrib:
            del pr.attrib["phldrT"]
        pr.set("phldr", "0")

    t = pt.find(_qn(DGM_NS, "t"))
    if t is None:
        return

    # Strip existing children and rebuild: <a:bodyPr/><a:lstStyle/><a:p>...</a:p>
    for child in list(t):
        t.remove(child)

    body_pr = etree.SubElement(t, _qn(A_NS, "bodyPr"))
    lst_style = etree.SubElement(t, _qn(A_NS, "lstStyle"))
    p = etree.SubElement(t, _qn(A_NS, "p"))

    if text:
        r = etree.SubElement(p, _qn(A_NS, "r"))
        r_pr = etree.SubElement(r, _qn(A_NS, "rPr"))
        r_pr.set("lang", "en-US")
        r_pr.set("dirty", "0")
        text_el = etree.SubElement(r, _qn(A_NS, "t"))
        text_el.text = text
    else:
        # leave empty — PowerPoint will show the slot as empty but valid
        end_par = etree.SubElement(p, _qn(A_NS, "endParaRPr"))
        end_par.set("lang", "en-US")


def emit_data_xml(template_path: Path, items: list[str]) -> bytes:
    """Load the template data1.xml, substitute placeholder texts with `items`,
    return the serialized XML bytes."""
    parser = etree.XMLParser(remove_blank_text=False)
    tree = etree.parse(str(template_path), parser)
    root = tree.getroot()

    placeholders = [
        pt for pt in root.iter(_qn(DGM_NS, "pt"))
        if _is_placeholder_data_pt(pt)
    ]

    # Pad / truncate items to match the template's slot count.
    n = len(placeholders)
    padded = list(items[:n]) + [""] * max(0, n - len(items))

    for pt, text in zip(placeholders, padded):
        _set_run_text(pt, text)

    # Strip the dataModelExt → drawing1.xml relId reference. We're going to
    # ship without drawing1.xml; PowerPoint regenerates it on first open.
    for ext_lst in root.iter(_qn(DGM_NS, "extLst")):
        ext_lst.getparent().remove(ext_lst)

    return etree.tostring(
        root,
        xml_declaration=True, encoding="UTF-8", standalone=True,
    )


def template_slot_count(template_path: Path) -> int:
    """How many placeholder data nodes the template ships with (the v1 fixed
    item count for that layout)."""
    parser = etree.XMLParser(remove_blank_text=False)
    tree = etree.parse(str(template_path), parser)
    return sum(
        1 for pt in tree.getroot().iter(_qn(DGM_NS, "pt"))
        if _is_placeholder_data_pt(pt)
    )
