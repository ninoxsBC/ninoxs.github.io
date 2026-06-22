"use strict";

// Punto único de configuración para la API de Google Apps Script.
const API_CONFIG = Object.freeze({
  baseUrl: "https://script.google.com/macros/s/AKfycbxkC9ZLneuPn_zQyomW1RzZZQwaEjXy5ZjGXdlWVOZVhwD-JCWm9Wb70QdoVwVS13Qm/exec",
  timeoutMs: 90000
});

const SIGNERS = ["Secretario", "Presidenta", "Tesorero"];
const USER_ROLES = ["Administrador", "Secretario", "Presidenta", "Tesorero", "GestorUsuarios"];
const ROLE_LABELS = Object.freeze({
  Administrador: "Administrador de egresos",
  Secretario: "Secretario",
  Presidenta: "Presidenta",
  Tesorero: "Tesorero",
  GestorUsuarios: "Gestor de usuarios"
});

let expenses = [];
let managedUsers = [];

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

async function authenticatedRequest(action, params = {}) {
  const token = localStorage.getItem("tokenSesion");
  if (!token) throw new Error("No existe una sesión activa.");
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), API_CONFIG.timeoutMs);
  try {
    const data = await requestApi({ accion: action, token, ...params }, controller.signal);
    if (data?.codigo === "SESION_INVALIDA") {
      clearSession();
      window.location.replace("index.html");
      throw new Error("La sesión expiró.");
    }
    return data;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function destinationForRole(role) {
  if (role === "Administrador") return "admin.html";
  if (role === "GestorUsuarios") return "usuarios.html";
  return "comite.html";
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
      const serverMessage = data?.codigo === "CREDENCIALES_INVALIDAS" || !data?.codigo
        ? "Usuario o contraseña incorrectos."
        : data.mensaje || "El servidor no pudo procesar el inicio de sesión.";
      showFormMessage(message, serverMessage, "error");
      return;
    }

    if (!data.usuario || !data.token || !USER_ROLES.includes(data.rol)) {
      throw new Error("La respuesta de inicio de sesión está incompleta.");
    }

    localStorage.setItem("usuario", String(data.usuario));
    localStorage.setItem("nombre", String(data.nombre || data.usuario));
    localStorage.setItem("rol", data.rol);
    localStorage.setItem("tokenSesion", String(data.token));
    localStorage.setItem("requiereCambioClave", data.requiereCambioClave ? "SI" : "NO");
    showFormMessage(message, "Acceso correcto. Redirigiendo…", "success");

    const destination = data.requiereCambioClave ? "perfil.html?cambio=obligatorio" : destinationForRole(data.rol);
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
  ["usuario", "nombre", "rol", "tokenSesion", "requiereCambioClave"].forEach(key => localStorage.removeItem(key));
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
    localStorage.setItem("nombre", String(data.nombre || data.usuario));
    localStorage.setItem("rol", String(data.rol));
    localStorage.setItem("requiereCambioClave", data.requiereCambioClave ? "SI" : "NO");

    const currentPage = document.body.dataset.page;
    if (data.requiereCambioClave && currentPage !== "perfil") {
      window.location.replace("perfil.html?cambio=obligatorio");
      return false;
    }
    const expectedPage = data.rol === "Administrador" ? "admin" : data.rol === "GestorUsuarios" ? "usuarios" : "comite";
    if (currentPage !== "perfil" && currentPage !== expectedPage) {
      window.location.replace(destinationForRole(data.rol));
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
  return expenses.filter(expense => status.includes(expense.estado));
}

function mostrarPendientes() {
  renderCardList("pendingList", getExpensesByStatus(["PENDIENTE"]), "pendingCount");
}

function mostrarAprobados() {
  renderCardList("approvedList", getExpensesByStatus(["APROBADO"]), "approvedCount");
}

function mostrarHistorico() {
  renderCardList("historyList", getExpensesByStatus(["RECHAZADO"]), "historyCount");
}

async function loadExpenses() {
  const data = await authenticatedRequest("listarEgresos");
  if (data.estado !== "OK") throw new Error(data.mensaje || "No fue posible cargar los egresos.");
  expenses = data.egresos || [];
  if (document.body.dataset.page === "admin") renderAdminTable();
  if (document.body.dataset.page === "comite") renderCommittee();
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
  const signatures = SIGNERS.map(signer => {
    const decision = expense.decisiones.find(item => item.rol === signer);
    const modifier = decision?.decision === "APROBADO" ? "signature--done" : decision?.decision === "RECHAZADO" ? "signature--rejected" : "";
    const symbol = decision?.decision === "APROBADO" ? "✓" : decision?.decision === "RECHAZADO" ? "×" : "□";
    return `<span class="signature ${modifier}" title="${decision?.motivo ? escapeHtml(decision.motivo) : ""}">${symbol} ${escapeHtml(signer)}</span>`;
  }).join("");
  card.innerHTML = `
    <div class="expense-card__top">
      <div><span class="expense-id">EGRESO #${escapeHtml(expense.numero)} · V${expense.version}</span><h3 title="${escapeHtml(expense.proveedor)}">${escapeHtml(expense.proveedor)}</h3></div>
      <strong class="expense-amount">${formatCurrency(expense.monto)}</strong>
    </div>
    <div class="expense-meta"><span>${escapeHtml(expense.categoria)}</span><span>Vence ${formatDate(expense.fechaLimite)}</span></div>
    <div class="signatures-label">Firmas</div><div class="signature-list">${signatures}</div>
    <div class="card-actions">
      ${expense.puedeFirmar ? `<button class="button button--success" type="button" data-action="approve" data-id="${escapeHtml(expense.numero)}">Aprobar</button><button class="button button--danger" type="button" data-action="reject" data-id="${escapeHtml(expense.numero)}">Rechazar</button>` : ""}
      <button class="button button--detail" type="button" data-action="detail" data-id="${escapeHtml(expense.numero)}">Ver detalle</button>
    </div>`;
  return card;
}

async function crearEgreso(event) {
  event?.preventDefault();
  const form = document.getElementById("expenseForm");
  const message = document.getElementById("expenseMessage");
  const button = form.querySelector('[type="submit"]');
  message.className = "form-message field--full";
  message.textContent = "";
  if (!form.checkValidity()) {
    form.reportValidity();
    showFormMessage(message, "Completa todos los campos obligatorios.", "error");
    return;
  }
  setButtonLoading(button, true, "Creando…");
  try {
    const data = await authenticatedRequest("crearEgreso", Object.fromEntries(new FormData(form)));
    if (data.estado !== "OK") return showFormMessage(message, data.mensaje || "No fue posible crear el egreso.", "error");
    form.reset();
    setDefaultDeadline();
    showFormMessage(message, data.mensaje, "success");
    await loadExpenses();
  } catch (error) {
    showFormMessage(message, "No fue posible conectar con el servidor.", "error");
  } finally {
    setButtonLoading(button, false);
  }
}

function renderAdminTable() {
  const tbody = document.getElementById("adminExpenseRows");
  if (!tbody) return;
  tbody.replaceChildren();
  expenses.forEach(expense => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>#${escapeHtml(expense.numero)} <span class="muted">V${expense.version}</span></td><td>${escapeHtml(expense.proveedor)}</td><td>${formatCurrency(expense.monto)}</td><td>${statusBadge(expense.estado)}</td><td>${expense.firmasFaltantes.length ? escapeHtml(expense.firmasFaltantes.join(", ")) : "—"}</td><td>${expense.puedeEditar ? `<button class="button button--ghost table-edit-expense" type="button" data-edit-expense="${escapeHtml(expense.numero)}">Editar</button>` : "—"}</td>`;
    tbody.append(tr);
  });
  document.getElementById("recordCount").textContent = `${expenses.length} ${expenses.length === 1 ? "registro" : "registros"}`;
  document.getElementById("adminEmpty").hidden = expenses.length > 0;
  document.getElementById("metricTotal").textContent = expenses.length;
  document.getElementById("metricPending").textContent = getExpensesByStatus(["PENDIENTE"]).length;
  document.getElementById("metricApproved").textContent = getExpensesByStatus(["APROBADO"]).length;
}

