import { v4 as uuidv4 } from 'uuid';
import db from './db.js';
import { DEFAULT_BRANCH_ID } from './branches.js';

const { queryAll, queryOne, run } = db;

export function getDepartments(branchId = null, activeOnly = false) {
  let sql = `
    SELECT d.*, b.name as branch_name
    FROM departments d
    JOIN branches b ON b.id = d.branch_id
  `;
  const params = [];
  const where = [];
  if (branchId) {
    where.push('d.branch_id = ?');
    params.push(branchId);
  }
  if (activeOnly) {
    where.push('d.active = 1');
  }
  if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
  sql += ' ORDER BY b.name, d.name';
  return queryAll(sql, params);
}

export function getDepartment(id) {
  return queryOne(`
    SELECT d.*, b.name as branch_name
    FROM departments d
    JOIN branches b ON b.id = d.branch_id
    WHERE d.id = ?
  `, [id]);
}

export function assertDepartmentInBranch(departmentId, branchId) {
  const dept = getDepartment(departmentId);
  if (!dept) throw new Error('Отдел не найден');
  if (dept.branch_id !== branchId) throw new Error('Отдел не принадлежит выбранному филиалу');
  if (!dept.active) throw new Error('Отдел отключён');
  return dept;
}

export function createDepartment(data) {
  const id = (data.id || uuidv4()).trim();
  const branchId = (data.branch_id || DEFAULT_BRANCH_ID).trim();
  const name = (data.name || '').trim();
  if (!name) throw new Error('Укажите название отдела');

  const branch = queryOne('SELECT id FROM branches WHERE id = ?', [branchId]);
  if (!branch) throw new Error('Филиал не найден');

  const existing = queryOne('SELECT id FROM departments WHERE id = ?', [id]);
  if (existing) throw new Error('Отдел с таким кодом уже существует');

  run(
    'INSERT INTO departments (id, branch_id, name, active) VALUES (?, ?, ?, ?)',
    [id, branchId, name, data.active !== false ? 1 : 0],
  );
  return getDepartment(id);
}

export function updateDepartment(id, data) {
  const dept = getDepartment(id);
  if (!dept) throw new Error('Отдел не найден');

  const name = (data.name || dept.name).trim();
  if (!name) throw new Error('Укажите название отдела');

  const branchId = data.branch_id !== undefined ? data.branch_id : dept.branch_id;
  if (branchId !== dept.branch_id) {
    const docsCount = queryOne(
      'SELECT COUNT(*) as c FROM documents WHERE from_department_id = ? OR to_department_id = ?',
      [id, id],
    ).c;
    if (docsCount > 0) throw new Error('Отдел используется в документах — смена филиала невозможна');
  }

  run(
    'UPDATE departments SET branch_id = ?, name = ?, active = ? WHERE id = ?',
    [
      branchId,
      name,
      data.active !== undefined ? (data.active ? 1 : 0) : dept.active,
      id,
    ],
  );
  return getDepartment(id);
}

export function deleteDepartment(id) {
  const dept = getDepartment(id);
  if (!dept) throw new Error('Отдел не найден');

  const docsCount = queryOne(
    'SELECT COUNT(*) as c FROM documents WHERE from_department_id = ? OR to_department_id = ?',
    [id, id],
  ).c;
  if (docsCount > 0) throw new Error('Отдел используется в документах — удаление невозможно');

  run('DELETE FROM product_department_stock WHERE department_id = ?', [id]);
  run('DELETE FROM departments WHERE id = ?', [id]);
}

export function getDepartmentStock(productId, departmentId, variantId = null) {
  if (variantId) {
    const row = queryOne(
      'SELECT stock FROM product_department_stock WHERE department_id = ? AND product_id = ? AND variant_id = ?',
      [departmentId, productId, variantId],
    );
    return row?.stock || 0;
  }
  const row = queryOne(
    `SELECT stock FROM product_department_stock
     WHERE department_id = ? AND product_id = ? AND (variant_id IS NULL OR variant_id = '')`,
    [departmentId, productId],
  );
  return row?.stock || 0;
}

