const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('saveProduct persiste en una ruta configurable', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inventario-test-'));
  const tempDbPath = path.join(tempDir, 'database.json');
  process.env.DB_PATH = tempDbPath;

  delete require.cache[require.resolve('../database')];
  const db = require('../database');

  const saved = db.saveProduct({
    code: 'PR-001',
    name: 'Producto prueba',
    proveedor: 'Proveedor X',
    quantity: 5,
    minQuantity: 2,
    price: 10.5,
    ubicacion: 'Almacén',
    ubicacionDetalle: ''
  });

  assert.equal(saved.code, 'PR-001');
  assert.equal(db.getProducts().length, 1);
  assert.ok(fs.existsSync(tempDbPath));

  delete process.env.DB_PATH;
});
