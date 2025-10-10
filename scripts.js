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
// 🧠 Evento principal de comparación
// ==========================
compareBtn.addEventListener("click", async () => {
  const modeloFile = document.getElementById("excelFile1").files[0];
  const maestroFile = document.getElementById("excelFile2").files[0];
  const facturaInput = document.getElementById("facturaManual"); // ✅ corregido id

  if (!modeloFile || !maestroFile) {
    alert("Por favor, selecciona ambos archivos Excel.");
    return;
  }

  const modeloData = await extractDataFromExcel(modeloFile);
  const maestroData = await extractDataFromExcel(maestroFile);

  modeloCodes = modeloData.codes;
  maestroCodes = maestroData.codes;
  clienteData = maestroData.clienteData || {};

    // ==========================
    // 💡 Tomar número de factura desde el input
    // ==========================
    facturaNumber = facturaInput.value.trim(); // ✅ sin const/let
    if (!facturaNumber) {
    alert("Por favor, ingresa el número de factura.");
    return;
    }

  // ==========================
// 💡 Buscar número de proforma (sigue igual)
// ==========================
const modeloText = (modeloData.rawText || (modeloData.rawCells || []).join(" ")).toString();
const maestroText = (maestroData.rawText || (maestroData.rawCells || []).join(" ")).toString();

const normalizeForMatch = (text) => {
  if (!text && text !== 0) return "";
  let s = String(text).normalize("NFKC");
  s = s.replace(/[\u200B-\u200F\uFEFF\u00AD]/g, "");
  s = s.replace(/\u00A0/g, " ");
  s = s.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, "");
  s = s.replace(/\s+/g, " ").trim();
  return s;
};

const escapeForRe = (s) => String(s).replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");

function findNumberByPrefixInText(rawText, prefix) {
  if (!rawText) return null;
  const txt = normalizeForMatch(rawText).toUpperCase();
  const p = escapeForRe(prefix.toUpperCase());
  const re = new RegExp("\\b(" + p + ")[-\\s\\/\\:\\u2013\\u2014]?0*(\\d{3,})\\b", "i");
  const m = txt.match(re);
  if (m) return `${m[1].toUpperCase()}-${m[2]}`;
  return "";
}

proformaNumber =
  findNumberByPrefixInText(maestroText, "002") ||
  findNumberByPrefixInText(modeloText, "002") ||
  "";

console.log("Factura (manual):", facturaNumber);
console.log("Proforma detectada:", proformaNumber || "(no detectada)");

    // Función para limpiar códigos: deja solo dígitos
    function normalizeCodigo(codigo) {
    return String(codigo).replace(/\D/g, "");
    }

  // ==========================
  // 🔎 Comparar códigos
  // ==========================
    const faltantes = maestroCodes.filter(
        (code) => !modeloCodes.some(
            (c) => normalizeCodigo(c.codigo) === normalizeCodigo(code.codigo)
        )
    );


  mostrarResultados(faltantes);
});


