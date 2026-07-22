const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'database.json');

// Cliente KV perezoso (Lazy Load client) para evitar errores locales de inicialización
let kvClient = null;

function getKVClient() {
  if (kvClient) return kvClient;

  // Buscar credenciales de conexión HTTP REST
  let url = process.env.KV_REST_API_URL;
  let token = process.env.KV_REST_API_TOKEN;

  if (!url && process.env.UPSTASH_REDIS_REST_URL) {
    url = process.env.UPSTASH_REDIS_REST_URL;
    token = process.env.UPSTASH_REDIS_REST_TOKEN;
  } else if (!url && process.env.REDIS_URL) {
    try {
      const rawUrl = process.env.REDIS_URL;
      if (rawUrl.startsWith('redis://') || rawUrl.startsWith('rediss://')) {
        const cleanUrl = rawUrl.replace(/^rediss?:\/\//, '');
        const [credentials, hostPort] = cleanUrl.split('@');
        if (credentials && hostPort) {
          const parts = credentials.split(':');
          const password = parts.length > 1 ? parts[1] : parts[0];
          const [host] = hostPort.split(':');
          if (host && password) {
            url = `https://${host}`;
            token = password;
          }
        }
      }
    } catch (error) {
      console.error("Error al parsear REDIS_URL en getKVClient:", error);
    }
  }

  // Si tenemos credenciales válidas, creamos el cliente
  if (url && token) {
    try {
      const { createClient } = require('@vercel/kv');
      kvClient = createClient({ url, token });
      console.log("Cliente de Vercel KV (Upstash) inicializado correctamente por REST.");
    } catch (e) {
      console.error("Error al importar o instanciar createClient de @vercel/kv:", e);
    }
  }

  return kvClient;
}

// Obtener datos iniciales de la base de datos
function getInitialData() {
  return {
    products: [],
    history: [],
    officeLocations: [],
    chat_messages: [
      {
        id: "msg_welcome",
        timestamp: new Date().toISOString(),
        sender: "bot",
        text: "¡Hola! Bienvenido al chat de control de inventario. Registra productos en el panel de inventario y luego escríbeme aquí para registrar consumos.",
        status: "info"
      }
    ]
  };
}

// Migración de datos estructurados para compatibilidad de versión
function migrateData(dbObj) {
  let migrated = false;
  if (!dbObj.officeLocations) {
    dbObj.officeLocations = [];
    migrated = true;
  }
  if (dbObj.products) {
    dbObj.products.forEach(p => {
      if (p.hasOwnProperty('category')) {
        p.proveedor = p.category;
        delete p.category;
        migrated = true;
      }
      if (!p.hasOwnProperty('ubicacion')) {
        p.ubicacion = "Almacén";
        p.ubicacionDetalle = "";
        migrated = true;
      }
    });
  }
  return { dbObj, migrated };
}

// Leer base de datos de forma asíncrona compatible con Local / Vercel KV
async function readDB() {
  const kv = getKVClient();
  
  if (kv) {
    try {
      const dbObj = await kv.get('inventario_db');
      if (!dbObj) {
        const initial = getInitialData();
        await kv.set('inventario_db', initial);
        return initial;
      }
      const { dbObj: migratedObj, migrated } = migrateData(dbObj);
      if (migrated) {
        await kv.set('inventario_db', migratedObj);
      }
      return migratedObj;
    } catch (error) {
      console.error("Error al leer de Vercel KV:", error);
      return getInitialData();
    }
  } else {
    // Modo local (archivo JSON físico)
    try {
      const dir = path.dirname(DB_PATH);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      if (!fs.existsSync(DB_PATH)) {
        const initial = getInitialData();
        fs.writeFileSync(DB_PATH, JSON.stringify(initial, null, 2), 'utf8');
        return initial;
      }

      const data = fs.readFileSync(DB_PATH, 'utf8');
      const dbObj = JSON.parse(data);
      const { dbObj: migratedObj, migrated } = migrateData(dbObj);
      if (migrated) {
        fs.writeFileSync(DB_PATH, JSON.stringify(migratedObj, null, 2), 'utf8');
      }
      return migratedObj;
    } catch (error) {
      console.error("Error al leer la base de datos local:", error);
      return getInitialData();
    }
  }
}

// Escribir base de datos de forma asíncrona compatible con Local / Vercel KV
async function writeDB(data) {
  const kv = getKVClient();

  if (kv) {
    try {
      await kv.set('inventario_db', data);
      return true;
    } catch (error) {
      console.error("Error al escribir en Vercel KV:", error);
      return false;
    }
  } else {
    // Modo local (archivo JSON físico de forma atómica)
    try {
      const dir = path.dirname(DB_PATH);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const tempPath = DB_PATH + '.tmp';
      fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
      fs.renameSync(tempPath, DB_PATH);
      return true;
    } catch (error) {
      console.error("Error al escribir la base de datos local:", error);
      return false;
    }
  }
}

// --- Operaciones de Productos (Asíncronas) ---
async function getProducts() {
  const db = await readDB();
  return db.products;
}

async function saveProduct(productData) {
  const db = await readDB();
  const index = db.products.findIndex(p => p.code.toUpperCase() === productData.code.toUpperCase());
  const now = new Date().toISOString();
  
  const price = parseFloat(productData.price) || 0.0;

  let quantityChange = 0;
  let action = "ACTUALIZAR_PRODUCTO";
  let details = "";

  if (index !== -1) {
    // Actualizar producto existente
    const oldProduct = db.products[index];
    quantityChange = productData.quantity - oldProduct.quantity;
    
    let pendingReplenishment = oldProduct.pendingReplenishment || 0;
    if (quantityChange > 0) {
      pendingReplenishment = Math.max(0, pendingReplenishment - quantityChange);
    } else if (quantityChange < 0) {
      pendingReplenishment += Math.abs(quantityChange);
    }

    db.products[index] = {
      ...oldProduct,
      name: productData.name,
      proveedor: productData.proveedor || oldProduct.proveedor,
      quantity: productData.quantity,
      minQuantity: productData.minQuantity !== undefined ? productData.minQuantity : oldProduct.minQuantity,
      price: price,
      pendingReplenishment: pendingReplenishment,
      ubicacion: productData.ubicacion || oldProduct.ubicacion || "Almacén",
      ubicacionDetalle: productData.ubicacionDetalle !== undefined ? productData.ubicacionDetalle : (oldProduct.ubicacionDetalle || ""),
      updatedAt: now
    };
    details = `Actualización de producto. Cambios: Nombre (${oldProduct.name} -> ${productData.name}), Stock (${oldProduct.quantity} -> ${productData.quantity}), Ubicación (${productData.ubicacion || "Almacén"}), Precio ($${(oldProduct.price || 0).toFixed(2)} -> $${price.toFixed(2)})`;
  } else {
    // Crear nuevo producto
    const newProduct = {
      code: productData.code.toUpperCase(),
      name: productData.name,
      proveedor: productData.proveedor || "General",
      quantity: productData.quantity,
      minQuantity: productData.minQuantity !== undefined ? productData.minQuantity : 2,
      price: price,
      pendingReplenishment: 0,
      ubicacion: productData.ubicacion || "Almacén",
      ubicacionDetalle: productData.ubicacionDetalle || "",
      createdAt: now,
      updatedAt: now
    };
    db.products.push(newProduct);
    quantityChange = productData.quantity;
    action = "CREAR_PRODUCTO";
    details = `Nuevo producto registrado en inventario con ${productData.quantity} unidades (ubicación: ${newProduct.ubicacion}) a un precio de $${price.toFixed(2)} c/u.`;
  }

  // Registrar en historial
  db.history.push({
    id: "log_" + Date.now() + "_" + Math.random().toString(36).substr(2, 5),
    timestamp: now,
    action: action,
    productCode: productData.code.toUpperCase(),
    productName: productData.name,
    quantityChange: quantityChange,
    priceUnit: price,
    person: "Administrador",
    details: details
  });

  await writeDB(db);
  return db.products.find(p => p.code.toUpperCase() === productData.code.toUpperCase());
}

async function deleteProduct(code) {
  const db = await readDB();
  const index = db.products.findIndex(p => p.code.toUpperCase() === code.toUpperCase());
  
  if (index !== -1) {
    const removed = db.products.splice(index, 1)[0];
    
    db.history.push({
      id: "log_" + Date.now() + "_" + Math.random().toString(36).substr(2, 5),
      timestamp: new Date().toISOString(),
      action: "ELIMINAR_PRODUCTO",
      productCode: removed.code,
      productName: removed.name,
      quantityChange: -removed.quantity,
      priceUnit: removed.price || 0.0,
      person: "Administrador",
      details: `Producto eliminado del sistema. Stock al eliminar: ${removed.quantity}. Precio unitario: $${(removed.price || 0).toFixed(2)}.`
    });

    await writeDB(db);
    return true;
  }
  return false;
}

// --- Operaciones de Historial y Mensajes (Asíncronas) ---
async function getHistory() {
  const db = await readDB();
  return db.history;
}

async function getChatMessages() {
  const db = await readDB();
  return db.chat_messages;
}

async function addChatMessage(message) {
  const db = await readDB();
  const newMessage = {
    id: "msg_" + Date.now() + "_" + Math.random().toString(36).substr(2, 5),
    timestamp: new Date().toISOString(),
    ...message
  };
  db.chat_messages.push(newMessage);
  
  // Limitar historial de chat a 100 mensajes
  if (db.chat_messages.length > 100) {
    db.chat_messages.shift();
  }
  
  await writeDB(db);
  return newMessage;
}

// Registrar un consumo desde el Chat (NLP)
async function processConsumption(code, quantity, person, vehicle) {
  const db = await readDB();
  const index = db.products.findIndex(p => p.code.toUpperCase() === code.toUpperCase());

  if (index === -1) {
    return { success: false, reason: "NOT_FOUND", code };
  }

  const product = db.products[index];
  if (product.quantity < quantity) {
    return { success: false, reason: "INSUFFICIENT_STOCK", code, product, requested: quantity };
  }

  // Descontar
  const oldQty = product.quantity;
  product.quantity -= quantity;
  product.pendingReplenishment = (product.pendingReplenishment || 0) + quantity;
  product.updatedAt = new Date().toISOString();

  // Calcular costo de reposición
  const priceUnit = product.price || 0.0;
  const replacementCost = quantity * priceUnit;

  // Crear ID de transacción único para poder deshacerla
  const transactionId = "tx_" + Date.now() + "_" + Math.random().toString(36).substr(2, 5);

  // Guardar log en el historial
  const log = {
    id: transactionId,
    timestamp: new Date().toISOString(),
    action: "CONSUMO_CHAT",
    productCode: product.code,
    productName: product.name,
    quantityChange: -quantity,
    priceUnit: priceUnit,
    replacementCost: replacementCost,
    person: person || "Usuario Anónimo",
    vehicle: vehicle || "No especificado",
    details: `Consumo registrado vía chat por ${person || 'Usuario'}. Cantidad: ${quantity} unidades para ${vehicle || 'vehículo no especificado'}. Costo de reposición: $${replacementCost.toFixed(2)}.`
  };
  db.history.push(log);

  await writeDB(db);

  return {
    success: true,
    transactionId,
    productName: product.name,
    productCode: product.code,
    remainingQuantity: product.quantity,
    pendingReplenishment: product.pendingReplenishment,
    minQuantity: product.minQuantity,
    quantity,
    priceUnit,
    replacementCost
  };
}

// Registrar un ingreso desde el Chat (NLP)
async function processAddition(code, quantity, person) {
  const db = await readDB();
  const index = db.products.findIndex(p => p.code.toUpperCase() === code.toUpperCase());

  if (index === -1) {
    return { success: false, reason: "NOT_FOUND", code };
  }

  const product = db.products[index];
  
  // Aumentar stock
  product.quantity += quantity;
  product.pendingReplenishment = Math.max(0, (product.pendingReplenishment || 0) - quantity);
  product.updatedAt = new Date().toISOString();

  // Calcular valor del ingreso
  const priceUnit = product.price || 0.0;
  const additionValue = quantity * priceUnit;

  // Crear ID de transacción único para poder deshacerla
  const transactionId = "tx_" + Date.now() + "_" + Math.random().toString(36).substr(2, 5);

  // Guardar log en el historial
  const log = {
    id: transactionId,
    timestamp: new Date().toISOString(),
    action: "INGRESO_CHAT",
    productCode: product.code,
    productName: product.name,
    quantityChange: quantity,
    priceUnit: priceUnit,
    replacementCost: -additionValue, // Se registra como valor negativo de costo (ahorro/ingreso)
    person: person || "Usuario Anónimo",
    details: `Ingreso de stock registrado vía chat por ${person || 'Usuario'}. Cantidad: ${quantity} unidades.`
  };
  db.history.push(log);

  await writeDB(db);

  return {
    success: true,
    transactionId,
    productName: product.name,
    productCode: product.code,
    remainingQuantity: product.quantity,
    pendingReplenishment: product.pendingReplenishment,
    minQuantity: product.minQuantity,
    quantity,
    priceUnit,
    additionValue
  };
}

// Deshacer una transacción (Undo)
async function undoTransaction(transactionId) {
  const db = await readDB();
  const logIndex = db.history.findIndex(h => h.id === transactionId);

  if (logIndex === -1) {
    return { success: false, reason: "LOG_NOT_FOUND" };
  }

  const log = db.history[logIndex];
  if (log.action !== "CONSUMO_CHAT" && log.action !== "INGRESO_CHAT") {
    return { success: false, reason: "INVALID_ACTION_TYPE" };
  }

  const productIndex = db.products.findIndex(p => p.code.toUpperCase() === log.productCode.toUpperCase());
  if (productIndex === -1) {
    return { success: false, reason: "PRODUCT_NOT_FOUND" };
  }

  let qtyChangeResult = 0;
  let detailMessage = "";
  
  if (log.action === "CONSUMO_CHAT") {
    // Revertir descuento (sumar lo que se restó)
    const qtyToRestore = Math.abs(log.quantityChange);
    db.products[productIndex].quantity += qtyToRestore;
    db.products[productIndex].pendingReplenishment = Math.max(0, (db.products[productIndex].pendingReplenishment || 0) - qtyToRestore);
    qtyChangeResult = qtyToRestore;
    detailMessage = `Se devolvieron ${qtyToRestore} unidades al stock.`;
  } else if (log.action === "INGRESO_CHAT") {
    // Revertir ingreso (restar lo que se sumó)
    const qtyToDeduct = log.quantityChange;
    if (db.products[productIndex].quantity < qtyToDeduct) {
      return { success: false, reason: "INSUFFICIENT_STOCK_FOR_UNDO" };
    }
    db.products[productIndex].quantity -= qtyToDeduct;
    db.products[productIndex].pendingReplenishment = (db.products[productIndex].pendingReplenishment || 0) + qtyToDeduct;
    qtyChangeResult = -qtyToDeduct;
    detailMessage = `Se retiraron ${qtyToDeduct} unidades del stock.`;
  }

  db.products[productIndex].updatedAt = new Date().toISOString();

  // Registrar la reversión en el historial
  db.history.push({
    id: "log_" + Date.now() + "_" + Math.random().toString(36).substr(2, 5),
    timestamp: new Date().toISOString(),
    action: "REVERTIR_CHAT",
    productCode: log.productCode,
    productName: log.productName,
    quantityChange: qtyChangeResult,
    priceUnit: log.priceUnit || 0.0,
    person: "Sistema (Deshacer)",
    details: `Se revirtió la transacción ${transactionId}. ${detailMessage}`
  });

  // Eliminar el log original para que no se pueda deshacer dos veces
  db.history.splice(logIndex, 1);

  await writeDB(db);

  return {
    success: true,
    productName: db.products[productIndex].name,
    productCode: db.products[productIndex].code,
    newQuantity: db.products[productIndex].quantity,
    restoredQuantity: qtyChangeResult,
    actionType: log.action
  };
}

async function clearHistory() {
  const db = await readDB();
  db.history = [];
  db.chat_messages = [
    {
      id: "msg_welcome",
      timestamp: new Date().toISOString(),
      sender: "bot",
      text: "¡Hola! Bienvenido al chat de control de inventario. Registra productos en el panel de inventario y luego escríbeme aquí para registrar consumos.",
      status: "info"
    }
  ];
  
  // Reiniciar pendingReplenishment de todos los productos
  db.products.forEach(p => {
    p.pendingReplenishment = 0;
  });
  
  await writeDB(db);
  return true;
}

async function getOfficeLocations() {
  const db = await readDB();
  return db.officeLocations || [];
}

async function saveOfficeLocation(loc) {
  if (!loc || loc.trim() === '') return;
  const db = await readDB();
  if (!db.officeLocations) db.officeLocations = [];
  const normalized = loc.trim();
  // Búsqueda case-insensitive para evitar duplicados
  if (!db.officeLocations.some(l => l.toLowerCase() === normalized.toLowerCase())) {
    db.officeLocations.push(normalized);
    await writeDB(db);
  }
}

module.exports = {
  getProducts,
  saveProduct,
  deleteProduct,
  getHistory,
  getChatMessages,
  addChatMessage,
  processConsumption,
  processAddition,
  undoTransaction,
  clearHistory,
  getOfficeLocations,
  saveOfficeLocation
};
