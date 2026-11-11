# Excalidraw (.excalidraw) Format Reference

## File Structure

An `.excalidraw` file is a JSON file with this schema:

```json
{
  "type": "excalidraw",
  "version": 2,
  "source": "https://excalidraw.com",
  "elements": [],
  "appState": {
    "gridSize": 20,
    "viewBackgroundColor": "#ffffff"
  },
  "files": {}
}
```

### Top-level Fields

| Field | Required | Description |
|---|---|---|
| `type` | Yes | Must be `"excalidraw"` |
| `version` | Yes | Must be `2` |
| `source` | Yes | Origin URL, use `"https://excalidraw.com"` |
| `elements` | Yes | Array of element objects |
| `appState` | No | Canvas settings |
| `files` | No | Binary file data for image elements |

## Element Types

Every element shares these common properties:

```json
{
  "id": "unique-string-id",
  "type": "rectangle",
  "x": 100,
  "y": 200,
  "width": 200,
  "height": 100,
  "angle": 0,
  "strokeColor": "#1e1e1e",
  "backgroundColor": "transparent",
  "fillStyle": "solid",
  "strokeWidth": 2,
  "strokeStyle": "solid",
  "roughness": 1,
  "opacity": 100,
  "groupIds": [],
  "frameId": null,
  "index": "a0",
  "roundness": { "type": 3 },
  "seed": 1234567890,
  "version": 1,
  "versionNonce": 1234567890,
  "isDeleted": false,
  "boundElements": null,
  "updated": 1690000000000,
  "link": null,
  "locked": false
}
```

### ID Generation
Use any unique string. For AI generation, use descriptive IDs like `"rect-vpc"`, `"arrow-1"`, `"text-label-db"`. IDs must be unique across all elements.

### Common Properties Reference

| Property | Type | Description |
|---|---|---|
| `id` | string | Unique identifier |
| `type` | string | Element type (see below) |
| `x`, `y` | number | Position (top-left origin) |
| `width`, `height` | number | Dimensions |
| `angle` | number | Rotation in radians |
| `strokeColor` | string | Border color (`#RRGGBB`) |
| `backgroundColor` | string | Fill color or `"transparent"` |
| `fillStyle` | string | `"solid"`, `"hachure"`, `"cross-hatch"`, `"dots"` |
| `strokeWidth` | number | Border thickness (1, 2, 4) |
| `strokeStyle` | string | `"solid"`, `"dashed"`, `"dotted"` |
| `roughness` | number | 0=sharp, 1=normal, 2=very rough |
| `opacity` | number | 0-100 |
| `groupIds` | string[] | Groups this element belongs to |
| `roundness` | object/null | `{"type": 3}` for rounded, `null` for sharp |
| `seed` | number | Random seed for roughness rendering |

### Shape Elements

**Rectangle**: `"type": "rectangle"`
**Ellipse**: `"type": "ellipse"`
**Diamond**: `"type": "diamond"`
**Freedraw**: `"type": "freedraw"` (hand-drawn paths)

### Text Element

```json
{
  "type": "text",
  "text": "Your label here",
  "fontSize": 20,
  "fontFamily": 1,
  "textAlign": "center",
  "verticalAlign": "middle",
  "containerId": null,
  "originalText": "Your label here",
  "autoResize": true,
  "lineHeight": 1.25
}
```

**fontFamily values**: `1` = Virgil (hand-drawn), `2` = Helvetica, `3` = Cascadia (monospace)

### Bound Text (label inside a shape)

To put text inside a shape, create both elements and link them:

```json
// Shape with boundElements reference
{
  "id": "rect-1",
  "type": "rectangle",
  "x": 100, "y": 100, "width": 200, "height": 80,
  "boundElements": [{"type": "text", "id": "text-rect-1"}]
},
// Text bound to shape
{
  "id": "text-rect-1",
  "type": "text",
  "x": 100, "y": 100, "width": 200, "height": 25,
  "text": "Web Server",
  "containerId": "rect-1",
  "textAlign": "center",
  "verticalAlign": "middle"
}
```

### Arrow / Line Elements

```json
{
  "id": "arrow-1",
  "type": "arrow",
  "x": 300,
  "y": 140,
  "width": 150,
  "height": 0,
  "points": [[0, 0], [150, 0]],
  "startBinding": {
    "elementId": "rect-1",
    "focus": 0,
    "gap": 5,
    "fixedPoint": null
  },
  "endBinding": {
    "elementId": "rect-2",
    "focus": 0,
    "gap": 5,
    "fixedPoint": null
  },
  "startArrowhead": null,
  "endArrowhead": "arrow",
  "elbowed": false
}
```

- `type`: `"arrow"` (with arrowheads) or `"line"` (no arrowheads)
- `points`: Array of `[x, y]` relative to element position. Minimum 2 points.
- `startBinding` / `endBinding`: Connect to shapes. `elementId` references target shape.
- `startArrowhead` / `endArrowhead`: `null`, `"arrow"`, `"bar"`, `"dot"`, `"triangle"`
- `elbowed`: `true` for right-angle routing

