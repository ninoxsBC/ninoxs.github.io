const SHEET_ID = "1AqVB3PTHWwj9dNHbbzGyELD5AUmt21cqgkobHita8kw";
const HOJA_USUARIOS = "USUARIOS";
const HOJA_SESIONES = "SESIONES";
const DURACION_SESION_MS = 8 * 60 * 60 * 1000;
const ROLES_VALIDOS = ["Administrador", "Secretario", "Presidenta", "Tesorero"];

/**
 * El frontend sólo debe usar POST. Esto evita enviar claves y tokens en la URL.
 */
function doPost(e) {
  try {
    const accion = normalizarTexto(e && e.parameter && e.parameter.accion);

    switch (accion) {
      case "login":
        return login(e);
      case "validarSesion":
        return validarSesion(e);
      case "logout":
        return logout(e);
      default:
        return respuesta({ estado: "ERROR", mensaje: "Acción no válida" });
    }
  } catch (error) {
    console.error("Error en doPost: " + error.stack);
    return respuesta({ estado: "ERROR", mensaje: "Error interno del servidor" });
  }
}

/**
 * Se conserva sólo como respuesta informativa. No procesa credenciales por GET.
 */
function doGet() {
  return respuesta({
    estado: "ERROR",
    mensaje: "Método no permitido. Utiliza POST."
  });
}

function login(e) {
  const usuario = normalizarTexto(e.parameter.usuario);
  const clave = String(e.parameter.clave || "");

  if (!usuario || !clave) {
    return respuesta({ estado: "ERROR", mensaje: "Credenciales incompletas" });
  }

  const hojaUsuarios = obtenerHojaObligatoria(HOJA_USUARIOS);
  const ultimaFila = hojaUsuarios.getLastRow();

  if (ultimaFila < 2) {
    return respuesta({ estado: "ERROR", mensaje: "Usuario o contraseña incorrectos" });
  }

  const datos = hojaUsuarios.getRange(2, 1, ultimaFila - 1, 4).getDisplayValues();

  for (let i = 0; i < datos.length; i++) {
    const usuarioHoja = normalizarTexto(datos[i][0]);
    const claveHoja = String(datos[i][1] || "").trim();
    const rolHoja = normalizarTexto(datos[i][2]);
    const activo = normalizarTexto(datos[i][3]).toUpperCase();

    if (
      usuarioHoja.toLowerCase() === usuario.toLowerCase() &&
      claveHoja === clave &&
      activo === "SI" &&
      ROLES_VALIDOS.indexOf(rolHoja) !== -1
    ) {
      const token = crearSesion(usuarioHoja, rolHoja);

      return respuesta({
        estado: "OK",
        usuario: usuarioHoja,
        rol: rolHoja,
        token: token
      });
    }
  }

  return respuesta({ estado: "ERROR", mensaje: "Usuario o contraseña incorrectos" });
}

function validarSesion(e) {
  const token = String(e.parameter.token || "").trim();
  if (!token) {
    return respuesta({ estado: "ERROR", mensaje: "Sesión no válida" });
  }

  const sesion = buscarSesionActiva(token);
  if (!sesion) {
    return respuesta({ estado: "ERROR", mensaje: "Sesión expirada o no válida" });
  }

  // Se vuelve a comprobar el usuario para bloquear inmediatamente cuentas desactivadas.
  const usuarioActual = buscarUsuarioActivo(sesion.usuario);
  if (!usuarioActual) {
    desactivarSesionPorFila(sesion.fila);
    return respuesta({ estado: "ERROR", mensaje: "Usuario inactivo" });
  }

  return respuesta({
    estado: "OK",
    usuario: usuarioActual.usuario,
    rol: usuarioActual.rol
  });
}

function logout(e) {
  const token = String(e.parameter.token || "").trim();
  if (token) {
    const sesion = buscarSesionActiva(token);
    if (sesion) desactivarSesionPorFila(sesion.fila);
  }

  // El logout es idempotente: una sesión ya cerrada también se considera cerrada.
  return respuesta({ estado: "OK" });
}

