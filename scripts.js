import { supabase } from "./configDB.js";

// ==========================
// 📌 Referencias del DOM
// ==========================
const compareBtn = document.getElementById("compareBtn");
const resultSection = document.getElementById("resultSection");
const resultTable = document.querySelector("#resultTable tbody");
const downloadBtn = document.getElementById("downloadBtn");
const uploadSection = document.querySelector(".upload-section");
const actionButtons = document.querySelector(".action-buttons");
const backBtn = document.getElementById("backBtn");

let modeloCodes = [];      // Factura - menos productos
let maestroCodes = [];     // Proforma - más productos
let clienteData = {};      // Datos del cliente (de Excel maestro)
let proformaNumber = "";   // e.g. "002-00065088"
let facturaNumber = "";    // e.g. "FF02-00016865"

// ==========================
// 🔧 Función global para normalizar códigos (NUMÉRICOS)
// ==========================
function normalizeCodigo(v) {
  if (v === null || v === undefined) return "";
  let s = String(v).normalize("NFKC");
  s = s.replace(/[\u200B-\u200F\uFEFF\u00A0"']/g, "");
  s = s.replace(/[\r\n\t]/g, " ");
  const m = s.match(/\d+/g);
  if (!m || m.length === 0) return "";
  const joined = m.join("");
  return joined;
}

// ==========================
// 🧠 Evento principal de comparación
// ==========================
compareBtn.addEventListener("click", async () => {
  const modeloFile = document.getElementById("excelFile1").files[0];
  const maestroFile = document.getElementById("excelFile2").files[0];
  const facturaInput = document.getElementById("facturaManual");

  if (!modeloFile || !maestroFile) {
    showToast("Por favor, selecciona ambos archivos Excel.", "error");
    return;
  }

  const modeloData = await extractDataFromExcel(modeloFile);
  const maestroData = await extractDataFromExcel(maestroFile);
  const modeloText = (modeloData.rawText || (modeloData.rawCells || []).join(" ")).toString();
  const maestroText = (maestroData.rawText || (maestroData.rawCells || []).join(" ")).toString();

  // Buscar número con prefijo "002"
  proformaNumber =
    findNumberByPrefixInText(maestroText, "002") ||
    findNumberByPrefixInText(modeloText, "002") ||
    "";

  console.log("Número de proforma detectado automáticamente:", proformaNumber);

  if (!proformaNumber) {
    showToast("No se detectó número de proforma automáticamente.", "warning");
  }

  modeloCodes = modeloData.codes || [];
  maestroCodes = maestroData.codes || [];
  clienteData = maestroData.clienteData || {};

  facturaNumber = facturaInput.value.trim();
  if (!facturaNumber) {
    showToast("Por favor, ingresa el número de factura.", "error");
    return;
  }

  rellenarFormularioCliente(clienteData);

  // (Opcional) versión local de normalización para este scope — NO elimina la global
  const normalizeLocal = (v) => normalizeCodigo(v);

  // Debug counts
  console.log("Productos en MODELO (factura):", modeloCodes.length);
  console.log("Productos en MAESTRO (proforma):", maestroCodes.length);

  // ==========================
  // 🔹 Detectar duplicados
  // ==========================
  detectarDuplicados(modeloCodes, "Factura/Boleta/Nota de Pedido");
  detectarDuplicados(maestroCodes, "Proforma");

  // 1) Proforma -> Factura (proforma tiene pero la factura NO)
  const faltantesEnFactura = maestroCodes
    .filter(code => {
      const nc = normalizeLocal(code.codigo || code.codigoNorm || "");
      if (!nc) return false;
      return !modeloCodes.some(c => normalizeLocal(c.codigo || c.codigoNorm || "") === nc);
    })
    .map(c => ({ ...c, _origen: "PROFORMA_SIN_FACTURA" }));

  // 2) Factura -> Proforma (factura tiene pero la proforma NO)
  const noRegistradosEnProforma = modeloCodes
    .filter(code => {
      const nc = normalizeLocal(code.codigo || code.codigoNorm || "");
      if (!nc) return false;
      return !maestroCodes.some(c => normalizeLocal(c.codigo || c.codigoNorm || "") === nc);
    })
    .map(c => ({ ...c, _origen: "FACTURA_SIN_PROFORMA" }));

  console.log("faltantesEnFactura:", faltantesEnFactura.length, "noRegistradosEnProforma:", noRegistradosEnProforma.length);

  // Unir y deduplicar por código normalizado
  const merged = [...faltantesEnFactura, ...noRegistradosEnProforma];
  const mapByCode = new Map();
  merged.forEach(item => {
    const key = normalizeLocal(item.codigo || item.codigoNorm || "");
    if (!mapByCode.has(key)) mapByCode.set(key, item);
    else {
      const existing = mapByCode.get(key);
      existing._origen = existing._origen === item._origen ? existing._origen : `${existing._origen}|${item._origen}`;
    }
  });
  const faltantesTotales = Array.from(mapByCode.values());

  // Debug final
  console.log("Faltantes totales (únicos):", faltantesTotales.length);

  // Mostrar resultados
  if (faltantesTotales.length === 0) {
    showToast("No hay productos faltantes o inesperados.", "success");
  }

  mostrarResultados(faltantesTotales, {
    facturaNumber,
    proformaNumber,
    clienteData,
    duplicados: [] // Ya se muestra el toast desde detectarDuplicados()
  });

  // (opcional) desplazar vista a resultados
  uploadSection.style.display = "none";
  resultSection.classList.remove("hidden");
  actionButtons.classList.remove("hidden");
});



// ==========================
// 📝 Mostrar resultados en tabla + bloque
// ==========================
function mostrarResultados(faltantes) {
  resultTable.innerHTML = "";
  if (faltantes.length === 0) {
    resultTable.innerHTML = `<tr><td colspan="7">No hay productos faltantes</td></tr>`;
  } else {
    faltantes.forEach(item => {
      const row = document.createElement("tr");

      const tdCodigo = document.createElement("td");
      // Mostrar preferentemente el código normalizado (solo números)
      tdCodigo.textContent = item.codigoNorm || normalizeCodigo(item.codigo) || item.codigo || "";
      makeCellLocked(tdCodigo);

      const tdDescripcion = document.createElement("td");
      tdDescripcion.textContent = item.descripcion;
      makeCellLocked(tdDescripcion);

      const tdUM = document.createElement("td");
      tdUM.textContent = item.um;
      tdUM.contentEditable = "true";
      tdUM.addEventListener("input", () => recalcularSubtotal(row));

      const tdPrecio = document.createElement("td");
      tdPrecio.textContent = item.precio;
      tdPrecio.contentEditable = "true";
      tdPrecio.addEventListener("input", () => recalcularSubtotal(row));

      const tdCantidad = document.createElement("td");
      tdCantidad.textContent = item.cantidad;
      tdCantidad.contentEditable = "true";
      tdCantidad.addEventListener("input", () => recalcularSubtotal(row));

      const tdSubtotal = document.createElement("td");
      tdSubtotal.textContent = item.subtotal;
      makeCellLocked(tdSubtotal);

      const tdAcciones = document.createElement("td");
      const btnDelete = document.createElement("button");
      btnDelete.textContent = "X";
      btnDelete.classList.add("delete-row-btn");
      btnDelete.addEventListener("click", () => row.remove());
      tdAcciones.appendChild(btnDelete);

      row.append(tdCodigo, tdDescripcion, tdUM, tdPrecio, tdCantidad, tdSubtotal, tdAcciones);
      resultTable.appendChild(row);
    });
  }

  resultSection.classList.remove("hidden");
  downloadBtn.classList.remove("hidden");
}


// ==========================
// 📊 Extraer datos desde Excel
// ==========================
async function extractDataFromExcel(file) {
  const data = await file.arrayBuffer();
  const workbook = XLSX.read(data, { type: "array" });

  const cleanVal = (val) => (val || val === 0 ? String(val).replace(/^:\s*/, "").trim() : "");

  const validarFecha = (val) => {
    const regexFecha = /^\d{2}\/\d{2}\/\d{4}$/;
    return regexFecha.test(val) ? val : "";
  };

  // ===============================
  // 📌 1️⃣ CLIENTE DATA AUTOMÁTICO (Hoja 1)
  // ===============================
  const firstSheetName = workbook.SheetNames[0];
  const firstSheet = workbook.Sheets[firstSheetName];
  const firstJson = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: "" });

  // --- Leer filas base ---
  const fila3 = cleanVal(firstJson[2]?.[3]);
  const fila4 = cleanVal(firstJson[3]?.[3]);
  const fila5 = cleanVal(firstJson[4]?.[3]);
  const fila6 = cleanVal(firstJson[5]?.[3]);
  const fila7 = cleanVal(firstJson[6]?.[3]);
  const fila8 = cleanVal(firstJson[7]?.[3]);
  const fila9 = cleanVal(firstJson[8]?.[3]);

  const regexRucDni = /^\d{8}(\d{3})?$/; // 8 o 11 dígitos

  let razon = fila3;
  let dni = fila4;
  let direccion = fila5;
  let referencia = fila6;
  let entrega = fila7;
  let contacto = fila8;

  // 👉 Si fila4 NO es RUC/DNI, se concatena a razón y se corre todo
  if (fila4 && !regexRucDni.test(fila4)) {
    razon = `${fila3} ${fila4}`.trim();
    dni = fila5;
    direccion = fila6;
    referencia = fila7;
    entrega = fila8;
    contacto = fila9;
  }

  // --- Extraer fechas y pedido ---
  const readHI = (rowIndex, jsonData) => {
    const valH = cleanVal(jsonData[rowIndex]?.[7]);
    const valI = cleanVal(jsonData[rowIndex]?.[8]);
    if (valH && !["EMAIL", "IMAL"].includes(valH.toUpperCase())) return valH;
    if (valI && !["EMAIL", "IMAL"].includes(valI.toUpperCase())) return valI;
    return "";
  };

  const fecEmision = validarFecha(readHI(2, firstJson));
  const fecEntrega = validarFecha(readHI(4, firstJson));
  const pedido = readHI(5, firstJson);

  const clienteDataLocal = {
    razon,
    dni,
    direccion,
    referencia,
    entrega,
    contacto,
    fecEmision,
    fecEntrega,
    pedido
  };

  // ===============================
  // 📌 2️⃣ PRODUCTOS (todas las hojas)
  // ===============================
  const allRaw = [];
  const cellsInfo = [];
  const codes = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

    // Guardar texto bruto y coords
    for (let r = 0; r < jsonData.length; r++) {
      const row = jsonData[r] || [];
      for (let c = 0; c < row.length; c++) {
        const raw = cleanVal(row[c]);
        if (raw !== "") {
          allRaw.push(raw);
          cellsInfo.push({ sheet: sheetName, addr: `R${r + 1}C${c + 1}`, text: raw });
        }
      }
    }

    // Detectar fila de encabezado de tabla
    let headerIndex = 8;
    for (let r = 6; r <= 12 && r < jsonData.length; r++) {
      const row = (jsonData[r] || []).map(h => (h ? String(h).trim().toUpperCase() : ""));
      const hasCod = row.some(h => /^(#|COD|CÓD|CÓDIGO|CODIGO)$/.test(h) || /COD/.test(h));
      const hasDes = row.some(h => /DESCRIP|DESCRIPCIÓN|DESCRIPCION|DES/.test(h));
      if (hasCod && hasDes) { headerIndex = r; break; }
    }

    const headersRow = jsonData[headerIndex] || [];
    const headers = headersRow.map(h => (h ? String(h).trim().toUpperCase() : ""));
    const findSafeIndex = (keyword) => headers.findIndex(h => h && h.includes(keyword));
    const idxCodigo = findSafeIndex("COD");
    const idxDescripcion = findSafeIndex("DES");
    const idxUM = findSafeIndex("UM");
    const idxPrecio = findSafeIndex("PRECIO");
    const idxCantidad = findSafeIndex("CANT");
    const idxSubtotal = findSafeIndex("SUB");

    if (idxCodigo >= 0) {
      for (let i = headerIndex + 1; i < jsonData.length; i++) {
        const row = jsonData[i];
        if (!row || row.every(cell => cell === undefined || cell === null || String(cell).trim() === "")) continue;
        const codigoRaw = cleanVal(row[idxCodigo]);
        const descripcion = idxDescripcion >= 0 ? cleanVal(row[idxDescripcion]) : "";
        const um = idxUM >= 0 ? cleanVal(row[idxUM]) : "";
        const precio = idxPrecio >= 0 ? cleanVal(row[idxPrecio]) : "";
        const cantidad = idxCantidad >= 0 ? cleanVal(row[idxCantidad]) : "";
        const subtotal = idxSubtotal >= 0 ? cleanVal(row[idxSubtotal]) : "";
        if (codigoRaw) {
          const codigoNorm = normalizeCodigo(codigoRaw);
          codes.push({
            codigo: codigoRaw,
            codigoNorm,
            descripcion,
            um,
            precio,
            cantidad,
            subtotal,
            sheet: sheetName,
            rowIndex: i + 1
          });
        }
      }
    }
  }

  const rawText = allRaw.join(" ").replace(/\s+/g, " ").trim();
  return { clienteData: clienteDataLocal, codes, rawCells: allRaw, rawText, cellsInfo };
}


// ==========================
// 📝 Rellenar formulario con los datos del cliente extraídos del Excel
// ==========================
function rellenarFormularioCliente(clienteData) {
  if (!clienteData) return;

  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (!el) return;

    // 🧠 Valida formato de fecha si el campo es de fecha
    if (id === "clienteFecEmision" || id === "clienteFecEntrega") {
      const regexFecha = /^\d{2}\/\d{2}\/\d{4}$/;
      if (val && regexFecha.test(val)) {
        el.value = val;
      } else {
        el.value = ""; // limpia si no es fecha válida
      }
    } else {
      el.value = val || "";
    }
  };

  setVal("clienteRazon", clienteData.razon);
  setVal("clienteDNI", clienteData.dni);
  setVal("clienteDireccion", clienteData.direccion);
  setVal("clienteReferencia", clienteData.referencia);
  setVal("clienteFecEmision", clienteData.fecEmision);
  setVal("clienteFecEntrega", clienteData.fecEntrega);
}

