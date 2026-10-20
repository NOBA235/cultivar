"use client";

import React, { useEffect, useRef, useState, useMemo } from "react";
import dynamic from "next/dynamic";
import * as Dialog from "@radix-ui/react-dialog";
import { toBlob, toPng } from "html-to-image";
import type { Recommendation, ResolvedEntity } from "@/lib/types";

// ForceGraph2D accesses `window` at evaluation time; dynamic import with { ssr: false } is mandatory in Next.js.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ForceGraph2D: any = dynamic(() => import("react-force-graph-2d"), {
  ssr: false,
});

// Tableau 10 Color-Blind Safe Palette
export const TABLEAU_PALETTE = {
  blue: "#4e79a7", // Source Product
  orange: "#f28e2b", // Movie
  teal: "#76b7b2", // Destination
  green: "#59a14f", // Book
  amber: "#edc948", // Fashion Brand
  purple: "#b07aa1", // Musician / Artist
  emerald: "#10b981", // Recommendation Opportunity
  gray: "#bab0ac", // Other
};

export function cleanDomain(urn: string): string {
  const map: Record<string, string> = {
    "urn:entity:artist": "musician",
    "urn:entity:movie": "movie",
    "urn:entity:brand": "fashion_brand",
    "urn:entity:book": "book",
    "urn:entity:destination": "destination",
    "urn:entity:restaurant": "restaurant",
    "urn:entity:place": "place",
  };
  return map[urn] || urn.replace("urn:entity:", "");
}

export function getColorByType(urn: string): string {
  const clean = cleanDomain(urn);
  switch (clean) {
    case "musician":
      return TABLEAU_PALETTE.purple;
    case "movie":
      return TABLEAU_PALETTE.orange;
    case "fashion_brand":
      return TABLEAU_PALETTE.amber;
    case "book":
      return TABLEAU_PALETTE.green;
    case "destination":
      return TABLEAU_PALETTE.teal;
    default:
      return TABLEAU_PALETTE.gray;
  }
}

export interface GraphNode {
  id: string;
  name: string;
  fullUrn: string;
  rawId: string;
  nodeType: "source" | "signal" | "recommendation";
  cleanType: string;
  rawType: string;
  color: string;
  val: number;
  affinityToSource?: number;
  qlooUrl: string;
  x?: number;
  y?: number;
}

export interface GraphLink {
  source: string;
  target: string;
  sourceLabel: string;
  targetLabel: string;
  affinity: number;
  qlooSource: string;
  value: number;
  color: string;
}

export interface CulturalGraphProps {
  recommendation: Recommendation;
  sourceProducts?: ResolvedEntity[];
}

