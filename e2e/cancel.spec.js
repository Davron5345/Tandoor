import { test, expect } from '@playwright/test';
import { loginAsAdmin, createConfirmedPrihod, cancelFirstConfirmedDoc } from './helpers.js';

test('cancel confirmed prihod document', async ({ page }) => {
  await loginAsAdmin(page);
  await createConfirmedPrihod(page, { qty: 4, price: 1000 });
  await cancelFirstConfirmedDoc(page);
  await expect(page.getByRole('heading', { name: 'Приход' })).toBeVisible();
});
