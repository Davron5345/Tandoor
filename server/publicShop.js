import { existsSync } from 'fs';
import { join } from 'path';
import db from './db.js';
import { getBranch, getBranchesEnriched } from './branches.js';
import { getProducts, getProductCategories } from './services/products.js';
import { getMyShopLayout } from './myShop.js';
import { getShopSettings } from './shopOrders.js';
import { assertDepartmentInBranch } from './departments.js';
import { uploadsDir } from './dbBackup.js';

const { queryOne } = db;

function publicMediaUrl(branchId, productId, fileName) {
  return `/api/public/shop/${encodeURIComponent(branchId)}/media/${encodeURIComponent(productId)}/${encodeURIComponent(fileName)}`;
}

function rewriteImageUrl(branchId, productId, url) {
  if (!url) return null;
  const fileName = String(url).split('/').pop();
  if (!fileName) return null;
  return publicMediaUrl(branchId, productId, fileName);
}

function getVariantPrimaryImage(variant, product) {
  const images = variant.images || [];
  const image = images.find((i) => i.is_primary && i.media_type === 'photo')
    || images.find((i) => i.media_type === 'photo')
    || images[0];
  if (image) return image;
  return product.primary_image;
}

function flattenPublicCatalogProducts(products) {
  const items = [];

  for (const product of products) {
    if (product.has_variants && product.variants?.length) {
      for (const variant of product.variants) {
        items.push({
          ...product,
          catalog_key: `${product.id}:${variant.id}`,
          variant_id: variant.id,
          name: `${product.name} — ${variant.name}`,
          price: variant.price ?? product.price ?? 0,
          stock: variant.stock ?? 0,
          has_variants: false,
          variants: [],
          variant_price_min: null,
          variant_price_max: null,
          primary_image: getVariantPrimaryImage(variant, product),
        });
      }
      continue;
    }

    items.push({
      ...product,
      catalog_key: product.id,
      variant_id: null,
      has_variants: false,
      variants: [],
    });
  }

  return items;
}

function mapPublicProduct(product, branchId) {
  return {
    id: product.id,
    name: product.name,
    sku: product.sku,
    unit: product.unit,
    price: product.price,
    stock: product.stock,
    has_variants: !!product.has_variants,
    category_id: product.category_id,
    category_name: product.category_name,
    category_parent_id: product.category_parent_id,
    parent_category_name: product.parent_category_name,
    variant_price_min: product.variant_price_min,
    variant_price_max: product.variant_price_max,
    primary_image: product.primary_image
      ? { ...product.primary_image, url: rewriteImageUrl(branchId, product.id, product.primary_image.url) }
      : null,
    variants: (product.variants || []).map((variant) => ({
      id: variant.id,
      name: variant.name,
      price: variant.price,
      stock: variant.stock,
      images: (variant.images || []).map((img) => ({
        ...img,
        url: rewriteImageUrl(branchId, product.id, img.url),
      })),
    })),
  };
}

function getBranchCategories(products, allCategories) {
  const ids = new Set();
  for (const product of products) {
    if (product.category_id) ids.add(product.category_id);
    if (product.category_parent_id) ids.add(product.category_parent_id);
  }
  return allCategories.filter((category) => ids.has(category.id));
}

export function getPublicBranches() {
  return getBranchesEnriched(true)
    .filter((branch) => getShopSettings(branch.id).enabled)
    .map((branch) => ({
      id: branch.id,
      name: branch.name,
      address: branch.address || '',
      phone: branch.phone || '',
    }));
}

export function getPublicCatalog(branchId, departmentId = null) {
  const branch = getBranch(branchId);
  if (!branch || !branch.active) throw new Error('Филиал не найден');

  const settings = getShopSettings(branchId);
  if (!settings.enabled) throw new Error('Магазин временно недоступен');

  let department = null;
  if (departmentId) {
    const dept = assertDepartmentInBranch(departmentId, branchId);
    department = { id: dept.id, name: dept.name };
  }

  const layout = getMyShopLayout(branchId);
  const rawProducts = getProducts({
    branch_id: branchId,
    archived: '0',
    product_kind: 'raw,semi_finished',
  }).map((p) => mapPublicProduct(p, branchId));
  const products = flattenPublicCatalogProducts(rawProducts);
  const categories = getBranchCategories(products, getProductCategories());

  return {
    branch: {
      id: branch.id,
      name: branch.name,
      address: branch.address || '',
      phone: branch.phone || '',
    },
    department,
    layout,
    products,
    categories,
  };
}

export function resolvePublicProductMedia(branchId, productId, fileName) {
  const branch = getBranch(branchId);
  if (!branch || !branch.active) return null;
  if (!getShopSettings(branchId).enabled) return null;

  if (!fileName || fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
    return null;
  }

  const visible = queryOne(
    'SELECT pb.id FROM product_branches pb JOIN products p ON p.id = pb.product_id WHERE pb.branch_id = ? AND pb.product_id = ? AND pb.visible = 1 AND COALESCE(p.archived, 0) = 0',
    [branchId, productId],
  );
  if (!visible) return null;

  const image = queryOne(
    'SELECT id FROM product_images WHERE product_id = ? AND file_name = ?',
    [productId, fileName],
  );
  if (!image) return null;

  const filePath = join(uploadsDir, 'products', productId, fileName);
  if (!existsSync(filePath)) return null;

  return filePath;
}
