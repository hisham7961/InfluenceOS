import type {
  CampaignSalesCreatorDTO,
  CampaignSalesDTO,
  CurrencyTotalDTO,
  PromoCodeDTO,
  SaleDTO,
  SalesImportDTO,
  SalesImportProblem,
  SalesImportResultDTO,
  TrackingLinkDTO,
  TrackingLinkResolveDTO,
} from '@influenceos/contracts';
import type { requests, z } from '@influenceos/contracts';
import { Prisma } from '@influenceos/database';
import { businessDateKey, slugify, startOfBusinessDay } from '@influenceos/shared';
import type { DomainContext } from '../context';
import { AppError } from '../errors';
import { requireActor, requireCapability } from '../lib/authz';
import { hasCapability } from '../lib/capabilities';
import { iso, logActivity } from '../lib/helpers';
import { toDecimal } from '../lib/money';
import {
  detectCurrency,
  isCancelledStatus,
  isLikelyBot,
  linkSlugFrom,
  newLinkSlug,
  normalizeCode,
  parseAmount,
  parseOrders,
  parseSaleDate,
  pickCode,
  withUtm,
} from '../lib/sales';
import { isBrandOutOfScope, scopedBrandIds } from '../lib/scope';
import { loadCampaignMoney, participationMoney } from '../lib/spend';

type PromoCodeCreate = z.infer<typeof requests.promoCodeCreateSchema>;
type PromoCodeUpdate = z.infer<typeof requests.promoCodeUpdateSchema>;
type TrackingLinkCreate = z.infer<typeof requests.trackingLinkCreateSchema>;
type TrackingLinkUpdate = z.infer<typeof requests.trackingLinkUpdateSchema>;
type SaleCreate = z.infer<typeof requests.saleCreateSchema>;
type SalesImportInput = z.infer<typeof requests.salesImportSchema>;

const RECENT_SALES = 50;
const MAX_INVALID_LISTED = 50;
const MAX_UNKNOWN_CODES = 20;
const INSERT_BATCH = 1000;