async function handleCommitteeAction(action, id, button) {
  const expense = expenses.find(item => item.numero === id);
  if (!expense) return;
  if (action === "detail") {
    openExpenseDialog(expense);
    return;
  }
  if (action === "reject") {
    document.getElementById("rejectExpenseNumber").value = expense.numero;
    document.getElementById("rejectExpenseVersion").value = expense.version;
    document.getElementById("rejectExpenseLabel").textContent = `Egreso #${expense.numero} · Versión ${expense.version}`;
    document.getElementById("rejectReason").value = "";
    resetMessage(document.getElementById("rejectMessage"));
    document.getElementById("rejectDialog").showModal();
    return;
  }
  if (action === "approve") {
    setButtonLoading(button, true, "Firmando…");
    try {
      const data = await authenticatedRequest("registrarDecision", {
        numeroEgreso: expense.numero,
        version: expense.version,
        decision: "APROBADO",
        motivo: ""
      });
      if (data.estado !== "OK") return showToast(data.mensaje || "No fue posible registrar la firma.", true);
      showToast(data.mensaje);
      await loadExpenses();
    } catch (error) {
      showToast("No fue posible conectar con el servidor.", true);
    } finally {
      setButtonLoading(button, false);
    }
  }
}

async function submitRejection(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const message = document.getElementById("rejectMessage");
  const button = form.querySelector('[type="submit"]');
  resetMessage(message);
  if (!form.checkValidity()) return form.reportValidity();
  setButtonLoading(button, true, "Registrando…");
  try {
    const values = Object.fromEntries(new FormData(form));
    const data = await authenticatedRequest("registrarDecision", {
      numeroEgreso: values.numeroEgreso,
      version: values.version,
      decision: "RECHAZADO",
      motivo: values.motivo
    });
    if (data.estado !== "OK") return showFormMessage(message, data.mensaje || "No fue posible registrar el rechazo.", "error");
    document.getElementById("rejectDialog").close();
    showToast(data.mensaje);
    await loadExpenses();
  } catch (error) {
    showFormMessage(message, "No fue posible conectar con el servidor.", "error");
  } finally {
    setButtonLoading(button, false);
  }
}

