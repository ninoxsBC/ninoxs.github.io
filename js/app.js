"use strict";

// Punto único de configuración para la API de Google Apps Script.
const API_CONFIG = Object.freeze({
  baseUrl: "https://script.google.com/macros/s/AKfycbwIK_AT69ramxxdG_ho4psUdSFd1-W1KSpOcnydrGDLG3zD5bmeIrmcF-ZHSpfOt1_-/exec",
  timeoutMs: 15000
});

const SIGNERS = ["Secretario", "Presidenta", "Tesorero"];

// Datos efímeros: se reinician cada vez que se recarga la página.
let expenses = [
  { id: "2026-0001", provider: "Servicios El Arrayán", amount: 50000, category: "Mantención", description: "Reparación de luminarias en acceso principal.", deadline: "2026-06-25", status: "Pendiente", signatures: { Secretario: true, Presidenta: true, Tesorero: false } },
  { id: "2026-0002", provider: "Aguas Patagonia SpA", amount: 128400, category: "Servicios básicos", description: "Pago mensual por suministro de agua comunitaria.", deadline: "2026-06-28", status: "Pendiente", signatures: { Secretario: true, Presidenta: false, Tesorero: false } },
  { id: "2026-0003", provider: "Ferretería del Lago", amount: 86390, category: "Mejoras", description: "Materiales para reparación de cerco perimetral.", deadline: "2026-06-20", status: "Aprobado", signatures: { Secretario: true, Presidenta: true, Tesorero: true } },
  { id: "2026-0000", provider: "Transportes Ralún", amount: 45000, category: "Administración", description: "Traslado de materiales comunitarios.", deadline: "2026-05-30", status: "Pagado", signatures: { Secretario: true, Presidenta: true, Tesorero: true } }
];

async function requestApi(params, signal) {
  const body = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => body.set(key, value));

  const response = await fetch(API_CONFIG.baseUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
    },
    body,
    cache: "no-store",
    redirect: "follow",
    signal
  });

  if (!response.ok) {
    throw new Error(`La API respondió con HTTP ${response.status}.`);
  }

  const responseText = await response.text();
  try {
    return JSON.parse(responseText);
  } catch {
    throw new Error("La API no devolvió una respuesta JSON válida.");
  }
}

async function login(event) {
  event?.preventDefault();
  const userInput = document.querySelector("#usuario");
  const passwordInput = document.querySelector("#contrasena");
  const message = document.querySelector("#loginMessage");
  const submitButton = event?.currentTarget?.querySelector('[type="submit"]');
  const username = userInput.value.trim();
  const password = passwordInput.value;

  message.className = "form-message";
  message.textContent = "";
  if (!username || !password) {
    showFormMessage(message, "Completa el usuario y la contraseña.", "error");
    (!username ? userInput : passwordInput).focus();
    return;
  }

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), API_CONFIG.timeoutMs);
  setLoginLoading(submitButton, true);

  try {
    const data = await requestApi({ accion: "login", usuario: username, clave: password }, controller.signal);

    if (data?.estado !== "OK") {
      clearSession();
      passwordInput.value = "";
      passwordInput.focus();
      showFormMessage(message, "Usuario o contraseña incorrectos.", "error");
      return;
    }

    const allowedRoles = ["Administrador", "Secretario", "Presidenta", "Tesorero"];
    if (!data.usuario || !data.token || !allowedRoles.includes(data.rol)) {
      throw new Error("La respuesta de inicio de sesión está incompleta.");
    }

    localStorage.setItem("usuario", String(data.usuario));
    localStorage.setItem("rol", data.rol);
    localStorage.setItem("tokenSesion", String(data.token));
    showFormMessage(message, "Acceso correcto. Redirigiendo…", "success");

    const destination = data.rol === "Administrador" ? "admin.html" : "comite.html";
    window.setTimeout(() => window.location.assign(destination), 350);
  } catch (error) {
    clearSession();
    const errorMessage = error.name === "AbortError"
      ? "El servidor tardó demasiado en responder. Intenta nuevamente."
      : "No fue posible conectar con el servidor. Intenta nuevamente.";
    showFormMessage(message, errorMessage, "error");
    console.error("Error de inicio de sesión:", error);
  } finally {
    window.clearTimeout(timeoutId);
    setLoginLoading(submitButton, false);
  }
}

