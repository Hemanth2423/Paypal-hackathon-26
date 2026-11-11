"""Render a .drawio file to JPEG using a local HTML page + Playwright.

Properly escapes XML content as a JS string literal to avoid the JSON
parse error caused by &#xa; entities becoming newlines inside data-mxgraph.
"""

import json
import sys
import textwrap
from pathlib import Path

from PIL import Image
from playwright.sync_api import sync_playwright


def render(input_path: Path, output_path: Path) -> None:
    xml_content = input_path.read_text(encoding="utf-8")

    # json.dumps produces a valid JS string literal (with all control chars escaped)
    js_string = json.dumps(xml_content)

    # Build HTML that loads the draw.io viewer with the diagram
    html = textwrap.dedent(f"""\
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8">
    <style>body {{ margin:0; padding:0; background:white; overflow:hidden; }}</style>
    </head>
    <body>
    <div id="diagram"></div>
    <script>
    (function() {{
      var xmlData = {js_string};
      var cfg = JSON.stringify({{
        highlight: "#0000ff",
        nav: true,
        resize: true,
        xml: xmlData
      }});
      var container = document.getElementById("diagram");
      var div = document.createElement("div");
      div.className = "mxgraph";
      div.style.maxWidth = "100%";
      div.setAttribute("data-mxgraph", cfg);
      container.appendChild(div);
      var s = document.createElement("script");
      s.src = "https://viewer.diagrams.net/js/viewer-static.min.js";
      document.body.appendChild(s);
    }})();
    </script>
    </body>
    </html>
    """)

    html_path = input_path.with_suffix(".render.html")
    html_path.write_text(html, encoding="utf-8")

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page(viewport={"width": 1600, "height": 1000})
            page.goto(f"file:///{html_path.resolve()}")
            # Wait for viewer JS to load and render
            page.wait_for_timeout(6000)
            try:
                page.wait_for_selector("svg", timeout=15000)
                page.wait_for_timeout(2000)
            except Exception:
                print("Warning: SVG element not found, taking screenshot anyway")
            temp_png = str(output_path.with_suffix(".temp.png"))
            page.screenshot(path=temp_png, full_page=False)
            browser.close()
    finally:
        html_path.unlink(missing_ok=True)

    if output_path.suffix.lower() in (".jpg", ".jpeg"):
        img = Image.open(temp_png).convert("RGB")
        img.save(str(output_path), "JPEG", quality=95)
        Path(temp_png).unlink(missing_ok=True)
    else:
        Path(temp_png).replace(output_path)
    print(f"Rendered: {output_path} ({output_path.stat().st_size / 1024:.1f} KB)")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: render_local.py <input.drawio> [output.jpg]")
        sys.exit(1)
    inp = Path(sys.argv[1])
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else inp.with_suffix(".jpg")
    render(inp, out)
