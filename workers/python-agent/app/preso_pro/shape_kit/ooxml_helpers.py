"""Raw OOXML helpers for primitives python-pptx doesn't expose first-class.

Each helper takes a python-pptx shape (or its element) and injects DrawingML
XML to apply effects. Keep these tiny and well-scoped.
"""

from __future__ import annotations

from typing import Any

from lxml import etree

A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"
A_PREFIX = "{%s}" % A_NS


def _replace_fill(sp_pr: Any, fill_xml: str) -> None:
    """Remove any existing fill child on spPr/txBody and insert the given XML."""
    for tag in ("solidFill", "gradFill", "blipFill", "noFill", "pattFill"):
        existing = sp_pr.find(f"{A_PREFIX}{tag}")
        if existing is not None:
            sp_pr.remove(existing)
    new_fill = etree.fromstring(fill_xml)
    sp_pr.insert(0, new_fill)


def apply_linear_gradient(shape: Any, hex_a: str, hex_b: str, angle_deg: int = 135) -> None:
    """Two-stop linear gradient on a shape. angle_deg is the visual gradient angle."""
    pptx_angle = (angle_deg * 60000) % (360 * 60000)
    fill_xml = f"""
    <a:gradFill xmlns:a="{A_NS}" rotWithShape="1">
      <a:gsLst>
        <a:gs pos="0"><a:srgbClr val="{hex_a.lstrip('#').upper()}"/></a:gs>
        <a:gs pos="100000"><a:srgbClr val="{hex_b.lstrip('#').upper()}"/></a:gs>
      </a:gsLst>
      <a:lin ang="{pptx_angle}" scaled="0"/>
    </a:gradFill>
    """
    _replace_fill(shape.fill._xPr, fill_xml)


def apply_multistop_gradient(
    shape: Any,
    stops: list[tuple[int, str]],
    angle_deg: int = 135,
) -> None:
    """Multi-stop linear gradient. `stops` = [(position 0-100000, hex), ...]."""
    pptx_angle = (angle_deg * 60000) % (360 * 60000)
    gs_xml = "".join(
        f'<a:gs pos="{pos}"><a:srgbClr val="{hex_v.lstrip("#").upper()}"/></a:gs>'
        for pos, hex_v in stops
    )
    fill_xml = f"""
    <a:gradFill xmlns:a="{A_NS}" rotWithShape="1">
      <a:gsLst>{gs_xml}</a:gsLst>
      <a:lin ang="{pptx_angle}" scaled="0"/>
    </a:gradFill>
    """
    _replace_fill(shape.fill._xPr, fill_xml)


def apply_radial_gradient(
    shape: Any,
    hex_inner: str,
    hex_outer: str,
    *,
    focus_x: int = 50000,
    focus_y: int = 50000,
) -> None:
    """Radial gradient with inner color at focus point fading to outer color.
    focus_x/focus_y are 0-100000 (percent of shape extent)."""
    fill_xml = f"""
    <a:gradFill xmlns:a="{A_NS}" rotWithShape="1">
      <a:gsLst>
        <a:gs pos="0"><a:srgbClr val="{hex_inner.lstrip('#').upper()}"/></a:gs>
        <a:gs pos="100000"><a:srgbClr val="{hex_outer.lstrip('#').upper()}"/></a:gs>
      </a:gsLst>
      <a:path path="circle">
        <a:fillToRect l="{focus_x}" t="{focus_y}" r="{100000 - focus_x}" b="{100000 - focus_y}"/>
      </a:path>
    </a:gradFill>
    """
    _replace_fill(shape.fill._xPr, fill_xml)


def apply_alpha(shape: Any, opacity: float) -> None:
    """Apply alpha transparency (0.0 fully transparent, 1.0 opaque) to a solid fill."""
    if opacity >= 1.0:
        return
    sp_pr = shape.fill._xPr
    solid_fill = sp_pr.find(f"{A_PREFIX}solidFill")
    if solid_fill is None:
        return
    srgb = solid_fill.find(f"{A_PREFIX}srgbClr")
    if srgb is None:
        return
    alpha_val = max(0, min(100000, int(opacity * 100000)))
    # remove existing alpha if any
    existing_alpha = srgb.find(f"{A_PREFIX}alpha")
    if existing_alpha is not None:
        srgb.remove(existing_alpha)
    alpha = etree.SubElement(srgb, f"{A_PREFIX}alpha")
    alpha.set("val", str(alpha_val))