export function adjustDepartmentStock(departmentId, productId, delta, variantId = null) {
  const row = variantId
    ? queryOne(
      'SELECT id, stock FROM product_department_stock WHERE department_id = ? AND product_id = ? AND variant_id = ?',
      [departmentId, productId, variantId],
    )
    : queryOne(
      `SELECT id, stock FROM product_department_stock
       WHERE department_id = ? AND product_id = ? AND (variant_id IS NULL OR variant_id = '')`,
      [departmentId, productId],
    );

  if (row) {
    if (variantId) {
      run(
        'UPDATE product_department_stock SET stock = stock + ?, updated_at = datetime(\'now\') WHERE department_id = ? AND product_id = ? AND variant_id = ?',
        [delta, departmentId, productId, variantId],
      );
    } else {
      run(
        'UPDATE product_department_stock SET stock = stock + ?, updated_at = datetime(\'now\') WHERE department_id = ? AND product_id = ? AND (variant_id IS NULL OR variant_id = \'\')',
        [delta, departmentId, productId],
      );
    }
  } else {
    run(
      'INSERT INTO product_department_stock (id, department_id, product_id, variant_id, stock) VALUES (?, ?, ?, ?, ?)',
      [uuidv4(), departmentId, productId, variantId || null, delta],
    );
  }
}

export function getDefaultDepartmentId(branchId) {
  const dept = queryOne(
    `SELECT id FROM departments
     WHERE branch_id = ? AND active = 1
     ORDER BY id = 'main_wh' DESC, name
     LIMIT 1`,
    [branchId],
  );
  return dept?.id || null;
}

export function getDepartmentStockSumForBranch(productId, branchId) {
  const row = queryOne(`
    SELECT COALESCE(SUM(pds.stock), 0) as total
    FROM product_department_stock pds
    JOIN departments d ON d.id = pds.department_id
    WHERE d.branch_id = ? AND pds.product_id = ?
  `, [branchId, productId]);
  return row?.total || 0;
}

export function syncBranchStockFromDepartments(branchId, productId) {
  const total = getDepartmentStockSumForBranch(productId, branchId);
  const row = queryOne(
    'SELECT id FROM product_branch_stock WHERE branch_id = ? AND product_id = ?',
    [branchId, productId],
  );
  if (row) {
    run(
      'UPDATE product_branch_stock SET stock = ?, updated_at = datetime(\'now\') WHERE branch_id = ? AND product_id = ?',
      [total, branchId, productId],
    );
  } else if (total !== 0) {
    run(
      'INSERT INTO product_branch_stock (id, branch_id, product_id, stock) VALUES (?, ?, ?, ?)',
      [uuidv4(), branchId, productId, total],
    );
  }
}

export function migrateDepartmentStockSync() {
  const done = queryOne("SELECT value FROM settings WHERE key = 'departments_stock_v2'");
  if (done) return;

  const branchStocks = queryAll(
    'SELECT product_id, branch_id, stock FROM product_branch_stock WHERE stock != 0',
  );
  for (const row of branchStocks) {
    const deptSum = getDepartmentStockSumForBranch(row.product_id, row.branch_id);
    if (deptSum !== 0) continue;

    const defaultDeptId = getDefaultDepartmentId(row.branch_id);
    if (!defaultDeptId) continue;

    adjustDepartmentStock(defaultDeptId, row.product_id, row.stock);
  }

  const branches = queryAll('SELECT id FROM branches');
  const products = queryAll('SELECT id FROM products');
  for (const branch of branches) {
    for (const product of products) {
      syncBranchStockFromDepartments(branch.id, product.id);
    }
  }

  run("INSERT OR REPLACE INTO settings (key, value) VALUES ('departments_stock_v2', '1')");
}

export function enrichDepartment(dept) {
  if (!dept) return null;
  return { ...dept, active: !!dept.active };
}

export function getDepartmentsEnriched(branchId = null, activeOnly = false) {
  return getDepartments(branchId, activeOnly).map(enrichDepartment);
}
