"use client";

import cytoscape, { type Core, type ElementDefinition, type LayoutOptions } from "cytoscape";
import fcose from "cytoscape-fcose";
import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

cytoscape.use(fcose);

type GraphNode = {
  id: string;
  label: string;
  node_type: string;
  slug: string;
  source_page_id?: string | null;
  source_path?: string | null;
  synthetic?: boolean;
};

type GraphEdge = {
  from_node_id: string;
  id: string;
  relation: string;
  synthetic?: boolean;
  to_node_id: string;
  weight: number;
};

type KnowledgeGraphProps = {
  edges: GraphEdge[];
  highlightPath?: string | null;
  nodes: GraphNode[];
  projectId?: string | null;
  rootLabel?: string | null;
};

const ROOT_NODE_ID = "__wiki-intent-root__";

function nodeColor(type: string) {
  if (type === "intent") {
    return "#111827";
  }

  if (type === "page") {
    return "#00a7ff";
  }

  if (type === "tag") {
    return "#00c48c";
  }

  if (type === "owner" || type === "person") {
    return "#ff8a3d";
  }

  if (type === "decision") {
    return "#f43f5e";
  }

  if (type === "source") {
    return "#6366f1";
  }

  return "#8b5cf6";
}

function linkColor(relation: string, synthetic?: boolean) {
  if (synthetic) {
    return "rgba(17, 24, 39, 0.62)";
  }

  if (relation === "depends_on") {
    return "rgba(244, 63, 94, 0.72)";
  }

  if (relation === "owned_by") {
    return "rgba(255, 138, 61, 0.72)";
  }

  if (relation === "source_for") {
    return "rgba(99, 102, 241, 0.72)";
  }

  if (relation === "decision_from") {
    return "rgba(220, 38, 38, 0.72)";
  }

  if (relation === "mentions") {
    return "rgba(0, 167, 255, 0.52)";
  }

  return "rgba(100, 116, 139, 0.48)";
}

function truncateLabel(value: string) {
  return value.length > 42 ? `${value.slice(0, 39)}...` : value;
}

function validEdges(nodes: GraphNode[], edges: GraphEdge[]) {
  const nodeIds = new Set(nodes.map((node) => node.id));

  return edges.filter((edge) => nodeIds.has(edge.from_node_id) && nodeIds.has(edge.to_node_id));
}

function connectedComponents(nodes: GraphNode[], edges: GraphEdge[]) {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const adjacency = new Map<string, Set<string>>();

  for (const node of nodes) {
    adjacency.set(node.id, new Set());
  }

  for (const edge of edges) {
    if (!nodeIds.has(edge.from_node_id) || !nodeIds.has(edge.to_node_id)) {
      continue;
    }

    adjacency.get(edge.from_node_id)?.add(edge.to_node_id);
    adjacency.get(edge.to_node_id)?.add(edge.from_node_id);
  }

  const components: GraphNode[][] = [];
  const visited = new Set<string>();

  for (const node of nodes) {
    if (visited.has(node.id)) {
      continue;
    }

    const stack = [node.id];
    const component: GraphNode[] = [];
    visited.add(node.id);

    while (stack.length > 0) {
      const currentId = stack.pop();

      if (!currentId) {
        continue;
      }

      const currentNode = nodesById.get(currentId);

      if (currentNode) {
        component.push(currentNode);
      }

      for (const neighborId of adjacency.get(currentId) ?? []) {
        if (!visited.has(neighborId)) {
          visited.add(neighborId);
          stack.push(neighborId);
        }
      }
    }

    components.push(component);
  }

  return components.sort((left, right) => right.length - left.length);
}

function degreeMap(edges: GraphEdge[]) {
  const degree = new Map<string, number>();

  for (const edge of edges) {
    degree.set(edge.from_node_id, (degree.get(edge.from_node_id) ?? 0) + 1);
    degree.set(edge.to_node_id, (degree.get(edge.to_node_id) ?? 0) + 1);
  }

  return degree;
}