// ==========================
// ⏰ Validación dinámica en los inputs de fecha
// ==========================
function validarFormatoFecha(inputId) {
  const input = document.getElementById(inputId);
  if (!input) return;

  input.addEventListener("blur", () => {
    const valor = input.value.trim();
    const regexFecha = /^\d{2}\/\d{2}\/\d{4}$/;

    if (valor && !regexFecha.test(valor)) {
      input.value = "";
    }
  });
}


// Activar validación en ambos campos de fecha
validarFormatoFecha("clienteFecEmision");
validarFormatoFecha("clienteFecEntrega");


// 🧮 Conversión de unidades a cantidad base
function recalcularSubtotal(row) {
  const precio = parseFloat(row.children[3].textContent) || 0;
  const cantidad = parseFloat(row.children[4].textContent) || 0;
  const subtotal = precio * cantidad;

  // ✅ Mostrar sin .00 si es entero
  row.children[5].textContent = Number.isInteger(subtotal)
    ? subtotal.toString()
    : subtotal.toFixed(2);
}



// ---------------------------
// Estado global de desbloqueo
// ---------------------------
let globalUnlock = {
  unlocked: false,
  expiresAt: 0,
  timeoutId: null
};

const UNLOCK_DURATION_MS = 2 * 60 * 1000;
const PASSWORD = "primavera";