function crearSesion(usuario, rol) {
  const token = "sesion_" + Utilities.getUuid().replace(/-/g, "") + Utilities.getUuid().replace(/-/g, "");
  const tokenHash = calcularHash(token);
  const creada = new Date();
  const expira = new Date(creada.getTime() + DURACION_SESION_MS);
  const lock = LockService.getScriptLock();

  lock.waitLock(10000);
  try {
    const hoja = obtenerHojaSesiones();
    desactivarSesionesAnteriores(hoja, usuario);
    hoja.appendRow([tokenHash, usuario, rol, creada, expira, "SI"]);
  } finally {
    lock.releaseLock();
  }

  return token;
}

function buscarSesionActiva(token) {
  const hoja = obtenerHojaSesiones();
  const ultimaFila = hoja.getLastRow();
  if (ultimaFila < 2) return null;

  const tokenHash = calcularHash(token);
  const datos = hoja.getRange(2, 1, ultimaFila - 1, 6).getValues();
  const ahora = new Date().getTime();

  for (let i = datos.length - 1; i >= 0; i--) {
    const hashHoja = String(datos[i][0] || "");
    const activa = normalizarTexto(datos[i][5]).toUpperCase();

    if (hashHoja === tokenHash && activa === "SI") {
      const expira = datos[i][4] instanceof Date ? datos[i][4].getTime() : new Date(datos[i][4]).getTime();
      const fila = i + 2;

      if (!expira || expira <= ahora) {
        desactivarSesionPorFila(fila);
        return null;
      }

      return {
        fila: fila,
        usuario: String(datos[i][1]),
        rol: String(datos[i][2])
      };
    }
  }

  return null;
}

function buscarUsuarioActivo(usuario) {
  const hoja = obtenerHojaObligatoria(HOJA_USUARIOS);
  const ultimaFila = hoja.getLastRow();
  if (ultimaFila < 2) return null;

  const datos = hoja.getRange(2, 1, ultimaFila - 1, 4).getDisplayValues();
  for (let i = 0; i < datos.length; i++) {
    const usuarioHoja = normalizarTexto(datos[i][0]);
    const rolHoja = normalizarTexto(datos[i][2]);
    const activo = normalizarTexto(datos[i][3]).toUpperCase();

    if (
      usuarioHoja.toLowerCase() === usuario.toLowerCase() &&
      activo === "SI" &&
      ROLES_VALIDOS.indexOf(rolHoja) !== -1
    ) {
      return { usuario: usuarioHoja, rol: rolHoja };
    }
  }

  return null;
}

function obtenerHojaSesiones() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let hoja = ss.getSheetByName(HOJA_SESIONES);

  if (!hoja) {
    hoja = ss.insertSheet(HOJA_SESIONES);
    hoja.appendRow(["TOKEN_HASH", "USUARIO", "ROL", "CREADA", "EXPIRA", "ACTIVA"]);
    hoja.setFrozenRows(1);
    hoja.getRange("D:E").setNumberFormat("yyyy-mm-dd hh:mm:ss");
  }

  return hoja;
}

function obtenerHojaObligatoria(nombre) {
  const hoja = SpreadsheetApp.openById(SHEET_ID).getSheetByName(nombre);
  if (!hoja) throw new Error("No existe la hoja requerida: " + nombre);
  return hoja;
}

function desactivarSesionesAnteriores(hoja, usuario) {
  const ultimaFila = hoja.getLastRow();
  if (ultimaFila < 2) return;

  const datos = hoja.getRange(2, 1, ultimaFila - 1, 6).getValues();
  for (let i = 0; i < datos.length; i++) {
    if (
      String(datos[i][1]).toLowerCase() === usuario.toLowerCase() &&
      normalizarTexto(datos[i][5]).toUpperCase() === "SI"
    ) {
      hoja.getRange(i + 2, 6).setValue("NO");
    }
  }
}

function desactivarSesionPorFila(fila) {
  obtenerHojaSesiones().getRange(fila, 6).setValue("NO");
}

function calcularHash(valor) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    valor,
    Utilities.Charset.UTF_8
  );

  return bytes.map(function(byte) {
    const valorPositivo = byte < 0 ? byte + 256 : byte;
    return ("0" + valorPositivo.toString(16)).slice(-2);
  }).join("");
}

function normalizarTexto(valor) {
  return String(valor || "").trim();
}

function respuesta(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
