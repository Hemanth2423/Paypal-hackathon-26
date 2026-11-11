# claude-skill-draw-diagram

A [Claude Code](https://docs.anthropic.com/en/docs/claude-code) skill that generates production-quality editable diagrams in **.drawio** (Draw.io / diagrams.net) and **.excalidraw** (Excalidraw) formats.

Ask Claude to "draw a diagram" and get an editable file — not an image. Cloud architecture, system design, microservices, flowcharts, ER diagrams, and more.

## Features

- **Draw.io (.drawio)** — Full support for AWS, Azure, GCP, and Kubernetes icon libraries. Best for cloud architecture and infrastructure diagrams.
- **Excalidraw (.excalidraw)** — Hand-drawn aesthetic for whiteboard-style sketches and brainstorming.
- **Icon lookup** — Built-in search across 150+ cloud provider icons (AWS, Azure, GCP, K8s).
- **Visual validation** — Render-view-fix loop using Playwright to catch layout issues before delivery.
- **Export** — Convert to PNG/SVG/PDF via draw.io desktop CLI, with editable diagram embedded in the export.

## Install

### Claude Code

Copy the skill into your project's `.github/skills/` or `.claude/skills/` directory:

```bash
# Option 1: Clone directly
git clone https://github.com/alexpov/claude-skill-draw-diagram .github/skills/draw-diagram

# Option 2: Git submodule (keeps it updatable)
git submodule add https://github.com/alexpov/claude-skill-draw-diagram .github/skills/draw-diagram
```

### GitHub Copilot

Same directory — Copilot agent mode reads skills from `.github/skills/` as well. You may need to invoke it explicitly with `/draw-diagram` in the chat.

## Usage

Once installed, Claude Code will automatically trigger the skill when you ask it to create diagrams. Examples:

```
> draw an AWS architecture for a web app with CloudFront, ALB, ECS, and RDS
> diagram our microservices topology
> make a draw.io diagram of the Kubernetes deployment
> sketch a system design for a real-time data pipeline
> excalidraw a quick whiteboard of the auth flow
```

The skill will:
1. Choose the right format (Draw.io for cloud/infra, Excalidraw for sketches)
2. Look up correct icon shapes for cloud services
3. Generate valid XML/JSON with proper layout
4. Validate structure and optionally render a preview
5. Save the editable file to `.diagrams/` (or wherever you specify)

## Scripts

Helper scripts in `scripts/` — used by the AI agent during generation, but also useful standalone:

| Script | Purpose | Usage |
|---|---|---|
| `find_icon.py` | Search cloud provider icon shapes | `python scripts/find_icon.py lambda --provider aws` |
| `render_diagram.py` | Validate + render to PNG | `python scripts/render_diagram.py arch.drawio --validate-only` |
| `render_local.py` | Render to JPEG (alternative renderer) | `python scripts/render_local.py arch.drawio preview.jpg` |
| `export_drawio.py` | Export via draw.io desktop CLI | `python scripts/export_drawio.py arch.drawio --format png` |

### Prerequisites for rendering

```bash
pip install playwright
playwright install chromium
```

Export requires the [draw.io desktop app](https://github.com/jgraph/drawio-desktop/releases).

## Opening Diagrams

**Draw.io files (.drawio):**
- [app.diagrams.net](https://app.diagrams.net) (web)
- VS Code with "Draw.io Integration" extension
- draw.io desktop app

**Excalidraw files (.excalidraw):**
- [excalidraw.com](https://excalidraw.com) (drag & drop)
- VS Code with "Excalidraw" extension
- Obsidian with Excalidraw plugin

## Examples

See [`references/examples/`](references/examples/) for complete working diagrams:
- `aws-web-app.drawio` — AWS architecture with VPC, subnets, ECS, RDS, S3
- `microservices-architecture.drawio` — Trading platform with Docker Compose services, Kafka, TimescaleDB

## How It Works

The skill teaches Claude how to generate valid Draw.io XML and Excalidraw JSON by providing:
- **Format references** — Complete specs for both file formats ([drawio](references/drawio-format.md), [excalidraw](references/excalidraw-format.md))
- **Layout rules** — Spacing, edge routing, container nesting, annotation placement
- **Design philosophy** — Diagrams should argue visually, not just display information
- **Pre-delivery checklist** — Structural, visual, and format-specific validation
- **Icon database** — 150+ searchable cloud provider shapes

## License

[MIT](LICENSE)