function renderCommittee() {
  mostrarPendientes();
  mostrarAprobados();
  mostrarHistorico();
}

function openExpenseDialog(expense) {
  const dialog = document.getElementById("expenseDialog");
  document.getElementById("dialogTitle").textContent = `Egreso #${expense.numero}`;
  document.getElementById("dialogContent").innerHTML = `<div class="detail-grid">
    <div class="detail-item"><span>Proveedor</span><strong>${escapeHtml(expense.proveedor)}</strong></div>
    <div class="detail-item"><span>Monto</span><strong>${formatCurrency(expense.monto)}</strong></div>
    <div class="detail-item"><span>Categoría</span><strong>${escapeHtml(expense.categoria)}</strong></div>
    <div class="detail-item"><span>Fecha límite</span><strong>${formatDate(expense.fechaLimite)}</strong></div>
    <div class="detail-item"><span>Estado</span>${statusBadge(expense.estado)}</div>
    <div class="detail-item"><span>Versión / prórrogas</span><strong>V${expense.version} · ${expense.prorrogas}</strong></div>
    <div class="detail-item detail-item--full"><span>Descripción</span><strong>${escapeHtml(expense.descripcion)}</strong></div>
    <div class="detail-item detail-item--full"><span>Decisiones</span><div class="decision-history">${renderDecisionDetails(expense)}</div></div>
  </div>`;
  dialog.showModal();
}

function renderDecisionDetails(expense) {
  if (!expense.decisiones.length) return '<span class="muted">Aún no hay decisiones.</span>';
  return expense.decisiones.map(item => `<div class="decision-row"><strong>${escapeHtml(item.rol)}</strong><span class="badge ${item.decision === "APROBADO" ? "badge--approved" : "badge--rejected"}">${escapeHtml(item.decision)}</span>${item.motivo ? `<p>${escapeHtml(item.motivo)}</p>` : ""}</div>`).join("");
}