// ---------------------------
// Solicita contraseña y desbloquea
// ---------------------------
function requestPasswordAndUnlock() {
  const pass = prompt("🔒 Esta celda está bloqueada.\nIngrese la contraseña para editar (minúscula):");
  if (pass === null) return false;

  if (pass === PASSWORD) {
    unlockAllFor(UNLOCK_DURATION_MS);
    return true;
  } else {
    alert("Contraseña incorrecta.");
    return false;
  }
}

// ---------------------------
// Desbloquea todas las celdas por un tiempo
// ---------------------------
function unlockAllFor(durationMs) {
  globalUnlock.unlocked = true;
  globalUnlock.expiresAt = Date.now() + durationMs;

  if (globalUnlock.timeoutId) {
    clearTimeout(globalUnlock.timeoutId);
  }

  document.querySelectorAll(".locked-cell").forEach(td => {
    td.contentEditable = "true";
    td.classList.add("unlocked-cell");
    td.classList.remove("locked-cell");
  });

  globalUnlock.timeoutId = setTimeout(() => {
    lockAllCells();
  }, durationMs);
}

// ---------------------------
// Re-bloquea todas las celdas
// ---------------------------
function lockAllCells() {
  globalUnlock.unlocked = false;
  globalUnlock.expiresAt = 0;
  if (globalUnlock.timeoutId) {
    clearTimeout(globalUnlock.timeoutId);
    globalUnlock.timeoutId = null;
  }

  document.querySelectorAll(".unlocked-cell").forEach(td => {
    td.contentEditable = "false";
    td.classList.add("locked-cell");
    td.classList.remove("unlocked-cell");
  });
}