/** A code's date typed as a day: the start of that Kuwait day. */
function dayStart(d: Date | null | undefined): Date | null {
  return d ? startOfBusinessDay(businessDateKey(d)) : null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Sum money by currency from grouped rows, biggest first. */
function totals(rows: { currency: string; amount: Prisma.Decimal | number | null }[]): CurrencyTotalDTO[] {
  const by = new Map<string, Prisma.Decimal>();
  for (const r of rows) {
    const d = toDecimal(r.amount);
    if (!d) continue;
    by.set(r.currency, (by.get(r.currency) ?? new Prisma.Decimal(0)).plus(d));
  }
  return [...by.entries()]
    .map(([currency, amount]) => ({ currency, amount: amount.toNumber() }))
    .sort((a, b) => b.amount - a.amount);
}

function amountIn(list: CurrencyTotalDTO[], currency: string): number {
  return list.find((t) => t.currency === currency)?.amount ?? 0;
}

function windowsOverlap(
  a: { validFrom: Date | null; validTo: Date | null },
  b: { validFrom: Date | null; validTo: Date | null },
): boolean {
  const aFrom = a.validFrom?.getTime() ?? -Infinity;
  const aTo = a.validTo?.getTime() ?? Infinity;
  const bFrom = b.validFrom?.getTime() ?? -Infinity;
  const bTo = b.validTo?.getTime() ?? Infinity;
  return aFrom <= bTo && bFrom <= aTo;
}

/**
 * Sales & ROI (P3.1): promo codes and tracking links per creator per
 * campaign, and the brand's own sales credited to them — from a shop export
 * or entered by hand. Revenue is only what was recorded; nothing is
 * estimated. ROAS and cost per order need finance access (they reveal spend).
 *
 * Reading needs campaign access (brand scope); changing anything needs
 * CAMPAIGNS_MANAGE. Following a tracking link needs nothing (it's public).
 */
export function makeSalesService(ctx: DomainContext) {
  const { prisma } = ctx;

  async function campaignInScope(campaignId: string) {
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { id: true, brandId: true, name: true, slug: true, currency: true, startDate: true },
    });
    if (!campaign) throw AppError.notFound('Campaign');
    if (isBrandOutOfScope(await scopedBrandIds(ctx), campaign.brandId)) throw AppError.notFound('Campaign');
    return campaign;
  }

  async function brandInScope(brandId: string) {
    const brand = await prisma.brand.findUnique({ where: { id: brandId }, select: { id: true } });
    if (!brand || isBrandOutOfScope(await scopedBrandIds(ctx), brand.id)) throw AppError.notFound('Brand');
    return brand;
  }

  /** The creator must be on the campaign's roster. */
  async function rosterCreator(campaignId: string, influencerId: string) {
    const row = await prisma.campaignInfluencer.findUnique({
      where: { campaignId_influencerId: { campaignId, influencerId } },
      select: { influencer: { select: { id: true, displayName: true } } },
    });
    if (!row) throw AppError.badRequest('That creator is not on this campaign.');
    return row.influencer;
  }

  // --- Promo codes -----------------------------------------------------------

  async function assertCodeFree(
    brandId: string,
    codeKey: string,
    influencerId: string,
    window: { validFrom: Date | null; validTo: Date | null },
    exceptId?: string,
  ) {
    const same = await prisma.promoCode.findMany({
      where: { brandId, codeKey, isActive: true, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { influencerId: true, validFrom: true, validTo: true },
    });
    // The same creator may reuse their code on a later campaign (the newer one
    // takes over from its start date); two creators can't share a code.
    if (same.some((c) => c.influencerId !== influencerId && windowsOverlap(c, window))) {
      throw AppError.conflict('Another creator already has this code for these dates.');
    }
  }

  async function createPromoCode(campaignId: string, input: PromoCodeCreate): Promise<PromoCodeDTO> {
    const actor = await requireCapability(ctx, 'CAMPAIGNS_MANAGE');
    const campaign = await campaignInScope(campaignId);
    const creator = await rosterCreator(campaignId, input.influencerId);
    const codeKey = normalizeCode(input.code);
    if (codeKey.length < 2) throw AppError.badRequest('Enter the code as the creator shares it.');
    const validFrom = dayStart(input.validFrom) ?? dayStart(campaign.startDate);
    const validTo = dayStart(input.validTo);
    if (validFrom && validTo && validTo < validFrom) throw AppError.badRequest('The end date is before the start date.');
    const dup = await prisma.promoCode.findUnique({ where: { campaignId_codeKey: { campaignId, codeKey } }, select: { id: true } });
    if (dup) throw AppError.conflict('This code is already set up on this campaign.');
    await assertCodeFree(campaign.brandId, codeKey, creator.id, { validFrom, validTo });

    const row = await prisma.$transaction(async (tx) => {
      const created = await tx.promoCode.create({
        data: {
          brandId: campaign.brandId,
          campaignId,
          influencerId: creator.id,
          code: input.code.trim(),
          codeKey,
          discount: input.discount ?? null,
          validFrom,
          validTo,
          notes: input.notes ?? null,
          createdById: actor.id,
        },
      });
      await logActivity(
        ctx,
        {
          type: 'CAMPAIGN_UPDATED',
          message: `${actor.name} added promo code ${created.code} for ${creator.displayName}.`,
          brandId: campaign.brandId,
          campaignId,
          influencerId: creator.id,
          meta: { promoCodeId: created.id },
        },
        tx,
      );
      return created;
    });
    return (await promoCodeDTOs([row.id]))[0]!;
  }

  async function codeInScope(id: string) {
    const code = await prisma.promoCode.findUnique({ where: { id } });
    if (!code) throw AppError.notFound('Promo code');
    if (isBrandOutOfScope(await scopedBrandIds(ctx), code.brandId)) throw AppError.notFound('Promo code');
    return code;
  }

  async function updatePromoCode(id: string, input: PromoCodeUpdate): Promise<PromoCodeDTO> {
    await requireCapability(ctx, 'CAMPAIGNS_MANAGE');
    const code = await codeInScope(id);
    const codeKey = input.code !== undefined ? normalizeCode(input.code) : code.codeKey;
    if (codeKey.length < 2) throw AppError.badRequest('Enter the code as the creator shares it.');
    const validFrom = input.validFrom !== undefined ? dayStart(input.validFrom) : code.validFrom;
    const validTo = input.validTo !== undefined ? dayStart(input.validTo) : code.validTo;
    if (validFrom && validTo && validTo < validFrom) throw AppError.badRequest('The end date is before the start date.');
    if (codeKey !== code.codeKey) {
      const dup = await prisma.promoCode.findUnique({
        where: { campaignId_codeKey: { campaignId: code.campaignId, codeKey } },
        select: { id: true },
      });
      if (dup) throw AppError.conflict('This code is already set up on this campaign.');
    }
    const isActive = input.isActive ?? code.isActive;
    if (isActive) await assertCodeFree(code.brandId, codeKey, code.influencerId, { validFrom, validTo }, code.id);
    await prisma.promoCode.update({
      where: { id },
      data: {
        ...(input.code !== undefined ? { code: input.code.trim(), codeKey } : {}),
        ...(input.discount !== undefined ? { discount: input.discount } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        validFrom,
        validTo,
        isActive,
      },
    });
    return (await promoCodeDTOs([id]))[0]!;
  }

  async function deletePromoCode(id: string): Promise<void> {
    await requireCapability(ctx, 'CAMPAIGNS_MANAGE');
    const code = await codeInScope(id);
    const sales = await prisma.sale.count({ where: { promoCodeId: id } });
    if (sales > 0) throw AppError.conflict('Sales are recorded with this code. Turn it off instead.');
    await prisma.promoCode.delete({ where: { id: code.id } });
  }

  async function promoCodeDTOs(ids: string[] | { campaignId: string }): Promise<PromoCodeDTO[]> {
    const where = Array.isArray(ids) ? { id: { in: ids } } : { campaignId: ids.campaignId };
    const rows = await prisma.promoCode.findMany({
      where,
      include: { influencer: { select: { displayName: true } } },
      orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }],
    });
    const sums = rows.length
      ? await prisma.sale.groupBy({
          by: ['promoCodeId', 'currency'],
          where: { promoCodeId: { in: rows.map((r) => r.id) } },
          _sum: { amount: true, orders: true },
        })
      : [];
    return rows.map((r) => {
      const mine = sums.filter((s) => s.promoCodeId === r.id);
      return {
        id: r.id,
        campaignId: r.campaignId,
        influencerId: r.influencerId,
        influencerName: r.influencer.displayName,
        code: r.code,
        discount: r.discount,
        validFrom: iso(r.validFrom),
        validTo: iso(r.validTo),
        isActive: r.isActive,
        notes: r.notes,
        orders: mine.reduce((n, s) => n + (s._sum.orders ?? 0), 0),
        revenue: totals(mine.map((s) => ({ currency: s.currency, amount: s._sum.amount }))),
        createdAt: r.createdAt.toISOString(),
      };
    });
  }

  // --- Tracking links --------------------------------------------------------

  async function freeSlug(): Promise<string> {
    for (let i = 0; i < 8; i++) {
      const slug = newLinkSlug();
      const taken = await prisma.trackingLink.findUnique({ where: { slug }, select: { id: true } });
      if (!taken) return slug;
    }
    throw AppError.conflict('Could not make a short link. Try again.');
  }

  async function createTrackingLink(campaignId: string, input: TrackingLinkCreate): Promise<TrackingLinkDTO> {
    const actor = await requireCapability(ctx, 'CAMPAIGNS_MANAGE');
    const campaign = await campaignInScope(campaignId);
    const creator = await rosterCreator(campaignId, input.influencerId);
    const slug = await freeSlug();
    const targetUrl = input.utm
      ? withUtm(input.destinationUrl, { source: slugify(creator.displayName) || 'creator', campaign: campaign.slug, content: slug })
      : input.destinationUrl;
    const row = await prisma.$transaction(async (tx) => {
      const created = await tx.trackingLink.create({
        data: {
          slug,
          brandId: campaign.brandId,
          campaignId,
          influencerId: creator.id,
          destinationUrl: input.destinationUrl,
          targetUrl,
          label: input.label ?? null,
          createdById: actor.id,
        },
      });
      await logActivity(
        ctx,
        {
          type: 'CAMPAIGN_UPDATED',
          message: `${actor.name} created a tracking link for ${creator.displayName}.`,
          brandId: campaign.brandId,
          campaignId,
          influencerId: creator.id,
          meta: { trackingLinkId: created.id },
        },
        tx,
      );
      return created;
    });
    return (await linkDTOs([row.id]))[0]!;
  }

  async function linkInScope(id: string) {
    const link = await prisma.trackingLink.findUnique({
      where: { id },
      include: { campaign: { select: { slug: true } }, influencer: { select: { displayName: true } } },
    });
    if (!link) throw AppError.notFound('Tracking link');
    if (isBrandOutOfScope(await scopedBrandIds(ctx), link.brandId)) throw AppError.notFound('Tracking link');
    return link;
  }

  async function updateTrackingLink(id: string, input: TrackingLinkUpdate): Promise<TrackingLinkDTO> {
    await requireCapability(ctx, 'CAMPAIGNS_MANAGE');
    const link = await linkInScope(id);
    let targetUrl = link.targetUrl;
    if (input.destinationUrl !== undefined && input.destinationUrl !== link.destinationUrl) {
      const tagged = link.targetUrl !== link.destinationUrl;
      targetUrl = tagged
        ? withUtm(input.destinationUrl, {
            source: slugify(link.influencer.displayName) || 'creator',
            campaign: link.campaign.slug,
            content: link.slug,
          })
        : input.destinationUrl;
    }
    await prisma.trackingLink.update({
      where: { id },
      data: {
        ...(input.destinationUrl !== undefined ? { destinationUrl: input.destinationUrl, targetUrl } : {}),
        ...(input.label !== undefined ? { label: input.label } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });
    return (await linkDTOs([id]))[0]!;
  }

  async function deleteTrackingLink(id: string): Promise<void> {
    await requireCapability(ctx, 'CAMPAIGNS_MANAGE');
    const link = await linkInScope(id);
    await prisma.trackingLink.delete({ where: { id: link.id } });
  }

  async function linkDTOs(ids: string[] | { campaignId: string }): Promise<TrackingLinkDTO[]> {
    const where = Array.isArray(ids) ? { id: { in: ids } } : { campaignId: ids.campaignId };
    const rows = await prisma.trackingLink.findMany({
      where,
      include: { influencer: { select: { displayName: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const sums = rows.length
      ? await prisma.sale.groupBy({
          by: ['trackingLinkId', 'currency'],
          where: { trackingLinkId: { in: rows.map((r) => r.id) } },
          _sum: { amount: true, orders: true },
        })
      : [];
    return rows.map((r) => {
      const mine = sums.filter((s) => s.trackingLinkId === r.id);
      return {
        id: r.id,
        slug: r.slug,
        path: `/r/${r.slug}`,
        campaignId: r.campaignId,
        influencerId: r.influencerId,
        influencerName: r.influencer.displayName,
        destinationUrl: r.destinationUrl,
        targetUrl: r.targetUrl,
        label: r.label,
        isActive: r.isActive,
        clicks: r.clickCount,
        lastClickAt: iso(r.lastClickAt),
        orders: mine.reduce((n, s) => n + (s._sum.orders ?? 0), 0),
        revenue: totals(mine.map((s) => ({ currency: s.currency, amount: s._sum.amount }))),
        createdAt: r.createdAt.toISOString(),
      };
    });
  }

  /**
   * Someone followed a tracking link: where to send them. A person's click
   * is counted (per Kuwait day); link previews, scripts and paused links are
   * sent on without counting. Counting never stops the redirect.
   */
  async function resolveLink(slug: string, visit: { userAgent?: string | null; method?: string }): Promise<TrackingLinkResolveDTO> {
    const link = await prisma.trackingLink.findUnique({
      where: { slug: slug.toLowerCase() },
      select: { id: true, targetUrl: true, isActive: true },
    });
    if (!link) throw AppError.notFound('Link');
    if (link.isActive && (visit.method ?? 'GET') === 'GET' && !isLikelyBot(visit.userAgent)) {
      const day = businessDateKey(new Date());
      try {
        await prisma.$transaction([
          prisma.trackingLink.update({ where: { id: link.id }, data: { clickCount: { increment: 1 }, lastClickAt: new Date() } }),
          prisma.$executeRaw`
            INSERT INTO "TrackingLinkClickDay" ("linkId", "day", "clicks") VALUES (${link.id}, ${day}::date, 1)
            ON CONFLICT ("linkId", "day") DO UPDATE SET "clicks" = "TrackingLinkClickDay"."clicks" + 1`,
        ]);
      } catch {
        // A lost count is better than a broken link.
      }
    }
    return { url: link.targetUrl };
  }

  // --- Sales entered by hand ---------------------------------------------------

  async function addSale(campaignId: string, input: SaleCreate): Promise<SaleDTO> {
    const actor = await requireCapability(ctx, 'CAMPAIGNS_MANAGE');
    const campaign = await campaignInScope(campaignId);
    const creator = await rosterCreator(campaignId, input.influencerId);
    if (input.promoCodeId) {
      const code = await prisma.promoCode.findUnique({ where: { id: input.promoCodeId }, select: { campaignId: true, influencerId: true } });
      if (!code || code.campaignId !== campaignId || code.influencerId !== creator.id) {
        throw AppError.badRequest('That code belongs to another creator or campaign.');
      }
    }
    const row = await prisma.$transaction(async (tx) => {
      const created = await tx.sale.create({
        data: {
          brandId: campaign.brandId,
          campaignId,
          influencerId: creator.id,
          promoCodeId: input.promoCodeId ?? null,
          source: 'MANUAL',
          orders: input.orders,
          amount: new Prisma.Decimal(input.amount),
          currency: input.currency ?? campaign.currency,
          occurredAt: input.occurredAt,
          note: input.note ?? null,
          createdById: actor.id,
        },
      });
      await logActivity(
        ctx,
        {
          type: 'CAMPAIGN_UPDATED',
          message: `${actor.name} recorded sales for ${creator.displayName}.`,
          brandId: campaign.brandId,
          campaignId,
          influencerId: creator.id,
          meta: { saleId: created.id, orders: created.orders },
        },
        tx,
      );
      return created;
    });
    return (await saleDTOs({ id: row.id }))[0]!;
  }

  async function deleteSale(id: string): Promise<void> {
    await requireCapability(ctx, 'CAMPAIGNS_MANAGE');
    const sale = await prisma.sale.findUnique({ where: { id }, select: { id: true, brandId: true } });
    if (!sale || isBrandOutOfScope(await scopedBrandIds(ctx), sale.brandId)) throw AppError.notFound('Sale');
    await prisma.sale.delete({ where: { id } });
  }

  async function saleDTOs(where: Prisma.SaleWhereInput, take?: number): Promise<SaleDTO[]> {
    const rows = await prisma.sale.findMany({
      where,
      include: {
        influencer: { select: { displayName: true } },
        promoCode: { select: { code: true } },
        trackingLink: { select: { slug: true } },
        createdBy: { select: { name: true } },
      },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      ...(take ? { take } : {}),
    });
    return rows.map((r) => ({
      id: r.id,
      campaignId: r.campaignId,
      influencerId: r.influencerId,
      influencerName: r.influencer.displayName,
      source: r.source,
      orderRef: r.orderRef,
      orders: r.orders,
      amount: r.amount.toNumber(),
      currency: r.currency,
      occurredAt: r.occurredAt.toISOString(),
      code: r.promoCode?.code ?? null,
      linkSlug: r.trackingLink?.slug ?? null,
      importId: r.importId,
      note: r.note,
      createdByName: r.createdBy?.name ?? null,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  // --- Importing the shop's orders --------------------------------------------

  /**
   * Credit a shop's order export to creators: by promo code (the code whose
   * dates cover the order), else by one of our tracking links in a link or
   * UTM column. Orders already on record (same order number) and repeats in
   * the file are skipped; cancelled/refunded orders are left out. With
   * `dryRun` nothing is saved — the result says what would be.
   */
  async function importSales(brandId: string, input: SalesImportInput): Promise<SalesImportResultDTO> {
    const actor = await requireCapability(ctx, 'CAMPAIGNS_MANAGE');
    await brandInScope(brandId);

    const [codes, links] = await Promise.all([
      prisma.promoCode.findMany({
        where: { brandId, isActive: true },
        select: {
          id: true,
          codeKey: true,
          campaignId: true,
          influencerId: true,
          validFrom: true,
          validTo: true,
          campaign: { select: { name: true, currency: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.trackingLink.findMany({
        where: { brandId },
        select: { id: true, slug: true, campaignId: true, influencerId: true, campaign: { select: { name: true, currency: true } } },
      }),
    ]);
    const codesByKey = new Map<string, typeof codes>();
    for (const c of codes) (codesByKey.get(c.codeKey) ?? codesByKey.set(c.codeKey, []).get(c.codeKey)!).push(c);
    const linkBySlug = new Map(links.map((l) => [l.slug, l]));
    const slugs = new Set(linkBySlug.keys());

    type Accepted = {
      orderRef: string | null;
      campaignId: string;
      campaignName: string;
      influencerId: string;
      promoCodeId: string | null;
      trackingLinkId: string | null;
      orders: number;
      amount: number;
      currency: string;
      occurredAt: Date;
    };
    const accepted: Accepted[] = [];
    const invalid: { row: number; problem: SalesImportProblem }[] = [];
    let invalidCount = 0;
    const unknown = new Map<string, { code: string; rows: number }>();
    let unmatched = 0;
    let outsideDates = 0;
    let cancelled = 0;
    let duplicates = 0;
    const seenRefs = new Set<string>();

    const bad = (row: number, problem: SalesImportProblem) => {
      invalidCount++;
      if (invalid.length < MAX_INVALID_LISTED) invalid.push({ row, problem });
    };

    input.rows.forEach((r, i) => {
      const line = i + 2; // the header is line 1
      if (isCancelledStatus(r.status)) {
        cancelled++;
        return;
      }
      const at = parseSaleDate(r.date ?? '', input.dateOrder);
      if (!at) return bad(line, 'date');
      const money = parseAmount(r.amount ?? '');
      if (!money) return bad(line, 'amount');
      if (money.amount < 0) return bad(line, 'negative');
      const orders = parseOrders(r.orders);
      if (orders === null) return bad(line, 'orders');
      const currencyCell = (r.currency ?? '').trim();
      let rowCurrency: string | null = null;
      if (currencyCell) {
        rowCurrency = detectCurrency(currencyCell) ?? (/^[A-Za-z]{3}$/.test(currencyCell) ? currencyCell.toUpperCase() : null);
        if (!rowCurrency) return bad(line, 'currency');
      }

      let match: { campaignId: string; campaignName: string; campaignCurrency: string; influencerId: string; promoCodeId: string | null; trackingLinkId: string | null } | null = null;
      let knownButOutside = false;
      const unknownHere: string[] = [];
      for (const raw of (r.code ?? '').split(/[,;|]/)) {
        const text = raw.trim();
        if (!text) continue;
        const list = codesByKey.get(normalizeCode(text));
        if (!list) {
          unknownHere.push(text);
          continue;
        }
        const code = pickCode(list, at);
        if (!code) {
          knownButOutside = true;
          continue;
        }
        match = {
          campaignId: code.campaignId,
          campaignName: code.campaign.name,
          campaignCurrency: code.campaign.currency,
          influencerId: code.influencerId,
          promoCodeId: code.id,
          trackingLinkId: null,
        };
        break;
      }
      if (!match) {
        const slug = linkSlugFrom(r.link, slugs);
        const link = slug ? linkBySlug.get(slug) : undefined;
        if (link) {
          match = {
            campaignId: link.campaignId,
            campaignName: link.campaign.name,
            campaignCurrency: link.campaign.currency,
            influencerId: link.influencerId,
            promoCodeId: null,
            trackingLinkId: link.id,
          };
        }
      }
      if (!match) {
        if (knownButOutside) outsideDates++;
        else {
          unmatched++;
          for (const text of unknownHere) {
            const key = normalizeCode(text);
            const u = unknown.get(key) ?? { code: text, rows: 0 };
            u.rows++;
            unknown.set(key, u);
          }
        }
        return;
      }

      const orderRef = (r.orderRef ?? '').trim() || null;
      if (orderRef) {
        if (seenRefs.has(orderRef)) {
          duplicates++;
          return;
        }
        seenRefs.add(orderRef);
      }
      accepted.push({
        orderRef,
        campaignId: match.campaignId,
        campaignName: match.campaignName,
        influencerId: match.influencerId,
        promoCodeId: match.promoCodeId,
        trackingLinkId: match.trackingLinkId,
        orders,
        amount: money.amount,
        currency: rowCurrency ?? money.currency ?? input.currency ?? match.campaignCurrency,
        occurredAt: at,
      });
    });

    // Orders already on record for this brand.
    const refs = accepted.map((a) => a.orderRef).filter((r): r is string => !!r);
    const existing = new Set<string>();
    for (let i = 0; i < refs.length; i += 5000) {
      const found = await prisma.sale.findMany({
        where: { brandId, orderRef: { in: refs.slice(i, i + 5000) } },
        select: { orderRef: true },
      });
      for (const f of found) if (f.orderRef) existing.add(f.orderRef);
    }
    const fresh = accepted.filter((a) => !a.orderRef || !existing.has(a.orderRef));
    duplicates += accepted.length - fresh.length;

    const byCampaignMap = new Map<string, { campaignId: string; campaignName: string; orders: number; rows: { currency: string; amount: number }[] }>();
    for (const a of fresh) {
      const b = byCampaignMap.get(a.campaignId) ?? { campaignId: a.campaignId, campaignName: a.campaignName, orders: 0, rows: [] };
      b.orders += a.orders;
      b.rows.push({ currency: a.currency, amount: a.amount });
      byCampaignMap.set(a.campaignId, b);
    }
    const byCampaign = [...byCampaignMap.values()]
      .map((b) => ({ campaignId: b.campaignId, campaignName: b.campaignName, orders: b.orders, revenue: totals(b.rows) }))
      .sort((a, b) => b.orders - a.orders);

    let importId: string | null = null;
    if (!input.dryRun && fresh.length > 0) {
      importId = await prisma.$transaction(
        async (tx) => {
          const imp = await tx.salesImport.create({
            data: {
              brandId,
              fileName: input.fileName ?? null,
              rowCount: input.rows.length,
              imported: fresh.length,
              duplicates,
              unmatched: unmatched + outsideDates,
              createdById: actor.id,
            },
          });
          for (let i = 0; i < fresh.length; i += INSERT_BATCH) {
            await tx.sale.createMany({
              data: fresh.slice(i, i + INSERT_BATCH).map((a) => ({
                brandId,
                campaignId: a.campaignId,
                influencerId: a.influencerId,
                promoCodeId: a.promoCodeId,
                trackingLinkId: a.trackingLinkId,
                importId: imp.id,
                source: 'IMPORT' as const,
                orderRef: a.orderRef,
                orders: a.orders,
                amount: new Prisma.Decimal(a.amount),
                currency: a.currency,
                occurredAt: a.occurredAt,
                createdById: actor.id,
              })),
              // Another import of the same orders racing this one.
              skipDuplicates: true,
            });
          }
          for (const b of byCampaign) {
            await logActivity(
              ctx,
              {
                type: 'CAMPAIGN_UPDATED',
                message: `${actor.name} imported ${b.orders} orders from a sales file.`,
                brandId,
                campaignId: b.campaignId,
                meta: { salesImportId: imp.id },
              },
              tx,
            );
          }
          return imp.id;
        },
        { timeout: 60_000 },
      );
    }

    return {
      dryRun: input.dryRun,
      importId,
      rows: input.rows.length,
      matched: fresh.length,
      duplicates,
      unmatched,
      outsideDates,
      cancelled,
      invalid,
      invalidCount,
      unknownCodes: [...unknown.values()].sort((a, b) => b.rows - a.rows).slice(0, MAX_UNKNOWN_CODES),
      byCampaign,
    };
  }

  /** Take a whole file back out: every order it recorded, on every campaign. */
  async function undoImport(importId: string): Promise<{ removed: number }> {
    const actor = await requireCapability(ctx, 'CAMPAIGNS_MANAGE');
    const imp = await prisma.salesImport.findUnique({ where: { id: importId }, select: { id: true, brandId: true } });
    if (!imp || isBrandOutOfScope(await scopedBrandIds(ctx), imp.brandId)) throw AppError.notFound('Sales file');
    const removed = await prisma.$transaction(async (tx) => {
      const n = await tx.sale.count({ where: { importId } });
      await tx.salesImport.delete({ where: { id: importId } });
      await logActivity(
        ctx,
        { type: 'BRAND_UPDATED', message: `${actor.name} removed a sales file (${n} orders).`, brandId: imp.brandId, meta: { salesImportId: importId } },
        tx,
      );
      return n;
    });
    return { removed };
  }

  async function importDTOs(ids: string[]): Promise<SalesImportDTO[]> {
    if (ids.length === 0) return [];
    const [rows, onRecord] = await Promise.all([
      prisma.salesImport.findMany({
        where: { id: { in: ids } },
        include: { createdBy: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.sale.groupBy({ by: ['importId'], where: { importId: { in: ids } }, _sum: { orders: true } }),
    ]);
    return rows.map((r) => ({
      id: r.id,
      brandId: r.brandId,
      fileName: r.fileName,
      rowCount: r.rowCount,
      imported: r.imported,
      duplicates: r.duplicates,
      unmatched: r.unmatched,
      ordersOnRecord: onRecord.find((o) => o.importId === r.id)?._sum.orders ?? 0,
      createdByName: r.createdBy?.name ?? null,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  // --- Reading -------------------------------------------------------------

  /** A campaign's codes, links, sales and — with finance access — return on spend. */
  async function campaignSales(campaignId: string): Promise<CampaignSalesDTO> {
    requireActor(ctx);
    const campaign = await campaignInScope(campaignId);
    const [canManage, canSeeMoney, promoCodes, links, byCreator, recentSales, importIds, roster] = await Promise.all([
      hasCapability(ctx, 'CAMPAIGNS_MANAGE'),
      hasCapability(ctx, 'FINANCE_VIEW'),
      promoCodeDTOs({ campaignId }),
      linkDTOs({ campaignId }),
      prisma.sale.groupBy({ by: ['influencerId', 'currency'], where: { campaignId }, _sum: { amount: true, orders: true } }),
      saleDTOs({ campaignId }, RECENT_SALES),
      prisma.sale.groupBy({ by: ['importId'], where: { campaignId, importId: { not: null } } }),
      prisma.campaignInfluencer.findMany({
        where: { campaignId },
        select: {
          influencerId: true,
          dealType: true,
          agreedCost: true,
          participationStatus: true,
          paymentStatus: true,
          paidAmount: true,
        },
      }),
    ]);
    const money = canSeeMoney ? (await loadCampaignMoney(prisma, [campaignId])).get(campaignId) : undefined;
    const imports = await importDTOs(importIds.map((g) => g.importId!).filter(Boolean));

    const ids = new Set<string>([
      ...promoCodes.map((c) => c.influencerId),
      ...links.map((l) => l.influencerId),
      ...byCreator.map((g) => g.influencerId),
    ]);
    const people = ids.size
      ? await prisma.influencer.findMany({
          where: { id: { in: [...ids] } },
          select: {
            id: true,
            displayName: true,
            avatarOverrideUrl: true,
            resolvedAvatarUrl: true,
            socialAccounts: { select: { avatarUrl: true, isPrimary: true } },
          },
        })
      : [];

    const currency = campaign.currency;
    const creators: CampaignSalesCreatorDTO[] = people.map((p) => {
      const groups = byCreator.filter((g) => g.influencerId === p.id);
      const revenue = totals(groups.map((g) => ({ currency: g.currency, amount: g._sum.amount })));
      const orders = groups.reduce((n, g) => n + (g._sum.orders ?? 0), 0);
      const ci = roster.find((r) => r.influencerId === p.id);
      const fee = canSeeMoney && ci ? participationMoney(ci).fee.toNumber() : null;
      const inCurrency = amountIn(revenue, currency);
      const primary = p.socialAccounts.find((a) => a.isPrimary) ?? p.socialAccounts[0];
      return {
        influencerId: p.id,
        name: p.displayName,
        avatarUrl: p.avatarOverrideUrl ?? p.resolvedAvatarUrl ?? primary?.avatarUrl ?? null,
        codes: promoCodes.filter((c) => c.influencerId === p.id).map((c) => c.code),
        clicks: links.filter((l) => l.influencerId === p.id).reduce((n, l) => n + l.clicks, 0),
        orders,
        revenue,
        fee,
        roas: fee && fee > 0 && orders > 0 ? round2(inCurrency / fee) : null,
        costPerOrder: fee && fee > 0 && orders > 0 ? round2(fee / orders) : null,
      };
    });
    creators.sort(
      (a, b) => amountIn(b.revenue, currency) - amountIn(a.revenue, currency) || b.orders - a.orders || a.name.localeCompare(b.name),
    );

    const revenue = totals(byCreator.map((g) => ({ currency: g.currency, amount: g._sum.amount })));
    const orders = byCreator.reduce((n, g) => n + (g._sum.orders ?? 0), 0);
    const clicks = links.reduce((n, l) => n + l.clicks, 0);
    const linkOrders = links.reduce((n, l) => n + l.orders, 0);
    const spend = money ? money.totalSpend.toNumber() : null;
    return {
      campaignId,
      currency,
      orders,
      revenue,
      clicks,
      conversionRate: clicks > 0 && orders > 0 ? Math.round((linkOrders / clicks) * 10_000) / 10_000 : null,
      spend,
      roas: spend && spend > 0 && orders > 0 ? round2(amountIn(revenue, currency) / spend) : null,
      costPerOrder: spend && spend > 0 && orders > 0 ? round2(spend / orders) : null,
      creators,
      promoCodes,
      links,
      recentSales,
      imports,
      canManage,
    };
  }

  /** A creator's sales and clicks across the brands the reader can see (creator page). */
  async function creatorSales(influencerId: string): Promise<{ orders: number; revenue: CurrencyTotalDTO[]; clicks: number } | null> {
    const scope = await scopedBrandIds(ctx);
    const brandFilter = scope ? { brandId: { in: scope } } : {};
    const [groups, clicks] = await Promise.all([
      prisma.sale.groupBy({ by: ['currency'], where: { influencerId, ...brandFilter }, _sum: { amount: true, orders: true } }),
      prisma.trackingLink.aggregate({ where: { influencerId, ...brandFilter }, _sum: { clickCount: true } }),
    ]);
    const orders = groups.reduce((n, g) => n + (g._sum.orders ?? 0), 0);
    const clickCount = clicks._sum.clickCount ?? 0;
    if (orders === 0 && clickCount === 0) return null;
    return { orders, revenue: totals(groups.map((g) => ({ currency: g.currency, amount: g._sum.amount }))), clicks: clickCount };
  }

  return {
    campaignSales,
    creatorSales,
    createPromoCode,
    updatePromoCode,
    deletePromoCode,
    createTrackingLink,
    updateTrackingLink,
    deleteTrackingLink,
    resolveLink,
    addSale,
    deleteSale,
    importSales,
    undoImport,
  };
}
