import { d3Curve, defineChart, link, rect, text } from '@tanstack/charts'
import { sankeyDiagram, type SankeyNode } from '@tanstack/charts/network/sankey'
import { Chart } from '@tanstack/charts/react'
import { curveBumpX } from 'd3-shape'
import { useMemo } from 'react'
import { NoData } from '@/components/NoData'
import { formatCount } from '@/lib/format'
import type { AppFlow as Flow } from '@/lib/queries'

/** What a node means, which sets its colour: the funnel stage tokens, and grey for leaving. */
type Tone = 'downloads' | 'trial' | 'paid' | 'running' | 'left'

const TONE_COLOR: Record<Tone, string> = {
  downloads: 'var(--downloads)',
  trial: 'color-mix(in oklab, var(--revenue) 55%, var(--card))',
  paid: 'var(--revenue)',
  running: 'color-mix(in oklab, var(--revenue) 30%, var(--card))',
  left: 'var(--faint)',
}

interface FlowNode {
  id: string
  label: string
  tone: Tone
}

interface FlowLink {
  source: string
  target: string
  value: number
}

const STORE_LABEL: Record<string, string> = { app_store: 'App Store', google_play: 'Google Play' }

/**
 * Downloads by store, what share went on to a trial or straight to a paid subscription, and what
 * became of the trials. Every link is a count of the same people, so widths add up; social views
 * are left out, since nothing ties a view to a download.
 */
function graphOf(flow: Flow): { nodes: FlowNode[]; links: FlowLink[]; overflow: boolean } | null {
  const downloads = flow.downloads.total
  const { converted, expired, running } = flow.trialOutcomes
  const outcomes = converted === null ? null : converted + (expired ?? 0) + (running ?? 0)
  // Trials started, counted the way their outcomes are, so the trial node's in and out match.
  const trials = outcomes ?? flow.trials
  if (!downloads || trials === null) return null

  const nodes: FlowNode[] = []
  const links: FlowLink[] = []
  const add = (node: FlowNode, from: string, value: number | null) => {
    if (!value || value <= 0) return
    nodes.push(node)
    links.push({ source: from, target: node.id, value })
  }

  for (const [store, value] of Object.entries(flow.downloads.bySource)) {
    if (value > 0) {
      nodes.push({ id: store, label: STORE_LABEL[store] ?? store, tone: 'downloads' })
      links.push({ source: store, target: 'downloads', value })
    }
  }
  nodes.push({ id: 'downloads', label: 'Downloads', tone: 'downloads' })
  // In the order they stack in the last column: the trials' outcomes, then the other downloads.
  add({ id: 'trial', label: 'Started a trial', tone: 'trial' }, 'downloads', trials)
  add({ id: 'converted', label: 'Converted', tone: 'paid' }, 'trial', converted)
  add({ id: 'running', label: 'Still in trial', tone: 'running' }, 'trial', running)
  add({ id: 'expired', label: 'Trial expired', tone: 'left' }, 'trial', expired)
  add({ id: 'direct', label: 'Paid without a trial', tone: 'paid' }, 'downloads', flow.directSubscriptions)
  // More trials and purchases than downloads happens (reinstalls, a second device), so the
  // rest is only drawn when there is one.
  const rest = downloads - trials - (flow.directSubscriptions ?? 0)
  add({ id: 'none', label: 'No purchase', tone: 'left' }, 'downloads', rest)
  return { nodes, links, overflow: rest < 0 }
}

/** Whether the app has the downloads and trials this flow needs. */
export const canDrawFlow = (flow: Flow) => graphOf(flow) !== null

type Laid = SankeyNode<FlowNode, FlowLink, string>

/** Downloads by store, where they went, and what became of the trials, over the range. */
export function AppFlow({ flow }: { flow: Flow }) {
  const graph = useMemo(() => graphOf(flow), [flow])

  const definition = useMemo(() => {
    if (!graph) return null
    const tones = [...new Set(graph.nodes.map((node) => node.tone))]
    const toneOf = new Map(graph.nodes.map((node) => [node.id, node.tone]))
    return defineChart({
      marks: [
        sankeyDiagram({
          nodes: graph.nodes,
          links: graph.links,
          nodeKey: 'id',
          source: 'source',
          target: 'target',
          value: 'value',
          // Every end point (an outcome, or a download that went nowhere) in the last column.
          align: 'justify',
          // Keep the order given: stores, then outcomes best first.
          nodeSort: null,
          nodeWidth: 12,
          nodePadding: 22,
          // Room for the labels: beside the first and last columns, above the middle ones.
          inset: ({ width }) => ({ top: 42, bottom: 4, left: Math.min(120, width * 0.2), right: Math.min(150, width * 0.26) }),
          iterations: 32,
          marks: ({ nodes, links }) => {
            const last = Math.max(...nodes.map((node) => node.layer))
            const where = (node: Laid) => (node.layer === 0 ? 'before' : node.layer === last ? 'after' : 'above')
            // The last column holds small outcomes close together, so each takes one line there.
            const label = (node: Laid) =>
              where(node) === 'after' ? `${node.data.label} · ${formatCount(node.value)}` : node.data.label
            const amount = (node: Laid) => formatCount(node.value)
            const x = (node: Laid) =>
              ({ before: node.x0 - 8, after: node.x1 + 8, above: (node.x0 + node.x1) / 2 })[where(node)]
            // Above a middle node, both lines clear its top, where its links leave.
            const y = (node: Laid) => (where(node) === 'above' ? node.y0 - 20 : node.y)
            const anchor = (node: Laid) => ({ before: 'end', after: 'start', above: 'middle' } as const)[where(node)]
            return [
              link(links, {
                id: 'links',
                x1: 'x1',
                y1: 'y1',
                x2: 'x2',
                y2: 'y2',
                stroke: (row) => TONE_COLOR[toneOf.get(String(row.target)) ?? 'left'],
                strokeOpacity: 0.35,
                strokeWidth: (row) => Math.max(1, row.width),
                lineCap: 'butt',
                curve: d3Curve(curveBumpX),
              }),
              ...tones.map((tone) =>
                rect(
                  nodes.filter((node) => node.data.tone === tone),
                  { id: `nodes-${tone}`, x1: 'x0', x2: 'x1', y1: 'y0', y2: 'y1', fill: TONE_COLOR[tone] },
                ),
              ),
              text(nodes, {
                id: 'names',
                x,
                y,
                text: label,
                anchor,
                dy: (node) => (where(node) === 'after' ? 4 : -7),
                fontSize: 12,
                fontWeight: 600,
                fill: 'var(--foreground)',
              }),
              text(
                nodes.filter((node) => where(node) !== 'after'),
                {
                id: 'values',
                x,
                y,
                text: amount,
                anchor,
                dy: 9,
                fontSize: 12,
                fill: 'var(--muted-foreground)',
              },
              ),
            ]
          },
        }),
      ],
      scales: { x: null, y: null },
      guides: false,
      margin: 0,
    })
  }, [graph])

  if (!graph || !definition) {
    return (
      <NoData label="This flow needs downloads from a store and trials from RevenueCat in the range." />
    )
  }

  return (
    <>
      <Chart
        definition={definition}
        height={300}
        initialWidth={720}
        ariaLabel="Where downloads went: trials, paid subscriptions, and what became of the trials"
      />
      {graph.overflow && (
        <p className="mt-2 text-xs text-muted-foreground">
          More trials and purchases than downloads in this range, as reinstalls and second devices
          are not counted as new downloads; the downloads bar is drawn at the larger of the two.
        </p>
      )}
    </>
  )
}