// ---------------------------
// Handler para cuando se crea una celda bloqueada
// ---------------------------
function makeCellLocked(td) {
  // estilo inicial
  td.contentEditable = "false";
  td.classList.add("locked-cell");

  td.addEventListener("click", async (e) => {
    if (globalUnlock.unlocked && Date.now() < globalUnlock.expiresAt) {
      td.contentEditable = "true";
      td.classList.add("unlocked-cell");
      td.classList.remove("locked-cell");
      td.focus();
      return;
    }

    // Si no está desbloqueado globalmente, solicitar contraseña
    const ok = requestPasswordAndUnlock();
    if (ok) {
      td.contentEditable = "true";
      td.classList.add("unlocked-cell");
      td.classList.remove("locked-cell");
      td.focus();
    }
  });
}


// ==========================
// 🧾 Generar PDF con contador global desde Supabase
// ==========================

// Obtener contador actual desde Supabase
async function obtenerContador() {
  const { data, error } = await supabase
    .from("contador_pdf")
    .select("contador")
    .eq("id", 1)
    .single();

  if (error) {
    console.error("Error obteniendo contador:", error);
    return 0;
  }

  return data.contador;
}

// Incrementar contador y guardarlo en Supabase
async function incrementarContador() {
  let contador = await obtenerContador();
  contador++;

  const { error } = await supabase
    .from("contador_pdf")
    .update({ contador })
    .eq("id", 1);

  if (error) console.error("Error actualizando contador:", error);

  return contador;
}

// ==========================
// 🆔 Formatear número con prefijo y ceros
// ==========================
function formatearCodigo(contador) {
  const prefijo = "SP"; // <-- puedes cambiarlo (ej: "DOC", "CMP", "INV")
  const numeroFormateado = contador.toString().padStart(6, "0");
  return `${prefijo}-${numeroFormateado}`;
}

