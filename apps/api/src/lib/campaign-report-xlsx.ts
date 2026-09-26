import type { CampaignReportDTO, ReportTargetDTO } from '@influenceos/contracts';
import { buildXlsx, type Cell, type Sheet } from './xlsx';

/** Every label the workbook prints, in the two languages the brand may read. */
const LABELS = {
  en: {
    summary: 'Summary',
    creators: 'Creators',
    posts: 'Posts',
    period: 'Period',
    generated: 'Generated',
    metricsUpdated: 'Numbers last updated',
    metric: 'Metric',
    result: 'Result',
    target: 'Target',
    ofTarget: '% of target',
    creatorsCount: 'Creators',
    postsLive: 'Posts live',
    views: 'Views',
    engagements: 'Engagements',
    engagementRate: 'Engagement rate (%)',
    spend: 'Spend',
    budget: 'Budget',
    costPerView: 'Cost per view',
    costPerEngagement: 'Cost per engagement',
    notes: 'Notes',
    creator: 'Creator',
    handle: 'Handle',
    platforms: 'Platforms',
    postsPlanned: 'Posts planned',
    platform: 'Platform',
    published: 'Published',
    link: 'Link',
    status: 'Status',
    caption: 'Caption',
    live: 'Live',
    removed: 'Removed',
    story: 'Story (kept in the app)',
    currency: 'Currency',
  },
  ar: {
    summary: 'الملخص',
    creators: 'المؤثرون',
    posts: 'المنشورات',
    period: 'الفترة',
    generated: 'تاريخ الإعداد',
    metricsUpdated: 'آخر تحديث للأرقام',
    metric: 'المؤشر',
    result: 'النتيجة',
    target: 'المستهدف',
    ofTarget: '٪ من المستهدف',
    creatorsCount: 'عدد المؤثرين',
    postsLive: 'المنشورات المنشورة حاليًا',
    views: 'المشاهدات',
    engagements: 'التفاعلات',
    engagementRate: 'معدل التفاعل (٪)',
    spend: 'الإنفاق',
    budget: 'الميزانية',
    costPerView: 'تكلفة المشاهدة',
    costPerEngagement: 'تكلفة التفاعل',
    notes: 'ملاحظات',
    creator: 'المؤثر',
    handle: 'الحساب',
    platforms: 'المنصات',
    postsPlanned: 'المنشورات المخطط لها',
    platform: 'المنصة',
    published: 'تاريخ النشر',
    link: 'الرابط',
    status: 'الحالة',
    caption: 'النص المنشور',
    live: 'منشور',
    removed: 'محذوف',
    story: 'ستوري (محفوظة في التطبيق)',
    currency: 'العملة',
  },
} as const;

const day = (value: string | null) => (value ? value.slice(0, 10) : '');

function targetRow(
  label: string,
  t: ReportTargetDTO,
  style: 'int' | 'decimal1' | 'rate' | 'money',
): Cell[] {
  return [
    { value: label, style: 'bold' },
    { value: t.actual, style },
    { value: t.target, style },
    { value: t.percent, style: 'int' },
  ];
}

