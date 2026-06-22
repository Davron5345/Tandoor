import { registerAuthRoutes } from './auth.routes.js';
import { registerAdminRoutes } from './admin.routes.js';
import { registerOrgRoutes } from './org.routes.js';
import { registerCatalogRoutes } from './catalog.routes.js';
import { registerCounterpartyRoutes } from './counterparties.routes.js';
import { registerDocumentRoutes } from './documents.routes.js';
import { registerFinanceRoutes } from './finance.routes.js';
import { registerTelegramRoutes } from './telegram.routes.js';
import { registerPublicShopRoutes } from './publicShop.routes.js';
import { registerShopOrdersRoutes } from './shopOrders.routes.js';
import { registerOpeningBalanceRoutes } from './openingBalance.routes.js';
import { registerPublicPushRoutes, registerPushRoutes } from './push.routes.js';

export function registerApiRoutes(app, deps = {}) {
  registerPublicShopRoutes(app);
  registerPublicPushRoutes(app);
  registerAuthRoutes(app, deps);
  registerAdminRoutes(app);
  registerOrgRoutes(app);
  registerCatalogRoutes(app, deps);
  registerCounterpartyRoutes(app);
  registerDocumentRoutes(app);
  registerFinanceRoutes(app);
  registerShopOrdersRoutes(app);
  registerPushRoutes(app);
  registerOpeningBalanceRoutes(app);
  registerTelegramRoutes(app);
}

export {
  registerAuthRoutes,
  registerAdminRoutes,
  registerOrgRoutes,
  registerCatalogRoutes,
  registerCounterpartyRoutes,
  registerDocumentRoutes,
  registerFinanceRoutes,
  registerTelegramRoutes,
};
