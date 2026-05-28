'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  sankey,
  sankeyLinkHorizontal,
  sankeyJustify,
  type SankeyGraph,
} from 'd3-sankey';
import { formatCurrency } from '@/lib/utils/format';
import type {
  SankeyDataNode,
  SankeyDataLink,
} from '@/lib/utils/cashflow-sankey';

interface CashflowSankeyChartProps {
  nodes: SankeyDataNode[];
  links: SankeyDataLink[];
  currency: string;
  height?: number;
  emptyMessage?: string;
}

// d3-sankey requires mutable plain objects. We carry our metadata via the same fields.
type LaidNode = SankeyDataNode & {
  index?: number;
  x0?: number;
  x1?: number;
  y0?: number;
  y1?: number;
  value?: number;
  sourceLinks?: LaidLink[];
  targetLinks?: LaidLink[];
};

type LaidLink = {
  source: LaidNode;
  target: LaidNode;
  value: number;
  width?: number;
  y0?: number;
  y1?: number;
  index?: number;
};

const NODE_WIDTH = 18;
const NODE_PADDING = 22;
const LABEL_MARGIN = 8;
const SIDE_PADDING = 140;
const ANIMATION_STAGGER_MS = 90;
// Hide the name label when the node bar is thinner than this — otherwise
// adjacent labels collide. Tooltip still works on hover.
const MIN_HEIGHT_FOR_NAME = 14;
// Only show the secondary value line when there's enough room.
const MIN_HEIGHT_FOR_VALUE = 28;