// ==========================
// 📊 Extraer datos desde Excel (seguro, escanea todas las hojas)
// ==========================
async function extractDataFromExcel(file) {
  const data = await file.arrayBuffer();
  const workbook = XLSX.read(data, { type: "array" });

  // clean function
  const cleanVal = (val) => (val || val === 0 ? String(val).replace(/^:\s*/, "").trim() : "");

  // clienteData extraído desde la primera hoja (igual que antes)
  const firstSheetName = workbook.SheetNames[0];
  const firstSheet = workbook.Sheets[firstSheetName];
  const firstJson = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: "" });
  const readHI = (rowIndex, jsonData) => {
    const valH = cleanVal(jsonData[rowIndex]?.[7]);
    const valI = cleanVal(jsonData[rowIndex]?.[8]);
    if (valH && !["EMAIL", "IMAL"].includes(valH.toUpperCase())) return valH;
    if (valI && !["EMAIL", "IMAL"].includes(valI.toUpperCase())) return valI;
    return "";
  };
  const clienteDataLocal = {
    razon: cleanVal(firstJson[2]?.[3]),
    dni: cleanVal(firstJson[3]?.[3]),
    direccion: cleanVal(firstJson[4]?.[3]),
    referencia: cleanVal(firstJson[5]?.[3]),
    entrega: cleanVal(firstJson[6]?.[3]),
    contacto: cleanVal(firstJson[7]?.[3]),
    fecEmision: readHI(2, firstJson),
    fecEntrega: readHI(4, firstJson),
    pedido: readHI(5, firstJson)
  };

  // recorrer todas las hojas para construir rawCells/rawText y cellsInfo, y detectar códigos si hay headers
  const allRaw = [];
  const cellsInfo = []; // { sheet, addr, text }
  const codes = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

    // recorrer celdas por fila/col
    for (let r = 0; r < jsonData.length; r++) {
      const row = jsonData[r] || [];
      for (let c = 0; c < row.length; c++) {
        const raw = cleanVal(row[c]);
        if (raw !== "") {
          allRaw.push(raw);
          // también guardamos dirección aproximada (fila/col) para debug; addr opcional
          cellsInfo.push({ sheet: sheetName, addr: `R${r+1}C${c+1}`, text: raw });
        }
      }
    }

    // intentar extraer códigos si la hoja contiene la estructura de tabla (encabezado en fila 11 -> índice 10)
    const headersRow = jsonData[10] || [];
    const headers = headersRow.map(h => (h ? String(h).trim().toUpperCase() : ""));
    if (headers.length && !headers.every(h => h === "")) {
      const findSafeIndex = (keyword) => headers.findIndex(h => h && h.includes(keyword));
      const idxCodigo = findSafeIndex("COD");
      const idxDescripcion = findSafeIndex("DES");
      const idxUM = findSafeIndex("UM");
      const idxPrecio = findSafeIndex("PRECIO");
      const idxCantidad = findSafeIndex("CANT");
      const idxSubtotal = findSafeIndex("SUB");

      if (idxCodigo >= 0) {
        for (let i = 11; i < jsonData.length; i++) {
          const row = jsonData[i];
          if (!row || row.every(cell => cell === undefined || cell === null || String(cell).trim() === "")) continue;
          const codigo = cleanVal(row[idxCodigo]);
          const descripcion = cleanVal(row[idxDescripcion]);
          const um = cleanVal(row[idxUM]);
          const precio = cleanVal(row[idxPrecio]);
          const cantidad = cleanVal(row[idxCantidad]);
          const subtotal = cleanVal(row[idxSubtotal]);
          if (codigo) {
            codes.push({ codigo, descripcion, um, precio, cantidad, subtotal });
          }
        }
      }
    }
  }

  const rawText = allRaw.join(" ").replace(/\s+/g, " ").trim();

  return { clienteData: clienteDataLocal, codes, rawCells: allRaw, rawText, cellsInfo };
}


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
      tdCodigo.textContent = item.codigo;
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

      row.append(tdCodigo, tdDescripcion, tdUM, tdPrecio, tdCantidad, tdSubtotal);
      resultTable.appendChild(row);
    });
  }

  resultSection.classList.remove("hidden");
  downloadBtn.classList.remove("hidden");
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

// ==========================
// ✨ Ejemplo de uso
// ==========================
async function generarCodigoPDF() {
  const nuevoContador = await incrementarContador();
  const codigoFormateado = formatearCodigo(nuevoContador);

  console.log("Nuevo código PDF:", codigoFormateado);
  return codigoFormateado;
}


