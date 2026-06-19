import { test, expect } from '@playwright/test';
import { loginAsAdmin, createConfirmedPrihod } from './helpers.js';

test('create and confirm prihod document', async ({ page }) => {
  await loginAsAdmin(page);
  await createConfirmedPrihod(page, { qty: 3, price: 1000 });
  await expect(page.getByRole('heading', { name: 'Приход' })).toBeVisible();
});