function openEditExpense(numero) {
  const expense = expenses.find(item => item.numero === numero);
  if (!expense || !expense.puedeEditar) return;
  document.getElementById("editExpenseNumber").value = expense.numero;
  document.getElementById("editExpenseVersion").value = expense.version;
  document.getElementById("editExpenseLabel").textContent = `Egreso #${expense.numero} · Versión ${expense.version}`;
  document.getElementById("editExpenseProvider").value = expense.proveedor;
  document.getElementById("editExpenseAmount").value = expense.monto;
  document.getElementById("editExpenseCategory").value = expense.categoria;
  document.getElementById("editExpenseDescription").value = expense.descripcion;
  document.getElementById("editExpenseDeadline").value = expense.fechaLimite;
  document.getElementById("editExpenseDeadline").min = localDateInputValue(new Date());
  resetMessage(document.getElementById("editExpenseMessage"));
  document.getElementById("editExpenseDialog").showModal();
}

async function submitExpenseEdit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const message = document.getElementById("editExpenseMessage");
  const button = form.querySelector('[type="submit"]');
  resetMessage(message);
  if (!form.checkValidity()) return form.reportValidity();
  if (!window.confirm("Editar el egreso iniciará una nueva versión y reiniciará las firmas. ¿Continuar?")) return;
  setButtonLoading(button, true, "Guardando…");
  try {
    const data = await authenticatedRequest("editarEgreso", Object.fromEntries(new FormData(form)));
    if (data.estado !== "OK") return showFormMessage(message, data.mensaje || "No fue posible editar el egreso.", "error");
    document.getElementById("editExpenseDialog").close();
    showToast(data.mensaje);
    await loadExpenses();
  } catch (error) {
    showFormMessage(message, "No fue posible conectar con el servidor.", "error");
  } finally {
    setButtonLoading(button, false);
  }
}

function setDefaultDeadline() {
  const input = document.getElementById("fechaLimite");
  if (!input) return;
  const today = new Date();
  input.min = localDateInputValue(today);
  if (!input.value) {
    const deadline = new Date(today);
    deadline.setDate(deadline.getDate() + 5);
    input.value = localDateInputValue(deadline);
  }
}

function localDateInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function fillSessionHeader() {
  const user = localStorage.getItem("usuario") || "Usuario";
  const name = localStorage.getItem("nombre") || user;
  const role = localStorage.getItem("rol") || "";
  document.getElementById("sessionUser").textContent = name;
  document.getElementById("sessionRole").textContent = ROLE_LABELS[role] || role;
  document.getElementById("sessionAvatar").textContent = name.charAt(0).toUpperCase();
}

function fillRoleSelect(select) {
  select.replaceChildren();
  USER_ROLES.forEach(role => {
    const option = document.createElement("option");
    option.value = role;
    option.textContent = ROLE_LABELS[role];
    select.append(option);
  });
}

function setButtonLoading(button, loading, label = "Procesando…") {
  if (!button) return;
  if (loading) {
    button.dataset.originalContent = button.innerHTML;
    button.textContent = label;
  } else if (button.dataset.originalContent) {
    button.innerHTML = button.dataset.originalContent;
    delete button.dataset.originalContent;
  }
  button.disabled = loading;
}

function resetMessage(element) {
  element.className = element.classList.contains("field--full") ? "form-message field--full" : "form-message";
  element.textContent = "";
}

async function loadProfile() {
  const data = await authenticatedRequest("obtenerPerfil");
  if (data.estado !== "OK") throw new Error(data.mensaje || "No se pudo cargar el perfil.");
  const profile = data.perfil;
  document.getElementById("profileName").value = profile.nombre;
  document.getElementById("profileUsername").value = profile.usuario;
  document.getElementById("profileRole").value = ROLE_LABELS[profile.rol] || profile.rol;
  const destination = destinationForRole(profile.rol);
  document.getElementById("profileHomeLink").href = destination;
  document.getElementById("backToPanel").href = destination;
  const required = profile.requiereCambioClave;
  document.getElementById("passwordRequiredAlert").hidden = !required;
  document.getElementById("backToPanel").hidden = required;
  if (required) document.getElementById("newProfilePassword").focus();
}