function representativeNode(nodes: GraphNode[], edges: GraphEdge[]) {
  const degrees = degreeMap(edges);

  return [...nodes].sort((left, right) => {
    const degreeDelta = (degrees.get(right.id) ?? 0) - (degrees.get(left.id) ?? 0);

    if (degreeDelta !== 0) {
      return degreeDelta;
    }

    if (left.node_type === "page" && right.node_type !== "page") {
      return -1;
    }

    if (right.node_type === "page" && left.node_type !== "page") {
      return 1;
    }

    return left.label.localeCompare(right.label);
  })[0] ?? nodes[0];
}

function buildConnectedGraph(nodes: GraphNode[], edges: GraphEdge[], rootLabel?: string | null) {
  const directEdges = validEdges(nodes, edges);
  const baseComponents = connectedComponents(nodes, directEdges);

  if (!rootLabel || nodes.length === 0) {
    return {
      componentCount: baseComponents.length,
      directEdgeCount: directEdges.length,
      edges: directEdges,
      nodes,
      rawComponents: baseComponents,
      syntheticEdgeCount: 0
    };
  }

  const rootNode: GraphNode = {
    id: ROOT_NODE_ID,
    label: rootLabel,
    node_type: "intent",
    slug: "wiki-intent-root",
    synthetic: true
  };
  const bridgeEdges: GraphEdge[] = [];

  baseComponents.forEach((component, index) => {
    const node = representativeNode(component, directEdges);

    if (node) {
      bridgeEdges.push({
        from_node_id: ROOT_NODE_ID,
        id: `${ROOT_NODE_ID}:${node.id}:${index}`,
        relation: "intent_scope",
        synthetic: true,
        to_node_id: node.id,
        weight: 1
      });
    }
  });

  return {
    componentCount: baseComponents.length,
    directEdgeCount: directEdges.length,
    edges: [...directEdges, ...bridgeEdges],
    nodes: [rootNode, ...nodes],
    rawComponents: baseComponents,
    syntheticEdgeCount: bridgeEdges.length
  };
}

function relationLabel(relation: string, synthetic?: boolean) {
  if (synthetic || relation === "links_to" || relation === "tagged") {
    return "";
  }

  return relation.replace(/_/g, " ");
}

function nodeWidth(label: string, isRoot: boolean) {
  const base = isRoot ? 190 : 130;
  return Math.min(isRoot ? 280 : 220, Math.max(base, label.length * (isRoot ? 7 : 6)));
}

function buildElements(
  nodes: GraphNode[],
  edges: GraphEdge[],
  rootLabel?: string | null,
  highlightPath?: string | null
) {
  const graph = buildConnectedGraph(nodes, edges, rootLabel);
  const degrees = degreeMap(graph.edges);
  const componentByNodeId = new Map<string, string>();
  const elements: ElementDefinition[] = [];

  if (rootLabel && graph.rawComponents.length > 1) {
    graph.rawComponents.forEach((component, index) => {
      const parentId = `cluster-${index}`;

      elements.push({
        classes: "cluster-shell",
        data: {
          id: parentId,
          label: `Cluster ${index + 1}`
        }
      });

      component.forEach((node) => {
        componentByNodeId.set(node.id, parentId);
      });
    });
  }

  for (const node of graph.nodes) {
    const isRoot = node.id === ROOT_NODE_ID;
    const degree = degrees.get(node.id) ?? 0;

    elements.push({
      classes: [
        node.node_type,
        isRoot ? "intent-root" : "",
        node.synthetic ? "synthetic-node" : "",
        !isRoot && node.source_page_id && highlightPath && node.source_path === highlightPath ? "highlighted-node" : ""
      ]
        .filter(Boolean)
        .join(" "),
      data: {
        color: nodeColor(node.node_type),
        degree,
        id: node.id,
        label: truncateLabel(node.label),
        parent: isRoot ? undefined : componentByNodeId.get(node.id),
        searchText: isRoot
          ? ""
          : [node.label, node.slug, node.node_type, node.source_path]
              .filter(Boolean)
              .join(" ")
              .toLowerCase(),
        size: isRoot ? Math.max(86, 66 + degree * 2) : Math.max(44, Math.min(76, 42 + degree * 3)),
        sourcePath: isRoot ? undefined : node.source_path,
        width: nodeWidth(node.label, isRoot)
      }
    });
  }

  for (const edge of graph.edges) {
    const color = linkColor(edge.relation, edge.synthetic);
    const directed = edge.relation !== "related_to" && edge.relation !== "intent_scope";

    elements.push({
      classes: [
        edge.synthetic ? "synthetic-edge" : "",
        directed ? "directed-edge" : "",
        edge.relation
      ]
        .filter(Boolean)
        .join(" "),
      data: {
        color,
        id: edge.id,
        label: relationLabel(edge.relation, edge.synthetic),
        source: edge.from_node_id,
        target: edge.to_node_id,
        weight: edge.synthetic ? 1.5 : Math.max(1.4, Math.min(4.2, edge.weight + 0.6))
      }
    });
  }

  return {
    componentCount: graph.componentCount,
    directEdgeCount: graph.directEdgeCount,
    elements
  };
}