def apply_outer_shadow(
    shape: Any,
    *,
    blur: int = 38100,       # EMU; default ~3pt blur
    distance: int = 38100,   # EMU
    direction: int = 5400000,  # angle in 60000ths of a degree (5400000 = 90deg)
    hex_color: str = "#000000",
    alpha: int = 50000,
) -> None:
    """Outer shadow effect on a shape."""
    sp_pr = shape._element.find(
        ".//{http://schemas.openxmlformats.org/drawingml/2006/main}spPr"
    )
    if sp_pr is None:
        sp_pr = shape._element.find(
            ".//{http://schemas.openxmlformats.org/drawingml/2006/main}txBody"
        )
    if sp_pr is None:
        return

    # Remove any existing effectLst
    existing = sp_pr.find(f"{A_PREFIX}effectLst")
    if existing is not None:
        sp_pr.remove(existing)

    effect_xml = f"""
    <a:effectLst xmlns:a="{A_NS}">
      <a:outerShdw blurRad="{blur}" dist="{distance}" dir="{direction}" algn="ctr" rotWithShape="0">
        <a:srgbClr val="{hex_color.lstrip('#').upper()}">
          <a:alpha val="{alpha}"/>
        </a:srgbClr>
      </a:outerShdw>
    </a:effectLst>
    """
    sp_pr.append(etree.fromstring(effect_xml))


def apply_text_gradient(text_run: Any, hex_a: str, hex_b: str, angle_deg: int = 90) -> None:
    """Apply a gradient fill to a text run (gradient text effect)."""
    rPr = text_run._r.get_or_add_rPr()
    # Remove existing solidFill
    for tag in ("solidFill", "gradFill"):
        existing = rPr.find(f"{A_PREFIX}{tag}")
        if existing is not None:
            rPr.remove(existing)
    pptx_angle = (angle_deg * 60000) % (360 * 60000)
    grad_xml = f"""
    <a:gradFill xmlns:a="{A_NS}">
      <a:gsLst>
        <a:gs pos="0"><a:srgbClr val="{hex_a.lstrip('#').upper()}"/></a:gs>
        <a:gs pos="100000"><a:srgbClr val="{hex_b.lstrip('#').upper()}"/></a:gs>
      </a:gsLst>
      <a:lin ang="{pptx_angle}" scaled="0"/>
    </a:gradFill>
    """
    rPr.append(etree.fromstring(grad_xml))


def apply_text_outline(text_run: Any, hex_color: str, weight_emu: int = 9525) -> None:
    """Apply an outline (stroke) to a text run, with optional empty fill for outline-only style."""
    rPr = text_run._r.get_or_add_rPr()
    # remove existing line element
    existing_ln = rPr.find(f"{A_PREFIX}ln")
    if existing_ln is not None:
        rPr.remove(existing_ln)
    ln_xml = f"""
    <a:ln xmlns:a="{A_NS}" w="{weight_emu}">
      <a:solidFill>
        <a:srgbClr val="{hex_color.lstrip('#').upper()}"/>
      </a:solidFill>
    </a:ln>
    """
    rPr.append(etree.fromstring(ln_xml))


def custom_geometry_blob_path() -> str:
    """Return a custGeom XML fragment shaping an organic blob.

    Used inside a freeform shape's spPr to override the shape geometry.
    """
    return f"""
    <a:custGeom xmlns:a="{A_NS}">
      <a:avLst/>
      <a:gdLst/>
      <a:ahLst/>
      <a:cxnLst/>
      <a:rect l="0" t="0" r="100000" b="100000"/>
      <a:pathLst>
        <a:path w="100000" h="100000">
          <a:moveTo><a:pt x="50000" y="0"/></a:moveTo>
          <a:cubicBezTo>
            <a:pt x="80000" y="0"/>
            <a:pt x="100000" y="20000"/>
            <a:pt x="100000" y="50000"/>
          </a:cubicBezTo>
          <a:cubicBezTo>
            <a:pt x="100000" y="80000"/>
            <a:pt x="80000" y="100000"/>
            <a:pt x="50000" y="100000"/>
          </a:cubicBezTo>
          <a:cubicBezTo>
            <a:pt x="20000" y="100000"/>
            <a:pt x="0" y="80000"/>
            <a:pt x="0" y="50000"/>
          </a:cubicBezTo>
          <a:cubicBezTo>
            <a:pt x="0" y="20000"/>
            <a:pt x="20000" y="0"/>
            <a:pt x="50000" y="0"/>
          </a:cubicBezTo>
          <a:close/>
        </a:path>
      </a:pathLst>
    </a:custGeom>
    """
