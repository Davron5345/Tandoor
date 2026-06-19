import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers.js';

test('admin can log in and see dashboard', async ({ page }) => {
  await loginAsAdmin(page);
  await expect(page.getByRole('heading', { name: 'Главная' })).toBeVisible();
});