function graphStylesheet() {
  return [
    {
      selector: "node",
      style: {
        "background-color": "data(color)",
        "border-color": "rgba(255,255,255,0.86)",
        "border-width": 2,
        color: "#f8fafc",
        content: "data(label)",
        "font-family": "inherit",
        "font-size": 11,
        "font-weight": 700,
        height: "data(size)",
        "label-wrap": "wrap",
        "padding-bottom": 8,
        "padding-left": 10,
        "padding-right": 10,
        "padding-top": 8,
        "shadow-blur": 18,
        "shadow-color": "rgba(15, 23, 42, 0.16)",
        "shadow-offset-x": 0,
        "shadow-offset-y": 10,
        "shadow-opacity": 1,
        "text-background-opacity": 0,
        "text-background-padding": 0,
        "text-background-shape": "roundrectangle",
        "text-halign": "center",
        "text-max-width": 140,
        "text-outline-color": "data(color)",
        "text-outline-opacity": 0.72,
        "text-outline-width": 2,
        "text-valign": "center",
        width: "data(width)"
      }
    },
    {
      selector: "node.intent-root",
      style: {
        color: "#f8fafc",
        "font-size": 14,
        "font-weight": 900,
        "shape": "round-rectangle",
        "text-background-color": "rgba(15,23,42,0.88)",
        "text-background-padding": 7
      }
    },
    {
      selector: "node.highlighted-node",
      style: {
        "background-color": "#ef4444",
        "border-color": "#fff7ed",
        "border-width": 4,
        "shadow-blur": 28,
        "shadow-color": "rgba(239, 68, 68, 0.55)",
        "shadow-offset-y": 12,
        "text-outline-color": "#ef4444",
        "text-outline-opacity": 0.88
      }
    },
    {
      selector: "node.search-match-node",
      style: {
        "border-color": "#facc15",
        "border-width": 4,
        "shadow-blur": 24,
        "shadow-color": "rgba(250, 204, 21, 0.58)",
        "shadow-offset-y": 12
      }
    },
    {
      selector: "node.search-active-node",
      style: {
        "background-color": "#f59e0b",
        "border-color": "#0f172a",
        "border-width": 5,
        "shadow-blur": 32,
        "shadow-color": "rgba(245, 158, 11, 0.68)",
        "text-outline-color": "#f59e0b",
        "text-outline-opacity": 0.9
      }
    },
    {
      selector: "node.cluster-shell",
      style: {
        "background-opacity": 0,
        "border-opacity": 0,
        "border-style": "dashed",
        "border-width": 0,
        color: "rgba(71,85,105,0.72)",
        content: "",
        padding: 32,
        "shape": "round-rectangle",
        "text-opacity": 0
      }
    },
    {
      selector: "edge",
      style: {
        "arrow-scale": 0.9,
        "curve-style": "bezier",
        "font-family": "inherit",
        "font-size": 10,
        "font-weight": 700,
        label: "data(label)",
        "line-color": "data(color)",
        "target-arrow-color": "data(color)",
        "target-arrow-shape": "triangle",
        "text-background-color": "rgba(255,255,255,0.9)",
        "text-background-opacity": 1,
        "text-background-padding": 3,
        "text-background-shape": "roundrectangle",
        "text-rotation": "autorotate",
        "text-wrap": "wrap",
        "text-max-width": 120,
        width: "data(weight)"
      }
    },
    {
      selector: "edge.synthetic-edge",
      style: {
        "line-style": "dashed",
        label: ""
      }
    },
    {
      selector: "edge:not(.directed-edge)",
      style: {
        "target-arrow-shape": "none"
      }
    }
  ] as unknown as cytoscape.StylesheetJson;
}

