# Draw.io (.drawio) Format Reference

## File Structure

A `.drawio` file is XML. AI should generate **uncompressed XML only**.

### Minimal Valid File

```xml
<mxGraphModel>
  <root>
    <mxCell id="0"/>
    <mxCell id="1" parent="0"/>
    <!-- your elements here -->
  </root>
</mxGraphModel>
```

> **Tip:** You can skip the `<mxfile>` and `<diagram>` wrappers. Draw.io auto-wraps bare `<mxGraphModel>` on open. Use the simplified format unless multi-page support is needed.

### Full Format (multi-page capable)

```xml
<mxfile>
  <diagram id="page-1" name="Page-1">
    <mxGraphModel dx="1326" dy="783" grid="1" gridSize="10" guides="1"
                  tooltips="1" connect="1" arrows="1" fold="1"
                  page="1" pageScale="1" pageWidth="1100" pageHeight="850"
                  math="0" shadow="0">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
        <!-- elements -->
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
```

## Critical Rules

1. **Two mandatory structural cells** at the start of `<root>`:
   - `<mxCell id="0"/>` — root container, NO parent
   - `<mxCell id="1" parent="0"/>` — default layer
2. **All elements** must have `parent="1"` (or parent of a group container)
3. **IDs must be unique** — use descriptive strings like `"vpc-1"`, `"ec2-web"`, `"edge-1"`
4. **Vertices** need `vertex="1"`, **edges** need `edge="1"` — mutually exclusive
5. **Edges** should have `source` and `target` attributes referencing vertex IDs
6. **Coordinates**: (0,0) = top-left, x→right, y→down
7. **Style strings**: `key=value;` separated by semicolons, ending with `;`
8. **HTML in value** must be XML-escaped: `&lt;`, `&gt;`, `&amp;`, `&quot;`

## Vertices (Shapes/Nodes)

```xml
<mxCell id="node-1" value="Web Server" 
        style="rounded=1;whiteSpace=wrap;html=1;fillColor=#DAE8FC;strokeColor=#6C8EBF;" 
        vertex="1" parent="1">
  <mxGeometry x="100" y="100" width="120" height="60" as="geometry"/>
</mxCell>
```

### Key Style Properties

| Property | Values | Description |
|---|---|---|
| `shape` | `rectangle`, `ellipse`, `rhombus`, `cylinder`, `cloud`, `hexagon`, `swimlane`, `mxgraph.*` | Shape type |
| `rounded` | `0`, `1` | Round corners |
| `whiteSpace` | `wrap` | Enable text wrapping |
| `html` | `1` | Enable HTML labels |
| `fillColor` | `#RRGGBB` or `none` | Background fill |
| `strokeColor` | `#RRGGBB` or `none` | Border color |
| `fontColor` | `#RRGGBB` | Text color |
| `fontSize` | number | Font size in pt |
| `fontStyle` | `0`=normal, `1`=bold, `2`=italic, `3`=bold+italic | Font style |
| `opacity` | `0`-`100` | Transparency |
| `shadow` | `0`, `1` | Drop shadow |
| `aspect` | `fixed` | Lock aspect ratio (circle = ellipse+fixed) |
| `verticalAlign` | `top`, `middle`, `bottom` | Vertical text alignment |
| `align` | `left`, `center`, `right` | Horizontal text alignment |

## Edges (Connectors)

```xml
<mxCell id="edge-1" value="HTTPS" 
        style="edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jetSize=auto;html=1;strokeColor=#666666;" 
        edge="1" source="node-1" target="node-2" parent="1">
  <mxGeometry relative="1" as="geometry"/>
</mxCell>
```

### Edge Styles

| Style | Result |
|---|---|
| `edgeStyle=orthogonalEdgeStyle;rounded=1;` | Rounded right-angle connectors (recommended default) |
| `edgeStyle=orthogonalEdgeStyle;curved=1;` | Curved orthogonal |
| `edgeStyle=entityRelationEdgeStyle;` | ER-style |
| `edgeStyle=elbowEdgeStyle;` | Elbow connectors |
| *(no edgeStyle)* | Straight line |

### Arrow Markers

| Property | Values |
|---|---|
| `endArrow` | `classic`, `block`, `open`, `oval`, `diamond`, `diamondThin`, `none` |
| `startArrow` | same as endArrow |
| `endFill` | `0` (outline), `1` (filled) |
| `startFill` | `0` (outline), `1` (filled) |
| `dashed` | `0`, `1` |
| `dashPattern` | e.g., `8 8` |

## Containers (Groups / Boundaries)

Use containers for VPCs, subnets, regions, resource groups, etc.:

