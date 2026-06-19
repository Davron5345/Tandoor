import path from 'path';
import { fileURLToPath } from 'url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const E2E_DATA_DIR = path.join(rootDir, 'e2e', '.data');
export const E2E_BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:3001';

export const E2E_ADMIN = { username: 'admin', password: 'admin123' };
export const E2E_SUPPLIER_NAME = 'E2E Поставщик';
export const E2E_CLIENT_NAME = 'E2E Клиент';
export const E2E_PRODUCT_NAME = 'E2E Товар';
export const E2E_DEPARTMENT_NAME = 'Склад';