function graphLayout(runCount: number) {
  return {
    animate: false,
    fit: true,
    gravity: 0.28,
    gravityCompound: 0.2,
    gravityRangeCompound: 1.2,
    idealEdgeLength(edge: cytoscape.EdgeSingular) {
      return edge.hasClass("synthetic-edge") ? 220 : 110;
    },
    initialEnergyOnIncremental: 0.4,
    name: "fcose",
    nestingFactor: 0.95,
    nodeRepulsion(node: cytoscape.NodeSingular) {
      return node.hasClass("intent-root") ? 180000 : 95000;
    },
    numIter: runCount === 0 ? 2800 : 1800,
    padding: 36,
    quality: "default",
    randomize: runCount === 0,
    tile: true
  };
}

function wikiPageHref(projectId: string, sourcePath: string) {
  const params = new URLSearchParams({
    path: sourcePath,
    projectId
  });

  return `/dashboard/wiki?${params.toString()}`;
}

function normalizedSearch(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function searchNodeIds(nodes: GraphNode[], value: string) {
  const query = normalizedSearch(value);

  if (!query) {
    return [];
  }

  return nodes
    .filter((node) =>
      [node.label, node.slug, node.node_type, node.source_path]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query)
    )
    .map((node) => node.id);
}

export function KnowledgeGraph({ edges, highlightPath, nodes, projectId, rootLabel }: KnowledgeGraphProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<Core | null>(null);
  const [activeSearchIndex, setActiveSearchIndex] = useState(0);
  const [runCount, setRunCount] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const graph = useMemo(() => buildElements(nodes, edges, rootLabel, highlightPath), [edges, highlightPath, nodes, rootLabel]);
  const searchMatches = useMemo(() => searchNodeIds(nodes, searchQuery), [nodes, searchQuery]);
  const trimmedSearchQuery = searchQuery.trim();

  function focusNodeById(nodeId: string) {
    const instance = cyRef.current;
    const node = instance?.getElementById(nodeId);

    if (!instance || !node || node.length === 0) {
      return;
    }

    instance.animate({
      center: {
        eles: node
      },
      duration: 220,
      fit: {
        eles: node.closedNeighborhood(),
        padding: 110
      }
    });
  }

  function moveSearch(delta: number) {
    if (searchMatches.length === 0) {
      return;
    }

    setActiveSearchIndex((current) => {
      const nextIndex = (current + delta + searchMatches.length) % searchMatches.length;
      focusNodeById(searchMatches[nextIndex]);
      return nextIndex;
    });
  }

  useEffect(() => {
    if (!containerRef.current || nodes.length === 0) {
      return;
    }

    const instance = cytoscape({
      container: containerRef.current,
      elements: graph.elements,
      layout: graphLayout(runCount) as LayoutOptions,
      maxZoom: 2.1,
      minZoom: 0.2,
      motionBlur: true,
      selectionType: "single",
      style: graphStylesheet(),
      userPanningEnabled: true,
      userZoomingEnabled: true,
      wheelSensitivity: 0.22
    });

    instance.on("mouseover", "node", (event) => {
      if (event.target.data("sourcePath")) {
        containerRef.current?.style.setProperty("cursor", "pointer");
      }
    });

    instance.on("mouseout", "node", () => {
      containerRef.current?.style.removeProperty("cursor");
    });

    instance.on("tap", "node", (event) => {
      const tappedNode = event.target;
      const sourcePath = tappedNode.data("sourcePath") as string | undefined;

      if (projectId && sourcePath) {
        window.location.assign(wikiPageHref(projectId, sourcePath));
        return;
      }

      instance.animate({
        center: {
          eles: tappedNode
        },
        duration: 260,
        fit: {
          eles: tappedNode.closedNeighborhood(),
          padding: 90
        }
      });
    });

    const focusHighlightedNode = () => {
      const highlightedNodes = instance.nodes(".highlighted-node");

      if (highlightedNodes.length === 0) {
        return;
      }

      instance.animate({
        center: {
          eles: highlightedNodes.first()
        },
        duration: 280,
        fit: {
          eles: highlightedNodes.first().closedNeighborhood(),
          padding: 110
        }
      });
    };

    instance.one("layoutstop", focusHighlightedNode);
    const highlightTimeout = window.setTimeout(focusHighlightedNode, 120);

    cyRef.current = instance;

    return () => {
      window.clearTimeout(highlightTimeout);
      cyRef.current?.destroy();
      cyRef.current = null;
    };
  }, [graph.elements, highlightPath, nodes.length, projectId, runCount]);

  useEffect(() => {
    setActiveSearchIndex(0);
  }, [trimmedSearchQuery]);

  useEffect(() => {
    const instance = cyRef.current;

    if (!instance) {
      return;
    }

    instance.nodes().removeClass("search-match-node search-active-node");

    if (!trimmedSearchQuery || searchMatches.length === 0) {
      return;
    }

    for (const nodeId of searchMatches) {
      instance.getElementById(nodeId).addClass("search-match-node");
    }

    const activeNodeId = searchMatches[Math.min(activeSearchIndex, searchMatches.length - 1)];

    if (activeNodeId) {
      instance.getElementById(activeNodeId).addClass("search-active-node");
      focusNodeById(activeNodeId);
    }
  }, [activeSearchIndex, searchMatches, trimmedSearchQuery]);

  if (nodes.length === 0) {
    return (
      <div className="empty-state">
        No graph nodes indexed yet. Open the Nth Brain and run Generate knowledge graph.
      </div>
    );
  }

  return (
    <div className="knowledge-graph-shell knowledge-graph-shell--cytoscape">
      <div className="graph-controls-panel graph-controls-panel--cytoscape">
        <strong>{nodes.length} nodes</strong>
        <span>
          {graph.directEdgeCount} semantic links. {graph.componentCount} cluster{graph.componentCount === 1 ? "" : "s"} tied to the Nth Brain intent.
        </span>
        <label className="graph-search-field">
          <Search size={14} strokeWidth={1.9} />
          <input
            onChange={(event) => {
              setSearchQuery(event.target.value);
            }}
            placeholder="Search markdown graph..."
            type="search"
            value={searchQuery}
          />
          {searchQuery ? (
            <button
              aria-label="Clear graph search"
              className="graph-search-clear"
              onClick={() => {
                setSearchQuery("");
              }}
              type="button"
            >
              <X size={13} strokeWidth={2} />
            </button>
          ) : null}
        </label>
        <div className="graph-search-status" aria-live="polite">
          {trimmedSearchQuery ? (
            searchMatches.length > 0 ? (
              <span>
                {Math.min(activeSearchIndex + 1, searchMatches.length)} of {searchMatches.length} matches
              </span>
            ) : (
              <span>No matches</span>
            )
          ) : (
            <span>Search indexed markdown nodes and file paths</span>
          )}
          <div className="graph-search-nav">
            <button
              aria-label="Previous graph search result"
              disabled={searchMatches.length === 0}
              onClick={() => moveSearch(-1)}
              type="button"
            >
              <ChevronLeft size={14} strokeWidth={2} />
            </button>
            <button
              aria-label="Next graph search result"
              disabled={searchMatches.length === 0}
              onClick={() => moveSearch(1)}
              type="button"
            >
              <ChevronRight size={14} strokeWidth={2} />
            </button>
          </div>
        </div>
        <div className="graph-controls-panel__actions">
          <button
            onClick={() => {
              cyRef.current?.fit(undefined, 48);
            }}
            type="button"
          >
            Fit view
          </button>
          <button
            onClick={() => {
              setRunCount((current) => current + 1);
            }}
            type="button"
          >
            Re-run layout
          </button>
        </div>
      </div>
      <div className="knowledge-graph-cytoscape" ref={containerRef} />
    </div>
  );
}
