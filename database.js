const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'database.json');

// Inicializar base de datos
function initDB() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (!fs.existsSync(DB_PATH)) {
    const initialData = {
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
    writeDB(initialData);
  } else {
    // Migración de base de datos de category a proveedor e inicialización de ubicaciones
    try {
      const data = fs.readFileSync(DB_PATH, 'utf8');
      const dbObj = JSON.parse(data);
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
      if (migrated) {
        fs.writeFileSync(DB_PATH, JSON.stringify(dbObj, null, 2), 'utf8');
        console.log("Base de datos migrada: se inicializaron ubicaciones.");
      }
    } catch (e) {
      console.error("Error al migrar la base de datos:", e);
    }
  }
}

// Leer base de datos de forma segura
function readDB() {
  try {
    initDB();
    const data = fs.readFileSync(DB_PATH, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error("Error al leer la base de datos:", error);
    return { products: [], history: [], chat_messages: [] };
  }
}

// Escribir base de datos de forma atómica
function writeDB(data) {
  try {
    const tempPath = DB_PATH + '.tmp';
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tempPath, DB_PATH);
    return true;
  } catch (error) {
    console.error("Error al escribir la base de datos:", error);
    return false;
  }
}

// Operaciones de Productos
function getProducts() {
  const db = readDB();
  return db.products;
}

function saveProduct(productData) {
  const db = readDB();
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

  writeDB(db);
  return db.products.find(p => p.code.toUpperCase() === productData.code.toUpperCase());
}

function deleteProduct(code) {
  const db = readDB();
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

    writeDB(db);
    return true;
  }
  return false;
}

// Operaciones de Historial y Mensajes
function getHistory() {
  const db = readDB();
  return db.history;
}

function getChatMessages() {
  const db = readDB();
  return db.chat_messages;
}

function addChatMessage(message) {
  const db = readDB();
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
  
  writeDB(db);
  return newMessage;
}

// Registrar un consumo desde el Chat (NLP)
function processConsumption(code, quantity, person, vehicle) {
  const db = readDB();
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

  writeDB(db);

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
function processAddition(code, quantity, person) {
  const db = readDB();
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

  writeDB(db);

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
function undoTransaction(transactionId) {
  const db = readDB();
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

  writeDB(db);

  return {
    success: true,
    productName: db.products[productIndex].name,
    productCode: db.products[productIndex].code,
    newQuantity: db.products[productIndex].quantity,
    restoredQuantity: qtyChangeResult,
    actionType: log.action
  };
}

function clearHistory() {
  const db = readDB();
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
  
  writeDB(db);
  return true;
}

function getOfficeLocations() {
  const db = readDB();
  return db.officeLocations || [];
}

function saveOfficeLocation(loc) {
  if (!loc || loc.trim() === '') return;
  const db = readDB();
  if (!db.officeLocations) db.officeLocations = [];
  const normalized = loc.trim();
  // Búsqueda case-insensitive para evitar duplicados
  if (!db.officeLocations.some(l => l.toLowerCase() === normalized.toLowerCase())) {
    db.officeLocations.push(normalized);
    writeDB(db);
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