function clearSession() {
  ["usuario", "rol", "tokenSesion"].forEach(key => localStorage.removeItem(key));
}

function setLoginLoading(button, isLoading) {
  if (!button) return;
  button.disabled = isLoading;
  button.setAttribute("aria-busy", String(isLoading));
  button.innerHTML = isLoading
    ? "Ingresando…"
    : 'Ingresar <span aria-hidden="true">→</span>';
}

async function logout() {
  const token = localStorage.getItem("tokenSesion");
  clearSession();

  if (token) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), API_CONFIG.timeoutMs);
    try {
      await requestApi({ accion: "logout", token }, controller.signal);
    } catch (error) {
      console.warn("No fue posible cerrar la sesión en el servidor:", error);
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  window.location.replace("index.html");
}

async function verificarSesion() {
  const token = localStorage.getItem("tokenSesion");
  const user = localStorage.getItem("usuario");
  const role = localStorage.getItem("rol");
  if (!token || !user || !role) {
    clearSession();
    window.location.replace("index.html");
    return false;
  }

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), API_CONFIG.timeoutMs);
  try {
    const data = await requestApi({ accion: "validarSesion", token }, controller.signal);
    if (data?.estado !== "OK" || !data.usuario || !data.rol) {
      clearSession();
      window.location.replace("index.html");
      return false;
    }

    localStorage.setItem("usuario", String(data.usuario));
    localStorage.setItem("rol", String(data.rol));

    const currentPage = document.body.dataset.page;
    if (currentPage === "admin" && data.rol !== "Administrador") {
      window.location.replace("comite.html");
      return false;
    }
    if (currentPage === "comite" && data.rol === "Administrador") {
      window.location.replace("admin.html");
      return false;
    }

    return true;
  } catch (error) {
    console.error("No fue posible validar la sesión:", error);
    clearSession();
    window.location.replace("index.html");
    return false;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function getExpensesByStatus(status) {
  return expenses.filter(expense => status.includes(expense.status));
}

function mostrarPendientes() {
  renderCardList("pendingList", getExpensesByStatus(["Pendiente"]), "pendingCount");
}

function mostrarAprobados() {
  renderCardList("approvedList", getExpensesByStatus(["Aprobado"]), "approvedCount");
}

function mostrarHistorico() {
  renderCardList("historyList", getExpensesByStatus(["Pagado", "Rechazado"]), "historyCount");
}

function renderCardList(containerId, list, countId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  document.getElementById(countId).textContent = list.length;
  container.replaceChildren();
  if (!list.length) {
    const empty = document.createElement("div");
    empty.className = "empty-column";
    empty.textContent = "No hay egresos en esta etapa.";
    container.append(empty);
    return;
  }
  list.forEach(expense => container.append(createExpenseCard(expense)));
}

function createExpenseCard(expense) {
  const card = document.createElement("article");
  card.className = "expense-card";
  const canDecide = expense.status === "Pendiente";
  const signatures = SIGNERS.map(signer =>
    `<span class="signature ${expense.signatures[signer] ? "signature--done" : ""}">${expense.signatures[signer] ? "✓" : "□"} ${escapeHtml(signer)}</span>`
  ).join("");
  card.innerHTML = `
    <div class="expense-card__top">
      <div><span class="expense-id">EGRESO #${escapeHtml(expense.id)}</span><h3 title="${escapeHtml(expense.provider)}">${escapeHtml(expense.provider)}</h3></div>
      <strong class="expense-amount">${formatCurrency(expense.amount)}</strong>
    </div>
    <div class="expense-meta"><span>${escapeHtml(expense.category)}</span><span>Vence ${formatDate(expense.deadline)}</span></div>
    <div class="signatures-label">Firmas</div><div class="signature-list">${signatures}</div>
    <div class="card-actions">
      ${canDecide ? `<button class="button button--success" type="button" data-action="approve" data-id="${escapeHtml(expense.id)}">Aprobar</button><button class="button button--danger" type="button" data-action="reject" data-id="${escapeHtml(expense.id)}">Rechazar</button>` : ""}
      <button class="button button--detail" type="button" data-action="detail" data-id="${escapeHtml(expense.id)}">Ver detalle</button>
    </div>`;
  return card;
}

function crearEgreso(event) {
  event?.preventDefault();
  const form = document.getElementById("expenseForm");
  const message = document.getElementById("expenseMessage");
  const data = new FormData(form);
  const id = String(data.get("numeroEgreso") || "").trim().replace(/^#/, "");
  const amount = Number(data.get("monto"));
  message.className = "form-message field--full";
  message.textContent = "";

  if (!form.checkValidity()) {
    form.reportValidity();
    showFormMessage(message, "Completa todos los campos obligatorios.", "error");
    return;
  }
  if (expenses.some(expense => expense.id.toLowerCase() === id.toLowerCase())) {
    showFormMessage(message, "Ya existe un egreso con ese número.", "error");
    document.getElementById("numeroEgreso").focus();
    return;
  }
  expenses.unshift({
    id,
    provider: String(data.get("proveedor")).trim(),
    amount,
    category: String(data.get("categoria")),
    description: String(data.get("descripcion")).trim(),
    deadline: String(data.get("fechaLimite")),
    status: "Pendiente",
    signatures: { Secretario: false, Presidenta: false, Tesorero: false }
  });
  form.reset();
  showFormMessage(message, `Egreso #${id} creado. Se conservará hasta recargar la página.`, "success");
  renderAdminTable();
}

function renderAdminTable() {
  const tbody = document.getElementById("adminExpenseRows");
  if (!tbody) return;
  tbody.replaceChildren();
  expenses.forEach(expense => {
    const missing = SIGNERS.filter(signer => !expense.signatures[signer]);
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>#${escapeHtml(expense.id)}</td><td>${escapeHtml(expense.provider)}</td><td>${formatCurrency(expense.amount)}</td><td>${statusBadge(expense.status)}</td><td>${missing.length ? escapeHtml(missing.join(", ")) : "—"}</td>`;
    tbody.append(tr);
  });
  document.getElementById("recordCount").textContent = `${expenses.length} ${expenses.length === 1 ? "registro" : "registros"}`;
  document.getElementById("adminEmpty").hidden = expenses.length > 0;
  document.getElementById("metricTotal").textContent = expenses.length;
  document.getElementById("metricPending").textContent = getExpensesByStatus(["Pendiente"]).length;
  document.getElementById("metricApproved").textContent = getExpensesByStatus(["Aprobado", "Pagado"]).length;
}

function handleCommitteeAction(action, id) {
  const expense = expenses.find(item => item.id === id);
  if (!expense) return;
  if (action === "detail") {
    openExpenseDialog(expense);
    return;
  }
  if (expense.status !== "Pendiente") return;
  if (action === "reject") {
    expense.status = "Rechazado";
    renderCommittee();
    showToast(`Egreso #${id} rechazado.`, true);
    return;
  }
  if (action === "approve") {
    const role = localStorage.getItem("rol");
    if (SIGNERS.includes(role)) expense.signatures[role] = true;
    const allSigned = SIGNERS.every(signer => expense.signatures[signer]);
    if (allSigned) expense.status = "Aprobado";
    renderCommittee();
    showToast(allSigned ? `Egreso #${id} aprobado por el comité.` : `Firma de ${role} registrada para el egreso #${id}.`);
  }
}

function renderCommittee() {
  mostrarPendientes();
  mostrarAprobados();
  mostrarHistorico();
}

function openExpenseDialog(expense) {
  const dialog = document.getElementById("expenseDialog");
  document.getElementById("dialogTitle").textContent = `Egreso #${expense.id}`;
  document.getElementById("dialogContent").innerHTML = `<div class="detail-grid">
    <div class="detail-item"><span>Proveedor</span><strong>${escapeHtml(expense.provider)}</strong></div>
    <div class="detail-item"><span>Monto</span><strong>${formatCurrency(expense.amount)}</strong></div>
    <div class="detail-item"><span>Categoría</span><strong>${escapeHtml(expense.category)}</strong></div>
    <div class="detail-item"><span>Fecha límite</span><strong>${formatDate(expense.deadline)}</strong></div>
    <div class="detail-item"><span>Estado</span>${statusBadge(expense.status)}</div>
    <div class="detail-item detail-item--full"><span>Descripción</span><strong>${escapeHtml(expense.description)}</strong></div>
    <div class="detail-item detail-item--full"><span>Firmas</span><div class="signature-list">${SIGNERS.map(signer => `<span class="signature ${expense.signatures[signer] ? "signature--done" : ""}">${expense.signatures[signer] ? "✓" : "□"} ${signer}</span>`).join("")}</div></div>
  </div>`;
  dialog.showModal();
}

function fillSessionHeader() {
  const user = localStorage.getItem("usuario") || "Usuario";
  const role = localStorage.getItem("rol") || "";
  document.getElementById("sessionUser").textContent = user;
  document.getElementById("sessionRole").textContent = role;
  document.getElementById("sessionAvatar").textContent = user.charAt(0).toUpperCase();
}

function statusBadge(status) {
  const modifier = status === "Pendiente" ? "pending" : status === "Rechazado" ? "rejected" : "approved";
  return `<span class="badge badge--${modifier}">${escapeHtml(status)}</span>`;
}

function formatCurrency(value) {
  return new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(value);
}

function formatDate(date) {
  if (!date) return "Sin fecha";
  return new Intl.DateTimeFormat("es-CL", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
}

function escapeHtml(value) {
  const node = document.createElement("div");
  node.textContent = String(value);
  return node.innerHTML;
}

function showFormMessage(element, text, type) {
  element.textContent = text;
  element.classList.add(type);
}

function showToast(text, isError = false) {
  const region = document.getElementById("toastRegion");
  if (!region) return;
  const toast = document.createElement("div");
  toast.className = `toast${isError ? " toast--error" : ""}`;
  toast.textContent = text;
  region.append(toast);
  window.setTimeout(() => toast.remove(), 3200);
}

async function initializePage() {
  const page = document.body.dataset.page;
  if (page === "login") {
    document.getElementById("loginForm").addEventListener("submit", login);
    document.getElementById("togglePassword").addEventListener("click", event => {
      const input = document.getElementById("contrasena");
      const visible = input.type === "text";
      input.type = visible ? "password" : "text";
      event.currentTarget.textContent = visible ? "Ver" : "Ocultar";
      event.currentTarget.setAttribute("aria-label", visible ? "Mostrar contraseña" : "Ocultar contraseña");
    });
    return;
  }
  if (!await verificarSesion()) return;
  fillSessionHeader();
  document.querySelectorAll('[data-action="logout"]').forEach(button => button.addEventListener("click", logout));

  if (page === "admin") {
    renderAdminTable();
    document.getElementById("expenseForm").addEventListener("submit", crearEgreso);
  }
  if (page === "comite") {
    renderCommittee();
    document.querySelector(".kanban").addEventListener("click", event => {
      const button = event.target.closest("button[data-action]");
      if (button) handleCommitteeAction(button.dataset.action, button.dataset.id);
    });
    const dialog = document.getElementById("expenseDialog");
    dialog.addEventListener("click", event => {
      if (event.target.dataset.action === "close-dialog" || event.target === dialog) dialog.close();
    });
  }
}

document.addEventListener("DOMContentLoaded", initializePage);

// Funciones expuestas para facilitar la sustitución por llamadas fetch() en la integración futura.
Object.assign(window, { login, logout, verificarSesion, mostrarPendientes, mostrarAprobados, mostrarHistorico, crearEgreso, API_CONFIG });
