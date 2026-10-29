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

  const graphData = useMemo(() => {
    const nodes: GraphNode[] = [];
    const links: GraphLink[] = [];

    const signals = recommendation.supportingSignals || [];

    // Filter to sources that actually surfaced signals for this recommendation (if tracked)
    const activeSourcesMap = new Map<string, ResolvedEntity>();
    if (sourceProducts && sourceProducts.length > 0) {
      signals.forEach((sig) => {
        if (sig.sourceEntityId) {
          const match = sourceProducts.find((p) => p.qlooId === sig.sourceEntityId);
          if (match) activeSourcesMap.set(match.qlooId, match);
        } else if (sig.sourceProduct) {
          const match = sourceProducts.find((p) => p.product.name === sig.sourceProduct);
          if (match) activeSourcesMap.set(match.qlooId, match);
        }
      });
    }

    const effectiveSources =
      activeSourcesMap.size > 0
        ? Array.from(activeSourcesMap.values())
        : sourceProducts.length > 0
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

      // Connect only to the actual source product that surfaced this signal (or first source if unspecified)
      const matchingSources = effectiveSources.filter(
        (src) =>
          (sig.sourceEntityId && src.qlooId === sig.sourceEntityId) ||
          (sig.sourceProduct && src.product.name === sig.sourceProduct)
      );
      const sourcesToConnect =
        matchingSources.length > 0 ? matchingSources : effectiveSources.slice(0, 1);

      sourcesToConnect.forEach((src) => {
        links.push({
          source: `src-${src.qlooId}`,
          target: sigId,
          sourceLabel: src.product.name,
          targetLabel: sig.label,
          affinity: sig.affinity,
          qlooSource: `Stage 2: Catalog-to-Signal Affinity (${src.product.name} → ${sig.label})`,
          value: Math.max(1.5, sig.affinity * 3.2),
          color: "rgba(78, 121, 167, 0.45)",
        });
      });
    });

    const recId = `rec-${recommendation.entityId}`;
    nodes.push({
      id: recId,
      name: recommendation.name,
      fullUrn: `urn:entity:brand:${recommendation.entityId}`,
      rawId: recommendation.entityId,
      nodeType: "recommendation",
      cleanType: "Brand Inspiration (Qloo Brand Entity)",
      rawType: "urn:entity:brand",
      color: TABLEAU_PALETTE.emerald,
      val: 16,
      affinityToSource: recommendation.confidence / 100,
      qlooUrl:
        recommendation.qloo_request?.url ||
        `https://hackathon.api.qloo.com/v2/insights?filter.type=urn%3Aentity%3Abrand&signal.interests.entities=${recommendation.entityId}&take=10`,
    });

    signals.forEach((sig) => {
      const sigId = `sig-${sig.entityId}`;
      const affinity = sig.candidateAffinity ?? sig.affinity;
      links.push({
        source: sigId,
        target: recId,
        sourceLabel: sig.label,
        targetLabel: recommendation.name,
        affinity,
        qlooSource: `Stage 3: Signal-to-Candidate Affinity (${sig.label} → ${recommendation.name})`,
        value: Math.max(1.5, affinity * 4.0),
        color: "rgba(30, 77, 59, 0.55)",
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
        backgroundColor: "#FAF9F6",
      });
      if (blob && navigator.clipboard && window.ClipboardItem) {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        setToastMessage("Graph image copied to clipboard");
      } else {
        const dataUrl = await toPng(containerRef.current);
        const link = document.createElement("a");
        link.download = `cultural-graph-${recommendation.name
          .toLowerCase()
          .replace(/\s+/g, "-")}.png`;
        link.href = dataUrl;
        link.click();
        setToastMessage("Graph image downloaded");
      }
      setTimeout(() => setToastMessage(null), 3000);
    } catch (err: unknown) {
      console.warn("Image copy error:", err);
      setToastMessage("Could not export image directly");
      setTimeout(() => setToastMessage(null), 3000);
    }
  };

  return (
    <div className="relative w-full h-full flex flex-col bg-[#FAF9F6] overflow-hidden select-none">
      {/* Top Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 bg-stone-50 border-b border-stone-200 z-10 text-xs">
        <div className="flex items-center gap-3 text-stone-600">
          <span className="font-medium tabular-nums">
            Nodes: <strong className="text-stone-900">{graphData.nodes.length}</strong> &bull; Edges:{" "}
            <strong className="text-stone-900">{graphData.links.length}</strong>
          </span>
          <span className="hidden sm:inline text-stone-500">
            Select any node to inspect Qloo entity details
          </span>
        </div>

        <button
          type="button"
          onClick={copyAsImage}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white hover:bg-stone-100 text-stone-800 text-xs font-medium border border-stone-300 transition-colors cursor-pointer shadow-2xs"
          title="Export graph visual as PNG"
        >
          <svg className="w-3.5 h-3.5 text-[#1E4D3B]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
          backgroundColor="#FAF9F6"
          nodeRelSize={5}
          nodeVal={(node: GraphNode) => node.val}
          nodeColor={(node: GraphNode) => node.color}
          nodeCanvasObject={(node: GraphNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
            const radius = Math.sqrt(node.val) * 3.8;
            const x = node.x ?? 0;
            const y = node.y ?? 0;

            // Subtle ring
            ctx.beginPath();
            ctx.arc(x, y, radius + 2, 0, 2 * Math.PI, false);
            ctx.fillStyle = node.color + "22";
            ctx.fill();

            // Main node circle
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, 2 * Math.PI, false);
            ctx.fillStyle = node.color;
            ctx.fill();
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = "#ffffff";
            ctx.stroke();

            // Label
            const fontSize = Math.max(10 / globalScale, 3.2);
            ctx.font = `500 ${fontSize}px sans-serif`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillStyle = "#1c1917";
            ctx.fillText(node.name, x, y + radius + fontSize + 1);
          }}
          nodeLabel={(node: GraphNode) => `
            <div style="background:#1c1917;border:1px solid #44403c;padding:7px 10px;border-radius:6px;font-family:sans-serif;font-size:11px;color:#fafaf9;box-shadow:0 4px 12px rgba(0,0,0,0.18)">
              <div style="font-weight:600;color:#ffffff;margin-bottom:2px">${node.name}</div>
              <div style="color:#d6d3d1;font-size:10px">Type: <span style="color:#ffffff">${node.cleanType}</span></div>
              <div style="color:#a8a29e;font-family:monospace;font-size:9.5px;margin-top:3px">${node.fullUrn}</div>
            </div>
          `}
          linkWidth={(link: GraphLink) => link.value}
          linkColor={(link: GraphLink) => link.color}
          linkLabel={(link: GraphLink) => `
            <div style="background:#1c1917;border:1px solid #44403c;padding:6px 10px;border-radius:6px;font-family:sans-serif;font-size:10.5px;color:#fafaf9;box-shadow:0 4px 12px rgba(0,0,0,0.18)">
              <div style="color:#d6d3d1;font-size:10px">${link.sourceLabel} → ${link.targetLabel}</div>
              <div style="font-weight:600;color:#6ee7b7;font-family:monospace;margin-top:2px">Affinity: ${link.affinity.toFixed(4)}</div>
              <div style="color:#a8a29e;font-size:9.5px;margin-top:2px">${link.qlooSource}</div>
            </div>
          `}
          onNodeClick={(node: GraphNode) => setSelectedNode(node)}
          cooldownTicks={120}
          enableNodeDrag={true}
        />

        {/* Node Inspector Side Panel */}
        {selectedNode && (
          <div className="absolute top-3 right-3 w-72 sm:w-80 max-w-[92%] bg-white/95 border border-stone-200 rounded-xl p-4 shadow-lg backdrop-blur-xs text-xs text-stone-800 space-y-3 z-30">
            <div className="flex items-start justify-between pb-2 border-b border-stone-200">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: selectedNode.color }}
                />
                <span className="font-semibold text-stone-900 text-sm truncate">
                  {selectedNode.name}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setSelectedNode(null)}
                className="text-stone-400 hover:text-stone-800 p-0.5 rounded cursor-pointer"
                aria-label="Close node inspector"
              >
                ✕
              </button>
            </div>

            <div className="space-y-2.5">
              <div>
                <div className="text-[11px] text-stone-500 font-medium">
                  Entity type
                </div>
                <div className="text-stone-900 font-medium mt-0.5">
                  {selectedNode.cleanType}{" "}
                  <span className="text-stone-500 font-mono text-[11px] font-normal">
                    ({selectedNode.rawType})
                  </span>
                </div>
              </div>

              <div>
                <div className="text-[11px] text-stone-500 font-medium">
                  Qloo entity ID
                </div>
                <div className="flex items-center justify-between gap-2 p-1.5 mt-0.5 rounded-md bg-stone-50 border border-stone-200 font-mono text-[11px] select-all">
                  <span className="truncate text-[#1E4D3B]">
                    {selectedNode.fullUrn}
                  </span>
                  <button
                    type="button"
                    onClick={() => copyText(selectedNode.fullUrn, "Entity URN")}
                    className="px-2 py-0.5 bg-white hover:bg-stone-100 text-stone-700 border border-stone-200 rounded text-[10px] font-sans font-medium shrink-0 cursor-pointer"
                  >
                    Copy
                  </button>
                </div>
              </div>

              <div>
                <div className="text-[11px] text-stone-500 font-medium">
                  Affinity to source product
                </div>
                <div className="text-[#1E4D3B] font-mono font-semibold text-sm tabular-nums mt-0.5">
                  {selectedNode.affinityToSource !== undefined
                    ? selectedNode.affinityToSource.toFixed(4)
                    : "1.0000 (Catalog Seed)"}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-stone-500 font-medium">
                    Qloo request URL
                  </span>
                  <button
                    type="button"
                    onClick={() => copyText(selectedNode.qlooUrl, "Qloo URL")}
                    className="text-[11px] text-[#1E4D3B] hover:underline cursor-pointer font-medium"
                  >
                    Copy URL
                  </button>
                </div>
                <pre className="p-2 mt-1 rounded-md bg-stone-50 border border-stone-200 font-mono text-[10px] text-stone-700 whitespace-pre-wrap break-all max-h-20 overflow-y-auto select-all">
                  {selectedNode.qlooUrl}
                </pre>
              </div>
            </div>
          </div>
        )}

        {/* Color-Blind Safe Legend */}
        <div className="absolute bottom-2.5 left-2.5 right-2.5 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 px-3 py-1.5 rounded-lg bg-white/95 border border-stone-200 shadow-2xs text-[11px] text-stone-600 z-10">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: TABLEAU_PALETTE.blue }} />
            <span>Catalog Product</span>
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
            <span className="text-stone-900 font-medium">Brand Inspiration</span>
          </div>
        </div>
      </div>

      {/* Floating Toast */}
      {toastMessage && (
        <div
          role="status"
          aria-live="polite"
          className="absolute top-12 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-stone-900 text-white px-3.5 py-2 rounded-lg shadow-lg text-xs font-medium"
        >
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
        <Dialog.Overlay className="fixed inset-0 bg-stone-950/40 backdrop-blur-[1px] z-50" />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[95dvw] sm:w-[700px] h-[88dvh] sm:h-[600px] max-w-[700px] max-h-[600px] bg-white border border-stone-200 rounded-xl shadow-xl z-50 flex flex-col overflow-hidden"
          aria-describedby="cultural-graph-description"
        >
          {/* Modal Header */}
          <div className="flex items-center justify-between px-5 py-3.5 bg-white border-b border-stone-200">
            <div>
              <Dialog.Title className="text-sm sm:text-base font-semibold text-stone-900 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[#1E4D3B]" />
                Cultural affinity graph: {recommendation.name}
              </Dialog.Title>
              <Dialog.Description
                id="cultural-graph-description"
                className="text-xs text-stone-500 mt-0.5"
              >
                Cross-domain audience affinity path from your resolved catalog to {recommendation.name}.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="text-stone-400 hover:text-stone-800 p-1.5 rounded-lg hover:bg-stone-100 transition-colors cursor-pointer"
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
