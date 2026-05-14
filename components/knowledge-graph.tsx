"use client";

import {
  Cosmograph,
  prepareCosmographData,
  type CosmographConfig,
  type CosmographRef
} from "@cosmograph/react";
import { useEffect, useMemo, useRef, useState } from "react";

type GraphNode = {
  id: string;
  label: string;
  node_type: string;
  slug: string;
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
  nodes: GraphNode[];
  rootLabel?: string | null;
};

type CosmoPoint = {
  color: string;
  degree: number;
  id: string;
  label: string;
  labelWeight: number;
  type: string;
};

type CosmoLink = {
  color: string;
  directed: boolean;
  relation: string;
  source: string;
  target: string;
  weight: number;
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
  const components = connectedComponents(nodes, directEdges);

  if (!rootLabel || nodes.length === 0) {
    return {
      componentCount: components.length,
      directEdgeCount: directEdges.length,
      edges: directEdges,
      nodes,
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

  components.forEach((component, index) => {
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
    componentCount: components.length,
    directEdgeCount: directEdges.length,
    edges: [...directEdges, ...bridgeEdges],
    nodes: [rootNode, ...nodes],
    syntheticEdgeCount: bridgeEdges.length
  };
}

function toCosmographData(nodes: GraphNode[], edges: GraphEdge[]) {
  const degrees = degreeMap(edges);
  const points: CosmoPoint[] = nodes.map((node) => {
    const degree = degrees.get(node.id) ?? 0;
    const isRoot = node.id === ROOT_NODE_ID;

    return {
      color: nodeColor(node.node_type),
      degree: isRoot ? Math.max(12, degree) : Math.max(1, degree),
      id: node.id,
      label: truncateLabel(node.label),
      labelWeight: isRoot ? 1 : Math.min(1, 0.28 + degree * 0.08),
      type: node.node_type
    };
  });
  const links: CosmoLink[] = edges.map((edge) => ({
    color: linkColor(edge.relation, edge.synthetic),
    directed: edge.relation !== "related_to" && edge.relation !== "intent_scope",
    relation: edge.relation,
    source: edge.from_node_id,
    target: edge.to_node_id,
    weight: edge.synthetic ? 1.4 : Math.min(5, Math.max(1, Number(edge.weight) || 1))
  }));

  return { links, points };
}

function hasPreparedRows(value: unknown) {
  if (!value) {
    return false;
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  if (typeof value === "object" && "numRows" in value) {
    return Number((value as { numRows?: unknown }).numRows) > 0;
  }

  return true;
}

export function KnowledgeGraph({ edges, nodes, rootLabel }: KnowledgeGraphProps) {
  const cosmographRef = useRef<CosmographRef>(undefined);
  const [config, setConfig] = useState<CosmographConfig | null>(null);
  const [loadError, setLoadError] = useState("");
  const [isPaused, setIsPaused] = useState(false);
  const graph = useMemo(() => buildConnectedGraph(nodes, edges, rootLabel), [edges, nodes, rootLabel]);
  const data = useMemo(() => toCosmographData(graph.nodes, graph.edges), [graph.edges, graph.nodes]);

  useEffect(() => {
    let isCancelled = false;

    async function prepareGraph() {
      setLoadError("");

      if (data.points.length === 0) {
        setConfig(null);
        return;
      }

      try {
        const result = await prepareCosmographData(
          {
            links: {
              linkColorBy: "color",
              linkIncludeColumns: ["relation", "directed"],
              linkSourceBy: "source",
              linkTargetsBy: ["target"],
              linkWidthBy: "weight"
            },
            points: {
              pointClusterBy: "type",
              pointColorBy: "color",
              pointIdBy: "id",
              pointIncludeColumns: ["label", "type", "degree", "labelWeight"],
              pointLabelBy: "label",
              pointLabelWeightBy: "labelWeight",
              pointSizeBy: "degree"
            }
          },
          data.points,
          data.links
        );

        if (!isCancelled && result?.points && hasPreparedRows(result.points)) {
          setConfig({
            ...result.cosmographConfig,
            links: result.links,
            points: result.points
          });
        } else if (!isCancelled) {
          setConfig(null);
          setLoadError("No graph points were prepared. Run Generate knowledge graph for this wiki.");
        }
      } catch (error) {
        if (!isCancelled) {
          setLoadError(error instanceof Error ? error.message : "Graph could not be prepared.");
        }
      }
    }

    prepareGraph();

    return () => {
      isCancelled = true;
    };
  }, [data.links, data.points]);

  if (nodes.length === 0) {
    return (
      <div className="empty-state">
        No graph nodes indexed yet. Open the LLM Wiki and run Generate knowledge graph.
      </div>
    );
  }

  return (
    <div className="knowledge-graph-shell knowledge-graph-shell--cosmograph">
      <div className="graph-controls-panel graph-controls-panel--cosmograph">
        <strong>{nodes.length} nodes</strong>
        <span>
          {graph.directEdgeCount} semantic links. {graph.componentCount} cluster{graph.componentCount === 1 ? "" : "s"} tied to the wiki intent.
        </span>
        <div>
          <button onClick={() => cosmographRef.current?.fitView(450, 80)} type="button">
            Fit view
          </button>
          <button
            onClick={() => {
              if (isPaused) {
                cosmographRef.current?.unpause();
                setIsPaused(false);
              } else {
                cosmographRef.current?.pause();
                setIsPaused(true);
              }
            }}
            type="button"
          >
            {isPaused ? "Resume layout" : "Pause layout"}
          </button>
        </div>
      </div>
      {loadError ? <p className="form-error graph-load-error">{loadError}</p> : null}
      {config ? (
        <Cosmograph
          {...config}
          className="knowledge-graph-cosmograph"
          componentsDisplayStateMode="loading"
          disableLogging
          enableSimulation
          focusPointOnClick
          linkDefaultColor="rgba(100, 116, 139, 0.42)"
          linkDefaultWidth={1.2}
          linkWidthRange={[1, 4]}
          pointDefaultColor="#00a7ff"
          pointDefaultSize={5}
          pointLabelColor="#111827"
          pointLabelFontSize={12}
          pointSizeRange={[5, 19]}
          preservePointPositionsOnDataUpdate
          ref={cosmographRef}
          selectPointOnClick
          showDynamicLabels
          showDynamicLabelsLimit={48}
          showFocusedPointLabel
          showHoveredPointLabel
          showLabels
          showTopLabels
          showTopLabelsLimit={36}
          simulationCenter={0.12}
          simulationDecay={7200}
          simulationFriction={0.86}
          simulationGravity={0.18}
          simulationLinkDistance={78}
          simulationLinkSpring={1.08}
          simulationRepulsion={1.35}
          simulationRepulsionFromMouse={2.6}
          statusIndicatorMode="text"
        />
      ) : (
        <div className="empty-state">Preparing graph layout...</div>
      )}
    </div>
  );
}
