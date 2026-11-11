#!/usr/bin/env python3
"""Render .drawio or .excalidraw diagrams to PNG for visual validation.

Prerequisites:
    pip install playwright
    playwright install chromium

Usage:
    python render_diagram.py <input_file> [--output <output.png>] [--width 1600] [--height 900]

Examples:
    python render_diagram.py architecture.drawio
    python render_diagram.py sketch.excalidraw --output preview.png
    python render_diagram.py architecture.drawio --width 2400 --height 1200
"""

import argparse
import json
import sys
import urllib.parse
from pathlib import Path


def render_drawio(input_path: Path, output_path: Path, width: int, height: int):
    """Render a .drawio file using the diagrams.net viewer."""
    from playwright.sync_api import sync_playwright

    xml_content = input_path.read_text(encoding="utf-8")

    # URL-encode the XML and open in diagrams.net viewer
    encoded = urllib.parse.quote(xml_content, safe="")
    viewer_url = f"https://viewer.diagrams.net/?highlight=0000ff&nav=1&xml={encoded}"

    # Alternative: use local HTML with embedded viewer
    html = f"""<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <style>
        body {{ margin: 0; padding: 0; background: white; overflow: hidden; }}
        .mxgraph {{ max-width: 100%; }}
    </style>
</head>
<body>
    <div class="mxgraph" style="width:{width}px;height:{height}px;" data-mxgraph='{json.dumps({"highlight":"#0000ff","nav":True,"resize":True,"xml":xml_content})}'>
    </div>
    <script src="https://viewer.diagrams.net/js/viewer-static.min.js"></script>
</body>
</html>"""

    html_path = input_path.with_suffix(".render.html")
    html_path.write_text(html, encoding="utf-8")

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": width, "height": height})
        page.goto(f"file://{html_path.resolve()}")

        # Wait for the viewer to render
        page.wait_for_timeout(3000)

        # Try to wait for the SVG container
        try:
            page.wait_for_selector("svg", timeout=5000)
        except Exception:
            pass  # Viewer might use canvas fallback

        page.screenshot(path=str(output_path), full_page=False)
        browser.close()

    # Clean up temp HTML
    html_path.unlink(missing_ok=True)
    print(f"Rendered: {output_path}")


def render_excalidraw(input_path: Path, output_path: Path, width: int, height: int):
    """Render an .excalidraw file using the Excalidraw web app."""
    from playwright.sync_api import sync_playwright

    scene_data = input_path.read_text(encoding="utf-8")

    html = f"""<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <style>
        body {{ margin: 0; padding: 0; background: white; }}
        #root {{ width: {width}px; height: {height}px; }}
    </style>
</head>
<body>
    <div id="root"></div>
    <script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
    <script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
    <script type="module">
        import {{ Excalidraw }} from "https://esm.sh/@excalidraw/excalidraw@latest";

        const sceneData = {scene_data};
        const App = () => {{
            return React.createElement(Excalidraw, {{
                initialData: sceneData,
                viewModeEnabled: true,
                zenModeEnabled: true,
                gridModeEnabled: false,
                UIOptions: {{ canvasActions: {{ toggleTheme: false }} }}
            }});
        }};

        const root = ReactDOM.createRoot(document.getElementById("root"));
        root.render(React.createElement(App));
    </script>
</body>
</html>"""

    html_path = input_path.with_suffix(".render.html")
    html_path.write_text(html, encoding="utf-8")

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": width, "height": height})
        page.goto(f"file://{html_path.resolve()}")
        page.wait_for_timeout(5000)  # Excalidraw needs more time to render
        page.screenshot(path=str(output_path), full_page=False)
        browser.close()

    html_path.unlink(missing_ok=True)
    print(f"Rendered: {output_path}")


