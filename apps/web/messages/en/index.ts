// Merges every per-namespace message file into the single object next-intl
// resolves keys against. Add a new namespace here (and in ../ar/index.ts)
// whenever a new messages/en/<namespace>.json file is created — this is the
// ONLY place that needs to change; the namespace JSON files themselves never
// collide with each other. See docs/localization/README.md.
import nav from './nav.json';
import common from './common.json';
import dashboard from './dashboard.json';
import auth from './auth.json';
import empty from './empty.json';
import enums from './enums.json';
import campaigns from './campaigns.json';
import brands from './brands.json';
import ui from './ui.json';
import collaboration from './collaboration.json';
import inspiration from './inspiration.json';
import content from './content.json';
import dataQuality from './dataQuality.json';
import influencers from './influencers.json';
import logistics from './logistics.json';
import notifications from './notifications.json';
import permissions from './permissions.json';
import reports from './reports.json';
import settings from './settings.json';
import users from './users.json';
import attention from './attention.json';

export default {
  nav,
  common,
  dashboard,
  auth,
  empty,
  enums,
  campaigns,
  brands,
  ui,
  collaboration,
  inspiration,
  content,
  dataQuality,
  influencers,
  logistics,
  notifications,
  permissions,
  reports,
  settings,
  users,
  attention,
};
