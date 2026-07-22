// URL de la API (Servidor local)
const API_URL = '';

// Variables de Estado
let products = [];
let historyLogs = [];
let chatMessages = [];
let activeTab = 'dashboard';
let isEditing = false;

// Elementos DOM
const navItems = document.querySelectorAll('.nav-item');
const tabContents = document.querySelectorAll('.tab-content');
const chatMessagesContainer = document.getElementById('chat-messages-container');
const chatInput = document.getElementById('chat-input');
const sendChatBtn = document.getElementById('send-chat-btn');
const toastContainer = document.getElementById('toast-container');
const chatBadge = document.getElementById('chat-badge');

// Inicialización de la aplicación
document.addEventListener('DOMContentLoaded', () => {
  setupTabs();
  fetchProducts();
  fetchHistory();
  fetchChatMessages();
  setupProductForm();
  setupSearchAndFilters();
  setupChatSuggestions();
  setupStatsControls();
  fetchOfficeLocations();
  setupLocationSelector();

  const clearHistoryBtn = document.getElementById('clear-history-btn');
  if (clearHistoryBtn) {
    clearHistoryBtn.addEventListener('click', clearHistoryWithCode);
  }
});

// --- SISTEMA DE TOASTS (NOTIFICACIONES) ---
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  let icon = '🔔';
  if (type === 'success') icon = '✅';
  if (type === 'warning') icon = '⚠️';
  if (type === 'danger') icon = '❌';

  toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
  toastContainer.appendChild(toast);
  
  // Eliminar toast después del delay
  setTimeout(() => {
    toast.remove();
  }, 4000);
}

async function clearHistoryWithCode() {
  const input = prompt('Ingrese el código de seguridad para eliminar el historial:');
  if (input === null) return; // Usuario canceló

  const normalized = input.trim();
  if (normalized !== '2610') {
    showToast('Código incorrecto. No se eliminó el historial.', 'danger');
    return;
  }

  try {
    const res = await fetch(`${API_URL}/api/history/clear`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: '2610' })
    });

    const contentType = res.headers.get('content-type') || '';
    let body;

    if (contentType.includes('application/json')) {
      body = await res.json();
    } else {
      const text = await res.text();
      throw new Error('Respuesta inesperada del servidor.');
    }

    if (!res.ok) {
      throw new Error(body.error || 'No se pudo eliminar el historial.');
    }

    showToast(body.message || 'Historial eliminado con éxito.', 'success');
    fetchHistory();
    fetchProducts();
    fetchChatMessages();
  } catch (error) {
    console.error(error);
    showToast(error.message, 'danger');
  }
}

// --- NAVEGACIÓN POR PESTAÑAS ---
function setupTabs() {
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const tabName = item.getAttribute('data-tab');
      
      navItems.forEach(n => n.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));
      
      item.classList.add('active');
      const targetContent = document.getElementById(`tab-${tabName}`);
      if (targetContent) {
        targetContent.classList.add('active');
      }
      
      activeTab = tabName;

      // Recargar datos frescos al cambiar a la pestaña
      if (tabName === 'dashboard') {
        fetchProducts();
      } else if (tabName === 'history') {
        fetchHistory();
      } else if (tabName === 'chat') {
        chatBadge.style.display = 'none';
        chatBadge.textContent = '0';
        scrollToBottom();
      }
    });
  });
}

// --- PRODUCTOS: CONTROLADOR DE API & RENDERING ---

async function fetchProducts() {
  try {
    const res = await fetch(`${API_URL}/api/products`);
    if (!res.ok) throw new Error('Error al obtener productos');
    products = await res.json();
    renderInventoryTable(products);
    updateStats(products);
    populateProviderFilter(products);
    populateStatsProductSelect(products);
  } catch (error) {
    console.error(error);
    showToast("Error de conexión con el servidor", 'danger');
    const tbody = document.getElementById('inventory-table-body');
    tbody.innerHTML = `<tr><td colspan="8" class="empty-state" style="color: var(--danger); font-weight: 500;">
      ❌ Error de Conexión: No se pudo obtener el inventario. Asegúrate de que el servidor esté corriendo (<code>node server.js</code>) y recarga la página.
    </td></tr>`;
  }
}

