#!/usr/bin/env python3
"""Export .drawio files to PNG/SVG/PDF using the draw.io desktop CLI.

The draw.io desktop app includes a command-line exporter. This script
auto-detects the draw.io binary location across platforms.

Prerequisites:
    - draw.io desktop app installed
    - On Linux headless: sudo apt install xvfb

Usage:
    python export_drawio.py <input.drawio> [--format png|svg|pdf] [--scale 2]

Examples:
    python export_drawio.py architecture.drawio
    python export_drawio.py architecture.drawio --format svg
    python export_drawio.py architecture.drawio --format pdf --scale 3
"""

import argparse
import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path


def find_drawio_binary() -> str | None:
    """Auto-detect the draw.io desktop binary."""
    # Check PATH first
    path_binary = shutil.which("drawio") or shutil.which("draw.io")
    if path_binary:
        return path_binary

    system = platform.system()

    if system == "Darwin":
        mac_path = "/Applications/draw.io.app/Contents/MacOS/draw.io"
        if os.path.exists(mac_path):
            return mac_path

    elif system == "Windows":
        candidates = [
            os.path.expandvars(r"%LOCALAPPDATA%\Programs\draw.io\draw.io.exe"),
            os.path.expandvars(r"%PROGRAMFILES%\draw.io\draw.io.exe"),
        ]
        for c in candidates:
            if os.path.exists(c):
                return c

    elif system == "Linux":
        linux_candidates = [
            "/usr/bin/drawio",
            "/usr/local/bin/drawio",
            "/snap/bin/drawio",
            os.path.expanduser("~/.local/bin/drawio"),
        ]
        for c in linux_candidates:
            if os.path.exists(c):
                return c

    return None


def has_xvfb() -> bool:
    """Check if xvfb-run is available (needed for headless Linux)."""
    return shutil.which("xvfb-run") is not None


def export(input_path: Path, fmt: str = "png", scale: int = 2, embed: bool = True) -> Path:
    """Export a .drawio file to the specified format."""
    binary = find_drawio_binary()
    if not binary:
        print("Error: draw.io desktop not found.", file=sys.stderr)
        print("Install from: https://github.com/jgraph/drawio-desktop/releases", file=sys.stderr)
        print("Or add 'drawio' to your PATH.", file=sys.stderr)
        sys.exit(1)

    output_path = input_path.with_suffix(f".drawio.{fmt}")

    cmd = [binary, "-x", "-f", fmt, "-s", str(scale), "-b", "10"]

    if embed and fmt in ("png", "svg", "pdf"):
        cmd.append("--embed-diagram")

    cmd.extend(["-o", str(output_path), str(input_path)])

    # On headless Linux, wrap with xvfb-run
    system = platform.system()
    if system == "Linux" and not os.environ.get("DISPLAY"):
        if has_xvfb():
            cmd = ["xvfb-run", "-a"] + cmd
        else:
            print("Warning: No DISPLAY and xvfb-run not found. Export may fail.", file=sys.stderr)
            print("Install with: sudo apt install xvfb", file=sys.stderr)

    print(f"Exporting: {' '.join(cmd)}")
    result = subprocess.run(cmd, capture_output=True, text=True)

    if result.returncode != 0:
        print(f"Export failed (exit {result.returncode}):", file=sys.stderr)
        if result.stderr:
            print(result.stderr, file=sys.stderr)
        sys.exit(1)

    if output_path.exists():
        print(f"Exported: {output_path} ({output_path.stat().st_size:,} bytes)")
    else:
        print(f"Warning: Output file not created: {output_path}", file=sys.stderr)
        sys.exit(1)

    return output_path


def main():
    parser = argparse.ArgumentParser(description="Export .drawio files using draw.io desktop CLI")
    parser.add_argument("input", help="Path to .drawio file")
    parser.add_argument("--format", "-f", choices=["png", "svg", "pdf"], default="png",
                        help="Export format (default: png)")
    parser.add_argument("--scale", "-s", type=int, default=2,
                        help="Scale factor (default: 2)")
    parser.add_argument("--no-embed", action="store_true",
                        help="Don't embed diagram XML in exported file")
    parser.add_argument("--check", action="store_true",
                        help="Only check if draw.io is installed")
    args = parser.parse_args()

    if args.check:
        binary = find_drawio_binary()
        if binary:
            print(f"draw.io found: {binary}")
            sys.exit(0)
        else:
            print("draw.io desktop not found")
            sys.exit(1)

    input_path = Path(args.input)
    if not input_path.exists():
        print(f"Error: File not found: {input_path}", file=sys.stderr)
        sys.exit(1)

    export(input_path, fmt=args.format, scale=args.scale, embed=not args.no_embed)


if __name__ == "__main__":
    main()