async function updateProfile(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const message = document.getElementById("profileMessage");
  const button = form.querySelector('[type="submit"]');
  resetMessage(message);
  if (!form.checkValidity()) return form.reportValidity();
  const values = new FormData(form);
  setButtonLoading(button, true, "Guardando…");
  try {
    const data = await authenticatedRequest("actualizarMiPerfil", {
      nombre: String(values.get("nombre")).trim(),
      usuario: String(values.get("usuario")).trim()
    });
    if (data.estado !== "OK") return showFormMessage(message, data.mensaje || "No fue posible actualizar el perfil.", "error");
    if (data.sesionInvalidada) return finishInvalidatedSession(message, data.mensaje);
    localStorage.setItem("nombre", data.nombre);
    localStorage.setItem("usuario", data.usuario);
    fillSessionHeader();
    showFormMessage(message, "Perfil actualizado correctamente.", "success");
  } catch (error) {
    showFormMessage(message, "No fue posible conectar con el servidor.", "error");
  } finally {
    setButtonLoading(button, false);
  }
}

async function changePassword(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const message = document.getElementById("passwordMessage");
  const button = form.querySelector('[type="submit"]');
  const current = document.getElementById("currentPassword").value;
  const next = document.getElementById("newProfilePassword").value;
  const confirmation = document.getElementById("confirmProfilePassword").value;
  resetMessage(message);
  if (!form.checkValidity()) return form.reportValidity();
  if (next !== confirmation) return showFormMessage(message, "Las contraseñas nuevas no coinciden.", "error");

  setButtonLoading(button, true, "Actualizando…");
  try {
    const data = await authenticatedRequest("cambiarMiClave", { claveActual: current, claveNueva: next });
    if (data.estado !== "OK") return showFormMessage(message, data.mensaje || "No fue posible cambiar la contraseña.", "error");
    finishInvalidatedSession(message, data.mensaje);
  } catch (error) {
    showFormMessage(message, "No fue posible conectar con el servidor.", "error");
  } finally {
    setButtonLoading(button, false);
  }
}

function finishInvalidatedSession(message, text) {
  showFormMessage(message, text || "Cambio guardado. Ingresa nuevamente.", "success");
  clearSession();
  window.setTimeout(() => window.location.replace("index.html"), 1200);
}

async function loadUsers() {
  const tbody = document.getElementById("userRows");
  tbody.innerHTML = '<tr class="loading-row"><td colspan="5">Cargando usuarios…</td></tr>';
  const data = await authenticatedRequest("listarUsuarios");
  if (data.estado !== "OK") throw new Error(data.mensaje || "No se pudieron cargar los usuarios.");
  managedUsers = data.usuarios || [];
  renderUsers();
}

function renderUsers() {
  const tbody = document.getElementById("userRows");
  tbody.replaceChildren();
  managedUsers.forEach(user => {
    const status = user.bloqueado
      ? '<span class="badge badge--blocked">Bloqueado</span>'
      : user.activo === "SI"
        ? '<span class="badge badge--approved">Activo</span>'
        : '<span class="badge badge--inactive">Inactivo</span>';
    const row = document.createElement("tr");
    row.innerHTML = `
      <td><div class="user-identity"><strong>${escapeHtml(user.nombre)}</strong><span>${escapeHtml(user.usuario)}${user.email ? ` · ${escapeHtml(user.email)}` : " · Sin email"}${user.requiereCambioClave ? " · Cambio de clave pendiente" : ""}</span></div></td>
      <td>${escapeHtml(ROLE_LABELS[user.rol] || user.rol)}</td>
      <td>${status}</td>
      <td>${user.ultimoAcceso ? formatDateTime(user.ultimoAcceso) : "Nunca"}</td>
      <td><div class="table-actions"><button class="button button--ghost" type="button" data-user-action="edit" data-id="${escapeHtml(user.id)}">Editar</button><button class="button button--ghost" type="button" data-user-action="reset" data-id="${escapeHtml(user.id)}">Clave</button></div></td>`;
    tbody.append(row);
  });
  document.getElementById("usersEmpty").hidden = managedUsers.length > 0;
  document.getElementById("userRecordCount").textContent = `${managedUsers.length} ${managedUsers.length === 1 ? "registro" : "registros"}`;
  document.getElementById("metricUsersTotal").textContent = managedUsers.length;
  document.getElementById("metricUsersActive").textContent = managedUsers.filter(user => user.activo === "SI").length;
  document.getElementById("metricUsersBlocked").textContent = managedUsers.filter(user => user.bloqueado).length;
}