export function CulturalGraphCanvas({
  recommendation,
  sourceProducts = [],
}: CulturalGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState<{ width: number; height: number }>({
    width: 680,
    height: 480,
  });
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Resize listener
  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        const { clientWidth, clientHeight } = containerRef.current;
        if (clientWidth > 0 && clientHeight > 0) {
          setDimensions({ width: clientWidth, height: clientHeight });
        }
      }
    };
    updateSize();
    window.addEventListener("resize", updateSize);
    return () => window.removeEventListener("resize", updateSize);
  }, []);

  // Build Graph Data
  const graphData = useMemo(() => {
    const nodes: GraphNode[] = [];
    const links: GraphLink[] = [];

    // 1. Center: Source Products from catalog (grounding seeds for cultural taste profile)
    const effectiveSources =
      sourceProducts.length > 0
        ? sourceProducts
        : [
            {
              product: {
                name: "Alder Street Yirgacheffe",
                category: "single-origin beans",
                description: "",
              },
              qlooId: "8C07C9D4-3B47-4138-902B-C9B9E150FACF",
              qlooType: "urn:entity:brand",
              confidence: 0.84,
              label: "The Wall Street Journal",
            },
            {
              product: {
                name: "Foggy Ferry Cold Brew Concentrate",
                category: "cold brew",
                description: "",
              },
              qlooId: "1511E9F9-4DEA-494B-BAF2-013D90FEC72D",
              qlooType: "urn:entity:brand",
              confidence: 0.84,
              label: "Chameleon Cold-brew",
            },
            {
              product: {
                name: "High Meadow Chamomile & Mint",
                category: "herbal tea",
                description: "",
              },
              qlooId: "2D9C51D2-8DF6-464A-A984-75ED176A76E8",
              qlooType: "urn:entity:brand",
              confidence: 0.84,
              label: "Twinings",
            },
            {
              product: {
                name: "Valley View 70% Single-Estate Dark Bar",
                category: "bean-to-bar chocolate",
                description: "",
              },
              qlooId: "5F6B4BD5-7281-4C3F-9DA4-42861F346D9B",
              qlooType: "urn:entity:brand",
              confidence: 0.84,
              label: "Valrhona",
            },
            {
              product: {
                name: "Solstice Reserve Barrel-Aged Cascara",
                category: "cascara infusion",
                description: "",
              },
              qlooId: "E0F155AA-5CE3-4EB3-9BA0-6CDA2EB91F03",
              qlooType: "urn:entity:brand",
              confidence: 0.84,
              label: "Stumptown Coffee Roasters",
            },
          ];

    effectiveSources.forEach((src) => {
      const srcId = `src-${src.qlooId}`;
      nodes.push({
        id: srcId,
        name: src.product.name,
        fullUrn: `urn:entity:brand:${src.qlooId}`,
        rawId: src.qlooId,
        nodeType: "source",
        cleanType: "Producer Catalog Product",
        rawType: src.qlooType,
        color: TABLEAU_PALETTE.blue,
        val: 14,
        affinityToSource: 1.0,
        qlooUrl: `https://hackathon.api.qloo.com/search?query=${encodeURIComponent(
          src.product.name
        )}&types=${encodeURIComponent(src.qlooType)}`,
      });
    });

    // 2. Ring 1: Cultural Signals (supportingSignals)
    const signals = recommendation.supportingSignals || [];
    signals.forEach((sig) => {
      const sigId = `sig-${sig.entityId}`;
      const prefix = sig.entityType.startsWith("urn:entity:")
        ? sig.entityType
        : `urn:entity:${sig.entityType}`;
      const sigUrn = `${prefix}:${sig.entityId}`;
      const sigColor = getColorByType(sig.entityType);

      nodes.push({
        id: sigId,
        name: sig.label,
        fullUrn: sigUrn,
        rawId: sig.entityId,
        nodeType: "signal",
        cleanType: cleanDomain(sig.entityType),
        rawType: sig.entityType,
        color: sigColor,
        val: 9,
        affinityToSource: sig.affinity,
        qlooUrl:
          sig.qloo_request?.url ||
          `https://hackathon.api.qloo.com/v2/insights?filter.type=${encodeURIComponent(
            sig.entityType
          )}&signal.interests.entities=${sig.entityId}&take=10`,
      });

      // Connect each source to this signal
      effectiveSources.forEach((src) => {
        links.push({
          source: `src-${src.qlooId}`,
          target: sigId,
          sourceLabel: src.product.name,
          targetLabel: sig.label,
          affinity: sig.affinity,
          qlooSource: `Qloo Taste Insights (Seed: ${src.label})`,
          value: Math.max(1.5, sig.affinity * 3.5),
          color: "rgba(78, 121, 167, 0.45)",
        });
      });
    });

    // 3. Ring 2: Recommended Opportunity Node
    const recId = `rec-${recommendation.entityId}`;
    nodes.push({
      id: recId,
      name: recommendation.name,
      fullUrn: `urn:entity:brand:${recommendation.entityId}`,
      rawId: recommendation.entityId,
      nodeType: "recommendation",
      cleanType: "Recommended Opportunity",
      rawType: "urn:entity:brand",
      color: TABLEAU_PALETTE.emerald,
      val: 16,
      affinityToSource: recommendation.confidence / 100,
      qlooUrl:
        recommendation.qloo_request?.url ||
        `https://hackathon.api.qloo.com/v2/insights?filter.type=urn%3Aentity%3Abrand&signal.interests.entities=${recommendation.entityId}&take=10`,
    });

    // Connect each signal to the recommendation
    signals.forEach((sig) => {
      const sigId = `sig-${sig.entityId}`;
      const affinity = sig.candidateAffinity ?? sig.affinity;
      links.push({
        source: sigId,
        target: recId,
        sourceLabel: sig.label,
        targetLabel: recommendation.name,
        affinity,
        qlooSource: `Qloo Cross-Domain Adjacency (Signal → Opportunity)`,
        value: Math.max(1.5, affinity * 4.5),
        color: "rgba(16, 185, 129, 0.55)",
      });
    });

    return { nodes, links };
  }, [recommendation, sourceProducts]);

  const copyText = async (text: string, label = "Item") => {
    try {
      await navigator.clipboard.writeText(text);
      setToastMessage(`Copied ${label} to clipboard`);
      setTimeout(() => setToastMessage(null), 2500);
    } catch {
      setToastMessage("Copied to clipboard");
      setTimeout(() => setToastMessage(null), 2500);
    }
  };

  const copyAsImage = async () => {
    if (!containerRef.current) return;
    try {
      const blob = await toBlob(containerRef.current, {
        backgroundColor: "#020617",
      });
      if (blob && navigator.clipboard && window.ClipboardItem) {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        setToastMessage("Graph image copied to clipboard!");
      } else {
        const dataUrl = await toPng(containerRef.current);
        const link = document.createElement("a");
        link.download = `cultural-graph-${recommendation.name
          .toLowerCase()
          .replace(/\s+/g, "-")}.png`;
        link.href = dataUrl;
        link.click();
        setToastMessage("Graph image downloaded!");
      }
      setTimeout(() => setToastMessage(null), 3000);
    } catch (err: unknown) {
      console.warn("Image copy error:", err);
      setToastMessage("Could not export image directly");
      setTimeout(() => setToastMessage(null), 3000);
    }
  };

  return (
    <div className="relative w-full h-full flex flex-col bg-slate-950 overflow-hidden select-none">
      {/* Top Toolbar: Node / Link Stats & Copy as Image */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-slate-900/90 border-b border-slate-800 z-10 text-xs font-mono">
        <div className="flex items-center gap-3">
          <span className="text-slate-300 font-semibold">
            Nodes: <span className="text-emerald-400">{graphData.nodes.length}</span> &bull; Edges:{" "}
            <span className="text-emerald-400">{graphData.links.length}</span>
          </span>
          <span className="hidden sm:inline text-slate-500 text-[11px]">
            (Click node for Qloo audit details)
          </span>
        </div>

        <button
          onClick={copyAsImage}
          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-mono border border-slate-700 transition cursor-pointer"
          title="Export graph visual as PNG"
        >
          <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <span>Copy as image</span>
        </button>
      </div>

      {/* Force Graph Container */}
      <div ref={containerRef} className="relative flex-1 w-full h-full">
        <ForceGraph2D
          width={dimensions.width}
          height={dimensions.height}
          graphData={graphData}
          backgroundColor="#020617"
          nodeRelSize={5}
          nodeVal={(node: GraphNode) => node.val}
          nodeColor={(node: GraphNode) => node.color}
          nodeCanvasObject={(node: GraphNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
            const radius = Math.sqrt(node.val) * 4;
            const x = node.x ?? 0;
            const y = node.y ?? 0;

            // Outer glow
            ctx.beginPath();
            ctx.arc(x, y, radius + 2, 0, 2 * Math.PI, false);
            ctx.fillStyle = node.color + "33";
            ctx.fill();

            // Main circle
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, 2 * Math.PI, false);
            ctx.fillStyle = node.color;
            ctx.fill();
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = "#ffffff44";
            ctx.stroke();

            // Label
            const fontSize = Math.max(10 / globalScale, 3);
            ctx.font = `${fontSize}px sans-serif`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillStyle = "#f8fafc";
            ctx.fillText(node.name, x, y + radius + fontSize);
          }}
          nodeLabel={(node: GraphNode) => `
            <div style="background:#0f172a;border:1px solid #334155;padding:8px 12px;border-radius:8px;font-family:monospace;font-size:11px;color:#f8fafc;box-shadow:0 10px 25px rgba(0,0,0,0.5)">
              <div style="font-weight:bold;color:#38bdf8;margin-bottom:2px">${node.name}</div>
              <div style="color:#94a3b8;font-size:10px">Type: <span style="color:#e2e8f0">${node.cleanType}</span></div>
              <div style="color:#64748b;font-size:9.5px;margin-top:4px">${node.fullUrn}</div>
            </div>
          `}
          linkWidth={(link: GraphLink) => link.value}
          linkColor={(link: GraphLink) => link.color}
          linkLabel={(link: GraphLink) => `
            <div style="background:#0f172a;border:1px solid #334155;padding:6px 10px;border-radius:8px;font-family:monospace;font-size:10.5px;color:#f8fafc;box-shadow:0 10px 25px rgba(0,0,0,0.5)">
              <div style="color:#94a3b8;font-size:10px">${link.sourceLabel} → ${link.targetLabel}</div>
              <div style="font-weight:bold;color:#34d399;margin-top:2px">Affinity: ${link.affinity.toFixed(4)}</div>
              <div style="color:#64748b;font-size:9px;margin-top:2px">${link.qlooSource}</div>
            </div>
          `}
          onNodeClick={(node: GraphNode) => setSelectedNode(node)}
          cooldownTicks={120}
          enableNodeDrag={true}
        />

        {/* Slide-out Node Inspector Side Panel */}
        {selectedNode && (
          <div className="absolute top-3 right-3 w-80 max-w-[90%] bg-slate-900/95 border border-slate-700/90 rounded-xl p-4 shadow-2xl backdrop-blur-md font-mono text-xs text-slate-200 space-y-3 z-30 animate-in fade-in slide-in-from-right-3">
            <div className="flex items-start justify-between pb-2 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <span
                  className="w-3 h-3 rounded-full shrink-0"
                  style={{ backgroundColor: selectedNode.color }}
                />
                <span className="font-bold text-white text-sm truncate">
                  {selectedNode.name}
                </span>
              </div>
              <button
                onClick={() => setSelectedNode(null)}
                className="text-slate-400 hover:text-white p-0.5 rounded cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-2">
              <div>
                <div className="text-[10px] uppercase text-slate-500 font-semibold">
                  Entity Type
                </div>
                <div className="text-slate-300 font-medium">
                  {selectedNode.cleanType}{" "}
                  <span className="text-slate-500 text-[10px]">
                    ({selectedNode.rawType})
                  </span>
                </div>
              </div>

              <div>
                <div className="text-[10px] uppercase text-slate-500 font-semibold">
                  Qloo Entity URN ID
                </div>
                <div className="flex items-center justify-between gap-2 p-1.5 rounded bg-slate-950 border border-slate-800 text-[10.5px] select-all">
                  <span className="truncate text-emerald-400">
                    {selectedNode.fullUrn}
                  </span>
                  <button
                    onClick={() => copyText(selectedNode.fullUrn, "Entity URN")}
                    className="px-1.5 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[9.5px] shrink-0 cursor-pointer"
                  >
                    Copy
                  </button>
                </div>
              </div>

              <div>
                <div className="text-[10px] uppercase text-slate-500 font-semibold">
                  Affinity Score
                </div>
                <div className="text-emerald-400 font-bold text-sm">
                  {selectedNode.affinityToSource !== undefined
                    ? selectedNode.affinityToSource.toFixed(4)
                    : "1.0000 (Catalog Seed)"}
                </div>
              </div>

              <div>
                <div className="text-[10px] uppercase text-slate-500 font-semibold">
                  Live Qloo API URL
                </div>
                <div className="relative group mt-1">
                  <pre className="p-2 rounded bg-slate-950 border border-slate-800 text-[10px] text-emerald-400/90 whitespace-pre-wrap break-all max-h-24 overflow-y-auto select-all">
                    {selectedNode.qlooUrl}
                  </pre>
                  <button
                    onClick={() => copyText(selectedNode.qlooUrl, "Qloo URL")}
                    className="absolute top-1.5 right-1.5 px-1.5 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[9.5px] cursor-pointer"
                  >
                    Copy URL
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Color-Blind Safe Legend */}
        <div className="absolute bottom-2 left-2 right-2 flex flex-wrap items-center justify-center gap-3 px-3 py-1.5 rounded-xl bg-slate-900/90 border border-slate-800/80 backdrop-blur-sm text-[10px] font-mono text-slate-400 z-10">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: TABLEAU_PALETTE.blue }} />
            <span>Product</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: TABLEAU_PALETTE.purple }} />
            <span>Musician</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: TABLEAU_PALETTE.orange }} />
            <span>Movie</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: TABLEAU_PALETTE.amber }} />
            <span>Brand</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: TABLEAU_PALETTE.green }} />
            <span>Book</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: TABLEAU_PALETTE.teal }} />
            <span>Destination</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: TABLEAU_PALETTE.emerald }} />
            <span className="text-emerald-400 font-semibold">Opportunity</span>
          </div>
        </div>
      </div>

      {/* Floating Toast Notification */}
      {toastMessage && (
        <div className="absolute top-12 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-slate-900 border border-emerald-500/50 text-emerald-300 px-3.5 py-2 rounded-xl shadow-2xl text-xs font-mono animate-in fade-in slide-in-from-top-2">
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
}

export interface CulturalGraphModalProps {
  recommendation: Recommendation | null;
  sourceProducts?: ResolvedEntity[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CulturalGraphModal({
  recommendation,
  sourceProducts = [],
  open,
  onOpenChange,
}: CulturalGraphModalProps) {
  if (!recommendation) return null;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 animate-in fade-in" />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[95vw] sm:w-[700px] h-[90vh] sm:h-[600px] max-w-[700px] max-h-[600px] bg-slate-950 border border-slate-800 rounded-2xl shadow-2xl z-50 flex flex-col overflow-hidden animate-in fade-in zoom-in-95"
          aria-describedby="cultural-graph-description"
        >
          {/* Modal Header */}
          <div className="flex items-center justify-between px-5 py-3.5 bg-slate-900 border-b border-slate-800">
            <div>
              <Dialog.Title className="text-sm sm:text-base font-bold text-white font-mono flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                Cultural Taste Graph: {recommendation.name}
              </Dialog.Title>
              <Dialog.Description id="cultural-graph-description" className="text-[11px] text-slate-400 font-mono mt-0.5">
                Visualizing cross-domain taste path from catalog products to {recommendation.name}.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition cursor-pointer font-mono"
                aria-label="Close modal"
              >
                ✕
              </button>
            </Dialog.Close>
          </div>

          {/* Graph Canvas */}
          <div className="flex-1 w-full h-full min-h-0 relative">
            <CulturalGraphCanvas
              recommendation={recommendation}
              sourceProducts={sourceProducts}
            />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default CulturalGraphModal;