// Evento de descarga PDF
downloadBtn.addEventListener("click", async () => {
  try {

    const input = document.getElementById("proformaManual");
    proformaNumber = input?.value?.trim() || proformaNumber;

    const inputFactura = document.getElementById("facturaManual");
    facturaNumber = inputFactura?.value?.trim() || facturaNumber;

    // Validar que ya haya cargado la proforma
    if (!proformaNumber) {
      alert("No se ha detectado número de proforma. Primero usa 'Comparar Excel'.");
      return;
    }

    // ⚡ Obtener contador global
    const contadorGlobal = await incrementarContador();
    const codigoPDF = formatearCodigo(contadorGlobal);

    const { jsPDF } = window.jspdf;
    
    const doc = new jsPDF("p", "mm", "a4");

    const PAGE_WIDTH = 210;
    const MARGIN_X = 15;
    const CONTENT_WIDTH = PAGE_WIDTH - (MARGIN_X * 2);
    const headerTop = 15;

    // === Logo
    try {
      const logoUrl = "img/logo.jpg";
      const blob = await fetch(logoUrl).then(r => r.blob());
      const reader = new FileReader();
      const base64 = await new Promise(resolve => {
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(blob);
      });
      doc.addImage(base64, "JPG", MARGIN_X - 3, headerTop, 26, 26);
    } catch (e) {
      console.warn("Logo no cargado:", e);
    }

    // === Encabezado
    doc.setFont("helvetica", "bold").setFontSize(13);
    doc.text("PRIMAVERA DISTRIBUIDORES S.A.C.", PAGE_WIDTH / 2, headerTop + 8, { align: "center" });
    doc.setFont("helvetica", "normal").setFontSize(9);
    doc.text("R.U.C. 20560201011", PAGE_WIDTH / 2, headerTop + 14, { align: "center" });
    doc.text([
      "AV MANCO INCA #128 URB SANTA MARIA 1ERA ETAPA",
      "TRUJILLO - TRUJILLO - LA LIBERTAD"
    ], PAGE_WIDTH / 2, headerTop + 19, { align: "center" });
    doc.text(
      "Teléfono: 936-278-856  |  Email: primaveradistribuidores@gmail.com",
      PAGE_WIDTH / 2, headerTop + 27, { align: "center" }
    );

    // === Fecha y usuario
    const fecha = new Date().toLocaleString();
    doc.setFontSize(8);
    doc.text(`Fecha: ${fecha}`, PAGE_WIDTH - MARGIN_X, headerTop, { align: "right" });
    doc.text(`Usuario: ADMIN`, PAGE_WIDTH - MARGIN_X, headerTop + 5, { align: "right" });

    // === Cuadro Proforma / Factura / Contador
    const boxTop = headerTop + 35;
    const boxHeight = 22;
    doc.setDrawColor(150).setFillColor(245, 245, 245);
    doc.roundedRect(MARGIN_X, boxTop, CONTENT_WIDTH, boxHeight, 2, 2, "F");
    doc.roundedRect(MARGIN_X, boxTop, CONTENT_WIDTH, boxHeight, 2, 2);

    const paddingX = 10;
    const leftX = MARGIN_X + paddingX;
    const rightX = PAGE_WIDTH - MARGIN_X - paddingX;
    const centerX = PAGE_WIDTH / 2;

    const titleY = boxTop + 8;
    const numberY = boxTop + 14;

    // PROFORMA
    doc.setFont("helvetica", "bold").setFontSize(10);
    doc.text("Proforma de Venta", leftX, titleY);
    doc.setFont("helvetica", "normal").setFontSize(9);
    doc.text(proformaNumber || "-", leftX, numberY);

    // CONTADOR GLOBAL
    doc.setFont("helvetica", "bold").setFontSize(10);
    doc.text("Saldos de Proforma", centerX, titleY, { align: "center" });
    doc.setFont("helvetica", "normal").setFontSize(9);
    doc.text(codigoPDF, centerX, numberY, { align: "center" });

    // === TIPO DE DOCUMENTO DINÁMICO
    const tipoDocumento = document.getElementById("tipoDocumento")?.value || "Factura Electrónica";

    // FACTURA
    doc.setFont("helvetica", "bold").setFontSize(10);
    doc.text(tipoDocumento, rightX, titleY, { align: "right" });
    doc.setFont("helvetica", "normal").setFontSize(9);
    doc.text(facturaNumber || "-", rightX, numberY, { align: "right" });

    // Línea separadora
    doc.setDrawColor(190, 30, 45);
    doc.line(MARGIN_X + 5, boxTop + boxHeight - 5, PAGE_WIDTH - MARGIN_X - 5, boxTop + boxHeight - 5);
    doc.setFontSize(8).setTextColor(80, 80, 80);
    doc.text(`${tipoDocumento} ligada directamente a la Proforma indicada arriba.`, PAGE_WIDTH / 2, boxTop + boxHeight - 1, { align: "center" });

    // ========================
    // DATOS CLIENTE (directo de inputs)
    // ========================
    const razonSocial = document.getElementById("clienteRazon")?.value.trim() || "—";
    const dni = document.getElementById("clienteDNI")?.value.trim() || "—";
    const direccion = document.getElementById("clienteDireccion")?.value.trim() || "—";
    const referencia = document.getElementById("clienteReferencia")?.value.trim() || "—";
    const fecEmision = document.getElementById("clienteFecEmision")?.value.trim() || "—";
    const fecEntrega = document.getElementById("clienteFecEntrega")?.value.trim() || "—";
    const pedido = document.getElementById("clientePedido")?.value.trim() || "—";

    // === Cuadro de datos del cliente
    const topBox = boxTop + boxHeight + 8;
    const headerHeight = 7;
    const boxHeightCliente = 30;

    doc.setFillColor(200, 0, 0);
    doc.rect(MARGIN_X, topBox, CONTENT_WIDTH, headerHeight, "F");
    doc.setDrawColor(180);
    doc.rect(MARGIN_X, topBox, CONTENT_WIDTH, boxHeightCliente);

    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold").setFontSize(8.5);
    doc.text("DATOS DEL CLIENTE", MARGIN_X + 4, topBox + 4.5);
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(7.2);

    let yPos = topBox + 10;
    const leftClienteX = MARGIN_X + 4;
    const leftValueX = leftClienteX + 28;
    const rightClienteX = MARGIN_X + Math.round(CONTENT_WIDTH * 0.62);
    const spacing = 4;

    // RAZÓN SOCIAL
    doc.setFont("helvetica", "bold");
    doc.text("RAZON SOCIAL :", leftClienteX, yPos);
    doc.setFont("helvetica", "normal");
    const razonLines = doc.splitTextToSize(razonSocial, Math.round(CONTENT_WIDTH * 0.62) - 30);
    doc.text(razonLines, leftValueX, yPos);
    yPos += spacing * razonLines.length;

    // DNI / RUC
    doc.setFont("helvetica", "bold");
    doc.text("DNI/RUC :", leftClienteX, yPos);
    doc.setFont("helvetica", "normal");
    doc.text(dni, leftValueX, yPos);
    yPos += spacing;

    // DIRECCIÓN
    doc.setFont("helvetica", "bold");
    doc.text("DIRECCIÓN :", leftClienteX, yPos);
    doc.setFont("helvetica", "normal");
    const dirLines = doc.splitTextToSize(direccion, Math.round(CONTENT_WIDTH * 0.62) - 30);
    doc.text(dirLines, leftValueX, yPos);
    yPos += spacing * dirLines.length;

    // REFERENCIA
    doc.setFont("helvetica", "bold");
    doc.text("REFERENCIA :", leftClienteX, yPos);
    doc.setFont("helvetica", "normal");
    const refLines = doc.splitTextToSize(referencia, Math.round(CONTENT_WIDTH * 0.62) - 30);
    doc.text(refLines, leftValueX, yPos);
    yPos += spacing * refLines.length;

    // Fechas y pedido a la derecha
    const labelOffset = -10;
    doc.setFont("helvetica", "bold");
    doc.text("FEC.EMISIÓN :", rightClienteX - labelOffset, topBox + 10);
    doc.setFont("helvetica", "normal");
    doc.text(fecEmision, rightClienteX + 35, topBox + 10);

    doc.setFont("helvetica", "bold");
    doc.text("FEC.ENTREGA :", rightClienteX - labelOffset, topBox + 10 + spacing);
    doc.setFont("helvetica", "normal");
    doc.text(fecEntrega, rightClienteX + 35, topBox + 10 + spacing);

    doc.setFont("helvetica", "bold");
    doc.text("PEDIDO :", rightClienteX - labelOffset, topBox + 10 + spacing * 2);
    doc.setFont("helvetica", "normal");
    doc.text(pedido, rightClienteX + 35, topBox + 10 + spacing * 2);

    // === Tabla productos
    const startTableY = topBox + boxHeightCliente + 8;
    const rows = Array.from(resultTable.querySelectorAll("tr")).map((tr, index) => {
      const celdas = Array.from(tr.children).map(td => td.textContent.trim());
      return [
        index + 1,
        celdas[0] || "",
        celdas[1] || "",
        celdas[2] || "",
        celdas[3] || "",
        celdas[4] || "",
        celdas[5] || ""
      ];
    });

    const baseWidths = [10, 22, 70, 14, 20, 18, 26];
    const scale = CONTENT_WIDTH / 180;
    const colWidths = baseWidths.map(w => +(w * scale).toFixed(2));

    const sumCols = colWidths.reduce((a, b) => a + b, 0);
    if (Math.abs(sumCols - CONTENT_WIDTH) > 0.01) {
      const diff = +(CONTENT_WIDTH - sumCols).toFixed(2);
      colWidths[colWidths.length - 1] = +(colWidths[colWidths.length - 1] + diff).toFixed(2);
    }

    doc.autoTable({
      startY: startTableY,
      head: [["ITEM", "COD", "DESCRIPCIÓN", "UM", "PRECIO", "CANT", "SUBTOTAL"]],
      body: rows,
      theme: "grid",
      tableWidth: CONTENT_WIDTH,
      margin: { left: MARGIN_X },
      styles: { fontSize: 7.6, cellPadding: 1.6, overflow: "linebreak", valign: "middle" },
      headStyles: { fillColor: [190, 30, 45], textColor: 255, halign: "center", fontStyle: "bold", fontSize: 8 },
      columnStyles: {
        0: { halign: "center", cellWidth: colWidths[0] },
        1: { halign: "center", cellWidth: colWidths[1] },
        2: { halign: "left",   cellWidth: colWidths[2] },
        3: { halign: "center", cellWidth: colWidths[3] },
        4: { halign: "right",  cellWidth: colWidths[4] },
        5: { halign: "center", cellWidth: colWidths[5] },
        6: { halign: "right",  cellWidth: colWidths[6] }
      }
    });

    // === Total
    let totalGeneral = 0;
    rows.forEach(r => {
      const val = parseFloat(String(r[6]).replace(/[^0-9.\-]/g, ""));
      if (!isNaN(val)) totalGeneral += val;
    });

    const finalY = doc.lastAutoTable ? doc.lastAutoTable.finalY + 6 : startTableY + 50;
    const totalBoxHeight = 22;
    doc.setDrawColor(180).setFillColor(255, 255, 255);
    doc.roundedRect(MARGIN_X, finalY, CONTENT_WIDTH, totalBoxHeight, 2, 2, "F");
    doc.roundedRect(MARGIN_X, finalY, CONTENT_WIDTH, totalBoxHeight, 2, 2);

    let montoLetras = numeroALetras(totalGeneral) || "CERO CON 00/100 SOLES";
    doc.setFont("helvetica", "bold").setFontSize(8);
    doc.text("SON:", MARGIN_X + 5, finalY + 8);
    doc.setFont("helvetica", "normal").setFontSize(8);
    const sonLines = doc.splitTextToSize(montoLetras, CONTENT_WIDTH * 0.55);
    doc.text(sonLines, MARGIN_X + 20, finalY + 8);

    const totalText = Number.isInteger(totalGeneral) ? totalGeneral.toString() : totalGeneral.toFixed(2);
    let fontSize = 11;
    if (totalText.length > 10) fontSize = 9;
    else if (totalText.length > 7) fontSize = 10;

    doc.setFont("helvetica", "bold").setFontSize(10);
    const totalLabelX = PAGE_WIDTH - MARGIN_X - 50;
    doc.text("TOTAL:", totalLabelX, finalY + 8);

    doc.setFontSize(fontSize);
    const totalValueX = PAGE_WIDTH - MARGIN_X - 5;
    doc.text(`S/ ${totalText}`, totalValueX, finalY + 8, { align: "right" });

    // Footer
    doc.setFontSize(7.5).setTextColor(100, 100, 100);
    doc.text("Primavera Distribuidores S.A.C. agradece su preferencia.", MARGIN_X + 5, finalY + 18);

    doc.save(`${codigoPDF}.pdf`);

  } catch (err) {
    console.error("Error generando PDF:", err);
    alert("Error generando PDF. Revisa la consola.");
  }
});


