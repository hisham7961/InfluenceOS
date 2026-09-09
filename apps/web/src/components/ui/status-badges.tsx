import {
  CONTENT_STATUS_LABELS,
  CONTENT_STATUS_TONE,
  DELIVERABLE_STATUS_LABELS,
  DELIVERABLE_STATUS_TONE,
  CAMPAIGN_STATUS_LABELS,
  CAMPAIGN_STATUS_TONE,
  PAYMENT_STATUS_LABELS,
  PAYMENT_STATUS_TONE,
  RELATIONSHIP_STATUS_LABELS,
  RELATIONSHIP_STATUS_TONE,
  AUDIENCE_HEALTH_LABELS_MAP,
  AUDIENCE_HEALTH_TONE,
  DEAL_TYPE_LABELS,
} from '@influenceos/shared';
import type {
  ContentStatus,
  DeliverableStatus,
  CampaignStatus,
  PaymentStatus,
  RelationshipStatus,
  AudienceHealthLabel,
  DealType,
  Tone,
} from '@influenceos/contracts';
import { cn } from '@/lib/cn';
import { Badge, type BadgeProps } from './badge';

const dotToneStyles: Record<Tone, string> = {
  neutral: 'bg-muted-foreground',
  info: 'bg-info',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  accent: 'bg-accent',
};

type StatusBadgeProps = Omit<BadgeProps, 'tone' | 'children'>;

export interface ContentStatusBadgeProps extends StatusBadgeProps {
  status: ContentStatus;
}

/** A content-status badge with a small tone-colored dot ahead of the label, so status is never conveyed by color alone. */
export function ContentStatusBadge({ status, className, ...props }: ContentStatusBadgeProps) {
  const tone = CONTENT_STATUS_TONE[status];
  return (
    <Badge tone={tone} className={cn('gap-1.5', className)} {...props}>
      <span aria-hidden="true" className={cn('h-1.5 w-1.5 shrink-0 rounded-full', dotToneStyles[tone])} />
      {CONTENT_STATUS_LABELS[status]}
    </Badge>
  );
}

export interface DeliverableStatusBadgeProps extends StatusBadgeProps {
  status: DeliverableStatus;
}

/** A badge for a deliverable's lifecycle status. */
export function DeliverableStatusBadge({ status, ...props }: DeliverableStatusBadgeProps) {
  return (
    <Badge tone={DELIVERABLE_STATUS_TONE[status]} {...props}>
      {DELIVERABLE_STATUS_LABELS[status]}
    </Badge>
  );
}

export interface CampaignStatusBadgeProps extends StatusBadgeProps {
  status: CampaignStatus;
}

/** A badge for a campaign's status. */
export function CampaignStatusBadge({ status, ...props }: CampaignStatusBadgeProps) {
  return (
    <Badge tone={CAMPAIGN_STATUS_TONE[status]} {...props}>
      {CAMPAIGN_STATUS_LABELS[status]}
    </Badge>
  );
}

export interface PaymentStatusBadgeProps extends StatusBadgeProps {
  status: PaymentStatus;
}

/** A badge for a payment's status. */
export function PaymentStatusBadge({ status, ...props }: PaymentStatusBadgeProps) {
  return (
    <Badge tone={PAYMENT_STATUS_TONE[status]} {...props}>
      {PAYMENT_STATUS_LABELS[status]}
    </Badge>
  );
}

export interface RelationshipStatusBadgeProps extends StatusBadgeProps {
  status: RelationshipStatus;
}

/** A badge for an influencer relationship's status. */
export function RelationshipStatusBadge({ status, ...props }: RelationshipStatusBadgeProps) {
  return (
    <Badge tone={RELATIONSHIP_STATUS_TONE[status]} {...props}>
      {RELATIONSHIP_STATUS_LABELS[status]}
    </Badge>
  );
}

export interface AudienceHealthBadgeProps extends StatusBadgeProps {
  status: AudienceHealthLabel;
}

/** A badge for an audience's health/data-quality label. */
export function AudienceHealthBadge({ status, ...props }: AudienceHealthBadgeProps) {
  return (
    <Badge tone={AUDIENCE_HEALTH_TONE[status]} {...props}>
      {AUDIENCE_HEALTH_LABELS_MAP[status]}
    </Badge>
  );
}

const DEAL_TYPE_TONE: Record<DealType, Tone> = {
  FREE: 'success',
  PAID: 'info',
  GIFTED_PRODUCT: 'accent',
  PAID_PLUS_GIFTED: 'accent',
};

export interface DealTypeBadgeProps extends StatusBadgeProps {
  status: DealType;
}

/** A badge for a deal's compensation type. */
export function DealTypeBadge({ status, ...props }: DealTypeBadgeProps) {
  return (
    <Badge tone={DEAL_TYPE_TONE[status]} {...props}>
      {DEAL_TYPE_LABELS[status]}
    </Badge>
  );
}