async function createUser(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const message = document.getElementById("createUserMessage");
  const button = form.querySelector('[type="submit"]');
  resetMessage(message);
  if (!form.checkValidity()) return form.reportValidity();
  const values = Object.fromEntries(new FormData(form));
  setButtonLoading(button, true, "Creando…");
  try {
    const data = await authenticatedRequest("crearUsuario", values);
    if (data.estado !== "OK") return showFormMessage(message, data.mensaje || "No fue posible crear el usuario.", "error");
    form.reset();
    showFormMessage(message, data.mensaje, "success");
    await loadUsers();
  } catch (error) {
    showFormMessage(message, "No fue posible conectar con el servidor.", "error");
  } finally {
    setButtonLoading(button, false);
  }
}

function openUserDialog(action, id) {
  const user = managedUsers.find(item => item.id === id);
  if (!user) return;
  if (action === "edit") {
    document.getElementById("editUserId").value = user.id;
    document.getElementById("editName").value = user.nombre;
    document.getElementById("editUsername").value = user.usuario;
    document.getElementById("editEmail").value = user.email || "";
    document.getElementById("editRole").value = user.rol;
    document.getElementById("editActive").value = user.activo;
    resetMessage(document.getElementById("editUserMessage"));
    document.getElementById("editUserDialog").showModal();
  }
  if (action === "reset") {
    document.getElementById("resetUserId").value = user.id;
    document.getElementById("resetPasswordUser").textContent = `${user.nombre} · ${user.usuario}`;
    document.getElementById("resetPasswordForm").reset();
    document.getElementById("resetUserId").value = user.id;
    resetMessage(document.getElementById("resetPasswordMessage"));
    document.getElementById("resetPasswordDialog").showModal();
  }
}

async function updateManagedUser(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const message = document.getElementById("editUserMessage");
  const button = form.querySelector('[type="submit"]');
  resetMessage(message);
  if (!form.checkValidity()) return form.reportValidity();
  setButtonLoading(button, true, "Guardando…");
  try {
    const data = await authenticatedRequest("actualizarUsuario", Object.fromEntries(new FormData(form)));
    if (data.estado !== "OK") return showFormMessage(message, data.mensaje || "No fue posible actualizar el usuario.", "error");
    document.getElementById("editUserDialog").close();
    showToast(data.mensaje);
    await loadUsers();
  } catch (error) {
    showFormMessage(message, "No fue posible conectar con el servidor.", "error");
  } finally {
    setButtonLoading(button, false);
  }
}

async function resetManagedPassword(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const message = document.getElementById("resetPasswordMessage");
  const button = form.querySelector('[type="submit"]');
  resetMessage(message);
  if (!form.checkValidity()) return form.reportValidity();
  setButtonLoading(button, true, "Restableciendo…");
  try {
    const data = await authenticatedRequest("restablecerClave", Object.fromEntries(new FormData(form)));
    if (data.estado !== "OK") return showFormMessage(message, data.mensaje || "No fue posible restablecer la contraseña.", "error");
    document.getElementById("resetPasswordDialog").close();
    showToast(data.mensaje);
    await loadUsers();
  } catch (error) {
    showFormMessage(message, "No fue posible conectar con el servidor.", "error");
  } finally {
    setButtonLoading(button, false);
  }
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("es-CL", { dateStyle: "short", timeStyle: "short" }).format(date);
}

