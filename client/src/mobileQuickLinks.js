import { hasPermission, hasAnyPermission } from './permissions';
import {
  IconNavPurchases,
  IconNavCart,
  IconNavShop,
  IconNavCashier,
  IconNavCatalog,
  IconNavDocuments,
  IconNavReports,
  IconNavArticles,
  IconNavProduction,
  IconNavWarehouse,
  IconNavAdmin,
  IconNavSettings,
  IconNavPayments,
} from './components/NavIcons';

/**
 * Пункты «Быстрый доступ» для мобильного рабочего стола (как сетка в админке-примере).
 */
export function buildMobileQuickLinks(user) {
  if (!user) return [];

  const candidates = [
    {
      to: '/prihod',
      label: 'Приход',
      perm: 'documents.prihod',
      tone: 'green',
      Icon: IconNavPurchases,
    },
    {
      to: '/shop-orders',
      label: 'Заявки',
      perm: 'shop_orders.view',
      tone: 'blue',
      Icon: IconNavCart,
    },
    {
      to: '/counterparties',
      label: 'Контрагенты',
      perm: 'counterparties.view',
      tone: 'orange',
      Icon: IconNavShop,
    },
    {
      to: '/cashier',
      label: 'Касса',
      anyPerm: ['cashier.view', 'cashier.edit'],
      tone: 'purple',
      Icon: IconNavCashier,
    },
    {
      to: '/products',
      label: 'Номенклатура',
      perm: 'products.view',
      tone: 'rose',
      Icon: IconNavCatalog,
    },
    {
      to: '/return-supplier',
      label: 'Возврат поставщику',
      perm: 'documents.rashod',
      tone: 'teal',
      Icon: IconNavDocuments,
    },
    {
      to: '/reports/stock',
      label: 'Отчёты',
      perm: 'reports.view',
      tone: 'orange',
      Icon: IconNavReports,
    },
    {
      to: '/product-categories',
      label: 'Категории',
      perm: 'products.view',
      tone: 'purple',
      Icon: IconNavArticles,
    },
    {
      to: '/payments',
      label: 'Банк',
      perm: 'payments.view',
      tone: 'teal',
      Icon: IconNavPayments,
    },
    {
      to: '/inventory',
      label: 'Инвентаризация',
      perm: 'documents.inventory',
      tone: 'blue',
      Icon: IconNavProduction,
    },
    {
      to: '/transfer',
      label: 'Перемещение',
      perm: 'documents.transfer',
      tone: 'orange',
      Icon: IconNavWarehouse,
    },
    {
      to: '/employees',
      label: 'Сотрудники',
      perm: 'users.view',
      tone: 'purple',
      Icon: IconNavAdmin,
    },
    {
      to: '/security',
      label: 'Настройки',
      role: 'admin',
      tone: 'rose',
      Icon: IconNavSettings,
    },
  ];

  const links = [];
  for (const item of candidates) {
    if (item.role && user.role !== item.role) continue;
    if (item.perm && !hasPermission(user, item.perm)) continue;
    if (item.anyPerm && !hasAnyPermission(user, item.anyPerm)) continue;
    links.push(item);
  }

  // Подсвечиваем первый доступный пункт (главное действие)
  return links.map((item, index) => ({
    ...item,
    highlight: index === 0,
  }));
}