export function CashflowSankeyChart({
  nodes,
  links,
  currency,
  height = 560,
  emptyMessage,
}: CashflowSankeyChartProps) {
  const t = useTranslations('charts');
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number>(0);
  const [hoverNodeId, setHoverNodeId] = useState<string | null>(null);
  const [hoverLinkIdx, setHoverLinkIdx] = useState<number | null>(null);
  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    title: string;
    detail: string;
  } | null>(null);
  const [mountKey, setMountKey] = useState(0);
  const [expandedOthers, setExpandedOthers] = useState(false);

  // Observe container width for responsive sizing
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        if (w > 0) setWidth(w);
      }
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // Trigger re-mount animation when underlying data changes
  useEffect(() => {
    setMountKey((k) => k + 1);
    setExpandedOthers(false);
  }, [nodes, links]);

  // Total flow into the system = sum of outflows from all source-layer nodes
  // (real income + virtual reserves). Used as denominator for tooltip %.
  // Summing all links would double-count (each unit flows through 2-3 links).
  const totalIncome = useMemo(() => {
    const sourceIdxs = new Set<number>();
    nodes.forEach((n, i) => {
      if (n.layer === 'income') sourceIdxs.add(i);
    });
    return links
      .filter((l) => sourceIdxs.has(l.source))
      .reduce((sum, l) => sum + l.value, 0);
  }, [nodes, links]);

  // Decide whether to render "Others" expanded inline. When expanded, we
  // splice the sub-items into the layer as siblings of the Others node and
  // drop the others link entirely so the user can see the underlying detail.
  const { effectiveNodes, effectiveLinks } = useMemo(() => {
    if (!expandedOthers) return { effectiveNodes: nodes, effectiveLinks: links };
    const othersNode = nodes.find((n) => n.kind === 'others');
    if (!othersNode || !othersNode.subItems || othersNode.subItems.length === 0) {
      return { effectiveNodes: nodes, effectiveLinks: links };
    }
    const othersIdx = nodes.findIndex((n) => n.id === othersNode.id);
    const othersIncomingLinks = links.filter((l) => l.target === othersIdx);

    const totalOthersInflow = othersIncomingLinks.reduce(
      (s, l) => s + l.value,
      0
    );
    if (totalOthersInflow <= 0) {
      return { effectiveNodes: nodes, effectiveLinks: links };
    }

    const newNodes: SankeyDataNode[] = nodes.filter((_, i) => i !== othersIdx);
    const subStartIdx = newNodes.length;
    for (const sub of othersNode.subItems) {
      newNodes.push({
        id: `expense::__others__::${sub.name}`,
        name: sub.name,
        layer: 'output',
        kind: 'expense',
        color: othersNode.color,
      });
    }

    // Reindex helper (since we removed one node before subStartIdx)
    const reindex = (idx: number) => (idx > othersIdx ? idx - 1 : idx);
    const newLinks: SankeyDataLink[] = [];
    for (const link of links) {
      if (link.target === othersIdx) {
        // Split this link proportionally across the sub-items
        for (let k = 0; k < othersNode.subItems.length; k++) {
          const sub = othersNode.subItems[k];
          const fraction = sub.value / totalOthersInflow;
          newLinks.push({
            source: reindex(link.source),
            target: subStartIdx + k,
            value: link.value * fraction,
          });
        }
      } else if (link.source === othersIdx) {
        // Others is a sink; should never be a source. Skip.
        continue;
      } else {
        newLinks.push({
          source: reindex(link.source),
          target: reindex(link.target),
          value: link.value,
        });
      }
    }
    return { effectiveNodes: newNodes, effectiveLinks: newLinks };
  }, [nodes, links, expandedOthers]);

  const graph = useMemo<SankeyGraph<LaidNode, LaidLink> | null>(() => {
    if (width <= 0 || effectiveNodes.length === 0 || effectiveLinks.length === 0) {
      return null;
    }
    const layoutWidth = Math.max(360, width);
    const layoutHeight = Math.max(280, height);

    const cloneNodes: LaidNode[] = effectiveNodes.map((n) => ({ ...n }));
    const cloneLinks = effectiveLinks.map((l) => ({ ...l }));

    const sankeyGen = sankey<LaidNode, LaidLink>()
      .nodeWidth(NODE_WIDTH)
      .nodePadding(NODE_PADDING)
      .nodeAlign(sankeyJustify)
      .nodeId((d) => (d as LaidNode).id)
      .iterations(32)
      // Leave nodeSort/linkSort at d3-sankey defaults — they use a
      // barycenter heuristic that empirically minimizes link crossings
      // better than any naive value-based sort.
      .extent([
        [SIDE_PADDING / 2, 16],
        [layoutWidth - SIDE_PADDING / 2, layoutHeight - 24],
      ]);

    return sankeyGen({
      nodes: cloneNodes,
      links: cloneLinks.map((l) => ({
        ...l,
        source: cloneNodes[l.source as number].id,
        target: cloneNodes[l.target as number].id,
      })) as unknown as LaidLink[],
    });
  }, [effectiveNodes, effectiveLinks, width, height]);

  // Build the set of node ids and link indices that should be highlighted
  // (when hovering a node, light up all connected paths upstream + downstream).
  const { highlightedNodeIds, highlightedLinkIdxs } = useMemo(() => {
    if (!graph) return { highlightedNodeIds: new Set<string>(), highlightedLinkIdxs: new Set<number>() };
    const nodeIds = new Set<string>();
    const linkIdxs = new Set<number>();

    if (hoverLinkIdx !== null) {
      const link = graph.links[hoverLinkIdx];
      if (link) {
        linkIdxs.add(hoverLinkIdx);
        nodeIds.add(link.source.id);
        nodeIds.add(link.target.id);
      }
    }

    if (hoverNodeId !== null) {
      const visited = new Set<string>();
      const stack: string[] = [hoverNodeId];
      while (stack.length) {
        const id = stack.pop()!;
        if (visited.has(id)) continue;
        visited.add(id);
        nodeIds.add(id);
        graph.links.forEach((l, i) => {
          if (l.source.id === id) {
            linkIdxs.add(i);
            stack.push(l.target.id);
          }
          if (l.target.id === id) {
            linkIdxs.add(i);
            stack.push(l.source.id);
          }
        });
      }
    }

    return { highlightedNodeIds: nodeIds, highlightedLinkIdxs: linkIdxs };
  }, [graph, hoverLinkIdx, hoverNodeId]);

  const anyHover = hoverNodeId !== null || hoverLinkIdx !== null;

  const handleLinkEnter = (i: number, link: LaidLink, event: React.MouseEvent) => {
    setHoverLinkIdx(i);
    const rect = containerRef.current?.getBoundingClientRect();
    const x = event.clientX - (rect?.left ?? 0);
    const y = event.clientY - (rect?.top ?? 0);
    const pct = totalIncome > 0 ? (link.value / totalIncome) * 100 : 0;
    setTooltip({
      x,
      y,
      title: `${link.source.name} → ${link.target.name}`,
      detail: `${formatCurrency(link.value, currency)} · ${pct.toFixed(1)}%`,
    });
  };

  const handleNodeEnter = (node: LaidNode, event: React.MouseEvent) => {
    setHoverNodeId(node.id);
    const rect = containerRef.current?.getBoundingClientRect();
    const x = event.clientX - (rect?.left ?? 0);
    const y = event.clientY - (rect?.top ?? 0);
    setTooltip({
      x,
      y,
      title: node.name,
      detail: formatCurrency(node.value ?? 0, currency),
    });
  };

  const handleLeave = () => {
    setHoverLinkIdx(null);
    setHoverNodeId(null);
    setTooltip(null);
  };

  const handleNodeClick = (node: LaidNode) => {
    if (node.kind === 'others' || node.id.startsWith('expense::__others__')) {
      setExpandedOthers((v) => !v);
    }
  };

  if (effectiveNodes.length === 0 || effectiveLinks.length === 0) {
    return (
      <div
        ref={containerRef}
        className="flex items-center justify-center text-sm text-slate-500"
        style={{ height }}
      >
        {emptyMessage ?? t('noData')}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative w-full"
      style={{ height }}
      onMouseLeave={handleLeave}
    >
      {graph ? (
        <svg
          key={mountKey}
          width="100%"
          height={height}
          viewBox={`0 0 ${Math.max(360, width)} ${height}`}
          preserveAspectRatio="none"
          className="cashflow-sankey-svg"
        >
          <defs>
            {graph.links.map((link, i) => {
              const id = `cashflow-link-grad-${i}`;
              const x1 = link.source.x1 ?? 0;
              const x2 = link.target.x0 ?? 0;
              return (
                <linearGradient
                  key={id}
                  id={id}
                  gradientUnits="userSpaceOnUse"
                  x1={x1}
                  x2={x2}
                >
                  <stop
                    offset="0%"
                    stopColor={link.source.color}
                    stopOpacity={0.55}
                  />
                  <stop
                    offset="100%"
                    stopColor={link.target.color}
                    stopOpacity={0.55}
                  />
                </linearGradient>
              );
            })}
          </defs>

          {/* Links */}
          <g fill="none">
            {graph.links.map((link, i) => {
              const d = sankeyLinkHorizontal()(link as never) as string;
              const dim = anyHover && !highlightedLinkIdxs.has(i);
              const sourceColumn = link.source.layer === 'income'
                ? 0
                : link.source.layer === 'business'
                ? 1
                : link.source.layer === 'personal'
                ? 2
                : 3;
              const delay = sourceColumn * ANIMATION_STAGGER_MS;
              return (
                <path
                  key={`link-${i}-${mountKey}`}
                  d={d}
                  stroke={`url(#cashflow-link-grad-${i})`}
                  strokeWidth={Math.max(1, link.width ?? 0)}
                  strokeLinecap="butt"
                  className="cashflow-link"
                  style={{
                    opacity: dim ? 0.22 : 1,
                    transition: 'opacity 180ms ease',
                    animationDelay: `${delay}ms`,
                  }}
                  onMouseEnter={(e) => handleLinkEnter(i, link, e)}
                  onMouseMove={(e) => handleLinkEnter(i, link, e)}
                  onMouseLeave={handleLeave}
                />
              );
            })}
          </g>

          {/* Nodes */}
          <g>
            {graph.nodes.map((node) => {
              const x0 = node.x0 ?? 0;
              const x1 = node.x1 ?? 0;
              const y0 = node.y0 ?? 0;
              const y1 = node.y1 ?? 0;
              const nodeWidth = x1 - x0;
              const nodeHeight = Math.max(2, y1 - y0);
              const dim = anyHover && !highlightedNodeIds.has(node.id);
              const labelOnRight = (node.x0 ?? 0) < (width - SIDE_PADDING) / 2;
              const labelX = labelOnRight ? x1 + LABEL_MARGIN : x0 - LABEL_MARGIN;
              const labelAnchor = labelOnRight ? 'start' : 'end';
              const cursor =
                node.kind === 'others' || node.id.startsWith('expense::__others__')
                  ? 'pointer'
                  : 'default';
              const delay =
                (node.layer === 'income'
                  ? 0
                  : node.layer === 'business'
                  ? 1
                  : node.layer === 'personal'
                  ? 2
                  : 3) * ANIMATION_STAGGER_MS;

              return (
                <g
                  key={`node-${node.id}`}
                  style={{
                    opacity: dim ? 0.45 : 1,
                    transition: 'opacity 180ms ease',
                    cursor,
                  }}
                  onMouseEnter={(e) => handleNodeEnter(node, e)}
                  onMouseMove={(e) => handleNodeEnter(node, e)}
                  onMouseLeave={handleLeave}
                  onClick={() => handleNodeClick(node)}
                >
                  <rect
                    x={x0}
                    y={y0}
                    width={nodeWidth}
                    height={nodeHeight}
                    fill={node.color}
                    rx={3}
                    className="cashflow-node"
                    style={{ animationDelay: `${delay}ms` }}
                  />
                  {nodeHeight >= MIN_HEIGHT_FOR_NAME && (
                    <text
                      x={labelX}
                      y={
                        nodeHeight >= MIN_HEIGHT_FOR_VALUE
                          ? (y0 + y1) / 2 - 6
                          : (y0 + y1) / 2
                      }
                      dy="0.35em"
                      fill={dim ? '#475569' : '#cbd5e1'}
                      fontSize={12}
                      fontWeight={500}
                      textAnchor={labelAnchor}
                      style={{
                        pointerEvents: 'none',
                        transition: 'fill 200ms ease',
                      }}
                    >
                      {node.name}
                      {node.kind === 'others' && (
                        <tspan dx={4} fill="#64748b" fontSize={10}>
                          ({node.subItems?.length ?? 0})
                        </tspan>
                      )}
                    </text>
                  )}
                  {nodeHeight >= MIN_HEIGHT_FOR_VALUE && (
                    <text
                      x={labelX}
                      y={(y0 + y1) / 2 + 8}
                      dy="0.35em"
                      fill="#64748b"
                      fontSize={10}
                      textAnchor={labelAnchor}
                      style={{ pointerEvents: 'none' }}
                    >
                      {formatCurrency(node.value ?? 0, currency)}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </svg>
      ) : null}

      {tooltip && (
        <div
          className="pointer-events-none absolute z-10 rounded-md border border-slate-700 bg-slate-900/95 px-3 py-2 text-xs shadow-lg backdrop-blur-sm"
          style={{
            left: Math.min(tooltip.x + 12, (width || 800) - 220),
            top: Math.max(0, tooltip.y - 48),
          }}
        >
          <div className="font-semibold text-white">{tooltip.title}</div>
          <div className="mt-0.5 text-slate-300">{tooltip.detail}</div>
        </div>
      )}
    </div>
  );
}