```xml
<!-- Container (group boundary) -->
<mxCell id="vpc-1" value="VPC 10.0.0.0/16" 
        style="swimlane;startSize=30;fillColor=#E6F2FF;strokeColor=#6C8EBF;rounded=1;arcSize=8;fontStyle=1;fontSize=13;" 
        vertex="1" parent="1">
  <mxGeometry x="50" y="50" width="500" height="400" as="geometry"/>
</mxCell>

<!-- Child element inside container — note parent="vpc-1" -->
<mxCell id="ec2-1" value="EC2 Instance" 
        style="shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.ec2;..." 
        vertex="1" parent="vpc-1">
  <!-- Coordinates are RELATIVE to parent container -->
  <mxGeometry x="30" y="50" width="60" height="60" as="geometry"/>
</mxCell>
```

**Key rule**: Children use coordinates **relative to the parent container**, not the canvas.

## Cloud Provider Shape Libraries

### AWS (prefix: `mxgraph.aws4.`)

Common shapes:
```
shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.ec2;
shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.lambda;
shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.s3;
shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.rds;
shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.cloudfront;
shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.api_gateway;
shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.elb;
shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.sqs;
shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.sns;
shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.dynamodb;
shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.ecs;
shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.eks;
shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.cognito;
shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.route_53;
shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.vpc;
shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.iam;
shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.cloudwatch;
shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.eventbridge;
```

AWS group containers:
```
shape=mxgraph.aws4.group;grIcon=mxgraph.aws4.group_vpc;
shape=mxgraph.aws4.group;grIcon=mxgraph.aws4.group_region;
shape=mxgraph.aws4.group;grIcon=mxgraph.aws4.group_availability_zone;
shape=mxgraph.aws4.group;grIcon=mxgraph.aws4.group_subnet;
shape=mxgraph.aws4.group;grIcon=mxgraph.aws4.group_security_group;
shape=mxgraph.aws4.group;grIcon=mxgraph.aws4.group_aws_cloud;
```

Typical AWS icon style (use consistently):
```
style="shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.ec2;labelBackgroundColor=none;sketch=0;fontColor=#232F3E;fontSize=11;verticalLabelPosition=bottom;verticalAlign=top;align=center;"
```

**Icon size**: Use `width="60" height="60"` for resource icons.

### Azure (prefix: `mxgraph.azure.`)

Common shapes:
```
shape=mxgraph.azure.virtual_machine;
shape=mxgraph.azure.app_service;
shape=mxgraph.azure.azure_sql_database;
shape=mxgraph.azure.storage_blob;
shape=mxgraph.azure.azure_functions;
shape=mxgraph.azure.virtual_network;
shape=mxgraph.azure.load_balancer;
shape=mxgraph.azure.key_vault;
shape=mxgraph.azure.azure_active_directory;
shape=mxgraph.azure.api_management;
shape=mxgraph.azure.azure_cosmos_db;
shape=mxgraph.azure.application_gateway;
shape=mxgraph.azure.azure_kubernetes_service;
shape=mxgraph.azure.container_instances;
shape=mxgraph.azure.azure_devops;
shape=mxgraph.azure.monitor;
```

### GCP (prefix: `mxgraph.gcp2.`)

Common shapes:
```
shape=mxgraph.gcp2.compute_engine;
shape=mxgraph.gcp2.cloud_run;
shape=mxgraph.gcp2.cloud_functions;
shape=mxgraph.gcp2.cloud_storage;
shape=mxgraph.gcp2.cloud_sql;
shape=mxgraph.gcp2.bigquery;
shape=mxgraph.gcp2.pub_sub;
shape=mxgraph.gcp2.cloud_load_balancing;
shape=mxgraph.gcp2.cloud_cdn;
shape=mxgraph.gcp2.cloud_dns;
shape=mxgraph.gcp2.gke;
shape=mxgraph.gcp2.cloud_firestore;
shape=mxgraph.gcp2.cloud_iam;
shape=mxgraph.gcp2.cloud_armor;
```

### Kubernetes (prefix: `mxgraph.kubernetes.`)

```
shape=mxgraph.kubernetes.pod;
shape=mxgraph.kubernetes.service;
shape=mxgraph.kubernetes.deployment;
shape=mxgraph.kubernetes.node;
shape=mxgraph.kubernetes.ingress;
shape=mxgraph.kubernetes.namespace;
shape=mxgraph.kubernetes.configmap;
shape=mxgraph.kubernetes.secret;
shape=mxgraph.kubernetes.persistent_volume;
shape=mxgraph.kubernetes.stateful_set;
shape=mxgraph.kubernetes.daemon_set;
shape=mxgraph.kubernetes.cronjob;
```

## Color Palettes

### Recommended diagram colors (draw.io defaults)

| Purpose | Fill | Stroke |
|---|---|---|
| Blue (compute/default) | `#DAE8FC` | `#6C8EBF` |
| Green (storage/data) | `#D5E8D4` | `#82B366` |
| Orange (networking/API) | `#FFE6CC` | `#D6B656` |
| Red (security/alerts) | `#F8CECC` | `#B85450` |
| Purple (AI/ML/analytics) | `#E1D5E7` | `#9673A6` |
| Yellow (warning/decisions) | `#FFF2CC` | `#D6B656` |
| Gray (infrastructure) | `#F5F5F5` | `#666666` |