// ==========================================================
// 🔠 Número a letras (simple español)
// ==========================================================
function numeroALetras(num) {
  if (typeof num !== "number") num = parseFloat(num);
  if (isNaN(num)) return "";

  const unidades = [
    "", "UNO", "DOS", "TRES", "CUATRO", "CINCO",
    "SEIS", "SIETE", "OCHO", "NUEVE", "DIEZ",
    "ONCE", "DOCE", "TRECE", "CATORCE", "QUINCE",
    "DIECISÉIS", "DIECISIETE", "DIECIOCHO", "DIECINUEVE", "VEINTE"
  ];

  const decenas = [
    "", "", "VEINTE", "TREINTA", "CUARENTA", "CINCUENTA",
    "SESENTA", "SETENTA", "OCHENTA", "NOVENTA"
  ];

  const centenas = [
    "", "CIENTO", "DOSCIENTOS", "TRESCIENTOS", "CUATROCIENTOS",
    "QUINIENTOS", "SEISCIENTOS", "SETECIENTOS", "OCHOCIENTOS", "NOVECIENTOS"
  ];

  function convertirGrupo(n) {
    let output = "";
    const c = Math.floor(n / 100);
    const d = n % 100;
    const u = n % 10;

    if (n === 0) return "";
    if (n === 100) return "CIEN";
    if (c > 0) output += centenas[c] + " ";

    if (d <= 20) {
      output += unidades[d];
    } else {
      const dec = Math.floor(d / 10);
      output += decenas[dec];
      if (u > 0) output += " Y " + unidades[u];
    }
    return output.trim();
  }

  function seccion(num, divisor, singular, plural) {
    const cantidad = Math.floor(num / divisor);
    const resto = num - cantidad * divisor;
    let letras = "";

    if (cantidad > 0) {
      if (cantidad === 1) letras = singular;
      else letras = numeroALetras(cantidad).replace(" CON 00/100 SOLES", "") + " " + plural;
    }

    return { letras, resto };
  }

  // === Parte entera y decimal ===
  const enteros = Math.floor(num);
  const decimales = Math.round((num - enteros) * 100);

  if (enteros === 0) return `CERO CON ${decimales.toString().padStart(2, "0")}/100 SOLES`;

  let letras = "";

  const millones = seccion(enteros, 1000000, "UN MILLÓN", "MILLONES");
  const miles = seccion(millones.resto, 1000, "MIL", "MIL");
  const cientos = millones.resto % 1000;

  if (millones.letras) letras += millones.letras + " ";
  if (miles.letras) letras += miles.letras + " ";
  if (cientos > 0) letras += convertirGrupo(cientos);

  letras = letras.trim();
  letras += ` CON ${decimales.toString().padStart(2, "0")}/100 SOLES`;

  return letras;
}


