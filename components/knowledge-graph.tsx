"use client";

import "@xyflow/react/dist/style.css";
import {
  Background,
  Controls,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Edge,
  type Node
} from "@xyflow/react";
import { useEffect, useMemo, useState } from "react";

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

function buildNodeStyle(node: GraphNode) {
  const isRoot = node.id === ROOT_NODE_ID;

  return {
    background: isRoot ? "linear-gradient(135deg, #111827, #334155)" : "#ffffff",
    border: `1px solid ${isRoot ? "#111827" : "rgba(148, 163, 184, 0.36)"}`,
    borderRadius: isRoot ? 20 : 18,
    boxShadow: isRoot ? "0 18px 34px rgba(15, 23, 42, 0.24)" : "0 14px 28px rgba(15, 23, 42, 0.1)",
    color: isRoot ? "#f8fafc" : "#0f172a",
    fontSize: isRoot ? 15 : 13,
    fontWeight: isRoot ? 900 : 700,
    maxWidth: isRoot ? 280 : 200,
    minWidth: isRoot ? 180 : 132,
    padding: isRoot ? "14px 18px" : "10px 14px"
  } as const;
}

function buildFlowGraph(nodes: GraphNode[], edges: GraphEdge[], rootLabel?: string | null) {
  const graph = buildConnectedGraph(nodes, edges, rootLabel);
  const rootNode = graph.nodes.find((node) => node.id === ROOT_NODE_ID) ?? null;
  const otherNodes = rootNode ? graph.nodes.filter((node) => node.id !== ROOT_NODE_ID) : graph.nodes;
  const components = rootNode ? graph.rawComponents : connectedComponents(otherNodes, validEdges(otherNodes, graph.edges));
  const positions = new Map<string, { x: number; y: number }>();

  if (rootNode) {
    positions.set(rootNode.id, { x: 0, y: 0 });
  }

  if (components.length === 1) {
    const [component] = components;
    const ringRadius = Math.max(140, component.length * 28);

    component.forEach((node, index) => {
      const angle = (Math.PI * 2 * index) / Math.max(component.length, 1) - Math.PI / 2;

      positions.set(node.id, {
        x: ringRadius * Math.cos(angle),
        y: 130 + ringRadius * Math.sin(angle)
      });
    });
  } else {
    const orbitRadius = Math.max(260, components.length * 110);

    components.forEach((component, componentIndex) => {
      const componentAngle = (Math.PI * 2 * componentIndex) / components.length - Math.PI / 2;
      const centerX = orbitRadius * Math.cos(componentAngle);
      const centerY = 80 + orbitRadius * Math.sin(componentAngle);
      const localRadius = Math.max(110, Math.min(220, component.length * 30));

      component.forEach((node, nodeIndex) => {
        if (component.length === 1) {
          positions.set(node.id, { x: centerX, y: centerY });
          return;
        }

        const nodeAngle = (Math.PI * 2 * nodeIndex) / component.length - Math.PI / 2;

        positions.set(node.id, {
          x: centerX + localRadius * Math.cos(nodeAngle),
          y: centerY + localRadius * Math.sin(nodeAngle)
        });
      });
    });
  }

  const flowNodes: Node[] = graph.nodes.map((node) => ({
    data: {
      label: truncateLabel(node.label)
    },
    draggable: true,
    id: node.id,
    position: positions.get(node.id) ?? { x: 0, y: 0 },
    sourcePosition: Position.Right,
    style: buildNodeStyle(node),
    targetPosition: Position.Left,
    type: "default"
  }));

  const flowEdges: Edge[] = graph.edges.map((edge) => {
    const directed = edge.relation !== "related_to" && edge.relation !== "intent_scope";
    const color = linkColor(edge.relation, edge.synthetic);

    return {
      animated: edge.relation === "depends_on" || edge.relation === "decision_from",
      id: edge.id,
      label: relationLabel(edge.relation, edge.synthetic),
      labelBgBorderRadius: 999,
      labelBgPadding: [8, 4],
      labelBgStyle: {
        fill: "rgba(255, 255, 255, 0.92)"
      },
      labelStyle: {
        fill: "#475569",
        fontSize: 11,
        fontWeight: 700,
        textTransform: "capitalize"
      },
      markerEnd: directed ? { color, type: MarkerType.ArrowClosed } : undefined,
      selectable: true,
      source: edge.from_node_id,
      style: {
        stroke: color,
        strokeDasharray: edge.synthetic ? "8 5" : undefined,
        strokeWidth: edge.synthetic ? 1.5 : Math.max(1.5, Math.min(4, edge.weight + 0.5))
      },
      target: edge.to_node_id,
      type: "smoothstep"
    };
  });

  return {
    componentCount: graph.componentCount,
    directEdgeCount: graph.directEdgeCount,
    flowEdges,
    flowNodes
  };
}

function KnowledgeGraphCanvas({ edges, nodes, rootLabel }: KnowledgeGraphProps) {
  const [layoutTick, setLayoutTick] = useState(0);
  const { fitView } = useReactFlow();
  const graph = useMemo(() => buildFlowGraph(nodes, edges, rootLabel), [edges, layoutTick, nodes, rootLabel]);
  const [flowNodes, setFlowNodes, onNodesChange] = useNodesState(graph.flowNodes);
  const [flowEdges, setFlowEdges, onEdgesChange] = useEdgesState(graph.flowEdges);

  useEffect(() => {
    setFlowNodes(graph.flowNodes);
    setFlowEdges(graph.flowEdges);

    const timer = window.setTimeout(() => {
      fitView({
        duration: 450,
        padding: 0.18
      });
    }, 30);

    return () => window.clearTimeout(timer);
  }, [fitView, graph.flowEdges, graph.flowNodes, setFlowEdges, setFlowNodes]);

  if (nodes.length === 0) {
    return (
      <div className="empty-state">
        No graph nodes indexed yet. Open the LLM Wiki and run Generate knowledge graph.
      </div>
    );
  }

  return (
    <div className="knowledge-graph-shell knowledge-graph-shell--flow">
      <div className="graph-controls-panel graph-controls-panel--flow">
        <strong>{nodes.length} nodes</strong>
        <span>
          {graph.directEdgeCount} semantic links. {graph.componentCount} cluster{graph.componentCount === 1 ? "" : "s"} tied to the wiki intent.
        </span>
        <div>
          <button
            onClick={() =>
              fitView({
                duration: 450,
                padding: 0.18
              })
            }
            type="button"
          >
            Fit view
          </button>
          <button onClick={() => setLayoutTick((current) => current + 1)} type="button">
            Reset layout
          </button>
        </div>
      </div>

      <ReactFlow
        edges={flowEdges}
        fitView
        maxZoom={1.6}
        minZoom={0.2}
        nodes={flowNodes}
        nodesDraggable
        nodesFocusable
        onEdgesChange={onEdgesChange}
        onNodesChange={onNodesChange}
        panOnDrag
        proOptions={{ hideAttribution: true }}
        selectionOnDrag
      >
        <Background color="rgba(148, 163, 184, 0.22)" gap={28} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

export function KnowledgeGraph(props: KnowledgeGraphProps) {
  return (
    <ReactFlowProvider>
      <KnowledgeGraphCanvas {...props} />
    </ReactFlowProvider>
  );
}
