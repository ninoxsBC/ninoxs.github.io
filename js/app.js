"use strict";

// Adaptador previsto para la futura API REST. La maqueta no realiza peticiones.
const API_CONFIG = Object.freeze({ baseUrl: "", enabled: false });

const TEST_USERS = Object.freeze({
  admin: { password: "1234", role: "Administrador", destination: "admin.html" },
  secretario: { password: "1234", role: "Secretario", destination: "comite.html" },
  presidenta: { password: "1234", role: "Presidenta", destination: "comite.html" },
  tesorero: { password: "1234", role: "Tesorero", destination: "comite.html" }
});

const SIGNERS = ["Secretario", "Presidenta", "Tesorero"];

// Datos efímeros: se reinician cada vez que se recarga la página.
let expenses = [
  { id: "2026-0001", provider: "Servicios El Arrayán", amount: 50000, category: "Mantención", description: "Reparación de luminarias en acceso principal.", deadline: "2026-06-25", status: "Pendiente", signatures: { Secretario: true, Presidenta: true, Tesorero: false } },
  { id: "2026-0002", provider: "Aguas Patagonia SpA", amount: 128400, category: "Servicios básicos", description: "Pago mensual por suministro de agua comunitaria.", deadline: "2026-06-28", status: "Pendiente", signatures: { Secretario: true, Presidenta: false, Tesorero: false } },
  { id: "2026-0003", provider: "Ferretería del Lago", amount: 86390, category: "Mejoras", description: "Materiales para reparación de cerco perimetral.", deadline: "2026-06-20", status: "Aprobado", signatures: { Secretario: true, Presidenta: true, Tesorero: true } },
  { id: "2026-0000", provider: "Transportes Ralún", amount: 45000, category: "Administración", description: "Traslado de materiales comunitarios.", deadline: "2026-05-30", status: "Pagado", signatures: { Secretario: true, Presidenta: true, Tesorero: true } }
];

function generarTokenSesion() {
  const randomPart = (globalThis.crypto?.getRandomValues)
    ? Array.from(crypto.getRandomValues(new Uint32Array(2)), value => value.toString(36)).join("")
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `token_${randomPart}`;
}

function login(event) {
  event?.preventDefault();
  const userInput = document.querySelector("#usuario");
  const passwordInput = document.querySelector("#contrasena");
  const message = document.querySelector("#loginMessage");
  const username = userInput.value.trim().toLowerCase();
  const account = TEST_USERS[username];

  message.className = "form-message";
  message.textContent = "";
  if (!username || !passwordInput.value) {
    showFormMessage(message, "Completa el usuario y la contraseña.", "error");
    (!username ? userInput : passwordInput).focus();
    return;
  }
  if (!account || account.password !== passwordInput.value) {
    showFormMessage(message, "Usuario o contraseña incorrectos.", "error");
    passwordInput.value = "";
    passwordInput.focus();
    return;
  }

  localStorage.setItem("usuario", username);
  localStorage.setItem("rol", account.role);
  localStorage.setItem("tokenSesion", generarTokenSesion());
  showFormMessage(message, "Acceso correcto. Redirigiendo…", "success");
  window.setTimeout(() => window.location.assign(account.destination), 350);
}

function logout() {
  ["usuario", "rol", "tokenSesion"].forEach(key => localStorage.removeItem(key));
  window.location.replace("index.html");
}

function verificarSesion() {
  const token = localStorage.getItem("tokenSesion");
  const user = localStorage.getItem("usuario");
  const role = localStorage.getItem("rol");
  if (!token || !user || !role) {
    logout();
    return false;
  }
  return true;
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

function initializePage() {
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
  if (!verificarSesion()) return;
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
Object.assign(window, { login, logout, generarTokenSesion, verificarSesion, mostrarPendientes, mostrarAprobados, mostrarHistorico, crearEgreso, API_CONFIG });