const modal = document.getElementById("conexionModal");
const modalTitulo = document.getElementById("modalTitulo");
const modalMensaje = document.getElementById("modalMensaje");
const recargarBtn = document.getElementById("recargarBtn");
const toast = document.getElementById("toastConexion");

// =======================
// Funciones de Modal
// =======================
function mostrarModalConexion(titulo = "⚠ Conexión Fallida", mensaje = "Tu conexión a internet se ha perdido.") {
  modal.style.display = "flex";
  modalTitulo.textContent = titulo;
  modalMensaje.textContent = mensaje;
}

function ocultarModal() {
  modal.style.display = "none";
}

// =======================
// Función de Toast
// =======================
function mostrarToastConexion(mensaje = "✅ Conexión restablecida", duracion = 3000) {
  toast.textContent = mensaje;
  toast.style.display = "block";
  toast.style.opacity = "1";
  setTimeout(() => {
    toast.style.transition = "opacity 0.5s";
    toast.style.opacity = "0";
    setTimeout(() => toast.style.display = "none", 500);
  }, duracion);
}

// =======================
// Botón recargar
// =======================
recargarBtn.addEventListener("click", () => window.location.reload());

// =======================
// Detectar cambios de conexión
// =======================
window.addEventListener("offline", () => {
  if (!navigator.onLine) { // Solo si realmente se perdió la conexión
    mostrarModalConexion();
  }
});

window.addEventListener("online", () => {
  ocultarModal();
  mostrarToastConexion("✅ ¡Conexión restablecida!");
});

// =======================
// Interceptar fetch para errores de red
// =======================
const originalFetch = window.fetch;
window.fetch = async (...args) => {
  try {
    const res = await originalFetch(...args);

    // Revisar si hubo un problema con el contenido (ERR_CONTENT_LENGTH_MISMATCH)
    if (!res.ok && res.status === 0) {
      mostrarModalConexion(
        "⚠ Error de descarga",
        "Un archivo no se pudo descargar completamente. Esto puede ser un problema de internet."
      );
    }

    return res;
  } catch (err) {
    // Solo mostrar modal si estamos offline o hay error explícito
    if (!navigator.onLine || (err.message && err.message.includes("ERR_CONTENT_LENGTH_MISMATCH"))) {
      mostrarModalConexion(
        "⚠ Error de red",
        "No se pudo conectar al servidor. Verifica tu internet."
      );
    }
    throw err;
  }
};

compareBtn.addEventListener("click", () => {
  uploadSection.style.display = "none";
  resultSection.classList.remove("hidden");
  actionButtons.classList.remove("hidden");
});

backBtn.addEventListener("click", () => {
  // Mostrar nuevamente la sección de carga
  uploadSection.style.display = "flex";
  resultSection.classList.add("hidden");
  actionButtons.classList.add("hidden");

  // Limpiar tabla
  document.querySelector("#resultTable tbody").innerHTML = "";

  // Limpiar campos de entrada
  document.getElementById("excelFile1").value = "";
  document.getElementById("excelFile2").value = "";
  document.getElementById("facturaManual").value = "";
  document.getElementById("proformaManual").value = "";

  // (Opcional) Mover scroll arriba del todo
  window.scrollTo({ top: 0, behavior: "smooth" });
});



function detectarDuplicados(excelData) {
  // excelData = array de objetos [{COD: '19057', DESCRIPCION: '...', CANT: 2}, ...]
  let codSet = new Set();
  let hayDuplicados = false;

  excelData.forEach((fila) => {
    let cod = String(fila.COD || fila.codigo || fila.codigoNorm || "").trim(); // Normaliza el código
    if (codSet.has(cod)) {
      hayDuplicados = true; // detectamos al menos un duplicado
    } else {
      codSet.add(cod);
    }
  });

  if (hayDuplicados) {
    // Mostrar toast fijo
    const toast = document.getElementById("toastDuplicado");
    if (toast) {
      toast.style.display = "block";
      setTimeout(() => {
        toast.style.display = "none";
      }, 4000); // desaparece después de 4 segundos
    }
  }
}

// ==========================
// 🔔 Función de Toast
// ==========================
function showToast(message, type = "info") {
  // Crear div si no existe
  let toast = document.getElementById("toastDuplicado");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "toastDuplicado";
    toast.style.position = "fixed";
    toast.style.bottom = "20px";
    toast.style.right = "20px";
    toast.style.padding = "12px 20px";
    toast.style.borderRadius = "6px";
    toast.style.boxShadow = "0 2px 6px rgba(0,0,0,0.3)";
    toast.style.color = "#fff";
    toast.style.zIndex = 9999;
    toast.style.display = "none";
    document.body.appendChild(toast);
  }

  // Colores por tipo
  switch(type) {
    case "success": toast.style.background = "#4BB543"; break;
    case "warning": toast.style.background = "#e7e40b"; break;
    case "error": toast.style.background = "#e74c3c"; break;
    default: toast.style.background = "#3498db"; break;
  }

  toast.textContent = message;
  toast.style.display = "block";

  // Ocultar después de 4 segundos
  setTimeout(() => {
    toast.style.display = "none";
  }, 4000);
}