// Evento de descarga PDF
downloadBtn.addEventListener("click", async () => {
  try {
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
    let logoImg = null;
    try {
      const logoUrl = "img/logo.jpg";
      const blob = await fetch(logoUrl).then(r => r.blob());
      logoImg = await new Promise(resolve => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(blob);
      });
    } catch (e) {
      console.warn("Logo no cargado:", e);
    }
    if (logoImg) doc.addImage(logoImg, "JPG", MARGIN_X - 3, headerTop, 26, 26);

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

    // FACTURA
    doc.setFont("helvetica", "bold").setFontSize(10);
    doc.text("Factura Electrónica", rightX, titleY, { align: "right" });
    doc.setFont("helvetica", "normal").setFontSize(9);
    doc.text(facturaNumber || "-", rightX, numberY, { align: "right" });

    // Línea roja separadora
    doc.setDrawColor(190, 30, 45);
    doc.line(MARGIN_X + 5, boxTop + boxHeight - 5, PAGE_WIDTH - MARGIN_X - 5, boxTop + boxHeight - 5);
    doc.setFontSize(8).setTextColor(80, 80, 80);
    doc.text("Factura ligada directamente a la Proforma indicada arriba.", PAGE_WIDTH / 2, boxTop + boxHeight - 1, { align: "center" });

    // ========================
    // PREPROCESADO DEL CLIENTE
    // ========================
    const rawC = clienteData ? { ...clienteData } : {};
    const preferOrder = [
      "razonLinea1","razonLinea2","razon","nombre","apellido",
      "dni","dniRuc","ruc",
      "direccion","referencia","entrega","direccionEntrega",
      "contacto","telefono","tel","cel","celular",
      "fecEmision","fecEntrega","pedido"
    ];

    const items = [];
    const seen = new Set();
    for (const k of preferOrder) {
      if (rawC[k] !== undefined && rawC[k] !== null) {
        const v = String(rawC[k]).trim();
        if (v !== "") { items.push({ key: k, value: v }); seen.add(k); }
      }
    }
    // añadir el resto de keys que no estaban en preferOrder
    for (const k in rawC) {
      if (!seen.has(k) && rawC[k] != null) {
        const v = String(rawC[k]).trim();
        if (v !== "") items.push({ key: k, value: v });
      }
    }

    // Target fields
    const target = {
      razonLines: [], // array de líneas
      dni: "",
      direccion: "",
      referencia: "",
      direccionEntrega: "",
      fecEmision: rawC.fecEmision || rawC.fecEmisión || rawC.fec_emision || "",
      fecEntrega: rawC.fecEntrega || rawC.fec_entrega || "",
      pedido: rawC.pedido || ""
    };

    // Util helpers
    const extractLongNumber = s => {
      const m = String(s).match(/\d{8,}/); // 8+ dígitos (DNI 8, RUC 11)
      return m ? m[0] : null;
    };
    
    const looksLikeAddress = s => {
      return /\b(CALLE|AV|AVENIDA|JR|JIRON|URB|#|PASA|PSJE|PARAJE)\b/i.test(s) || /#\d+/.test(s);
    };
    const looksLikeSchedule = s => {
      return /\b(AM|PM|HORARIO|ATENCI[ÓO]N|ATENCION)\b/i.test(s);
    };
    const looksLikeDate = s => {
      return /\b\d{2}\/\d{2}\/\d{4}\b/.test(s) || /\b\d{4}-\d{2}-\d{2}\b/.test(s);
    };

    // Primer pase: clasificar valores
    for (const it of items) {
      const v0 = String(it.value).trim();
      if (!v0) continue;
      const v = v0;

      // fechas
      if (looksLikeDate(v)) {
        if (!target.fecEmision) target.fecEmision = (v.match(/\d{2}\/\d{2}\/\d{4}/) || [v])[0];
        else if (!target.fecEntrega) target.fecEntrega = (v.match(/\d{2}\/\d{2}\/\d{4}/) || [v])[0];
        continue;
      }

      // número largo (DNI / RUC)
      const longNum = extractLongNumber(v);
      if (longNum) {
        if (!target.dni) {
          target.dni = longNum;
          // quitar ese número del string original para ver si queda texto (direccion u otra cosa)
          const remainder = v.replace(longNum, "").replace(/\s{2,}/g, " ").trim();
          if (remainder) {
            // si queda texto y parece dirección -> asignar
            if (looksLikeAddress(remainder)) {
              if (!target.direccion) target.direccion = remainder;
              else if (!target.direccionEntrega) target.direccionEntrega = remainder;
            } else if (looksLikeSchedule(remainder)) {
              if (!target.referencia) target.referencia = remainder;
            } else {
              // si no parece dirección ni horario, podríamos tratar como referencia o parte del nombre:
              // si el resto es totalmente alfabetico, tratarlo como segunda línea de razón
              if (/^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ\s]+$/.test(remainder)) {
                target.razonLines.push(remainder);
              } else {
                if (!target.referencia) target.referencia = remainder;
                else if (!target.direccion) target.direccion = remainder;
              }
            }
          }
        } else {
          // ya tenemos dni, entonces este número probablemente es parte de otra cosa (ej: referencia con números)
          // si parece dirección, asignarla
          if (looksLikeAddress(v)) {
            if (!target.direccion) target.direccion = v;
            else if (!target.direccionEntrega) target.direccionEntrega = v;
          } else {
            if (!target.referencia) target.referencia = v;
          }
        }
        continue;
      }

      // horario / referencia
      if (looksLikeSchedule(v)) {
        if (!target.referencia) target.referencia = v;
        else target.referencia += " / " + v;
        continue;
      }

      // direcciones (por palabras clave)
      if (looksLikeAddress(v)) {
        if (!target.direccion) target.direccion = v;
        else if (!target.direccionEntrega) target.direccionEntrega = v;
        else if (!target.referencia) target.referencia = v;
        continue;
      }

      // si es claramente un pedido
      if (/CORRIENTE|PEDIDO|ORDER|PEDIDO/i.test(v) && !target.pedido) {
        target.pedido = v;
        continue;
      }

      // nombres / razón social: todo lo que quede alfabético y no clasificado
      if (/^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ\.\s]+$/.test(v) && v.length > 2) {
        target.razonLines.push(v);
        continue;
      }

      // fallback: si no se clasificó, intentar colocarlo en referencia o direccion según el contenido
      if (!target.referencia) target.referencia = v;
      else if (!target.direccion) target.direccion = v;
      else if (!target.direccionEntrega) target.direccionEntrega = v;
    }

    // Si no se obtuvieron líneas de razón y existe rawC.razon con palabras, intentar separarlo en 2 líneas:
    if (target.razonLines.length === 0 && rawC.razon) {
      const r = String(rawC.razon).trim();
      // si el final es una sola palabra (ej. "EMPERATRIZ"), dividir la última palabra en segunda línea
      const m = r.match(/(.+)\s+([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{2,})$/);
      if (m) {
        target.razonLines.push(m[1].trim());
        target.razonLines.push(m[2].trim());
      } else {
        target.razonLines.push(r);
      }
    }

    // Normalizar: si hay >2 líneas, unir las extras en la primera línea (según diseño)
    if (target.razonLines.length > 2) {
      const first = target.razonLines.slice(0, target.razonLines.length - 1).join(" ");
      const last = target.razonLines[target.razonLines.length - 1];
      target.razonLines = [first, last];
    }

    // Si no encontramos dni pero hay campos comunes (ej: rawC.dni está no vacío y alfabético), intentar extraer dígitos ahí
    if (!target.dni && rawC.dni) {
      const maybe = extractLongNumber(String(rawC.dni));
      if (maybe) target.dni = maybe;
    }

    // Limpieza final: si dirección está vacía pero referencia contiene la dirección, moverla
    if (!target.direccion && target.referencia && looksLikeAddress(target.referencia)) {
      target.direccion = target.referencia;
      target.referencia = "";
    }

    // =========================
    // === Cuadro de datos del cliente (impresión usando target)
    // =========================
    const topBox = boxTop + boxHeight + 8;
    const headerHeight = 7;
    const boxHeightCliente = 36;

    doc.setFillColor(200, 0, 0);
    doc.rect(MARGIN_X, topBox, CONTENT_WIDTH, headerHeight, "F");
    doc.setDrawColor(180);
    doc.rect(MARGIN_X, topBox, CONTENT_WIDTH, boxHeightCliente);

    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold").setFontSize(8.5);
    doc.text("DATOS DEL CLIENTE", MARGIN_X + 4, topBox + 4.5);
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(7.2);

    // coordenadas y cálculo de espacios
    let yPos = topBox + 10;
    const leftClienteX = MARGIN_X + 4;
    const leftValueX = leftClienteX + 28;
    const rightClienteX = MARGIN_X + Math.round(CONTENT_WIDTH * 0.62);
    const spacing = 4;

    // =========================
    // Función auxiliar para limpiar campos y evitar duplicados
    // =========================
    function limpiarCampo(valor, comparaciones = []) {
      if (!valor || valor.toString().trim() === "") return "—";
      const limpio = valor.toString().trim();
      for (const cmp of comparaciones) {
        if (cmp && limpio.toUpperCase() === cmp.toString().trim().toUpperCase()) {
          return "—";
        }
      }
      return limpio;
    }

    // =========================
    // Preparar valores ya filtrados (pedido primero 🔥)
    // =========================
    const razonLinesOriginal = target.razonLines && target.razonLines.length ? target.razonLines : [];
    const razonTexto = razonLinesOriginal.join(" ").trim() || "—";
    const dni = limpiarCampo(target.dni);
    const direccion = limpiarCampo(target.direccion);
    const pedido = limpiarCampo(target.pedido); // 👉 prioridad
    const referencia = limpiarCampo(target.referencia, [pedido]); // 👉 evita duplicar pedido
    const direccionEntrega = limpiarCampo(target.direccionEntrega);
    const fecEmision = limpiarCampo(target.fecEmision);
    const fecEntrega = limpiarCampo(target.fecEntrega);

    // =========================
    // RAZON SOCIAL (1 o 2 líneas)
    // =========================
    doc.setFont("helvetica", "bold");
    doc.text("RAZON SOCIAL :", leftClienteX, yPos);
    doc.setFont("helvetica", "normal");

    if (razonLinesOriginal.length >= 2) {
      doc.text(razonLinesOriginal, leftValueX, yPos);
      yPos += spacing * razonLinesOriginal.length;
    } else {
      const razonPrinted = doc.splitTextToSize(razonTexto, Math.round(CONTENT_WIDTH * 0.62) - 30);
      doc.text(razonPrinted, leftValueX, yPos);
      yPos += spacing * razonPrinted.length;
    }

    // =========================
    // DNI / RUC
    // =========================
    doc.setFont("helvetica", "bold");
    doc.text("DNI/RUC :", leftClienteX, yPos);
    doc.setFont("helvetica", "normal");
    doc.text(dni, leftValueX, yPos);
    yPos += spacing;

    // =========================
    // DIRECCIÓN PRINCIPAL
    // =========================
    doc.setFont("helvetica", "bold");
    doc.text("DIRECCIÓN :", leftClienteX, yPos);
    doc.setFont("helvetica", "normal");
    const direccionLines = doc.splitTextToSize(direccion, Math.round(CONTENT_WIDTH * 0.62) - 30);
    doc.text(direccionLines, leftValueX, yPos);
    yPos += spacing * direccionLines.length;

    // =========================
    // REFERENCIA
    // =========================
    doc.setFont("helvetica", "bold");
    doc.text("REFERENCIA :", leftClienteX, yPos);
    doc.setFont("helvetica", "normal");
    const referenciaLines = doc.splitTextToSize(referencia, Math.round(CONTENT_WIDTH * 0.62) - 30);
    doc.text(referenciaLines, leftValueX, yPos);
    yPos += spacing * referenciaLines.length;

    // =========================
    // DIRECCIÓN ENTREGA
    // =========================
    doc.setFont("helvetica", "bold");
    doc.text("DIREC. ENTREGA :", leftClienteX, yPos);
    doc.setFont("helvetica", "normal");
    const direccionEntregaLines = doc.splitTextToSize(direccionEntrega, Math.round(CONTENT_WIDTH * 0.62) - 30);
    doc.text(direccionEntregaLines, leftValueX, yPos);
    yPos += spacing * direccionEntregaLines.length;

    // =========================
    // Lado derecho: fechas + pedido (ajustado hacia la izquierda)
    // =========================
    const labelOffset = -10; // ajusta este valor para mover solo las etiquetas

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

    // ajuste por redondeo
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
    if (isNaN(totalGeneral)) totalGeneral = 0;

    // === Bloque final
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

    const nombreArchivo = `${codigoPDF}.pdf`;
    doc.save(nombreArchivo);

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

  // (Opcional) Mover scroll arriba del todo
  window.scrollTo({ top: 0, behavior: "smooth" });
});
