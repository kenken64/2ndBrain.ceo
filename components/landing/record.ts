export type LpGraphNode = {
  readonly id: string;
  readonly label?: string;
  readonly x: number;
  readonly y: number;
};

export type LpGraphEdge = readonly [string, string];

const GRAPH_NODES: readonly LpGraphNode[] = [
  { id: "pricing", label: "Pricing", x: 64, y: 52 },
  { id: "q3deck", label: "Q3 Deck", x: 148, y: 32 },
  { id: "escalation", label: "Escalation", x: 252, y: 58 },
  { id: "oncall", label: "On-call", x: 334, y: 34 },
  { id: "gateway", label: "Gateway", x: 312, y: 124 },
  { id: "vendors", label: "Vendors", x: 92, y: 128 },
  { id: "n1", x: 186, y: 96 },
  { id: "n2", x: 28, y: 92 },
  { id: "n3", x: 222, y: 142 },
  { id: "n4", x: 372, y: 82 },
  { id: "n5", x: 152, y: 152 }
];

const GRAPH_EDGES: readonly LpGraphEdge[] = [
  ["pricing", "q3deck"],
  ["pricing", "vendors"],
  ["pricing", "n2"],
  ["q3deck", "n1"],
  ["q3deck", "escalation"],
  ["escalation", "oncall"],
  ["escalation", "n1"],
  ["oncall", "n4"],
  ["gateway", "n4"],
  ["gateway", "n3"],
  ["vendors", "n5"],
  ["n1", "n3"]
];

const GRAPH_NEW_EDGES: readonly LpGraphEdge[] = [
  ["runbook", "escalation"],
  ["runbook", "gateway"]
];

export const RECORD = {
  pagesBefore: 14,
  pagesAfter: 15,
  nodesBefore: 11,
  nodesAfter: 12,
  edgesBefore: 12,
  edgesAfter: 14,
  approvals: 1,
  files: [
    { name: "board-deck.pdf", size: "2.1 MB" },
    { name: "pricing-notes.docx", size: "840 KB" },
    { name: "standup.txt", size: "12 KB" },
    { name: "spec.md", size: "6 KB" },
    { name: "whiteboard.png", size: "3.4 MB" }
  ],
  editorTab: "operations/incident-runbook.md",
  editorLines: [
    "# Incident Runbook",
    "Generated from 3 sources. Edited by you.",
    "## Escalation",
    "1. Page the on-call lead",
    "2. Open the gateway console"
  ],
  /** data-node ids for cross-highlight, index-aligned with editorLines */
  editorLineNodes: ["runbook", null, "escalation", null, null] as readonly (string | null)[],
  treeRows: [
    "wiki-1748212996/",
    "├─ overview.md",
    "├─ sources/",
    "│  ├─ q3-board-deck.md",
    "│  └─ pricing-notes.md",
    "└─ operations/"
  ],
  treeInsert: "incident-runbook.md",
  consoleRun: [
    "$ clawmacdo ls-restore-fast",
    "[ok] snapshot found: openclaw-base",
    "[ok] runtime restored on lightsail",
    "[..] telegram pairing: waiting for approval"
  ],
  consoleApproved: [
    "[ok] approval received via telegram",
    "[ok] gateway online · ssh ready",
    "[ok] wiki synced: 15 pages (+1)",
    "$ "
  ],
  consoleAutoApproved: "[ok] demo auto-approved — your real agent keeps waiting",
  consoleRejected: ["[!] rejected — action halted. nothing ran.", "$ "],
  graphNodes: GRAPH_NODES,
  graphEdges: GRAPH_EDGES,
  graphNewNode: { id: "runbook", label: "Runbook", x: 240, y: 100 } as LpGraphNode,
  graphNewEdges: GRAPH_NEW_EDGES,
  ledger:
    "demo ledger — 15 pages · 12 nodes · 14 edges · 1 human approval. same numbers the machine printed above. we keep our books."
} as const;