// ==========================
// 🧹 Normalización de texto
// ==========================
function normalizeForMatch(text) {
  if (!text && text !== 0) return "";
  let s = String(text).normalize("NFKC");
  s = s.replace(/[\u200B-\u200F\uFEFF\u00AD]/g, ""); // invisibles
  s = s.replace(/\u00A0/g, " "); // espacios duros
  s = s.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, ""); // control chars
  s = s.replace(/\s+/g, " ").trim(); // espacios extra
  return s;
}

function escapeForRe(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ==========================
// 🔍 Buscar número de proforma
// ==========================
function findNumberByPrefixInText(rawText, prefix = "002") {
  if (!rawText) return "";

  const txt = normalizeForMatch(rawText).toUpperCase();
  const p = escapeForRe(prefix.toUpperCase());

  const re = new RegExp(
    [
      `(?:PROFORMA\\s*(?:DE)?\\s*(?:VENTA)?\\s*)?`, // opcional
      `(?:N[°º]|NUM(?:ERO)?|NRO)?`,                 // "N°" o "NUMERO"
      `\\s*[:#-\\s]*`,                             // separadores
      `(${p}|00\\d)`,                              // prefijo (002, 003, etc.)
      `[-\\s:/\\\\]*`,                             // separadores
      `(\\d{5,8})`                                 // parte numérica
    ].join(""),
    "i"
  );

  const m = txt.match(re);
  if (m) {
    const parte1 = m[1].toUpperCase();
    const parte2 = m[2].padStart(8, "0");
    return `${parte1}-${parte2}`;
  }

  // fallback simple
  const re2 = new RegExp(`\\b(${p})[-\\s:/\\\\]*(\\d{5,8})\\b`, "i");
  const m2 = txt.match(re2);
  if (m2) return `${m2[1].toUpperCase()}-${m2[2].padStart(8, "0")}`;

  return "";
}

// ==========================
// 🪄 Mostrar número detectado
// ==========================
function mostrarProformaDetectada(numero) {
  const input = document.getElementById("proformaManual");
  if (input) {
    input.value = numero || "";
    proformaNumber = numero || "";
  }
}

document.getElementById("proformaManual").addEventListener("input", (e) => {
  proformaNumber = e.target.value.trim();
});

// ==========================
// 📂 Detectar proforma al subir Excel
// ==========================
document.getElementById("excelFile2").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  try {
    const textoExcel = await leerSoloFila1YShapes(file);

    const numeroDetectado = findNumberByPrefixInText(textoExcel, "002") || "";

    if (numeroDetectado) {
      mostrarProformaDetectada(numeroDetectado);
    } else {
      mostrarProformaDetectada("");
    }
  } catch (err) {
    console.error("❌ Error al procesar Excel de proforma:", err);
  }
});

// ==========================
// 📘 Leer SOLO FILA 1 + Cuadros de texto (shapes)
// ==========================
async function leerSoloFila1YShapes(file) {
  const arrayBuffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuffer);
  let textoTotal = "";

  // 1️⃣ Leer solo la fila 1 de cada hoja
  const data = new Uint8Array(arrayBuffer);
  const workbook = XLSX.read(data, { type: "array" });

  workbook.SheetNames.forEach((nombreHoja) => {
    const hoja = workbook.Sheets[nombreHoja];
    const json = XLSX.utils.sheet_to_json(hoja, { header: 1 });
    if (json.length > 0 && json[0].length > 0) {
      textoTotal += json[0].join(" ") + " ";
    }
  });

  // 2️⃣ Leer cuadros de texto (shapes)
  const drawingFiles = Object.keys(zip.files).filter(f => f.match(/xl\/drawings\/drawing\d+\.xml$/));
  for (const fileName of drawingFiles) {
    try {
      const xmlText = await zip.file(fileName).async("text");
      const shapeTexts = Array.from(xmlText.matchAll(/<a:t[^>]*>([^<]+)<\/a:t>/g))
        .map(m => m[1])
        .join(" ");
      textoTotal += " " + shapeTexts;
    } catch (err) {
      console.warn("⚠ No se pudo leer shape:", fileName, err);
    }
  }

  return textoTotal;
}


// ==========================
// 🔍 Buscar número de factura/boleta/NotaPedido
// ==========================

function findFacturaNumber(rawText) {
  if (!rawText) return "";

  const txt = normalizeForMatch(rawText).toUpperCase();

  // Patrones de detección
  const patrones = [
    /(BV0\d)[-\s:/\\]*(\d{5,8})/,  // Boleta BV02-00042050
    /(FF0\d)[-\s:/\\]*(\d{5,8})/,  // Factura FF02-00016865
    /\b(2)[-\s:/\\]*(\d{5,8})\b/   // Nota de pedido 2-00004816
  ];

  for (const re of patrones) {
    const m = txt.match(re);
    if (m) {
      const prefijo = m[1].toUpperCase();
      const numero = m[2].padStart(8, "0");
      return `${prefijo}-${numero}`;
    }
  }

  return "";
}

// ==========================
// 🪄 Mostrar número detectado
// ==========================
function mostrarFacturaDetectada(numero) {
  const input = document.getElementById("facturaManual");
  if (input) {
    input.value = numero || "";
    facturaNumber = numero || "";
  }
}

// 🖊 Si el usuario edita manualmente
document.getElementById("facturaManual").addEventListener("input", (e) => {
  facturaNumber = e.target.value.trim();
});

// ==========================
// 📂 Detectar factura/boleta/nota al subir Excel
// ==========================
document.getElementById("excelFile1").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  try {
    const textoExcel = await leerSoloFila1YShapes(file);

    const numeroDetectado = findFacturaNumber(textoExcel) || "";

    if (numeroDetectado) {
      mostrarFacturaDetectada(numeroDetectado);
    } else {
      mostrarFacturaDetectada("");
    }
  } catch (err) {
    console.error("❌ Error al procesar Excel del documento:", err);
  }
});