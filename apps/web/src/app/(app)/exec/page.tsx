import Link from 'next/link';
import { CalendarClock, TrendingUp, Trophy } from 'lucide-react';
import type { CreatorTier, Tone } from '@influenceos/contracts';
import { getServerApi } from '@/lib/api-server';
import { PageHeader } from '@/components/common/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatCard } from '@/components/ui/stat-card';
import { Badge } from '@/components/ui/badge';
import { Avatar } from '@/components/ui/avatar';
import { EmptyState } from '@/components/ui/empty-state';
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, TableScroll } from '@/components/ui/table';
import { formatCompact, formatCurrency, formatPercent, relativeTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

const TIER_TONE: Record<CreatorTier, Tone> = { GOLD: 'warning', SILVER: 'info', BRONZE: 'accent', NEW: 'neutral' };

/** Executive dashboard (W6-3 + W6-2 web surface): spend-vs-budget, today,
 *  since-yesterday, the cross-brand rollup and the creator leaderboard — all
 *  server-computed, this page only renders. */
export default async function ExecPage() {
  const api = getServerApi();
  const [dash, board] = await Promise.all([api.reports.execDashboard(), api.reports.leaderboard({ limit: 10 })]);
  const c = dash.currency;
  const money = (n: number) => formatCurrency(n, c);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Executive dashboard"
        description="Spend vs budget, what happened today, what changed since yesterday, and where each brand and creator stands — updated live."
      />

      {/* Spend vs budget */}
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard label="Planned budget" value={dash.spendVsBudget.plannedBudget} iconName="wallet" tone="neutral" formatted={money(dash.spendVsBudget.plannedBudget)} />
        <StatCard label="Total spend" value={dash.spendVsBudget.totalSpend} iconName="wallet" tone="info" formatted={money(dash.spendVsBudget.totalSpend)} />
        <StatCard label="Remaining" value={dash.spendVsBudget.remaining} iconName="wallet" tone={dash.spendVsBudget.remaining < 0 ? 'danger' : 'success'} formatted={money(dash.spendVsBudget.remaining)} />
        <StatCard
          label="Budget used"
          value={dash.spendVsBudget.budgetUsedPercent ?? 0}
          iconName="trending"
          tone={(dash.spendVsBudget.budgetUsedPercent ?? 0) > 100 ? 'danger' : 'accent'}
          formatted={dash.spendVsBudget.budgetUsedPercent == null ? 'N/A' : `${dash.spendVsBudget.budgetUsedPercent}%`}
        />
        <StatCard
          label="Unpaid spend"
          value={dash.spendVsBudget.unpaidSpend}
          iconName="wallet"
          tone={dash.spendVsBudget.unpaidSpend > 0 ? 'warning' : 'success'}
          formatted={money(dash.spendVsBudget.unpaidSpend)}
        />
      </section>
      {dash.spendVsBudget.campaignsOverBudget > 0 ? (
        <p className="-mt-4 text-sm text-danger">
          {dash.spendVsBudget.campaignsOverBudget} campaign{dash.spendVsBudget.campaignsOverBudget === 1 ? '' : 's'} over budget.
        </p>
      ) : null}

      {/* Today + since-yesterday */}
      <section className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center gap-2">
            <CalendarClock className="size-5 text-muted-foreground" aria-hidden />
            <CardTitle>Today</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            <Metric label="Content published" value={dash.today.contentPublished} href="/content" />
            <Metric label="Deliverables due" value={dash.today.deliverablesDue} href="/calendar" />
            <Metric label="Campaigns starting" value={dash.today.campaignsStarting} href="/campaigns" />
            <Metric label="Campaigns ending" value={dash.today.campaignsEnding} href="/campaigns" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Since yesterday</CardTitle>
            <span className="text-xs text-muted-foreground">{relativeTime(dash.digest.since)}</span>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            <Metric label="Content published" value={dash.digest.contentPublished} href="/content" />
            <Metric label="Deliverables completed" value={dash.digest.deliverablesCompleted} href="/calendar" />
            <Metric label="Campaigns created" value={dash.digest.campaignsCreated} href="/campaigns" />
            <Metric label="Campaigns completed" value={dash.digest.campaignsCompleted} href="/campaigns" />
            <Metric label="Roster additions" value={dash.digest.rosterAdditions} href="/influencers" />
            <Metric label="Content removed" value={dash.digest.contentRemoved} tone={dash.digest.contentRemoved > 0 ? 'danger' : undefined} href="/content" />
            <Metric label="Shipments delivered" value={dash.digest.shipmentsDelivered} href="/logistics?status=DELIVERED" />
            <Metric
              label="Shipments failed"
              value={dash.digest.shipmentsFailed}
              tone={dash.digest.shipmentsFailed > 0 ? 'danger' : undefined}
              href="/logistics?status=FAILED"
            />
            <Metric label="UGC awaiting review" value={dash.digest.ugcAwaitingReview} tone={dash.digest.ugcAwaitingReview > 0 ? 'danger' : undefined} />
          </CardContent>
        </Card>
      </section>

      {/* Cross-brand rollup */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Brands</h2>
        {dash.brands.length === 0 ? (
          <EmptyState icon={TrendingUp} title="No brands in scope" description="Brand health appears here once you have brands with campaigns." />
        ) : (
          <Card className="overflow-hidden">
            <TableScroll>
              <Table className="min-w-[720px]">
                <TableHead>
                  <TableRow className="border-b border-border bg-surface-muted/60 hover:bg-surface-muted/60">
                    <TableHeaderCell className="ps-5">Brand</TableHeaderCell>
                    <TableHeaderCell align="end">Active</TableHeaderCell>
                    <TableHeaderCell align="end">Spend</TableHeaderCell>
                    <TableHeaderCell align="end">Budget</TableHeaderCell>
                    <TableHeaderCell align="end">Used</TableHeaderCell>
                    <TableHeaderCell align="end">Overdue</TableHeaderCell>
                    <TableHeaderCell align="end">Alerts</TableHeaderCell>
                    <TableHeaderCell align="end">Issues</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {dash.brands.map((b) => (
                    <TableRow key={b.brandId}>
                      <TableCell className="ps-5 font-medium">
                        {b.brandName}
                        {b.overBudget ? <Badge tone="danger" className="ms-2">Over budget</Badge> : null}
                      </TableCell>
                      <TableCell align="end">{b.activeCampaigns}</TableCell>
                      <TableCell align="end">{money(b.totalSpend)}</TableCell>
                      <TableCell align="end">{money(b.plannedBudget)}</TableCell>
                      <TableCell align="end">{b.budgetUsedPercent == null ? '—' : `${b.budgetUsedPercent}%`}</TableCell>
                      <TableCell align="end">{b.overdueDeliverables}</TableCell>
                      <TableCell align="end">{b.contentAlerts}</TableCell>
                      <TableCell align="end">
                        {b.issueCount > 0 ? <Badge tone="warning">{b.issueCount}</Badge> : <span className="text-muted-foreground">0</span>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableScroll>
          </Card>
        )}
      </section>

      {/* Creator leaderboard */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <Trophy className="size-5 text-muted-foreground" aria-hidden /> Top creators
        </h2>
        {board.entries.length === 0 ? (
          <EmptyState icon={Trophy} title="No ranked creators yet" description="Creators appear here once they've committed to campaigns and delivered work." />
        ) : (
          <Card className="overflow-hidden">
            <TableScroll>
              <Table className="min-w-[720px]">
                <TableHead>
                  <TableRow className="border-b border-border bg-surface-muted/60 hover:bg-surface-muted/60">
                    <TableHeaderCell className="ps-5">Creator</TableHeaderCell>
                    <TableHeaderCell align="end">Campaigns</TableHeaderCell>
                    <TableHeaderCell align="end">Published</TableHeaderCell>
                    <TableHeaderCell align="end">Completion</TableHeaderCell>
                    <TableHeaderCell align="end">Tier</TableHeaderCell>
                    <TableHeaderCell align="end">Score</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {board.entries.map((e, i) => (
                    <TableRow key={e.influencerId}>
                      <TableCell className="ps-5">
                        <div className="flex items-center gap-2.5">
                          <span className="w-5 text-end text-sm tabular-nums text-muted-foreground">{i + 1}</span>
                          <Avatar name={e.displayName} src={e.avatarUrl ?? undefined} size="xs" />
                          <div className="min-w-0">
                            <p className="truncate font-medium">{e.displayName}</p>
                            {e.primaryUsername ? <p className="truncate text-xs text-muted-foreground">@{e.primaryUsername}</p> : null}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell align="end">{e.campaigns}</TableCell>
                      <TableCell align="end">{formatCompact(e.deliverablesPublished)}</TableCell>
                      <TableCell align="end">{e.completionRate == null ? '—' : formatPercent(e.completionRate * 100)}</TableCell>
                      <TableCell align="end"><Badge tone={TIER_TONE[e.tier]}>{e.tier}</Badge></TableCell>
                      <TableCell align="end" className="font-semibold">{e.score}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableScroll>
          </Card>
        )}
      </section>

      <p className="text-xs text-muted-foreground">Generated {relativeTime(dash.generatedAt)}.</p>
    </div>
  );
}

function Metric({ label, value, tone, href }: { label: string; value: number; tone?: 'danger'; href?: string }) {
  const body = (
    <>
      <p className={`text-2xl font-semibold tabular-nums ${tone === 'danger' ? 'text-danger' : 'text-foreground'}`}>{formatCompact(value)}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </>
  );
  if (href) {
    return (
      <Link href={href} className="-m-1.5 rounded-lg p-1.5 transition-colors hover:bg-surface-muted">
        {body}
      </Link>
    );
  }
  return <div>{body}</div>;
}
