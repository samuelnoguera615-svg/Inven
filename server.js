const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Servir el frontend principal
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Helper de parsing NLP en Español
function cleanAndCapitalizeName(name) {
  if (!name) return "Usuario";
  
  // Quitar palabras de enlace comunes al inicio
  let clean = name.replace(/^(el|la|un|una|de|a|por)\s+/i, '').trim();
  
  // Quitar cláusulas extras (ej: "por favor", "del inventario")
  clean = clean.split(/\s+(?:el|la|un|una|en|con|del|de|para|como|gracias|por\s+favor)\b/i)[0];
  clean = clean.replace(/[.,;]/g, '').trim();
  
  if (clean.length < 2 || ["favor", "ejemplo", "sistema", "usuario", "unidad", "unidades", "equipo", "equipos"].includes(clean.toLowerCase())) {
    return "Usuario";
  }
  
  return clean.split(/\s+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

function cleanAndCapitalizeVehicle(val) {
  if (!val) return "No especificado";
  let clean = val.replace(/[.,;]/g, '').trim();
  return clean.split(/\s+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

function parseConsumptionMessage(text, products) {
  const normalized = text.toLowerCase();
  
  // 1. Detectar el Código de Producto
  let detectedCode = null;
  let matchedProduct = null;
  
  // Buscar coincidencia exacta con códigos de producto en inventario
  for (const product of products) {
    const codeEscaped = product.code.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const codeRegex = new RegExp('\\b' + codeEscaped + '\\b', 'i');
    if (codeRegex.test(text)) {
      detectedCode = product.code;
      matchedProduct = product;
      break;
    }
  }
  
  // Si no coincide con códigos existentes, buscar un formato general de código (ej: LPT-101)
  if (!detectedCode) {
    const genericCodeMatch = text.match(/\b([a-z0-9]+-[a-z0-9-]+)\b/i);
    if (genericCodeMatch) {
      detectedCode = genericCodeMatch[1].toUpperCase();
    }
  }
  
  // 2. Detectar la Cantidad (Soporta decimales ej: 0.5 o 0,5)
  let quantity = 1; // Default
  const normalizedText = text.replace(/,/g, '.');
  const numMatches = normalizedText.match(/\b\d+(?:\.\d+)?\b/g);
  if (numMatches && numMatches.length > 0) {
    let validNumbers = [];
    for (const numStr of numMatches) {
      const num = parseFloat(numStr);
      
      // Si el código contiene el número, evitar confundirlo con la cantidad (ej: MON-24 contiene 24)
      if (detectedCode) {
        const parts = detectedCode.split('-');
        if (parts.includes(numStr) || parts.includes(String(num)) || parts.includes(String(Math.floor(num)))) {
          continue; // Probablemente parte del código
        }
      }
      validNumbers.push(num);
    }
    
    if (validNumbers.length > 0) {
      quantity = validNumbers[0];
    }
  }
  
  // 3. Detectar Persona
  let person = "Usuario";
  
  // Patrones lingüísticos comunes en español
  const patterns = [
    // "[Persona] consumió/se consumió..."
    /^\s*([a-záéíóúñ\s]+?)\s+(?:se\s+)?(?:consumi[oó]|utiliz[oó]|sac[oó]|retir[oó]|llev[oó]|descont[oó]|uso|usó)/i,
    // "...por parte de [Persona]"
    /(?:por parte de|de parte de)\s+([a-záéíóúñ\s]+)/i,
    // "...para [Persona]"
    /\bpara\s+([a-záéíóúñ\s]+)/i,
    // "...entregado/asignado a [Persona]"
    /(?:entregado|asignado|dado|retirado)\s+a\s+([a-záéíóúñ\s]+)/i,
    // "...por [Persona]" (excluyendo "por parte" o "por favor")
    /\bpor\s+(?!parte|favor|ejemplo)([a-záéíóúñ\s]+)/i
  ];
  
  let foundPerson = false;
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const candidate = match[1].trim();
      const cleanedCandidate = cleanAndCapitalizeName(candidate);
      if (cleanedCandidate !== "Usuario") {
        person = cleanedCandidate;
        foundPerson = true;
        break;
      }
    }
  }
  
  // Si no se detectó persona por patrones, buscar el primer sustantivo propio potencial al inicio
  if (!foundPerson) {
    const firstWordMatch = text.match(/^\s*([a-záéíóúñ]+(?:\s+[a-záéíóúñ]+){0,1})/i);
    if (firstWordMatch) {
      const candidate = firstWordMatch[1].trim();
      const cleaned = cleanAndCapitalizeName(candidate);
      // Evitar que palabras clave del sistema sean tomadas como personas
      const keywords = ["se", "un", "una", "el", "la", "los", "las", "este", "esta", "consumo", "descuento", "inventario", "quiero", "favor", "hola"];
      if (cleaned !== "Usuario" && !keywords.includes(candidate.toLowerCase())) {
        person = cleaned;
      }
    }
  }
  
  // 4. Detectar si es una Adición (Añadir/Ingresar) o Remoción (Consumir/Quitar)
  let isAddition = false;
  const additionKeywords = ["añadir", "añadio", "añadió", "añadieron", "agregar", "agrego", "agregó", "agregaron", "ingresar", "ingreso", "ingresó", "ingresaron", "reponer", "repuso", "repusieron", "sumar", "sumo", "sumó", "devolver", "devolvio", "devolvió", "devolvieron", "recibir", "recibio", "recibió", "recibieron", "entrada", "entró", "entro", "entraron", "abastecer", "abasteció", "abastecio", "cargó", "cargo", "cargar", "cargaron", "sumar", "suma", "sumar"];
  
  for (const word of additionKeywords) {
    if (normalized.includes(word)) {
      isAddition = true;
      break;
    }
  }

  let isSubtraction = false;
  const subtractionKeywords = ["quitar", "quito", "quitó", "quitaron", "consumir", "consumio", "consumió", "consumieron", "retirar", "retiro", "retiró", "retiraron", "descontar", "desconto", "descontó", "descontaron", "sacar", "saco", "sacó", "sacaron", "perder", "perdio", "perdió", "perdieron", "gastar", "gasto", "gastó", "gastaron", "llevar", "llevo", "llevó", "llevaron", "usar", "uso", "usó", "usaron", "utilizar", "utilizo", "utilizó", "utilizaron", "restar", "resto", "restó", "restaron", "eliminar", "elimino", "eliminó", "eliminaron", "salida", "salió", "salio", "salieron", "menos"];
  
  for (const word of subtractionKeywords) {
    if (normalized.includes(word)) {
      isSubtraction = true;
      break;
    }
  }

  // Detectar signos (+/-) asociados a números
  let hasPlusSign = false;
  let hasMinusSign = false;
  
  let textForSignCheck = normalized;
  if (detectedCode) {
    const escapedCode = detectedCode.toLowerCase().replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    textForSignCheck = normalized.replace(new RegExp(escapedCode, 'g'), '');
  }
  
  if (/\+\s*\d+|\d+\s*\+/.test(textForSignCheck)) {
    hasPlusSign = true;
  }
  if (/-\s*\d+|\d+\s*-/.test(textForSignCheck)) {
    hasMinusSign = true;
  }

  if (hasPlusSign) isAddition = true;
  if (hasMinusSign) isSubtraction = true;

  const isAmbiguous = (isAddition && isSubtraction) || (!isAddition && !isSubtraction);

  // 5. Detectar Vehículo o Unidad (Prioriza placa de 7 caracteres)
  let vehicle = "No especificado";
  let foundVehicle = false;

  // Remover el código de producto detectado del texto para no confundirlo con la patente
  let textForVehicleSearch = text;
  if (detectedCode) {
    const escapedCode = detectedCode.toLowerCase().replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    textForVehicleSearch = text.replace(new RegExp(escapedCode, 'gi'), '');
  }

  // Buscar tokens de 7 caracteres alfanuméricos (mezcla de letras y números)
  const tokens = textForVehicleSearch.split(/[\s,;.!]+/);
  for (const token of tokens) {
    const cleanToken = token.replace(/[^a-zA-Z0-9]/g, '');
    if (cleanToken.length === 7) {
      const hasLetters = /[a-zA-Z]/.test(cleanToken);
      const hasNumbers = /[0-9]/.test(cleanToken);
      
      const commonWords = ["consumo", "gracias", "sistema", "usuario", "oficina", "almacen", "almacén"];
      
      if (hasLetters && hasNumbers && !commonWords.includes(cleanToken.toLowerCase())) {
        vehicle = token.toUpperCase();
        foundVehicle = true;
        break;
      }
    }
  }

  // Si no se encuentra patente de 7 caracteres, buscar por patrones lingüísticos tradicionales
  if (!foundVehicle) {
    const vehiclePatterns = [
      /(?:para\s+la\s+unidad|unidad|para\s+el\s+veh[ií]culo|veh[ií]culo|para\s+la\s+gr[uú]a|gr[uú]a)\s+([a-z0-9\-–\s]+?)(?:\s+(?:por|de|en|con|gracias|por\s+favor)\b|$)/i
    ];
    
    for (const pattern of vehiclePatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        const candidate = match[1].trim();
        if (candidate && (!detectedCode || candidate.toUpperCase() !== detectedCode.toUpperCase())) {
          vehicle = cleanAndCapitalizeVehicle(candidate);
          break;
        }
      }
    }
  }
  
  return {
    code: detectedCode,
    quantity,
    person,
    vehicle,
    matchedProduct,
    isAddition,
    isSubtraction,
    isAmbiguous
  };
}

// --- Rutas de la API ---

// 1. Obtener todos los productos
app.get('/api/products', (req, res) => {
  res.json(db.getProducts());
});

// 2. Registrar o actualizar un producto
app.post('/api/products', (req, res) => {
  const { code, name, proveedor, quantity, minQuantity, price, ubicacion, ubicacionDetalle } = req.body;
  
  if (!code || !name || quantity === undefined) {
    return res.status(400).json({ error: "Faltan datos obligatorios (código, nombre, cantidad)." });
  }
  
  const saved = db.saveProduct({
    code,
    name,
    proveedor,
    quantity: parseFloat(quantity),
    minQuantity: parseFloat(minQuantity),
    price: parseFloat(price) || 0.0,
    ubicacion,
    ubicacionDetalle
  });

  if (ubicacion === "Oficina" && ubicacionDetalle) {
    db.saveOfficeLocation(ubicacionDetalle);
  }

  res.json(saved);
});

// 3. Eliminar producto
app.delete('/api/products/:code', (req, res) => {
  const code = req.params.code;
  const success = db.deleteProduct(code);
  if (success) {
    res.json({ success: true, message: `Producto ${code} eliminado con éxito.` });
  } else {
    res.status(404).json({ error: `No se encontró el producto con código ${code}.` });
  }
});

// 4. Obtener historial de auditoría
app.get('/api/history', (req, res) => {
  res.json(db.getHistory());
});

// 5. Obtener historial de mensajes de chat
app.get('/api/chat/messages', (req, res) => {
  res.json(db.getChatMessages());
});

// Obtener ubicaciones guardadas para autocompletar
app.get('/api/office-locations', (req, res) => {
  res.json(db.getOfficeLocations());
});

// 6. Enviar mensaje de chat y procesar consumo (NLP)
app.post('/api/chat/message', (req, res) => {
  const { text } = req.body;
  if (!text || text.trim() === '') {
    return res.status(400).json({ error: "El texto del mensaje no puede estar vacío." });
  }

  // Guardar mensaje del usuario
  const userMsg = db.addChatMessage({
    sender: "user",
    text: text
  });

  const products = db.getProducts();
  const parsed = parseConsumptionMessage(text, products);

  // Si no se detectó código de producto
  if (!parsed.code) {
    const availableCodes = products.slice(0, 5).map(p => `\`${p.code}\` (${p.name})`).join(', ');
    const botReply = `❌ **No pude detectar el código del producto.**\n\nPor favor, escribe un mensaje que incluya el código del producto, por ejemplo: \`LAP-01\` o \`MON-24\`.\n\n_Ejemplos de códigos en inventario: ${availableCodes || 'Ninguno aún'}_`;
    
    const botMsg = db.addChatMessage({
      sender: "bot",
      text: botReply,
      status: "error"
    });

    return res.json({
      parsed,
      userMessage: userMsg,
      botMessage: botMsg
    });
  }

  // Si la acción es ambigua o no se reconoce la dirección del stock
  if (parsed.isAmbiguous) {
    let botReply = "";
    if (parsed.isAddition && parsed.isSubtraction) {
      botReply = `❌ **Comando Ambiguo**\n\nHe detectado palabras clave tanto de **adición** (añadir, ingresar) como de **sustracción** (quitar, consumir) para el producto \`${parsed.code}\`.\n\nPor favor, especifica claramente una sola acción. Por ejemplo:\n• _"César consumió 2 ${parsed.code}"_ (quitar)\n• _"Ana ingresó 5 ${parsed.code}"_ (añadir)`;
    } else {
      botReply = `❌ **Acción no reconocida**\n\nHe detectado el producto \`${parsed.code}\`, pero no pude determinar si deseas **añadir** o **quitar** stock.\n\nPor favor, utiliza palabras claras o símbolos:\n• Para **añadir**: _añadir, ingresar, reponer, agregar o un signo +_\n• Para **quitar**: _consumir, retirar, quitar, descontar o un signo -_\n\n_Ejemplo: "César consumió 2 ${parsed.code} para la grúa 12" o "Ana ingresó 5 ${parsed.code}"_`;
    }
    
    const botMsg = db.addChatMessage({
      sender: "bot",
      text: botReply,
      status: "error",
      affectedCode: parsed.code
    });

    return res.json({
      parsed,
      userMessage: userMsg,
      botMessage: botMsg
    });
  }

  // Intentar procesar la transacción según la dirección detectada (Añadir vs Quitar)
  let result;
  let botReply = "";
  let status = "info";
  let transactionId = null;

  if (parsed.isAddition) {
    // Procesar ingreso de stock
    result = db.processAddition(parsed.code, parsed.quantity, parsed.person);
    
    if (result.success) {
      status = "success";
      transactionId = result.transactionId;
      const addValueFormatted = result.additionValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const priceUnitFormatted = result.priceUnit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const pendingReplenishText = result.pendingReplenishment > 0 
        ? `Quedan **${result.pendingReplenishment}** unidades pendientes por reponer.`
        : `¡Reposición completada! No quedan unidades pendientes por reponer.`;

      botReply = `✅ **Ingreso de Stock Registrado Exitosamente**\n\n` +
                 `• **Responsable**: ${parsed.person}\n` +
                 `• **Producto**: ${result.productName} (\`${result.productCode}\`)\n` +
                 `• **Cantidad ingresada**: **${result.quantity}** unidades\n` +
                 `• **Valor de ingreso**: **$${addValueFormatted}** _(${result.quantity} und x $${priceUnitFormatted} c/u)_\n` +
                 `• **Estado de reposición**: ${pendingReplenishText}\n` +
                 `• **Stock actual**: **${result.remainingQuantity}**\n\n` +
                 `_ID de transacción: \`${transactionId}\` (puedes deshacer esta acción si fue un error)._`;
    } else {
      status = "error";
      if (result.reason === "NOT_FOUND") {
        botReply = `❌ **Producto no encontrado**\n\nEl código \`${parsed.code}\` no está registrado en el inventario. Agrégalo primero en el panel de inventario.`;
      }
    }
  } else {
    // Procesar consumo de stock (quitar)
    result = db.processConsumption(parsed.code, parsed.quantity, parsed.person, parsed.vehicle);
    
    if (result.success) {
      status = "success";
      transactionId = result.transactionId;
      const repCostFormatted = result.replacementCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const priceUnitFormatted = result.priceUnit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const vehicleText = parsed.vehicle !== "No especificado"
        ? `**${parsed.vehicle}**`
        : `No especificado _(puedes indicarlo en el chat, ej: 'para la grúa 14')_`;
      
      botReply = `✅ **Consumo Registrado Exitosamente**\n\n` +
                 `• **Responsable**: ${parsed.person}\n` +
                 `• **Vehículo (Placa)**: ${vehicleText}\n` +
                 `• **Producto**: ${result.productName} (\`${result.productCode}\`)\n` +
                 `• **Cantidad retirada**: **${result.quantity}** unidades\n` +
                 `• **Costo de reposición**: **$${repCostFormatted}** _(${result.quantity} und x $${priceUnitFormatted} c/u)_\n` +
                 `• **Para reponer esta acción**: Debes ingresar **${result.quantity}** unidades de este producto.\n` +
                 `• **Total pendiente por reponer**: **${result.pendingReplenishment}** unidades.\n` +
                 `• **Stock restante**: **${result.remainingQuantity}**\n\n` +
                 `_ID de transacción: \`${transactionId}\` (puedes deshacer esta acción si fue un error)._`;

      // Alerta de bajo stock si corresponde
      if (result.remainingQuantity <= result.minQuantity) {
        status = "warning";
        botReply += `\n\n⚠️ **ALERTA DE STOCK BAJO**: Este producto ha alcanzado o superado el stock mínimo recomendado de **${result.minQuantity}** unidades.`;
      }
    } else {
      status = "error";
      if (result.reason === "NOT_FOUND") {
        botReply = `❌ **Producto no encontrado**\n\nEl código \`${parsed.code}\` no está registrado en el inventario. Agrégalo primero en el panel de inventario.`;
      } else if (result.reason === "INSUFFICIENT_STOCK") {
        botReply = `❌ **Stock insuficiente**\n\nNo es posible retirar **${result.requested}** unidades del producto **${result.product.name}** (\`${result.code}\`).\n\n• **Stock actual**: **${result.product.quantity}** unidades\n• **Faltante**: **${result.requested - result.product.quantity}** unidades.`;
      }
    }
  }

  // Guardar mensaje de respuesta del bot
  const botMsg = db.addChatMessage({
    sender: "bot",
    text: botReply,
    status: status,
    transactionId: transactionId,
    affectedCode: parsed.code,
    person: parsed.person,
    quantity: parsed.isAddition ? parsed.quantity : -parsed.quantity
  });

  res.json({
    parsed,
    userMessage: userMsg,
    botMessage: botMsg
  });
});

// 7. Deshacer un consumo
app.post('/api/chat/undo', (req, res) => {
  const { transactionId } = req.body;
  if (!transactionId) {
    return res.status(400).json({ error: "Se requiere un ID de transacción." });
  }

  const result = db.undoTransaction(transactionId);

  if (result.success) {
    const undoReply = `🔄 **Acción Deshecha**\n\nSe han restaurado **${result.restoredQuantity}** unidades del producto **${result.productName}** (\`${result.productCode}\`).\n\n• **Nuevo Stock**: **${result.newQuantity}** unidades.`;
    
    const botMsg = db.addChatMessage({
      sender: "bot",
      text: undoReply,
      status: "info"
    });

    res.json({ success: true, botMessage: botMsg });
  } else {
    let errorMsg = "No se pudo deshacer la transacción.";
    if (result.reason === "LOG_NOT_FOUND") {
      errorMsg = "La transacción no existe o ya fue deshecha anteriormente.";
    } else if (result.reason === "PRODUCT_NOT_FOUND") {
      errorMsg = "El producto asociado a esta transacción ya no existe en el inventario.";
    }
    res.status(400).json({ error: errorMsg });
  }
});

// 8. Eliminar todo el historial con código de seguridad
app.post('/api/history/clear', (req, res) => {
  const { code } = req.body;
  if (!code) {
    return res.status(400).json({ error: "Se requiere el código de seguridad." });
  }

  if (code !== "2610") {
    return res.status(403).json({ error: "Código de seguridad incorrecto." });
  }

  const success = db.clearHistory();
  if (success) {
    res.json({ success: true, message: "Historial eliminado con éxito." });
  } else {
    res.status(500).json({ error: "Ocurrió un error al intentar eliminar el historial." });
  }
});

// 9. Fallback para APIs no encontradas: devolver JSON en lugar de HTML
app.use('/api/*', (req, res) => {
  res.status(404).json({ error: 'Endpoint API no encontrado.' });
});

// Iniciar servidor de manera dinámica (busca puertos alternativos si está ocupado)
function startServer(port) {
  const server = app.listen(port, () => {
    console.log(`===================================================`);
    console.log(` Servidor de Inventario corriendo en puerto ${port}`);
    console.log(` Local: http://localhost:${port}`);
    console.log(`===================================================`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`Puerto ${port} ocupado, probando con el puerto ${port + 1}...`);
      startServer(port + 1);
    } else {
      console.error("Error al iniciar el servidor:", err);
    }
  });
}

startServer(PORT);