function statusBadge(status) {
  const normalized = String(status || "").toUpperCase();
  const modifier = normalized === "PENDIENTE" ? "pending" : normalized === "RECHAZADO" ? "rejected" : "approved";
  return `<span class="badge badge--${modifier}">${escapeHtml(normalized)}</span>`;
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
    setDefaultDeadline();
    document.getElementById("expenseForm").addEventListener("submit", crearEgreso);
    document.getElementById("editExpenseForm").addEventListener("submit", submitExpenseEdit);
    document.getElementById("adminExpenseRows").addEventListener("click", event => {
      const button = event.target.closest("button[data-edit-expense]");
      if (button) openEditExpense(button.dataset.editExpense);
    });
    const editDialog = document.getElementById("editExpenseDialog");
    editDialog.addEventListener("click", event => {
      if (event.target.dataset.action === "close-dialog" || event.target === editDialog) editDialog.close();
    });
    try {
      await loadExpenses();
    } catch (error) {
      document.getElementById("adminExpenseRows").innerHTML = '<tr class="loading-row"><td colspan="6">No fue posible cargar los egresos.</td></tr>';
      showToast("No fue posible cargar los egresos.", true);
    }
  }
  if (page === "comite") {
    document.querySelector(".kanban").addEventListener("click", event => {
      const button = event.target.closest("button[data-action]");
      if (button) handleCommitteeAction(button.dataset.action, button.dataset.id, button);
    });
    document.getElementById("rejectForm").addEventListener("submit", submitRejection);
    document.querySelectorAll("#expenseDialog, #rejectDialog").forEach(dialog => {
      dialog.addEventListener("click", event => {
        if (event.target.dataset.action === "close-dialog" || event.target === dialog) dialog.close();
      });
    });
    try {
      await loadExpenses();
    } catch (error) {
      ["pendingList", "approvedList", "historyList"].forEach(id => {
        document.getElementById(id).innerHTML = '<div class="empty-column">No fue posible cargar los egresos.</div>';
      });
      showToast("No fue posible cargar los egresos.", true);
    }
  }
  if (page === "perfil") {
    document.getElementById("profileForm").addEventListener("submit", updateProfile);
    document.getElementById("passwordForm").addEventListener("submit", changePassword);
    try {
      await loadProfile();
    } catch (error) {
      showToast("No fue posible cargar el perfil.", true);
    }
  }
  if (page === "usuarios") {
    fillRoleSelect(document.getElementById("newRole"));
    fillRoleSelect(document.getElementById("editRole"));
    document.getElementById("createUserForm").addEventListener("submit", createUser);
    document.getElementById("editUserForm").addEventListener("submit", updateManagedUser);
    document.getElementById("resetPasswordForm").addEventListener("submit", resetManagedPassword);
    document.getElementById("userRows").addEventListener("click", event => {
      const button = event.target.closest("button[data-user-action]");
      if (button) openUserDialog(button.dataset.userAction, button.dataset.id);
    });
    document.querySelectorAll("#editUserDialog, #resetPasswordDialog").forEach(dialog => {
      dialog.addEventListener("click", event => {
        if (event.target.dataset.action === "close-dialog" || event.target === dialog) dialog.close();
      });
    });
    try {
      await loadUsers();
    } catch (error) {
      document.getElementById("userRows").innerHTML = '<tr class="loading-row"><td colspan="5">No fue posible cargar los usuarios.</td></tr>';
      showToast("No fue posible cargar los usuarios.", true);
    }
  }
}

document.addEventListener("DOMContentLoaded", initializePage);

// Funciones expuestas para facilitar la sustitución por llamadas fetch() en la integración futura.
Object.assign(window, { login, logout, verificarSesion, mostrarPendientes, mostrarAprobados, mostrarHistorico, crearEgreso, API_CONFIG });