**Important**: When an arrow is bound to a shape, that shape must have the arrow in its `boundElements`:
```json
{
  "id": "rect-1",
  "boundElements": [
    {"type": "text", "id": "text-rect-1"},
    {"type": "arrow", "id": "arrow-1"}
  ]
}
```

### Frame Element (Container/Group)

```json
{
  "id": "frame-vpc",
  "type": "frame",
  "x": 50, "y": 50, "width": 600, "height": 400,
  "name": "VPC 10.0.0.0/16"
}
```

Children reference frames via `"frameId": "frame-vpc"`.

## Color Palette (recommended for architecture diagrams)

| Purpose | Stroke | Background |
|---|---|---|
| Compute/Default | `#1971c2` | `#a5d8ff` |
| Storage/Data | `#2f9e44` | `#b2f2bb` |
| Networking | `#e8590c` | `#ffc9c9` |
| Security | `#e03131` | `#ffc9c9` |
| Database | `#6741d9` | `#d0bfff` |
| Queue/Messaging | `#f08c00` | `#ffec99` |
| Gray/Infrastructure | `#495057` | `#dee2e6` |

## Seed Values

The `seed` property controls the randomized hand-drawn appearance. Generate a random integer for each element. For consistent diagrams, use incrementing seeds starting from a fixed base.

```python
import random
seed = random.randint(1, 2147483647)
```

## Complete Example: Simple Architecture