### AWS official colors
| Element | Color |
|---|---|
| AWS Cloud boundary | `#232F3E` |
| AWS orange (services) | `#FF9900` |
| Compute | `#ED7100` |
| Storage | `#3F8624` |
| Database | `#3B48CC` |
| Networking | `#8C4FFF` |
| Security | `#DD344C` |

## Complete Example: Simple Web App Architecture

```xml
<mxGraphModel>
  <root>
    <mxCell id="0"/>
    <mxCell id="1" parent="0"/>
    
    <!-- Users -->
    <mxCell id="users" value="Users" 
            style="shape=mxgraph.aws4.users;sketch=0;fontColor=#232F3E;fontSize=11;verticalLabelPosition=bottom;verticalAlign=top;align=center;" 
            vertex="1" parent="1">
      <mxGeometry x="50" y="160" width="60" height="60" as="geometry"/>
    </mxCell>
    
    <!-- CloudFront -->
    <mxCell id="cf" value="CloudFront" 
            style="shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.cloudfront;sketch=0;labelBackgroundColor=none;fontColor=#232F3E;fontSize=11;verticalLabelPosition=bottom;verticalAlign=top;align=center;" 
            vertex="1" parent="1">
      <mxGeometry x="220" y="160" width="60" height="60" as="geometry"/>
    </mxCell>
    
    <!-- ALB -->
    <mxCell id="alb" value="ALB" 
            style="shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.elb;sketch=0;labelBackgroundColor=none;fontColor=#232F3E;fontSize=11;verticalLabelPosition=bottom;verticalAlign=top;align=center;" 
            vertex="1" parent="1">
      <mxGeometry x="390" y="160" width="60" height="60" as="geometry"/>
    </mxCell>
    
    <!-- ECS -->
    <mxCell id="ecs" value="ECS Fargate" 
            style="shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.ecs;sketch=0;labelBackgroundColor=none;fontColor=#232F3E;fontSize=11;verticalLabelPosition=bottom;verticalAlign=top;align=center;" 
            vertex="1" parent="1">
      <mxGeometry x="560" y="160" width="60" height="60" as="geometry"/>
    </mxCell>
    
    <!-- RDS -->
    <mxCell id="rds" value="RDS PostgreSQL" 
            style="shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.rds;sketch=0;labelBackgroundColor=none;fontColor=#232F3E;fontSize=11;verticalLabelPosition=bottom;verticalAlign=top;align=center;" 
            vertex="1" parent="1">
      <mxGeometry x="730" y="100" width="60" height="60" as="geometry"/>
    </mxCell>
    
    <!-- S3 -->
    <mxCell id="s3" value="S3 Bucket" 
            style="shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.s3;sketch=0;labelBackgroundColor=none;fontColor=#232F3E;fontSize=11;verticalLabelPosition=bottom;verticalAlign=top;align=center;" 
            vertex="1" parent="1">
      <mxGeometry x="730" y="230" width="60" height="60" as="geometry"/>
    </mxCell>
    
    <!-- Edges -->
    <mxCell id="e1" style="edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;strokeColor=#666666;" 
            edge="1" source="users" target="cf" parent="1">
      <mxGeometry relative="1" as="geometry"/>
    </mxCell>
    <mxCell id="e2" value="HTTPS" 
            style="edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;strokeColor=#666666;fontSize=10;" 
            edge="1" source="cf" target="alb" parent="1">
      <mxGeometry relative="1" as="geometry"/>
    </mxCell>
    <mxCell id="e3" style="edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;strokeColor=#666666;" 
            edge="1" source="alb" target="ecs" parent="1">
      <mxGeometry relative="1" as="geometry"/>
    </mxCell>
    <mxCell id="e4" value="SQL" 
            style="edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;strokeColor=#666666;fontSize=10;" 
            edge="1" source="ecs" target="rds" parent="1">
      <mxGeometry relative="1" as="geometry"/>
    </mxCell>
    <mxCell id="e5" value="Objects" 
            style="edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;strokeColor=#666666;fontSize=10;" 
            edge="1" source="ecs" target="s3" parent="1">
      <mxGeometry relative="1" as="geometry"/>
    </mxCell>
  </root>
</mxGraphModel>
```

## Validation Checklist

Before delivering a `.drawio` file, verify:

- [ ] Well-formed XML (parseable)
- [ ] `<mxCell id="0"/>` and `<mxCell id="1" parent="0"/>` present
- [ ] All IDs unique
- [ ] Every vertex has `vertex="1"`, every edge has `edge="1"`
- [ ] Edge `source` and `target` reference existing vertex IDs
- [ ] All non-root cells have valid `parent` reference
- [ ] Style strings use `key=value;` format
- [ ] No compressed/Base64 content
- [ ] Cloud icons use explicit `width`/`height` (typically 50-60px)
- [ ] HTML in `value` attributes is XML-escaped