function renderInventoryTable(data) {
  const tbody = document.getElementById('inventory-table-body');
  tbody.innerHTML = '';

  if (data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty-state">No se encontraron productos en el inventario.</td></tr>`;
    return;
  }

  data.forEach(p => {
    // Calcular Estado
    let statusClass = 'in-stock';
    let statusText = 'En Stock';
    if (p.quantity === 0) {
      statusClass = 'out-of-stock';
      statusText = 'Agotado';
    } else if (p.quantity <= p.minQuantity) {
      statusClass = 'low-stock';
      statusText = 'Bajo Stock';
    }

    const tr = document.createElement('tr');
    const priceFormatted = (p.price || 0.0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
    const pendingRepVal = p.pendingReplenishment || 0;
    const pendingRepHTML = pendingRepVal > 0 
      ? `<span style="color: var(--amber); font-weight: 700;">⚠️ ${pendingRepVal}</span>` 
      : `<span style="color: var(--success); font-weight: 500;">✓ 0</span>`;

    tr.innerHTML = `
      <td><span class="product-code-badge">${escapeHTML(p.code)}</span></td>
      <td style="font-weight:600;">${escapeHTML(p.name)}</td>
      <td>${escapeHTML(p.proveedor || 'General')}</td>
      <td style="font-weight:600;">$${priceFormatted}</td>
      <td>${p.minQuantity}</td>
      <td style="font-weight:700; font-size:15px;">${p.quantity}</td>
      <td style="text-align: center; font-weight:700;">${pendingRepHTML}</td>
      <td><span class="status-badge ${statusClass}">${statusText}</span></td>
      <td>
        <div class="table-actions">
          <button class="btn-table-action" onclick="openProductDetailModal('${p.code}')" title="Ver Detalles" style="border-color: var(--info); color: #22d3ee;">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path></svg>
          </button>
          <button class="btn-table-action edit" onclick="openEditProductModal('${p.code}')" title="Editar Producto">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>
          </button>
          <button class="btn-table-action delete" onclick="deleteProduct('${p.code}')" title="Eliminar Producto">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg>
          </button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function updateStats(data) {
  const totalItems = data.length;
  const totalUnits = data.reduce((sum, p) => sum + p.quantity, 0);
  const lowStockItems = data.filter(p => p.quantity <= p.minQuantity).length;

  document.getElementById('stat-total-items').textContent = totalItems;
  document.getElementById('stat-total-units').textContent = totalUnits;
  
  const lowStockElement = document.getElementById('stat-low-stock');
  lowStockElement.textContent = lowStockItems;
  
  const statsCardLowStock = lowStockElement.closest('.stats-card');
  if (lowStockItems > 0) {
    statsCardLowStock.classList.add('warning');
  } else {
    statsCardLowStock.classList.remove('warning');
  }
}

function populateProviderFilter(data) {
  const filter = document.getElementById('provider-filter');
  if (!filter) return;
  const currentValue = filter.value;
  
  // Extraer proveedores únicos
  const providers = [...new Set(data.map(p => p.proveedor).filter(Boolean))];
  
  filter.innerHTML = '<option value="">Todos los Proveedores</option>';
  providers.forEach(p => {
    filter.innerHTML += `<option value="${escapeHTML(p)}">${escapeHTML(p)}</option>`;
  });
  
  // Mantener el valor previamente seleccionado si todavía existe
  if (providers.includes(currentValue)) {
    filter.value = currentValue;
  }
}

// --- MODAL Y FORMULARIO DE PRODUCTO ---

const modal = document.getElementById('product-modal');
const openAddModalBtn = document.getElementById('open-add-modal-btn');
const closeModalBtn = document.getElementById('close-modal-btn');
const cancelModalBtn = document.getElementById('cancel-modal-btn');
const productForm = document.getElementById('product-form');
const prodCodeInput = document.getElementById('prod-code');

openAddModalBtn.addEventListener('click', () => {
  isEditing = false;
  document.getElementById('modal-title').textContent = 'Agregar Nuevo Producto';
  prodCodeInput.removeAttribute('readonly');
  productForm.reset();
  
  // Resetear campos de ubicación
  document.querySelectorAll('input[name="prod-location"]').forEach(r => {
    if (r.value === 'Almacén') r.checked = true;
  });
  document.getElementById('location-detail-container').style.display = 'none';
  document.getElementById('prod-location-detail').removeAttribute('required');
  document.getElementById('prod-location-detail').value = '';

  modal.classList.add('active');
});

function closeModal() {
  modal.classList.remove('active');
  productForm.reset();
}

closeModalBtn.addEventListener('click', closeModal);
cancelModalBtn.addEventListener('click', closeModal);

function openEditProductModal(code) {
  const product = products.find(p => p.code.toUpperCase() === code.toUpperCase());
  if (!product) return;

  isEditing = true;
  document.getElementById('modal-title').textContent = `Editar Producto: ${product.code}`;
  
  // Rellenar campos
  prodCodeInput.value = product.code;
  prodCodeInput.setAttribute('readonly', true); // No cambiar código una vez creado
  document.getElementById('prod-name').value = product.name;
  document.getElementById('prod-provider').value = product.proveedor || '';
  document.getElementById('prod-min-quantity').value = product.minQuantity;
  document.getElementById('prod-quantity').value = product.quantity;
  document.getElementById('prod-price').value = (product.price || 0.0).toFixed(2);

  // Rellenar ubicación
  const locationVal = product.ubicacion || 'Almacén';
  document.querySelectorAll('input[name="prod-location"]').forEach(r => {
    if (r.value === locationVal) {
      r.checked = true;
    }
  });

  const detailContainer = document.getElementById('location-detail-container');
  const detailInput = document.getElementById('prod-location-detail');
  if (locationVal === 'Oficina') {
    detailContainer.style.display = 'block';
    detailInput.setAttribute('required', 'true');
    detailInput.value = product.ubicacionDetalle || '';
  } else {
    detailContainer.style.display = 'none';
    detailInput.removeAttribute('required');
    detailInput.value = '';
  }

  modal.classList.add('active');
}

function setupProductForm() {
  productForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const selectedLocationInput = document.querySelector('input[name="prod-location"]:checked');
    const ubicacion = selectedLocationInput ? selectedLocationInput.value : 'Almacén';
    const ubicacionDetalle = ubicacion === 'Oficina' ? document.getElementById('prod-location-detail').value.trim() : '';

    const payload = {
      code: prodCodeInput.value.trim().toUpperCase(),
      name: document.getElementById('prod-name').value.trim(),
      proveedor: document.getElementById('prod-provider').value.trim() || 'General',
      minQuantity: parseFloat(document.getElementById('prod-min-quantity').value) || 0,
      quantity: parseFloat(document.getElementById('prod-quantity').value) || 0,
      price: parseFloat(document.getElementById('prod-price').value) || 0.0,
      ubicacion,
      ubicacionDetalle
    };

    try {
      const res = await fetch(`${API_URL}/api/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const contentType = res.headers.get('content-type') || '';
      let body;
      if (contentType.includes('application/json')) {
        body = await res.json();
      } else {
        body = await res.text();
      }

      if (!res.ok) {
        throw new Error(body.error || body.message || 'Error al guardar el producto');
      }
      
      showToast(isEditing ? 'Producto actualizado' : 'Producto agregado con éxito', 'success');
      closeModal();
      await Promise.all([fetchProducts(), fetchHistory(), fetchOfficeLocations()]);
      setTimeout(() => {
        fetchProducts();
      }, 1000);
    } catch (error) {
      console.error(error);
      showToast(error.message, 'danger');
    }
  });
}

