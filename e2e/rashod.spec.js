import { test, expect } from '@playwright/test';
import {
  E2E_DEPARTMENT_NAME,
  E2E_PRODUCT_NAME,
} from './constants.mjs';
import {
  loginAsAdmin,
  pickProductOption,
  selectDepartment,
  fillDocLine,
  confirmDocModal,
} from './helpers.js';

test('create and confirm rashod document', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/rashod');
  await expect(page.getByRole('heading', { name: 'Расход' })).toBeVisible();
  await page.waitForResponse(
    (resp) => resp.url().includes('/api/counterparties') && resp.ok(),
  );

  await page.getByRole('button', { name: 'Новый' }).click();
  await expect(page.getByRole('heading', { name: 'Новый расходный документ' })).toBeVisible();

  await selectDepartment(page, 'Отдел *', E2E_DEPARTMENT_NAME);
  await pickProductOption(page, E2E_PRODUCT_NAME);
  await fillDocLine(page, { qty: 2, price: 1000 });
  await confirmDocModal(page);

  await expect(page.getByRole('cell', { name: 'Проведён' }).first()).toBeVisible();
});
