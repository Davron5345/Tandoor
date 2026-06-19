import { expect } from '@playwright/test';
import {
  E2E_ADMIN,
  E2E_DEPARTMENT_NAME,
  E2E_PRODUCT_NAME,
  E2E_SUPPLIER_NAME,
} from './constants.mjs';

export async function loginAsAdmin(page) {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Вход в систему' })).toBeVisible();
  await page.locator('input[autocomplete="username"]').fill(E2E_ADMIN.username);
  await page.locator('input[autocomplete="current-password"]').fill(E2E_ADMIN.password);
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page).not.toHaveURL(/\/login$/);
}

export async function pickCategoryOption(page, labelText, optionName, searchPlaceholder) {
  const group = page.locator('.form-group').filter({ has: page.getByText(labelText, { exact: true }) });
  await group.locator('.category-select-trigger').click();
  await page.getByPlaceholder(searchPlaceholder).fill(optionName);
  await page.getByRole('option', { name: optionName }).click();
}

export async function pickProductOption(page, productName) {
  await page.locator('.product-select-trigger').first().click();
  await page.getByPlaceholder('Поиск по названию, артикулу...').fill(productName);
  await page.getByRole('option', { name: new RegExp(productName) }).click();
}

export async function selectDepartment(page, labelText, departmentName) {
  await page.locator('.form-group').filter({ hasText: labelText }).locator('select').selectOption({ label: departmentName });
}

export async function fillDocLine(page, { qty, price }) {
  await page.locator('.doc-items-table input[type="number"]').first().fill(String(qty));
  await page.locator('.doc-items-table input[inputmode="numeric"]').first().fill(String(price));
}

export async function confirmDocModal(page) {
  await page.getByRole('button', { name: 'Провести' }).click();
  await expect(page.getByRole('button', { name: 'Провести' })).toBeHidden({ timeout: 15_000 });
}

export async function createConfirmedPrihod(page, { qty = 5, price = 1000 } = {}) {
  await page.goto('/prihod');
  await page.getByRole('button', { name: 'Новый' }).click();
  await expect(page.getByRole('heading', { name: 'Новый приходный документ' })).toBeVisible();

  await pickCategoryOption(page, 'Поставщик', E2E_SUPPLIER_NAME, 'Поиск поставщика...');
  await selectDepartment(page, 'Отдел *', E2E_DEPARTMENT_NAME);
  await pickProductOption(page, E2E_PRODUCT_NAME);
  await fillDocLine(page, { qty, price });
  await confirmDocModal(page);

  await expect(page.getByRole('cell', { name: 'Проведён' }).first()).toBeVisible();
}

export async function openFirstDocActionsMenu(page) {
  await page.getByRole('button', { name: 'Ещё' }).first().click();
  await expect(page.locator('.doc-actions-menu')).toBeVisible();
}

export async function cancelFirstConfirmedDoc(page) {
  page.once('dialog', (dialog) => dialog.accept());
  await openFirstDocActionsMenu(page);
  await page.getByRole('button', { name: 'Отмена проведения' }).click();
  await expect(page.getByRole('cell', { name: 'Отменён' }).first()).toBeVisible({ timeout: 15_000 });
}
