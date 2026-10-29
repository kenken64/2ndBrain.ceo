"use client";

import { Localized, useLanguage, LocalizedMessage } from "@/components/language-provider";


import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { graphTypeLabel, graphRelationLabel } from "@/lib/graph-labels";
import { CircleHelp, ExternalLink, Maximize, Maximize2, Minimize, Pause, Play, RotateCcw, Search, X } from "lucide-react";
import type { ForceGraph3DInstance, LinkObject, NodeObject } from "3d-force-graph";

type InputNode = { id: string; label: string; node_type: string; slug: string; source_path?: string | null; synthetic?: boolean };
type InputEdge = { id: string; from_node_id: string; to_node_id: string; relation: string; weight: number; synthetic?: boolean };
type GraphNode = NodeObject & InputNode & { color: string; degree: number; val: number; showLabel: boolean };
type GraphLink = LinkObject<GraphNode> & { id: string; relation: string; synthetic?: boolean; sourceId: string; targetId: string };
type GraphInstance = ForceGraph3DInstance<GraphNode, GraphLink>;
type Props = { nodes: InputNode[]; edges: InputEdge[]; projectId?: string | null; highlightPath?: string | null; componentCount: number; directEdgeCount: number };

const TYPE_COLORS: Record<string, string> = { intent: "#facc15", page: "#60a5fa", tag: "#34d399", owner: "#fb923c", person: "#fb923c", decision: "#f472b6", source: "#a78bfa" };
function colorFor(type: string) { return TYPE_COLORS[type] ?? "#a78bfa"; }
function number(value: number | undefined) { return typeof value === "number" && Number.isFinite(value) ? value : 0; }
function wikiPageHref(projectId: string, sourcePath: string) { return `/dashboard/wiki?${new URLSearchParams({ path: sourcePath, projectId })}`; }

function spaceBackground() {
  const canvas = document.createElement("canvas");
  canvas.width = 1440; canvas.height = 960;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.fillStyle = "#030815"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (const [x, y, radius, color] of [[300, 230, 570, "rgba(41, 66, 133, .28)"], [1110, 700, 600, "rgba(68, 40, 118, .24)"], [850, 280, 470, "rgba(19, 99, 111, .12)"]] as const) {
    const glow = ctx.createRadialGradient(x, y, 0, x, y, radius);
    glow.addColorStop(0, color); glow.addColorStop(1, "rgba(3, 8, 21, 0)");
    ctx.fillStyle = glow; ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  let seed = 18742;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < 500; i++) {
    const x = random() * canvas.width, y = random() * canvas.height;
    const radius = i < 25 ? 1.3 : 0.35 + random() * 0.65;
    ctx.fillStyle = `rgba(210, 230, 255, ${0.18 + random() * 0.62})`;
    ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();
  }
  return `url(${canvas.toDataURL()})`;
}