```json
{
  "type": "excalidraw",
  "version": 2,
  "source": "https://excalidraw.com",
  "elements": [
    {
      "id": "client",
      "type": "rectangle",
      "x": 50, "y": 150, "width": 140, "height": 80,
      "strokeColor": "#1e1e1e",
      "backgroundColor": "#a5d8ff",
      "fillStyle": "solid",
      "strokeWidth": 2,
      "strokeStyle": "solid",
      "roughness": 1,
      "opacity": 100,
      "angle": 0,
      "groupIds": [],
      "frameId": null,
      "index": "a0",
      "roundness": {"type": 3},
      "seed": 100001,
      "version": 1,
      "versionNonce": 200001,
      "isDeleted": false,
      "boundElements": [
        {"type": "text", "id": "text-client"},
        {"type": "arrow", "id": "arrow-1"}
      ],
      "updated": 1700000000000,
      "link": null,
      "locked": false
    },
    {
      "id": "text-client",
      "type": "text",
      "x": 80, "y": 177,
      "width": 80, "height": 25,
      "text": "Client",
      "fontSize": 20,
      "fontFamily": 1,
      "textAlign": "center",
      "verticalAlign": "middle",
      "containerId": "client",
      "originalText": "Client",
      "autoResize": true,
      "lineHeight": 1.25,
      "strokeColor": "#1e1e1e",
      "backgroundColor": "transparent",
      "fillStyle": "solid",
      "strokeWidth": 2,
      "strokeStyle": "solid",
      "roughness": 1,
      "opacity": 100,
      "angle": 0,
      "groupIds": [],
      "frameId": null,
      "index": "a1",
      "roundness": null,
      "seed": 100002,
      "version": 1,
      "versionNonce": 200002,
      "isDeleted": false,
      "boundElements": null,
      "updated": 1700000000000,
      "link": null,
      "locked": false
    },
    {
      "id": "api",
      "type": "rectangle",
      "x": 320, "y": 150, "width": 140, "height": 80,
      "strokeColor": "#1e1e1e",
      "backgroundColor": "#b2f2bb",
      "fillStyle": "solid",
      "strokeWidth": 2,
      "strokeStyle": "solid",
      "roughness": 1,
      "opacity": 100,
      "angle": 0,
      "groupIds": [],
      "frameId": null,
      "index": "a2",
      "roundness": {"type": 3},
      "seed": 100003,
      "version": 1,
      "versionNonce": 200003,
      "isDeleted": false,
      "boundElements": [
        {"type": "text", "id": "text-api"},
        {"type": "arrow", "id": "arrow-1"},
        {"type": "arrow", "id": "arrow-2"}
      ],
      "updated": 1700000000000,
      "link": null,
      "locked": false
    },
    {
      "id": "text-api",
      "type": "text",
      "x": 340, "y": 177,
      "width": 100, "height": 25,
      "text": "API Server",
      "fontSize": 20,
      "fontFamily": 1,
      "textAlign": "center",
      "verticalAlign": "middle",
      "containerId": "api",
      "originalText": "API Server",
      "autoResize": true,
      "lineHeight": 1.25,
      "strokeColor": "#1e1e1e",
      "backgroundColor": "transparent",
      "fillStyle": "solid",
      "strokeWidth": 2,
      "strokeStyle": "solid",
      "roughness": 1,
      "opacity": 100,
      "angle": 0,
      "groupIds": [],
      "frameId": null,
      "index": "a3",
      "roundness": null,
      "seed": 100004,
      "version": 1,
      "versionNonce": 200004,
      "isDeleted": false,
      "boundElements": null,
      "updated": 1700000000000,
      "link": null,
      "locked": false
    },
    {
      "id": "db",
      "type": "ellipse",
      "x": 590, "y": 150, "width": 140, "height": 80,
      "strokeColor": "#1e1e1e",
      "backgroundColor": "#d0bfff",
      "fillStyle": "solid",
      "strokeWidth": 2,
      "strokeStyle": "solid",
      "roughness": 1,
      "opacity": 100,
      "angle": 0,
      "groupIds": [],
      "frameId": null,
      "index": "a4",
      "roundness": {"type": 2},
      "seed": 100005,
      "version": 1,
      "versionNonce": 200005,
      "isDeleted": false,
      "boundElements": [
        {"type": "text", "id": "text-db"},
        {"type": "arrow", "id": "arrow-2"}
      ],
      "updated": 1700000000000,
      "link": null,
      "locked": false
    },
    {
      "id": "text-db",
      "type": "text",
      "x": 620, "y": 177,
      "width": 80, "height": 25,
      "text": "Database",
      "fontSize": 20,
      "fontFamily": 1,
      "textAlign": "center",
      "verticalAlign": "middle",
      "containerId": "db",
      "originalText": "Database",
      "autoResize": true,
      "lineHeight": 1.25,
      "strokeColor": "#1e1e1e",
      "backgroundColor": "transparent",
      "fillStyle": "solid",
      "strokeWidth": 2,
      "strokeStyle": "solid",
      "roughness": 1,
      "opacity": 100,
      "angle": 0,
      "groupIds": [],
      "frameId": null,
      "index": "a5",
      "roundness": null,
      "seed": 100006,
      "version": 1,
      "versionNonce": 200006,
      "isDeleted": false,
      "boundElements": null,
      "updated": 1700000000000,
      "link": null,
      "locked": false
    },
    {
      "id": "arrow-1",
      "type": "arrow",
      "x": 190, "y": 190,
      "width": 130, "height": 0,
      "points": [[0, 0], [130, 0]],
      "strokeColor": "#1e1e1e",
      "backgroundColor": "transparent",
      "fillStyle": "solid",
      "strokeWidth": 2,
      "strokeStyle": "solid",
      "roughness": 1,
      "opacity": 100,
      "angle": 0,
      "groupIds": [],
      "frameId": null,
      "index": "a6",
      "roundness": {"type": 2},
      "seed": 100007,
      "version": 1,
      "versionNonce": 200007,
      "isDeleted": false,
      "boundElements": null,
      "updated": 1700000000000,
      "link": null,
      "locked": false,
      "startBinding": {"elementId": "client", "focus": 0, "gap": 5, "fixedPoint": null},
      "endBinding": {"elementId": "api", "focus": 0, "gap": 5, "fixedPoint": null},
      "startArrowhead": null,
      "endArrowhead": "arrow",
      "elbowed": false
    },
    {
      "id": "arrow-2",
      "type": "arrow",
      "x": 460, "y": 190,
      "width": 130, "height": 0,
      "points": [[0, 0], [130, 0]],
      "strokeColor": "#1e1e1e",
      "backgroundColor": "transparent",
      "fillStyle": "solid",
      "strokeWidth": 2,
      "strokeStyle": "solid",
      "roughness": 1,
      "opacity": 100,
      "angle": 0,
      "groupIds": [],
      "frameId": null,
      "index": "a7",
      "roundness": {"type": 2},
      "seed": 100008,
      "version": 1,
      "versionNonce": 200008,
      "isDeleted": false,
      "boundElements": null,
      "updated": 1700000000000,
      "link": null,
      "locked": false,
      "startBinding": {"elementId": "api", "focus": 0, "gap": 5, "fixedPoint": null},
      "endBinding": {"elementId": "db", "focus": 0, "gap": 5, "fixedPoint": null},
      "startArrowhead": null,
      "endArrowhead": "arrow",
      "elbowed": false
    }
  ],
  "appState": {
    "gridSize": 20,
    "viewBackgroundColor": "#ffffff"
  },
  "files": {}
}
```

## Tips for AI Generation

1. **Always include all common properties** on every element — Excalidraw may reject partial elements
2. **Bound text**: Both the shape and text must cross-reference each other (`boundElements` ↔ `containerId`)
3. **Arrow bindings**: Both the arrow and the connected shapes must reference each other
4. **Use `roughness: 1`** for the classic hand-drawn look, `0` for clean/sharp
5. **Seed values**: Generate unique random integers for each element
6. **Position text carefully** — when text is bound to a container, its x/y should be roughly centered within the container
7. **Use frames** for logical grouping (VPCs, regions, namespaces)
8. **No cloud-specific icons** — Excalidraw doesn't have built-in cloud provider shapes. Use colored rectangles/ellipses with descriptive labels instead. This is the main reason Draw.io is preferred for cloud architecture diagrams.
