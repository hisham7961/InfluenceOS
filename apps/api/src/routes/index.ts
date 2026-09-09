import type { FastifyInstance } from 'fastify';
import { authRoutes } from './auth.routes';
import { brandRoutes } from './brands.routes';
import { influencerRoutes } from './influencers.routes';
import { socialAccountRoutes } from './social-accounts.routes';
import { campaignRoutes } from './campaigns.routes';
import { campaignInfluencerRoutes } from './campaign-influencers.routes';
import { deliverableRoutes } from './deliverables.routes';
import { scriptRoutes } from './scripts.routes';
import { contentRoutes } from './content.routes';
import { expenseRoutes } from './expenses.routes';
import { noteRoutes } from './notes.routes';
import { brandInfluencerRoutes } from './brand-influencers.routes';
import { dashboardRoutes } from './dashboard.routes';
import { calendarRoutes } from './calendar.routes';
import { reportRoutes } from './reports.routes';
import { notificationRoutes } from './notifications.routes';
import { activityRoutes } from './activity.routes';
import { searchRoutes } from './search.routes';
import { integrationRoutes } from './integrations.routes';
import { platformRoutes } from './platform.routes';
import { fileRoutes } from './files.routes';

/** Register every v1 route module onto the (already /api/v1-prefixed) instance. */
export async function registerRoutes(app: FastifyInstance): Promise<void> {
  await authRoutes(app);
  await brandRoutes(app);
  await influencerRoutes(app);
  await socialAccountRoutes(app);
  await campaignRoutes(app);
  await campaignInfluencerRoutes(app);
  await deliverableRoutes(app);
  await scriptRoutes(app);
  await contentRoutes(app);
  await expenseRoutes(app);
  await noteRoutes(app);
  await brandInfluencerRoutes(app);
  await dashboardRoutes(app);
  await calendarRoutes(app);
  await reportRoutes(app);
  await notificationRoutes(app);
  await activityRoutes(app);
  await searchRoutes(app);
  await integrationRoutes(app);
  await platformRoutes(app);
  await fileRoutes(app);
}
