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

export default {
  nav,
  common,
  dashboard,
  auth,
  empty,
  enums,
};