/** The client report as an Excel workbook: Summary, Creators and Posts sheets. */
export function campaignReportXlsx(report: CampaignReportDTO): Buffer {
  const L = LABELS[report.locale];
  const rtl = report.locale === 'ar';
  const costs = report.includeCosts;
  const t = report.totals;
  const c = report.campaign;

  const summary: Cell[][] = [
    [{ value: `${c.name} — ${c.brandName}`, style: 'title' }],
    [L.period, [day(c.startDate), day(c.endDate)].filter(Boolean).join(' – ')],
    [L.generated, day(report.generatedAt)],
    [L.metricsUpdated, day(report.metricsLastSyncedAt)],
    [],
    [
      { value: L.metric, style: 'header' },
      { value: L.result, style: 'header' },
      { value: L.target, style: 'header' },
      { value: L.ofTarget, style: 'header' },
    ],
    [
      { value: L.creatorsCount, style: 'bold' },
      { value: t.creators, style: 'int' },
    ],
    [
      { value: L.postsLive, style: 'bold' },
      { value: t.postsLive, style: 'int' },
      { value: t.postsPlanned, style: 'int' },
      {
        value: t.postsPlanned > 0 ? Math.round((t.postsLive / t.postsPlanned) * 100) : null,
        style: 'int',
      },
    ],
    targetRow(L.views, t.views, 'int'),
    targetRow(L.engagements, t.engagements, 'int'),
    targetRow(L.engagementRate, t.engagementRate, 'decimal1'),
  ];
  if (costs) {
    summary.push(
      [
        { value: `${L.spend} (${c.currency})`, style: 'bold' },
        { value: t.spend, style: 'money' },
        { value: t.plannedBudget, style: 'money' },
        {
          value:
            t.spend != null && t.plannedBudget
              ? Math.round((t.spend / t.plannedBudget) * 100)
              : null,
          style: 'int',
        },
      ],
      targetRow(`${L.costPerView} (${c.currency})`, t.costPerView, 'rate'),
      [
        { value: `${L.costPerEngagement} (${c.currency})`, style: 'bold' },
        { value: t.costPerEngagement, style: 'rate' },
      ],
    );
  }
  if (report.summary) summary.push([], [{ value: L.notes, style: 'bold' }], [report.summary]);

  const creatorHead: string[] = [
    L.creator,
    L.handle,
    L.platforms,
    L.postsLive,
    L.postsPlanned,
    L.views,
    L.engagements,
    L.engagementRate,
  ];
  if (costs) creatorHead.push(`${L.spend} (${c.currency})`, `${L.costPerView} (${c.currency})`);
  const creators: Cell[][] = [
    creatorHead.map((h) => ({ value: h, style: 'header' as const })),
    ...report.creators.map((r) => {
      const row: Cell[] = [
        r.name,
        r.handle ? `@${r.handle}` : '',
        r.platforms.join(', '),
        { value: r.postsLive, style: 'int' },
        { value: r.postsPlanned, style: 'int' },
        { value: r.views, style: 'int' },
        { value: r.engagements, style: 'int' },
        { value: r.engagementRate, style: 'decimal1' },
      ];
      if (costs)
        row.push({ value: r.spend, style: 'money' }, { value: r.costPerView, style: 'rate' });
      return row;
    }),
  ];

  const postHead: string[] = [
    L.creator,
    L.platform,
    L.published,
    L.views,
    L.engagements,
    L.engagementRate,
  ];
  if (costs) postHead.push(`${L.costPerView} (${c.currency})`);
  postHead.push(L.status, L.link, L.caption);
  const posts: Cell[][] = [
    postHead.map((h) => ({ value: h, style: 'header' as const })),
    ...report.posts.map((p) => {
      const row: Cell[] = [
        p.creatorName ?? '',
        p.platform,
        day(p.publishedAt),
        { value: p.views, style: 'int' },
        { value: p.engagements, style: 'int' },
        { value: p.engagementRate, style: 'decimal1' },
      ];
      if (costs) row.push({ value: p.costPerView, style: 'rate' });
      row.push(p.removed ? L.removed : L.live, p.url ?? L.story, p.caption ?? '');
      return row;
    }),
  ];

  const sheets: Sheet[] = [
    { name: L.summary, rows: summary, widths: [34, 18, 18, 14], rtl },
    {
      name: L.creators,
      rows: creators,
      widths: [26, 20, 22, 12, 14, 14, 14, 18, 16, 16],
      freezeRow: 2,
      rtl,
    },
    {
      name: L.posts,
      rows: posts,
      widths: [24, 12, 13, 14, 14, 18, ...(costs ? [16] : []), 10, 44, 60],
      freezeRow: 2,
      rtl,
    },
  ];
  return buildXlsx(sheets);
}