def validate_drawio(input_path: Path) -> bool:
    """Validate .drawio XML structure."""
    import xml.etree.ElementTree as ET

    try:
        tree = ET.parse(input_path)
        root = tree.getroot()
    except ET.ParseError as e:
        print(f"XML parse error: {e}", file=sys.stderr)
        return False

    # Find the root element containing mxCells
    mxgraph = root if root.tag == "mxGraphModel" else root.find(".//mxGraphModel")
    if mxgraph is None:
        print("Error: No <mxGraphModel> element found", file=sys.stderr)
        return False

    root_elem = mxgraph.find("root")
    if root_elem is None:
        print("Error: No <root> element inside mxGraphModel", file=sys.stderr)
        return False

    cells = root_elem.findall("mxCell")
    if len(cells) < 2:
        print("Error: Missing mandatory structural cells (id=0 and id=1)", file=sys.stderr)
        return False

    # Check for mandatory cells
    ids = {c.get("id") for c in cells}
    if "0" not in ids:
        print("Error: Missing <mxCell id='0'/> (root container)", file=sys.stderr)
        return False
    if "1" not in ids:
        print("Error: Missing <mxCell id='1' parent='0'/> (default layer)", file=sys.stderr)
        return False

    # Check for duplicate IDs
    all_ids = [c.get("id") for c in cells]
    for obj in root_elem.findall("object"):
        all_ids.append(obj.get("id"))
    dupes = [x for x in all_ids if all_ids.count(x) > 1]
    if dupes:
        print(f"Warning: Duplicate IDs found: {set(dupes)}", file=sys.stderr)

    # Check edges reference valid sources/targets
    for cell in cells:
        if cell.get("edge") == "1":
            src = cell.get("source")
            tgt = cell.get("target")
            if src and src not in ids:
                print(f"Warning: Edge '{cell.get('id')}' source='{src}' references non-existent cell", file=sys.stderr)
            if tgt and tgt not in ids:
                print(f"Warning: Edge '{cell.get('id')}' target='{tgt}' references non-existent cell", file=sys.stderr)

    print(f"Validation passed: {len(cells)} cells, {len(ids)} unique IDs")
    return True


def validate_excalidraw(input_path: Path) -> bool:
    """Validate .excalidraw JSON structure."""
    try:
        data = json.loads(input_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        print(f"JSON parse error: {e}", file=sys.stderr)
        return False

    if data.get("type") != "excalidraw":
        print("Error: Missing or wrong 'type' field (expected 'excalidraw')", file=sys.stderr)
        return False

    elements = data.get("elements", [])
    if not isinstance(elements, list):
        print("Error: 'elements' is not an array", file=sys.stderr)
        return False

    # Check for duplicate IDs
    ids = [e.get("id") for e in elements if e.get("id")]
    dupes = [x for x in ids if ids.count(x) > 1]
    if dupes:
        print(f"Warning: Duplicate element IDs: {set(dupes)}", file=sys.stderr)

    # Check bound element references
    for elem in elements:
        if elem.get("containerId"):
            container_id = elem["containerId"]
            if container_id not in ids:
                print(f"Warning: Element '{elem.get('id')}' containerId='{container_id}' references non-existent element", file=sys.stderr)

        # Check arrow bindings
        for binding_key in ("startBinding", "endBinding"):
            binding = elem.get(binding_key)
            if binding and binding.get("elementId"):
                ref_id = binding["elementId"]
                if ref_id not in ids:
                    print(f"Warning: Arrow '{elem.get('id')}' {binding_key} references non-existent element '{ref_id}'", file=sys.stderr)

    print(f"Validation passed: {len(elements)} elements, {len(set(ids))} unique IDs")
    return True


def main():
    parser = argparse.ArgumentParser(description="Render and validate diagram files")
    parser.add_argument("input", help="Path to .drawio or .excalidraw file")
    parser.add_argument("--output", "-o", help="Output PNG path (default: <input>.png)")
    parser.add_argument("--width", type=int, default=1600, help="Viewport width (default: 1600)")
    parser.add_argument("--height", type=int, default=900, help="Viewport height (default: 900)")
    parser.add_argument("--validate-only", action="store_true", help="Only validate, don't render")
    args = parser.parse_args()

    input_path = Path(args.input)
    if not input_path.exists():
        print(f"Error: File not found: {input_path}", file=sys.stderr)
        sys.exit(1)

    suffix = input_path.suffix.lower()
    output_path = Path(args.output) if args.output else input_path.with_suffix(".png")

    if suffix == ".drawio":
        valid = validate_drawio(input_path)
        if not args.validate_only and valid:
            render_drawio(input_path, output_path, args.width, args.height)
    elif suffix == ".excalidraw":
        valid = validate_excalidraw(input_path)
        if not args.validate_only and valid:
            render_excalidraw(input_path, output_path, args.width, args.height)
    else:
        print(f"Error: Unsupported file type '{suffix}'. Use .drawio or .excalidraw", file=sys.stderr)
        sys.exit(1)

    if not valid:
        sys.exit(1)


if __name__ == "__main__":
    main()