export function KnowledgeGraph3D({ nodes, edges, projectId, highlightPath, componentCount, directEdgeCount }: Props) {
  const _uiLanguage = useLanguage().language;
  const languageRef = useRef(_uiLanguage);
  languageRef.current = _uiLanguage;
  const shellRef = useRef<HTMLDivElement>(null);
  const helpRef = useRef<HTMLDialogElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<GraphInstance | null>(null);
  const [hiddenTypes, setHiddenTypes] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [showControls, setShowControls] = useState(true);
  const [drifting, setDrifting] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [displayError, setDisplayError] = useState("");
  const [readyVersion, setReadyVersion] = useState(0);
  const selectedRef = useRef<string | null>(null);
  useEffect(() => { if (window.matchMedia("(max-width: 760px)").matches) setShowControls(false); }, []);
  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    setDrifting(!preference.matches);
    const onChange = (event: MediaQueryListEvent) => setDrifting(!event.matches);
    preference.addEventListener("change", onChange);
    return () => preference.removeEventListener("change", onChange);
  }, []);
  useEffect(() => {
    let fitTimeout: number | undefined;
    const onFullscreenChange = () => {
      setFullscreen(document.fullscreenElement === shellRef.current);
      if (fitTimeout) window.clearTimeout(fitTimeout);
      fitTimeout = window.setTimeout(() => {
        if (!selectedRef.current) graphRef.current?.zoomToFit(400, 40);
      }, 150);
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => { document.removeEventListener("fullscreenchange", onFullscreenChange); if (fitTimeout) window.clearTimeout(fitTimeout); };
  }, []);
  selectedRef.current = selectedId;
  const types = useMemo(() => {
    const counts = new Map<string, number>();
    for (const node of nodes) counts.set(node.node_type, (counts.get(node.node_type) ?? 0) + 1);
    return [...counts].sort(([a], [b]) => a.localeCompare(b));
  }, [nodes]);
  const visibleGraph = useMemo(() => {
    const visible = nodes.filter(node => !hiddenTypes.includes(node.node_type));
    const ids = new Set(visible.map(node => node.id));
    const links = edges.filter(edge => ids.has(edge.from_node_id) && ids.has(edge.to_node_id));
    const degrees = new Map<string, number>();
    for (const edge of links) { degrees.set(edge.from_node_id, (degrees.get(edge.from_node_id) ?? 0) + 1); degrees.set(edge.to_node_id, (degrees.get(edge.to_node_id) ?? 0) + 1); }
    const labels = new Set([...visible].sort((a, b) => (degrees.get(b.id) ?? 0) - (degrees.get(a.id) ?? 0)).slice(0, 45).map(node => node.id));
    return {
      nodes: visible.map(node => ({ ...node, color: colorFor(node.node_type), degree: degrees.get(node.id) ?? 0, val: node.synthetic ? 9 : 1.5 + Math.min(degrees.get(node.id) ?? 0, 18) * 0.65, showLabel: node.synthetic || labels.has(node.id) })),
      links: links.map(edge => ({ id: edge.id, source: edge.from_node_id, target: edge.to_node_id, sourceId: edge.from_node_id, targetId: edge.to_node_id, relation: edge.relation, synthetic: edge.synthetic }))
    };
  }, [nodes, edges, hiddenTypes]);
  const selected = visibleGraph.nodes.find(node => node.id === selectedId) ?? null;
  const connected = useMemo(() => {
    const ids = new Set<string>();
    if (selectedId) { ids.add(selectedId); for (const edge of visibleGraph.links) { if (edge.sourceId === selectedId) ids.add(edge.targetId); if (edge.targetId === selectedId) ids.add(edge.sourceId); } }
    return ids;
  }, [selectedId, visibleGraph.links]);
  const connectedRef = useRef(connected); connectedRef.current = connected;
  const matches = useMemo(() => {
    const value = query.trim().toLowerCase();
    if (!value) return [];
    return visibleGraph.nodes.filter(node => [node.label, node.node_type, graphTypeLabel(node.node_type, _uiLanguage), node.slug, node.source_path].filter(Boolean).join(" ").toLowerCase().includes(value)).slice(0, 30);
  }, [visibleGraph.nodes, query, _uiLanguage]);

  const focus = useCallback((id: string) => {
    const instance = graphRef.current;
    const node = instance?.graphData().nodes.find(item => item.id === id);
    if (!instance || !node) return;
    const point = { x: number(node.x), y: number(node.y), z: number(node.z) };
    const length = Math.hypot(point.x, point.y, point.z) || 1;
    const distance = 100;
    instance.cameraPosition({ x: point.x + point.x / length * distance, y: point.y + point.y / length * distance, z: point.z + (point.z || length) / length * distance }, point, 800);
    setSelectedId(id);
  }, []);

  useEffect(() => {
    const container = viewportRef.current;
    if (!container) return;
    let disposed = false;
    let graph: GraphInstance | null = null;
    let observer: ResizeObserver | null = null;
    let fitTimer: number | undefined;
    let userInteracted = false;
    const markInteraction = () => { userInteracted = true; };
    container.addEventListener("pointerdown", markInteraction);
    container.addEventListener("wheel", markInteraction, { passive: true });
    const textures: Array<{ dispose(): void }> = [];
    const materials: Array<{ dispose(): void }> = [];
    setError(""); setLoading(true);
    (async () => {
      try {
        const [{ default: ForceGraph3D }, THREE] = await Promise.all([import("3d-force-graph"), import("three")]);
        if (disposed) return;
        const webgl = document.createElement("canvas");
        if (!webgl.getContext("webgl2") && !webgl.getContext("webgl")) throw new Error("WebGL is not available in this browser.");
        if (container.parentElement) container.parentElement.style.backgroundImage = spaceBackground();
        const instance = new ForceGraph3D(container, { controlType: "orbit", rendererConfig: { antialias: true, alpha: true } }) as unknown as GraphInstance;
        graph = instance; graphRef.current = instance;
        let fitted = false;
        instance.width(container.clientWidth).height(container.clientHeight).backgroundColor("rgba(0, 0, 0, 0)").showNavInfo(false)
          .nodeId("id").nodeVal("val").nodeRelSize(5.5).nodeResolution(12)
          .nodeColor(node => selectedRef.current && !connectedRef.current.has(node.id) ? "#263747" : node.color)
          .nodeLabel(node => { const label = document.createElement("span"); label.textContent = `${node.label} · ${graphTypeLabel(node.node_type, languageRef.current)}`; return label; })
          .linkColor(link => selectedRef.current ? (link.sourceId === selectedRef.current || link.targetId === selectedRef.current ? "#83ebd2" : "#263a46") : link.synthetic ? "#496275" : "#4f9b8c")
          .linkOpacity(0.65)
          .linkWidth(link => selectedRef.current && (link.sourceId === selectedRef.current || link.targetId === selectedRef.current) ? 1.3 : 0.35)
          .nodeThreeObjectExtend(true)
          .nodeThreeObject(node => {
            if (!node.showLabel) return new THREE.Object3D();
            const canvas = document.createElement("canvas"); canvas.width = 512; canvas.height = 72;
            const ctx = canvas.getContext("2d");
            if (!ctx) return new THREE.Object3D();
            const label = node.label.length > 32 ? `${node.label.slice(0, 29)}…` : node.label;
            ctx.font = "600 28px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillStyle = "#e8f5ff";
            ctx.shadowColor = "#07101e"; ctx.shadowBlur = 6; ctx.fillText(label, 256, 36, 480);
            const texture = new THREE.CanvasTexture(canvas); textures.push(texture);
            const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }); materials.push(material);
            const sprite = new THREE.Sprite(material); sprite.scale.set(60, 8.5, 1); sprite.position.set(0, -16, 0); return sprite;
          })
          .warmupTicks(30).cooldownTicks(180).onEngineStop(() => { if (!fitted && !disposed) { fitted = true; if (selectedRef.current) focus(selectedRef.current); else if (!userInteracted) instance.zoomToFit(550, 60); } })
          .onNodeClick(node => focus(node.id))
          .onBackgroundClick(() => setSelectedId(null))
          .graphData({ nodes: visibleGraph.nodes.map(node => ({ ...node })), links: visibleGraph.links.map(link => ({ ...link })) });
        fitTimer = window.setTimeout(() => { if (!disposed && !userInteracted && !selectedRef.current) instance.zoomToFit(500, 60); }, 900);
        observer = new ResizeObserver(() => {
          if (!container.clientWidth || !container.clientHeight) return;
          instance.width(container.clientWidth).height(container.clientHeight);
          if (!userInteracted && !selectedRef.current) {
            if (fitTimer) window.clearTimeout(fitTimer);
            fitTimer = window.setTimeout(() => { if (!disposed && !userInteracted && !selectedRef.current) instance.zoomToFit(500, 40); }, 250);
          }
        });
        observer.observe(container);
        setReadyVersion(value => value + 1); setLoading(false);
      } catch (reason) {
        if (!disposed) { setError(reason instanceof Error ? reason.message : "The 3D graph could not be started."); setLoading(false); }
      }
    })();
    return () => {
      disposed = true; observer?.disconnect();
      if (fitTimer) window.clearTimeout(fitTimer);
      container.removeEventListener("pointerdown", markInteraction);
      container.removeEventListener("wheel", markInteraction);
      if (graph) { graph._destructor(); graph.renderer().dispose(); }
      for (const material of materials) material.dispose();
      for (const texture of textures) texture.dispose();
      if (graphRef.current === graph) graphRef.current = null;
    };
  }, [visibleGraph, focus]);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    const controls = graph.controls() as { autoRotate: boolean; autoRotateSpeed: number };
    controls.autoRotate = drifting && !selectedId;
    controls.autoRotateSpeed = 0.18;
  }, [drifting, selectedId, readyVersion]);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    graph.nodeColor(node => selectedId && !connected.has(node.id) ? "#263747" : node.color);
    graph.linkColor(link => selectedId ? (link.sourceId === selectedId || link.targetId === selectedId ? "#83ebd2" : "#263a46") : link.synthetic ? "#496275" : "#4f9b8c");
    graph.linkWidth(link => selectedId && (link.sourceId === selectedId || link.targetId === selectedId) ? 1.3 : 0.35);
  }, [selectedId, connected, readyVersion]);

  useEffect(() => {
    if (!highlightPath || !graphRef.current) return;
    const node = visibleGraph.nodes.find(item => item.source_path === highlightPath);
    if (node) { const timer = window.setTimeout(() => focus(node.id), 650); return () => window.clearTimeout(timer); }
  }, [highlightPath, visibleGraph.nodes, focus, readyVersion]);

  const neighbors = selected ? visibleGraph.links.filter(edge => edge.sourceId === selected.id || edge.targetId === selected.id).slice(0, 20) : [];
  const nodeById = new Map(visibleGraph.nodes.map(node => [node.id, node]));
  const openWindow = () => {
    if (!projectId) return;
    const params = new URLSearchParams({ projectId, graphWindow: "1" });
    if (highlightPath) params.set("path", highlightPath);
    const opened = window.open(`/dashboard/graph?${params}`, "_blank", "popup=yes,width=1200,height=850");
    if (!opened) { setDisplayError("Your browser blocked the graph window. Allow pop-ups for this site and try again."); return; }
    opened.opener = null;
    setDisplayError("");
  };
  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement === shellRef.current) await document.exitFullscreen();
      else if (shellRef.current?.requestFullscreen) await shellRef.current.requestFullscreen();
      else throw new Error("Full screen is not supported by this browser.");
      setDisplayError("");
    } catch { setDisplayError("Full screen is unavailable. Try opening the graph in a new window instead."); }
  };
  return <div ref={shellRef} className={`graph3d-shell${showControls ? " graph3d-shell--controls-open" : ""}`}>
    <div className="graph3d-viewport" ref={viewportRef} aria-label={_uiLanguage === "zh" ? "交互式 3D 知识图谱" : "Interactive 3D knowledge graph"} />
    {loading ? <p className="graph3d-state" role="status"><Localized en={"Preparing your 3D graph…"} zh={"正在准备 3D 图谱…"} /></p> : null}
    {error ? <p className="graph3d-state graph3d-state--error" role="alert"><LocalizedMessage text={error} /> <Localized en={"Switch to 2D view to explore this graph."} zh={"切换到 2D 视图以浏览此图谱。"} /></p> : null}
    <div className="graph3d-controls">
      <div className="graph3d-panel-header"><div><span className="graph3d-eyebrow"><Localized en={"KNOWLEDGE GALAXY"} zh={"知识星系"} /></span><div className="graph3d-node-count"><strong>{_uiLanguage === "zh" ? `${nodes.filter(node => !node.synthetic).length} 个节点 · ${directEdgeCount} 条链接` : `${nodes.filter(node => !node.synthetic).length} nodes · ${directEdgeCount} links`}</strong><button type="button" className="graph3d-help-trigger" aria-label={_uiLanguage === "zh" ? "关于知识图谱" : "About the knowledge graph"} title={_uiLanguage === "zh" ? "关于知识图谱" : "About the knowledge graph"} onClick={() => helpRef.current?.showModal()}><CircleHelp size={16} /></button></div></div><button type="button" onClick={() => setShowControls(value => !value)} aria-label={_uiLanguage === "zh" ? (showControls ? "收起图谱控制" : "展开图谱控制") : (showControls ? "Collapse graph controls" : "Expand graph controls")}>{showControls ? "−" : "+"}</button></div>
      {showControls ? <>
        <label className="graph3d-search"><Search size={15} /><input type="search" placeholder={_uiLanguage === "zh" ? "搜索图谱…" : "Search your graph…"} value={query} onChange={event => setQuery(event.target.value)} aria-label={_uiLanguage === "zh" ? "搜索图谱节点" : "Search graph nodes"} />{query ? <button type="button" aria-label={_uiLanguage === "zh" ? "清除图谱搜索" : "Clear graph search"} onClick={() => setQuery("")}><X size={14} /></button> : null}</label>
        {query.trim() ? <div className="graph3d-results" role="region" aria-label={_uiLanguage === "zh" ? "图谱搜索结果" : "Graph search results"}>{matches.length ? matches.map(node => <button type="button" key={node.id} onClick={() => { focus(node.id); setQuery(""); }}><span style={{ background: node.color }} />{node.label}</button>) : <p><Localized en={"No matching nodes."} zh={"没有匹配的节点。"} /></p>}</div> : <p className="graph3d-hint"><Localized en={"Drag to orbit · scroll to zoom · click a node to explore its connections."} zh={"拖动旋转 · 滚动缩放 · 点击节点查看其关联。"} /></p>}
        <div className="graph3d-filter-title"><Localized en={"FILTER BY TYPE"} zh={"按类型筛选"} /></div>
        <div className="graph3d-filters">{types.map(([type, count]) => <label key={type}><input type="checkbox" checked={!hiddenTypes.includes(type)} onChange={() => { setSelectedId(null); setHiddenTypes(current => current.includes(type) ? current.filter(item => item !== type) : [...current, type]); }} /><span className="graph3d-dot" style={{ background: colorFor(type) }} /><span>{graphTypeLabel(type, _uiLanguage)}</span><small>{count}</small></label>)}</div>
        <p className="graph3d-hint">{_uiLanguage === "zh" ? `${componentCount} 个原始聚类。项目范围链接仅用于视觉分组。` : `${componentCount} original cluster${componentCount === 1 ? "" : "s"}. Project-scope links are visual guides.`}</p>
      </> : null}
    </div>
    <div className="graph3d-actions"><button type="button" onClick={() => setDrifting(value => !value)} aria-pressed={drifting} title={_uiLanguage === "zh" ? (drifting ? "暂停星系漂移" : "恢复星系漂移") : (drifting ? "Pause galaxy drift" : "Resume galaxy drift")}>{drifting ? <Pause size={15} /> : <Play size={15} />} {drifting ? <Localized en={"Pause"} zh={"暂停"} /> : <Localized en={"Drift"} zh={"漂移"} />}</button><button type="button" onClick={() => { setSelectedId(null); graphRef.current?.zoomToFit(600, 40); }} title={_uiLanguage === "zh" ? "使图谱适合画面" : "Fit graph"}><Maximize2 size={15} /> <Localized en={"Fit"} zh={"适合画面"} /></button><button type="button" onClick={() => graphRef.current?.d3ReheatSimulation()} title={_uiLanguage === "zh" ? "重新运行力导向布局" : "Re-run force layout"}><RotateCcw size={15} /> <Localized en={"Reflow"} zh={"重新布局"} /></button>{projectId ? <button type="button" onClick={openWindow} aria-label={_uiLanguage === "zh" ? "在新窗口打开图谱" : "Open graph in new window"} title={_uiLanguage === "zh" ? "在新窗口打开图谱" : "Open graph in new window"}><ExternalLink size={15} /><span className="graph3d-action-label"><Localized en={"Window"} zh={"窗口"} /></span></button> : null}<button type="button" onClick={toggleFullscreen} aria-label={_uiLanguage === "zh" ? (fullscreen ? "退出全屏" : "进入全屏") : (fullscreen ? "Exit full screen" : "Enter full screen")} title={_uiLanguage === "zh" ? (fullscreen ? "退出全屏" : "进入全屏") : (fullscreen ? "Exit full screen" : "Enter full screen")}>{fullscreen ? <Minimize size={15} /> : <Maximize size={15} />}<span className="graph3d-action-label">{fullscreen ? <Localized en={"Exit full screen"} zh={"退出全屏"} /> : <Localized en={"Full screen"} zh={"全屏"} />}</span></button></div>
    {displayError ? <div className="graph3d-display-error" role="alert"><LocalizedMessage text={displayError} /><button type="button" onClick={() => setDisplayError("")} aria-label={_uiLanguage === "zh" ? "关闭消息" : "Dismiss message"}><X size={14} /></button></div> : null}
    <dialog ref={helpRef} className="graph3d-help-dialog" aria-labelledby="graph-help-title">
      <div className="graph3d-help-header"><div><span className="graph3d-eyebrow"><Localized en={"KNOWLEDGE GALAXY"} zh={"知识星系"} /></span><h2 id="graph-help-title"><Localized en={"What is this graph for?"} zh={"此图谱有什么用途？"} /></h2></div><button type="button" aria-label={_uiLanguage === "zh" ? "关闭图谱帮助" : "Close graph help"} onClick={() => helpRef.current?.close()}><X size={18} /></button></div>
      <p><Localized en={"The graph helps you explore how pages, people, decisions and topics in your knowledge base are connected. As your knowledge base grows, it can help you discover related information you might otherwise miss."} zh={"图谱帮助您了解知识库中的页面、人物、决策和主题如何关联。随着知识库增长，它可以帮助您发现可能被忽略的相关信息。"} /></p>
      <p><Localized en={"For example, search for a customer, select their node, and follow its connections to related meeting notes or decisions. Clusters can show groups of related material, and you can open a node’s source page for more detail."} zh={"例如，搜索客户并选择其节点，然后沿关联查看相关会议记录或决策。聚类可以显示相关资料，您也可以打开节点的源页面了解详情。"} /></p>
      <p><Localized en="The graph is only as useful as its underlying links. A line does not automatically mean AI has discovered an important relationship. Project-scope links are visual guides for grouping disconnected nodes. If you already know the page you want, ordinary search may be quicker." zh="图谱的价值取决于底层链接。一条连线并不一定意味着 AI 发现了重要关系。项目范围链接只是将未连接的节点分组的视觉提示。如果已经知道要找的页面，普通搜索可能更快。" /></p>
      <p><Localized en="Use Fit to return to the full overview after exploring a node." zh="浏览节点后，使用“适合画面”返回完整视图。" /></p>
      <button type="button" className="graph3d-help-done" onClick={() => helpRef.current?.close()}><Localized en={"Got it"} zh={"知道了"} /></button>
    </dialog>
    {selected ? <aside className="graph3d-inspector" aria-label={_uiLanguage === "zh" ? "所选节点详情" : "Selected node details"}><button className="graph3d-inspector-close" type="button" aria-label={_uiLanguage === "zh" ? "关闭节点详情" : "Close node details"} onClick={() => setSelectedId(null)}><X size={16} /></button><span className="graph3d-eyebrow"><span className="graph3d-dot" style={{ background: selected.color }} /> {graphTypeLabel(selected.node_type, _uiLanguage)}</span><h3>{selected.label}</h3><p>{selected.synthetic ? <Localized en={"Project anchor · visual grouping"} zh={"项目锚点 · 视觉分组"} /> : (_uiLanguage === "zh" ? `${selected.degree} 条可见关联` : `${selected.degree} visible connection${selected.degree === 1 ? "" : "s"}`)}</p>{projectId && selected.source_path ? <a href={wikiPageHref(projectId, selected.source_path)}><Localized en={"Open source page"} zh={"打开源页面"} /><ExternalLink size={14} /></a> : null}{neighbors.length ? <div className="graph3d-neighbors"><strong><Localized en={"Connections"} zh={"关联"} /></strong>{neighbors.map(edge => { const otherId = edge.sourceId === selected.id ? edge.targetId : edge.sourceId; const other = nodeById.get(otherId); return other ? <button key={edge.id} type="button" onClick={() => focus(other.id)}><span>{other.label}</span><small>{edge.synthetic ? <Localized en={"project scope"} zh={"项目范围"} /> : graphRelationLabel(edge.relation, _uiLanguage)}</small></button> : null; })}{selected.degree > neighbors.length ? <small>{_uiLanguage === "zh" ? `显示 ${neighbors.length} 条关联。` : `Showing ${neighbors.length} connections.`}</small> : null}</div> : null}</aside> : null}
    {!visibleGraph.nodes.length ? <div className="graph3d-empty"><Localized en={"All node types are hidden. Select a type in the filter to show it again."} zh={"所有节点类型均已隐藏。请在筛选器中选择类型以重新显示。"} /></div> : null}
  </div>;
}