// --- MODAL DETALLE DE PRODUCTO ---
const detailModal = document.getElementById('product-detail-modal');
const closeDetailModalBtn = document.getElementById('close-detail-modal-btn');
const closeDetailModalBtn2 = document.getElementById('close-detail-modal-btn2');

function closeDetailModal() {
  detailModal.classList.remove('active');
}
if(closeDetailModalBtn) closeDetailModalBtn.addEventListener('click', closeDetailModal);
if(closeDetailModalBtn2) closeDetailModalBtn2.addEventListener('click', closeDetailModal);

function openProductDetailModal(code) {
  const product = products.find(p => p.code.toUpperCase() === code.toUpperCase());
  if (!product) return;

  // Rellenar Ficha Técnica
  document.getElementById('detail-code').textContent = product.code;
  document.getElementById('detail-name').textContent = product.name;
  document.getElementById('detail-provider-badge').textContent = product.proveedor || 'General';

  const locationBadge = document.getElementById('detail-location-badge');
  if (locationBadge) {
    if (product.ubicacion === 'Oficina') {
      locationBadge.textContent = `Oficina: ${product.ubicacionDetalle || 'No especificada'}`;
      locationBadge.style.color = '#06b6d4'; // Cyan
      locationBadge.style.backgroundColor = 'rgba(6, 182, 212, 0.1)';
      locationBadge.style.borderColor = 'rgba(6, 182, 212, 0.2)';
    } else {
      locationBadge.textContent = 'Ubicación: Almacén';
      locationBadge.style.color = '#a5b4fc'; // Purple
      locationBadge.style.backgroundColor = 'rgba(99, 102, 241, 0.1)';
      locationBadge.style.borderColor = 'rgba(99, 102, 241, 0.2)';
    }
  }

  // Rellenar Stock y Precio
  const stock = product.quantity;
  const price = product.price || 0.0;
  const stockValue = stock * price;

  document.getElementById('detail-stock').textContent = stock;
  document.getElementById('detail-stock-value').textContent = `Valor en Almacén: $${stockValue.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
  document.getElementById('detail-price').textContent = `$${price.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;

  const pendingReplenish = product.pendingReplenishment || 0;
  const pendingRepCost = pendingReplenish * price;

  document.getElementById('detail-pending-replenish').textContent = `${pendingReplenish} unidades`;
  document.getElementById('detail-pending-rep-cost').textContent = `$${pendingRepCost.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;

  // Calcular métricas desde el historial
  const productLogs = historyLogs.filter(log => log.productCode.toUpperCase() === code.toUpperCase());
  
  let totalConsumed = 0;
  let totalRepCost = 0.0;

  productLogs.forEach(log => {
    if (log.quantityChange < 0) {
      totalConsumed += Math.abs(log.quantityChange);
      if (log.replacementCost) {
        totalRepCost += parseFloat(log.replacementCost);
      }
    }
  });

  document.getElementById('detail-total-consumed').textContent = `${totalConsumed} unidades`;
  document.getElementById('detail-total-rep-cost').textContent = `$${totalRepCost.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;

  // Renderizar la mini-tabla del historial del producto
  const detailHistoryBody = document.getElementById('detail-history-body');
  detailHistoryBody.innerHTML = '';

  if (productLogs.length === 0) {
    detailHistoryBody.innerHTML = `<tr><td colspan="5" class="empty-state" style="padding: 20px; text-align:center;">No hay registros de este producto.</td></tr>`;
  } else {
    // Ordenar del más reciente al más antiguo
    const sortedLogs = [...productLogs].reverse();
    sortedLogs.forEach(log => {
      const dateStr = new Date(log.timestamp).toLocaleDateString() + ' ' + new Date(log.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
      
      let changeClass = 'neutral';
      let changePrefix = '';
      if (log.quantityChange > 0) {
        changeClass = 'positive';
        changePrefix = '+';
      } else if (log.quantityChange < 0) {
        changeClass = 'negative';
      }

      let actionText = log.action;
      switch (log.action) {
        case 'INICIALIZACION': actionText = 'Inicio'; break;
        case 'CREAR_PRODUCTO': actionText = 'Registro'; break;
        case 'ACTUALIZAR_PRODUCTO': actionText = 'Editar'; break;
        case 'CONSUMO_CHAT': actionText = 'Consumo'; break;
        case 'INGRESO_CHAT': actionText = 'Ingreso'; break;
        case 'REVERTIR_CONSUMO':
        case 'REVERTIR_CHAT': actionText = 'Undo'; break;
        case 'ELIMINAR_PRODUCTO': actionText = 'Eliminado'; break;
      }

      const repCostVal = log.replacementCost ? `$${parseFloat(log.replacementCost).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}` : '-';

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="padding: 8px 16px; font-size:12px; color:var(--text-muted);">${dateStr}</td>
        <td style="padding: 8px 16px;"><span class="action-badge ${actionText.toLowerCase() === 'consumo' ? 'consumo' : (actionText.toLowerCase() === 'ingreso' || actionText.toLowerCase() === 'registro' ? 'crear' : 'revertir')}" style="font-size:9px; padding:2px 4px;">${actionText}</span></td>
        <td style="padding: 8px 16px; text-align:center; font-weight:700;" class="quantity-change ${changeClass}">${changePrefix}${log.quantityChange}</td>
        <td style="padding: 8px 16px; text-align:right; font-weight:600; color:var(--danger);">${repCostVal}</td>
        <td style="padding: 8px 16px; font-size:12px;">${escapeHTML(log.person || 'Sistema')}</td>
      `;
      detailHistoryBody.appendChild(tr);
    });
  }

  // Abrir Modal
  detailModal.classList.add('active');
}

async function deleteProduct(code) {
  if (!confirm(`¿Estás seguro de que deseas eliminar el producto con código ${code}? Esta acción se registrará en el historial.`)) {
    return;
  }

  try {
    const res = await fetch(`${API_URL}/api/products/${code}`, {
      method: 'DELETE'
    });

    if (!res.ok) throw new Error('Error al eliminar producto');
    
    showToast(`Producto ${code} eliminado`, 'warning');
    fetchProducts();
    fetchHistory();
  } catch (error) {
    showToast(error.message, 'danger');
  }
}

// --- CHAT INTERACTIVO (NLP) ---

async function fetchChatMessages() {
  try {
    const res = await fetch(`${API_URL}/api/chat/messages`);
    if (!res.ok) throw new Error('Error al cargar historial de chat');
    chatMessages = await res.json();
    renderChatMessages();
  } catch (error) {
    console.error(error);
    chatMessagesContainer.innerHTML = `
      <div class="message-bubble bot error">
        <strong>❌ Error de Conexión</strong><br>
        No se pudo establecer comunicación con el chat del servidor.<br><br>
        • Asegúrate de ejecutar <code>node server.js</code> en la terminal.<br>
        • Confirma que estás accediendo a través de <a href="http://localhost:3001" style="color:#a5b4fc;text-decoration:underline;">http://localhost:3001</a> en lugar de abrir el archivo directamente.
      </div>
    `;
  }
}

function renderChatMessages() {
  chatMessagesContainer.innerHTML = '';
  chatMessages.forEach(msg => {
    appendMessageToDOM(msg, false);
  });
  scrollToBottom();
}

function appendMessageToDOM(msg, animate = true) {
  const isUser = msg.sender === 'user';
  const bubble = document.createElement('div');
  
  let statusClass = '';
  if (!isUser && msg.status) {
    statusClass = msg.status; // success, warning, error, info
  }
  
  bubble.className = `message-bubble ${isUser ? 'user' : 'bot'} ${statusClass}`;
  if (!animate) {
    bubble.style.animation = 'none';
  }

  // Renderizar cuerpo del mensaje con formato Markdown simple
  let formattedText = formatMarkdown(msg.text);
  
  // Agregar acciones de tarjeta si es del bot y tiene transactionId
  let actionsHTML = '';
  if (!isUser && msg.transactionId) {
    actionsHTML = `
      <div class="bot-card-actions">
        <button class="btn-undo" onclick="undoTransaction('${msg.transactionId}', this)">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"></path><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"></path></svg>
          Deshacer Consumo
        </button>
      </div>
    `;
  }

  const time = new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
  bubble.innerHTML = `
    <div>${formattedText}</div>
    ${actionsHTML}
    <span class="message-timestamp">${time}</span>
  `;

  chatMessagesContainer.appendChild(bubble);
}

function scrollToBottom() {
  chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
}

// Enviar Mensaje
async function sendChatMessage(text) {
  if (!text || text.trim() === '') return;
  
  // Limpiar input
  chatInput.value = '';
  
  // Agregar temporalmente mensaje del usuario localmente (para feedback instantáneo)
  const tempUserMsg = {
    sender: 'user',
    text: text,
    timestamp: new Date().toISOString()
  };
  appendMessageToDOM(tempUserMsg);
  scrollToBottom();

  // Crear indicador de escribiendo
  const typingIndicator = document.createElement('div');
  typingIndicator.className = 'message-bubble bot info';
  typingIndicator.id = 'typing-indicator';
  typingIndicator.innerHTML = '<span class="spinner" style="margin:0;"></span> <em>Procesando comando...</em>';
  chatMessagesContainer.appendChild(typingIndicator);
  scrollToBottom();

  try {
    const res = await fetch(`${API_URL}/api/chat/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });

    if (!res.ok) throw new Error('Error de servidor al procesar el mensaje.');
    const result = await res.json();
    
    // Eliminar indicador
    const indicator = document.getElementById('typing-indicator');
    if (indicator) indicator.remove();

    // Agregar respuesta real del bot
    appendMessageToDOM(result.botMessage);
    scrollToBottom();
    
    // Si la pestaña no es chat, alertar con badge
    if (activeTab !== 'chat') {
      const badgeVal = parseInt(chatBadge.textContent, 10) || 0;
      chatBadge.textContent = badgeVal + 1;
      chatBadge.style.display = 'block';
    }

    // Si tuvo éxito, actualizar stock en segundo plano
    if (result.botMessage.status === 'success' || result.botMessage.status === 'warning') {
      showToast('Inventario actualizado por chat', 'success');
      fetchProducts();
      fetchHistory();
    }
  } catch (error) {
    const indicator = document.getElementById('typing-indicator');
    if (indicator) indicator.remove();
    
    showToast(error.message, 'danger');
    
    appendMessageToDOM({
      sender: 'bot',
      text: `❌ **Error**: ${error.message}`,
      status: 'error',
      timestamp: new Date().toISOString()
    });
    scrollToBottom();
  }
}

// Event Listeners Chat
sendChatBtn.addEventListener('click', () => {
  sendChatMessage(chatInput.value);
});

chatInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    sendChatMessage(chatInput.value);
  }
});

// Sugerencias Rápidas
function setupChatSuggestions() {
  document.querySelectorAll('.chip-suggestion').forEach(chip => {
    chip.addEventListener('click', () => {
      sendChatMessage(chip.textContent);
    });
  });
}

// Deshacer Transacción
async function undoTransaction(transactionId, buttonElement) {
  buttonElement.disabled = true;
  buttonElement.innerHTML = '<span class="spinner" style="width:12px; height:12px; margin:0 4px 0 0;"></span> Deshaciendo...';

  try {
    const res = await fetch(`${API_URL}/api/chat/undo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transactionId })
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Error al deshacer.');
    }
    
    const result = await res.json();
    showToast('Consumo revertido', 'info');
    
    // Agregar confirmación al chat
    appendMessageToDOM(result.botMessage);
    scrollToBottom();

    // Actualizar datos
    fetchProducts();
    fetchHistory();
    
    // Ocultar el botón para que no se presione dos veces
    const parentActions = buttonElement.closest('.bot-card-actions');
    if (parentActions) {
      parentActions.innerHTML = '<em>✓ Transacción revertida con éxito</em>';
    }
  } catch (error) {
    showToast(error.message, 'danger');
    buttonElement.disabled = false;
    buttonElement.innerHTML = 'Deshacer Consumo';
  }
}

// --- HISTORIAL DE ACTIVIDADES ---

async function fetchHistory() {
  try {
    const res = await fetch(`${API_URL}/api/history`);
    if (!res.ok) throw new Error('Error al obtener el historial');
    historyLogs = await res.json();
    renderHistoryTable(historyLogs);
    populatePersonFilter(historyLogs);
    updateProductFinancialStats();
  } catch (error) {
    console.error(error);
    const tbody = document.getElementById('history-table-body');
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state" style="color: var(--danger); font-weight: 500;">
      ❌ Error de Conexión: No se pudo obtener el historial de transacciones.
    </td></tr>`;
  }
}

function renderHistoryTable(data) {
  const tbody = document.getElementById('history-table-body');
  tbody.innerHTML = '';

  if (data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state">No hay registros en el historial.</td></tr>`;
    return;
  }

  // Ordenar historial del más reciente al más antiguo
  const sorted = [...data].reverse();

  sorted.forEach(log => {
    // Formato de Cambio de Cantidad
    let changeClass = 'neutral';
    let changePrefix = '';
    
    if (log.quantityChange > 0) {
      changeClass = 'positive';
      changePrefix = '+';
    } else if (log.quantityChange < 0) {
      changeClass = 'negative';
    }

    // Badge de Acción
    let actionBadgeClass = '';
    let actionBadgeText = log.action;
    switch (log.action) {
      case 'INICIALIZACION':
        actionBadgeClass = 'revertir';
        actionBadgeText = 'Inicio';
        break;
      case 'CREAR_PRODUCTO':
        actionBadgeClass = 'crear';
        actionBadgeText = 'Registro';
        break;
      case 'ACTUALIZAR_PRODUCTO':
        actionBadgeClass = 'actualizar';
        actionBadgeText = 'Editar';
        break;
      case 'CONSUMO_CHAT':
        actionBadgeClass = 'consumo';
        actionBadgeText = 'Consumo';
        break;
      case 'INGRESO_CHAT':
        actionBadgeClass = 'crear';
        actionBadgeText = 'Ingreso Chat';
        break;
      case 'REVERTIR_CONSUMO':
      case 'REVERTIR_CHAT':
        actionBadgeClass = 'revertir';
        actionBadgeText = 'Undo Chat';
        break;
      case 'ELIMINAR_PRODUCTO':
        actionBadgeClass = 'eliminar';
        actionBadgeText = 'Eliminar';
        break;
    }

    const dateStr = new Date(log.timestamp).toLocaleString();

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="white-space:nowrap; font-size:12px; color:var(--text-muted);">${dateStr}</td>
      <td><span class="action-badge ${actionBadgeClass}">${actionBadgeText}</span></td>
      <td><span class="product-code-badge">${escapeHTML(log.productCode)}</span></td>
      <td style="font-weight:600;">${escapeHTML(log.productName)}</td>
      <td class="quantity-change ${changeClass}">${changePrefix}${log.quantityChange}</td>
      <td>${escapeHTML(log.person || 'Sistema')}${log.vehicle && log.vehicle !== 'No especificado' ? ` / <span style="font-size:12px; color:#a5b4fc; font-family:monospace; font-weight:600;">${escapeHTML(log.vehicle)}</span>` : ''}</td>
      <td style="font-size:13px; color:var(--text-muted); max-width: 250px;">${escapeHTML(log.details)}</td>
    `;
    tbody.appendChild(tr);
  });
}

// --- FILTROS Y BÚSQUEDAS EN TIEMPO REAL ---

function setupSearchAndFilters() {
  // Búsqueda Inventario
  const searchInput = document.getElementById('inventory-search');
  const providerFilter = document.getElementById('provider-filter');
  
  function filterInventory() {
    const searchVal = searchInput.value.toLowerCase();
    const providerVal = providerFilter ? providerFilter.value : '';

    const filtered = products.filter(p => {
      const matchSearch = p.code.toLowerCase().includes(searchVal) || 
                          p.name.toLowerCase().includes(searchVal) || 
                          (p.proveedor && p.proveedor.toLowerCase().includes(searchVal));
      
      const matchProvider = providerVal === '' || p.proveedor === providerVal;
      
      return matchSearch && matchProvider;
    });

    renderInventoryTable(filtered);
  }

  searchInput.addEventListener('input', filterInventory);
  if (providerFilter) providerFilter.addEventListener('change', filterInventory);

  // Búsqueda Historial
  const historySearch = document.getElementById('history-search');
  const historyActionFilter = document.getElementById('history-action-filter');
  const historyDateFilter = document.getElementById('history-date-filter');
  const historyPersonFilter = document.getElementById('history-person-filter');
  const clearHistoryFiltersBtn = document.getElementById('clear-history-filters-btn');

  function filterHistory() {
    const searchVal = historySearch ? historySearch.value.toLowerCase() : '';
    const actionVal = historyActionFilter ? historyActionFilter.value : '';
    const dateVal = historyDateFilter ? historyDateFilter.value : '';
    const personVal = historyPersonFilter ? historyPersonFilter.value : '';

    const filtered = historyLogs.filter(log => {
      const matchSearch = !searchVal || 
                          log.productCode.toLowerCase().includes(searchVal) ||
                          log.productName.toLowerCase().includes(searchVal) ||
                          (log.person && log.person.toLowerCase().includes(searchVal)) ||
                          (log.vehicle && log.vehicle.toLowerCase().includes(searchVal)) ||
                          (log.details && log.details.toLowerCase().includes(searchVal));
      
      const matchAction = actionVal === '' || log.action === actionVal;
      const matchPerson = personVal === '' || log.person === personVal;

      let matchDate = true;
      if (dateVal !== '') {
        const logDateStr = new Date(log.timestamp).toISOString().split('T')[0];
        const d = new Date(log.timestamp);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const localDateStr = `${year}-${month}-${day}`;

        matchDate = (logDateStr === dateVal || localDateStr === dateVal);
      }

      return matchSearch && matchAction && matchPerson && matchDate;
    });

    renderHistoryTable(filtered);
  }

  if (historySearch) historySearch.addEventListener('input', filterHistory);
  if (historyActionFilter) historyActionFilter.addEventListener('change', filterHistory);
  if (historyDateFilter) historyDateFilter.addEventListener('change', filterHistory);
  if (historyPersonFilter) historyPersonFilter.addEventListener('change', filterHistory);
  if (clearHistoryFiltersBtn) {
    clearHistoryFiltersBtn.addEventListener('click', () => {
      if (historySearch) historySearch.value = '';
      if (historyActionFilter) historyActionFilter.value = '';
      if (historyDateFilter) historyDateFilter.value = '';
      if (historyPersonFilter) historyPersonFilter.value = '';
      filterHistory();
    });
  }
}

function populatePersonFilter(logs) {
  const filter = document.getElementById('history-person-filter');
  if (!filter) return;
  const currentValue = filter.value;

  const people = [...new Set(logs.map(l => l.person).filter(p => p && p !== 'Sistema'))];
  filter.innerHTML = '<option value="">Todos los Responsables</option>';
  people.forEach(p => {
    filter.innerHTML += `<option value="${escapeHTML(p)}">${escapeHTML(p)}</option>`;
  });

  if (people.includes(currentValue)) {
    filter.value = currentValue;
  }
}

function populateStatsProductSelect(prods) {
  const select = document.getElementById('stats-product-code');
  if (!select) return;
  const currentValue = select.value;

  select.innerHTML = '<option value="">Selecciona un Producto</option>';
  prods.forEach(p => {
    select.innerHTML += `<option value="${escapeHTML(p.code)}">${escapeHTML(p.code)} — ${escapeHTML(p.name)}</option>`;
  });

  if (currentValue && prods.some(p => p.code.toUpperCase() === currentValue.toUpperCase())) {
    select.value = currentValue;
  }
}

function setupStatsControls() {
  const prodSelect = document.getElementById('stats-product-code');
  const yearSelect = document.getElementById('stats-year');
  const monthSelect = document.getElementById('stats-month');

  if (prodSelect) prodSelect.addEventListener('change', updateProductFinancialStats);
  if (yearSelect) yearSelect.addEventListener('change', updateProductFinancialStats);
  if (monthSelect) monthSelect.addEventListener('change', updateProductFinancialStats);
}

function updateProductFinancialStats() {
  const prodSelect = document.getElementById('stats-product-code');
  const yearSelect = document.getElementById('stats-year');
  const monthSelect = document.getElementById('stats-month');

  if (!prodSelect) return;

  const selectedCode = prodSelect.value;
  const selectedYear = parseInt(yearSelect ? yearSelect.value : new Date().getFullYear(), 10);
  const selectedMonthVal = monthSelect ? monthSelect.value : 'all';

  const monthCostElem = document.getElementById('stats-month-cost');
  const monthUnitsElem = document.getElementById('stats-month-units');
  const monthLabelElem = document.getElementById('stats-month-label');
  const yearCostElem = document.getElementById('stats-year-cost');

  if (!selectedCode) {
    if (monthCostElem) monthCostElem.textContent = '$0.00';
    if (monthUnitsElem) monthUnitsElem.textContent = '0 und';
    if (yearCostElem) yearCostElem.textContent = '$0.00';
    return;
  }

  const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const monthlyData = monthNames.map((name, idx) => ({ index: idx, name: name, units: 0, cost: 0.0 }));

  // Filtrar logs del producto seleccionado y año
  const filteredLogs = historyLogs.filter(log => {
    if (log.action !== 'CONSUMO_CHAT' && log.action !== 'ELIMINAR_PRODUCTO') return false;
    if (!log.productCode || log.productCode.toUpperCase() !== selectedCode.toUpperCase()) return false;
    
    const d = new Date(log.timestamp);
    return d.getFullYear() === selectedYear;
  });

  filteredLogs.forEach(log => {
    const d = new Date(log.timestamp);
    const mIdx = d.getMonth();
    const units = Math.abs(log.quantityChange || 0);
    const cost = parseFloat(log.replacementCost) || 0.0;

    monthlyData[mIdx].units += units;
    monthlyData[mIdx].cost += cost;
  });

  const totalYearCost = monthlyData.reduce((sum, m) => sum + m.cost, 0);
  const totalYearUnits = monthlyData.reduce((sum, m) => sum + m.units, 0);

  let displayMonthUnits = totalYearUnits;
  let displayMonthCost = totalYearCost;

  if (selectedMonthVal !== 'all') {
    const mIdx = parseInt(selectedMonthVal, 10);
    displayMonthCost = monthlyData[mIdx].cost;
    displayMonthUnits = monthlyData[mIdx].units;
    if (monthLabelElem) monthLabelElem.textContent = `${monthNames[mIdx]} ${selectedYear}`;
  } else {
    if (monthLabelElem) monthLabelElem.textContent = `Acumulado ${selectedYear}`;
  }

  if (monthCostElem) monthCostElem.textContent = `$${displayMonthCost.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}`;
  if (monthUnitsElem) monthUnitsElem.textContent = `${displayMonthUnits} und`;
  if (yearCostElem) yearCostElem.textContent = `$${totalYearCost.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}`;
}

async function fetchOfficeLocations() {
  try {
    const res = await fetch(`${API_URL}/api/office-locations`);
    if (!res.ok) throw new Error('Error al obtener ubicaciones');
    const locations = await res.json();
    const datalist = document.getElementById('office-locations-list');
    if (datalist) {
      datalist.innerHTML = '';
      locations.forEach(loc => {
        datalist.innerHTML += `<option value="${escapeHTML(loc)}">`;
      });
    }
  } catch (error) {
    console.error(error);
  }
}

function setupLocationSelector() {
  const locationRadios = document.querySelectorAll('input[name="prod-location"]');
  const detailContainer = document.getElementById('location-detail-container');
  const detailInput = document.getElementById('prod-location-detail');

  locationRadios.forEach(radio => {
    radio.addEventListener('change', () => {
      if (radio.value === 'Oficina') {
        detailContainer.style.display = 'block';
        detailInput.setAttribute('required', 'true');
      } else {
        detailContainer.style.display = 'none';
        detailInput.removeAttribute('required');
        detailInput.value = '';
      }
    });
  });
}

// --- EXPORTAR PDF (JSPDF + AUTOTABLE) ---

document.getElementById('export-pdf-btn').addEventListener('click', generatePDF);

function generatePDF() {
  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('p', 'mm', 'a4');
    
    showToast('Generando reporte PDF...', 'info');

    // Configuración estética
    const primaryColor = [99, 102, 241]; // Indigo [R, G, B]
    const darkColor = [9, 11, 17]; // Dark grey
    
    // --- PÁGINA 1: PORTADA & ESTADO DEL INVENTARIO ---
    
    // Header corporativo
    doc.setFillColor(9, 11, 17);
    doc.rect(0, 0, 210, 45, 'F');
    
    // Logo / Texto de cabecera
    doc.setTextColor(255, 255, 255);
    doc.setFont('Helvetica', 'bold');
    doc.setFontSize(22);
    doc.text('SERVIGRUAS CESAR', 15, 20);
    
    doc.setFont('Helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(156, 163, 175);
    doc.text('SISTEMA DE GESTIÓN DE INVENTARIO INTELIGENTE', 15, 26);
    
    // Fecha y hora del reporte
    const dateFormatted = new Date().toLocaleString();
    doc.setFontSize(9);
    doc.setTextColor(200, 200, 200);
    doc.text(`Generado el: ${dateFormatted}`, 130, 20);
    doc.text('Estado: Operativo (Servidor Local)', 130, 26);
    
    // Línea divisoria decorativa
    doc.setFillColor(99, 102, 241);
    doc.rect(0, 43, 210, 2, 'F');
    
    // Sección: Resumen Ejecutivo
    doc.setTextColor(9, 11, 17);
    doc.setFont('Helvetica', 'bold');
    doc.setFontSize(14);
    doc.text('RESUMEN EJECUTIVO DE STOCK', 15, 60);
    
    // Datos de resumen
    const totalItems = products.length;
    const totalUnits = products.reduce((sum, p) => sum + p.quantity, 0);
    const lowStockItems = products.filter(p => p.quantity <= p.minQuantity).length;
    const totalInventoryValue = products.reduce((sum, p) => sum + (p.quantity * (p.price || 0.0)), 0);
    
    doc.setFont('Helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(80, 80, 80);
    doc.text(`Total de Productos Registrados: ${totalItems}`, 15, 68);
    doc.text(`Unidades Totales en Almacén: ${totalUnits}`, 15, 74);
    doc.text(`Valor Consolidado del Almacén: $${totalInventoryValue.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})} USD`, 15, 80);
    doc.text(`Productos en Nivel de Alerta de Stock Bajo: ${lowStockItems}`, 15, 86);
    
    // Separador
    doc.setDrawColor(220, 220, 220);
    doc.line(15, 94, 195, 94);
    
    // Sección: Tabla de Inventario Actual
    doc.setTextColor(9, 11, 17);
    doc.setFont('Helvetica', 'bold');
    doc.setFontSize(14);
    doc.text('INVENTARIO EN TIEMPO REAL', 15, 104);
    
    // Preparar datos para la tabla de inventario
    const inventoryRows = products.map(p => {
      let statusText = 'En Stock';
      if (p.quantity === 0) statusText = 'Agotado';
      else if (p.quantity <= p.minQuantity) statusText = 'Bajo Stock';
      
      const price = p.price || 0.0;
      const stockValue = p.quantity * price;
      const pendingRepVal = p.pendingReplenishment || 0;
      
      return [
        p.code,
        p.name,
        p.proveedor || 'General',
        `$${price.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}`,
        p.minQuantity.toString(),
        p.quantity.toString(),
        pendingRepVal.toString(),
        `$${stockValue.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}`,
        statusText
      ];
    });
    
    // Generar tabla de inventario
    doc.autoTable({
      startY: 110,
      head: [['Código', 'Producto', 'Proveedor', 'Precio Unit.', 'Stock Mín.', 'Stock Act.', 'Por Reponer', 'Valor Stock', 'Estado']],
      body: inventoryRows,
      theme: 'grid',
      headStyles: {
        fillColor: primaryColor,
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 9
      },
      bodyStyles: {
        fontSize: 8.5,
        textColor: [50, 50, 50]
      },
      columnStyles: {
        0: { fontStyle: 'bold', cellWidth: 18 },
        1: { cellWidth: 38 },
        2: { cellWidth: 20 },
        3: { halign: 'right', cellWidth: 20 },
        4: { halign: 'center', cellWidth: 16 },
        5: { halign: 'center', fontStyle: 'bold', cellWidth: 16 },
        6: { halign: 'center', fontStyle: 'bold', cellWidth: 16 }, // Por Reponer
        7: { halign: 'right', fontStyle: 'bold', cellWidth: 20 },
        8: { halign: 'center', cellWidth: 18 }
      },
      didParseCell: function(data) {
        // Estilizar colores de por reponer
        if (data.column.index === 6 && data.cell.section === 'body') {
          const val = parseInt(data.cell.raw, 10);
          if (val > 0) {
            data.cell.styles.textColor = [217, 119, 6]; // Amber color
            data.cell.styles.fontStyle = 'bold';
          }
        }
        // Estilizar colores de estado
        if (data.column.index === 8 && data.cell.section === 'body') {
          if (data.cell.raw === 'Agotado') {
            data.cell.styles.textColor = [239, 68, 68];
            data.cell.styles.fontStyle = 'bold';
          } else if (data.cell.raw === 'Bajo Stock') {
            data.cell.styles.textColor = [245, 158, 11];
            data.cell.styles.fontStyle = 'bold';
          } else {
            data.cell.styles.textColor = [16, 185, 129];
          }
        }
      }
    });

    // --- PÁGINA 2: HISTORIAL DE TRANSACCIONES ---
    
    doc.addPage();
    
    // Header minimalista de página interna
    doc.setFillColor(9, 11, 17);
    doc.rect(0, 0, 210, 20, 'F');
    doc.setFillColor(99, 102, 241);
    doc.rect(0, 18, 210, 1, 'F');
    
    doc.setTextColor(255, 255, 255);
    doc.setFont('Helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('SERVIGRUAS CESAR — AUDITORÍA E HISTORIAL COMPLETO', 15, 12);
    
    // Sección: Tabla de Historial
    doc.setTextColor(9, 11, 17);
    doc.setFont('Helvetica', 'bold');
    doc.setFontSize(14);
    doc.text('HISTORIAL COMPLETO DE MOVIMIENTOS', 15, 32);
    
    // Preparar datos de historial
    const sortedHistory = [...historyLogs];
    const historyRows = sortedHistory.map(log => {
      const dateStr = new Date(log.timestamp).toLocaleString();
      let actionText = log.action;
      switch (log.action) {
        case 'INICIALIZACION': actionText = 'Inicio'; break;
        case 'CREAR_PRODUCTO': actionText = 'Registro'; break;
        case 'ACTUALIZAR_PRODUCTO': actionText = 'Modificado'; break;
        case 'CONSUMO_CHAT': actionText = 'Consumo'; break;
        case 'REVERTIR_CONSUMO': actionText = 'Undo'; break;
        case 'ELIMINAR_PRODUCTO': actionText = 'Eliminado'; break;
      }
      
      let changePrefix = log.quantityChange > 0 ? '+' : '';
      const repCostVal = log.replacementCost ? `$${parseFloat(log.replacementCost).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}` : '-';
      
      return [
        dateStr,
        actionText,
        log.productCode,
        log.productName,
        changePrefix + log.quantityChange.toString(),
        repCostVal,
        (log.person || 'Sistema') + (log.vehicle && log.vehicle !== 'No especificado' ? ` / ${log.vehicle}` : ''),
        log.details
      ];
    });

    doc.autoTable({
      startY: 38,
      head: [['Fecha/Hora', 'Acción', 'Código', 'Producto', 'Cambio', 'Costo Rep.', 'Persona / Placa', 'Detalles']],
      body: historyRows,
      theme: 'grid',
      headStyles: {
        fillColor: [100, 110, 130],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 9
      },
      bodyStyles: {
        fontSize: 8,
        textColor: [60, 60, 60]
      },
      columnStyles: {
        0: { cellWidth: 25 },
        1: { fontStyle: 'bold', cellWidth: 18 },
        2: { cellWidth: 18 },
        3: { cellWidth: 32 },
        4: { halign: 'center', fontStyle: 'bold', cellWidth: 12 },
        5: { halign: 'right', fontStyle: 'bold', cellWidth: 20 },
        6: { cellWidth: 18 },
        7: { cellWidth: 47 }
      },
      didParseCell: function(data) {
        // Colorear los cambios de cantidad
        if (data.column.index === 4 && data.cell.section === 'body') {
          if (data.cell.raw.startsWith('-')) {
            data.cell.styles.textColor = [239, 68, 68];
          } else if (data.cell.raw.startsWith('+')) {
            data.cell.styles.textColor = [16, 185, 129];
          }
        }
        // Colorear el badge de acción
        if (data.column.index === 1 && data.cell.section === 'body') {
          if (data.cell.raw === 'Consumo' || data.cell.raw === 'Eliminado') {
            data.cell.styles.textColor = [220, 50, 50];
          } else if (data.cell.raw === 'Registro' || data.cell.raw === 'Undo') {
            data.cell.styles.textColor = [16, 160, 120];
          }
        }
      }
    });

    // Pie de página de número de páginas
    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(150, 150, 150);
      doc.text(`Página ${i} de ${pageCount}`, 180, 287);
      doc.text('Confidencial — Reporte Interno Automático', 15, 287);
    }
    
    // Descargar el PDF
    doc.save(`Reporte_Servigruas_Cesar_${Date.now()}.pdf`);
    showToast('PDF descargado con éxito.', 'success');

  } catch (error) {
    console.error(error);
    showToast(`Error al exportar PDF: ${error.message}`, 'danger');
  }
}

// --- UTILERÍAS ---

// Formatear markdown en chat de forma básica
function formatMarkdown(text) {
  if (!text) return '';
  // Escapar HTML básico primero
  let html = escapeHTML(text);
  // Reemplazar saltos de línea con br
  html = html.replace(/\n/g, '<br>');
  // Reemplazar **negrita**
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  // Reemplazar `código`
  html = html.replace(/`(.*?)`/g, '<code>$1</code>');
  // Reemplazar viñetas
  html = html.replace(/•\s+(.*?)(?:<br>|$)/g, '<li>$1</li>');
  
  return html;
}

// Escapar HTML para evitar XSS
function escapeHTML(str) {
  if (!str) return '';
  return str.replace(/[&<>'"]/g, 
    tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag)
  );
}
