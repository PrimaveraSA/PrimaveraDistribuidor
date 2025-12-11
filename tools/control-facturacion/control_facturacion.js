import { supabase } from "../../js/DB.js";

function initGeneradorControlFacturacion() {

    if (window._controlFacturacionInicializado) return;
    window._controlFacturacionInicializado = true;

    const compareBtn = document.getElementById("compareBtn");
    const resultTable = document.querySelector("#resultTable tbody");
    const downloadBtn = document.getElementById("downloadBtn");
    const backBtn = document.getElementById("backBtn");
    let modeloCodes = [];      // Factura - menos productos
    let maestroCodes = [];     // Proforma - más productos
    let clienteData = {};      // Datos del cliente (de Excel maestro)
    let proformaNumber = "";   // e.g. "002-00065088"
    let facturaNumber = "";    // e.g. "FF02-00016865"

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

    compareBtn.addEventListener("click", async () => {
        const modeloFile = document.getElementById("excelFile1").files[0];
        const maestroFile = document.getElementById("excelFile2").files[0];
        const facturaInput = document.getElementById("facturaManual");
        const proformaManual = document.getElementById("proformaManual");

        // === Validaciones iniciales ===
        if (!modeloFile || !maestroFile) {
            showToast("Por favor, selecciona ambos archivos Excel.", "error");
            return;
        }

        // === Leer ambos archivos Excel ===
        const modeloData = await extractDataFromExcel(modeloFile);
        const maestroData = await extractDataFromExcel(maestroFile);

        const modeloText = (modeloData.rawText || (modeloData.rawCells || []).join(" ")).toString();
        const maestroText = (maestroData.rawText || (maestroData.rawCells || []).join(" ")).toString();

        // === Detectar proforma/SP automáticamente (priorizar SP) ===
        let proformaNumber =
            findSaldoProformaNumberInText(maestroText) ||
            findSaldoProformaNumberInText(modeloText) ||
            findNumberByPrefixInText(maestroText, "002") ||
            findNumberByPrefixInText(modeloText, "002") ||
            "";

        if (!proformaNumber) {
            showToast("No se detectó número de proforma automáticamente.", "warning");
        } else if (proformaManual && proformaManual.value.trim() === "") {
            // Solo asigna si el campo está vacío
            proformaManual.value = proformaNumber;
        }

        // === Extraer datos de códigos y cliente ===
        modeloCodes = modeloData.codes || [];
        maestroCodes = maestroData.codes || [];

        const baseProformaNumber = findNumberByPrefixInText(maestroText, "002") || findNumberByPrefixInText(modeloText, "002") || "";

        const esSP = (v) => !!(v && String(v).toUpperCase().startsWith("SP"));
        const preferModelo = esSP(proformaNumber) || /\bSP\b|SALDOS?\s*DE\s*PROFORMA/i.test(maestroText);
        const mergeCliente = (a = {}, b = {}) => {
            const keys = ["razon","dni","direccion","referencia","entrega","contacto","fecEmision","fecEntrega","pedido"];
            const out = {};
            keys.forEach(k => out[k] = (preferModelo ? a[k] : b[k]) || "");
            keys.forEach(k => { if (!out[k]) out[k] = (preferModelo ? b[k] : a[k]) || ""; });
            const same = out.razon && out.direccion && out.razon.trim().toUpperCase() === out.direccion.trim().toUpperCase();
            if (same && ((preferModelo ? b.razon : a.razon))) out.razon = (preferModelo ? b.razon : a.razon);
            const dniOk = /\b\d{11}\b|\b\d{8}\b/.test(out.dni || "");
            if (!dniOk) out.dni = (preferModelo ? b.dni : a.dni) || out.dni;
            return out;
        };
        clienteData = mergeCliente(modeloData.clienteData, maestroData.clienteData);

        // === Validar número de factura ===
        const facturaNumber = facturaInput.value.trim();
        if (!facturaNumber) {
            showToast("Por favor, ingresa el número de factura.", "error");
            return;
        }

        // === Rellenar datos de cliente (si existen) ===
        rellenarFormularioCliente(clienteData);

        // Guardar para PDF encabezados dinámicos
        window.__baseProformaNumber = baseProformaNumber;
        window.__esSPDocumento = esSP(proformaNumber);

        const normalizeLocal = v => normalizeCodigo(v);

        detectarDuplicados(modeloCodes, "Factura/Boleta/Nota de Pedido");
        detectarDuplicados(maestroCodes, "Proforma");

        const modeloSet = new Set(modeloCodes
            .map(c => normalizeLocal(c.codigoNorm || c.codigo || ""))
            .filter(Boolean));
        const maestroSet = new Set(maestroCodes
            .map(c => normalizeLocal(c.codigoNorm || c.codigo || ""))
            .filter(Boolean));

        const faltantesEnFactura = maestroCodes
            .filter(code => {
                const nc = normalizeLocal(code.codigoNorm || code.codigo || "");
                return nc && !modeloSet.has(nc);
            })
            .map(c => ({ ...c, _origen: "PROFORMA_SIN_FACTURA" }));

        const noRegistradosEnProforma = modeloCodes
            .filter(code => {
                const nc = normalizeLocal(code.codigoNorm || code.codigo || "");
                return nc && !maestroSet.has(nc);
            })
            .map(c => ({ ...c, _origen: "FACTURA_SIN_PROFORMA" }));

        const normalizeUM = (v) => {
            const s = String(v || "").toUpperCase().replace(/[\s\.;:_-]+/g, " ").trim();
            if (!s) return "";
            if (/^UN(\.|IDAD|ID)?$/i.test(s) || /^UND$/i.test(s)) return "UNIDAD";
            return s;
        };

        const modeloMap = new Map();
        modeloCodes.forEach(c => {
            const k = normalizeLocal(c.codigoNorm || c.codigo || "");
            if (k) modeloMap.set(k, c);
        });
        const maestroMap = new Map();
        maestroCodes.forEach(c => {
            const k = normalizeLocal(c.codigoNorm || c.codigo || "");
            if (k) maestroMap.set(k, c);
        });

        const umDiferentes = [];
        modeloSet.forEach(k => {
            if (maestroSet.has(k)) {
                const a = modeloMap.get(k) || {};
                const b = maestroMap.get(k) || {};
                const ua = normalizeUM(a.um);
                const ub = normalizeUM(b.um);
                if (ua && ub && ua !== ub) {
                    umDiferentes.push({
                        codigo: a.codigo || b.codigo,
                        codigoNorm: k,
                        descripcion: a.descripcion || b.descripcion || "",
                        um: ub,
                        precio: b.precio || a.precio || "",
                        cantidad: b.cantidad || a.cantidad || "",
                        subtotal: b.subtotal || a.subtotal || "",
                        _origen: "UM_DIFERENTE",
                        _um_modelo: ua,
                        _um_maestro: ub
                    });
                }
            }
        });

        const merged = [...faltantesEnFactura, ...noRegistradosEnProforma, ...umDiferentes];
        const mapByCode = new Map();
        merged.forEach(item => {
            const key = normalizeLocal(item.codigoNorm || item.codigo || "");
            if (!key) return;
            if (!mapByCode.has(key)) {
                mapByCode.set(key, item);
            } else {
                const existing = mapByCode.get(key);
                existing._origen = existing._origen === item._origen ? existing._origen : `${existing._origen}|${item._origen}`;
            }
        });

        const coincidencias = Array.from(modeloSet).filter(k => maestroSet.has(k)).length;
        const faltantesTotales = Array.from(mapByCode.values());

        mostrarResultados(faltantesTotales);
        downloadBtn.removeAttribute("disabled");
        const selectorFilas = document.getElementById("rowsPerPage2");
        if (selectorFilas) selectorFilas.value = "todos";
        aplicarPaginacionTabla();

        const resumen = `Coinciden: ${coincidencias} | Faltan en Excel 1: ${noRegistradosEnProforma.length} | Faltan en Excel 2: ${faltantesEnFactura.length} | UM diferentes: ${umDiferentes.length} | Total a mostrar: ${faltantesTotales.length}`;
        showToast(resumen, "info");
    });


    // ==========================
    // Mostrar resultados en tabla
    // ==========================
    function mostrarResultados(faltantes) {
        const resultTableBody = document.querySelector("#resultTable tbody");
        if (!resultTableBody) {
            return;
        }

        resultTableBody.innerHTML = "";

        if (!faltantes || faltantes.length === 0) {
            resultTableBody.innerHTML = `
                <tr>
                    <td colspan="7" class="text-center text-muted">
                        No hay productos faltantes o inesperados.
                    </td>
                </tr>`;
            return;
        }

        faltantes.forEach(item => {
            const row = document.createElement("tr");

            // === Celdas ===
            const tdCodigo = document.createElement("td");
            tdCodigo.textContent = item.codigoNorm || normalizeCodigo(item.codigo) || item.codigo || "";
            makeCellLocked(tdCodigo);

            const tdDescripcion = document.createElement("td");
            tdDescripcion.textContent = item.descripcion || "";
            makeCellLocked(tdDescripcion);

            const tdUM = document.createElement("td");
            tdUM.textContent = item.um || "";
            tdUM.contentEditable = "true";
            tdUM.addEventListener("input", () => recalcularSubtotal(row));

            const tdPrecio = document.createElement("td");
            tdPrecio.textContent = item.precio || "";
            tdPrecio.contentEditable = "true";
            tdPrecio.addEventListener("input", () => recalcularSubtotal(row));

            const tdCantidad = document.createElement("td");
            tdCantidad.textContent = item.cantidad || "";
            tdCantidad.contentEditable = "true";
            tdCantidad.addEventListener("input", () => recalcularSubtotal(row));

            const tdSubtotal = document.createElement("td");
            const subSpan = document.createElement("span");
            subSpan.className = "cell-value";
            subSpan.textContent = item.subtotal || "0.00";
            tdSubtotal.appendChild(subSpan);
            makeCellLocked(tdSubtotal);

            const tdAcciones = document.createElement("td");
            tdAcciones.classList.add("actions-cell"); // <---- agregar clase para centrar
            const btnDelete = document.createElement("button");
            btnDelete.textContent = "X";
            btnDelete.classList.add("btn-close-professional");
            btnDelete.addEventListener("click", () => row.remove());
            tdAcciones.appendChild(btnDelete);

            // === Ensamblar la fila ===
            row.append(tdCodigo, tdDescripcion, tdUM, tdPrecio, tdCantidad, tdSubtotal, tdAcciones);
            resultTableBody.appendChild(row);

            // Recalcular subtotal inicial
            recalcularSubtotal(row);
        });
    }

    // ==========================
    // Extraer datos desde Excel
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
    // CLIENTE DATA AUTOMÁTICO (Hoja 1)
    // ===============================
    const firstSheetName = workbook.SheetNames[0];
    const firstSheet = workbook.Sheets[firstSheetName];
    const firstJson = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: "" });

    const findRightValue = (row, startIdx) => {
        for (let c = startIdx + 1; c <= startIdx + 3 && c < row.length; c++) {
            const v = cleanVal(row[c]);
            if (v) return v.replace(/^:\s*/, "");
        }
        const self = cleanVal(row[startIdx]);
        const m = self.match(/:\s*(.+)$/);
        return m ? m[1].trim() : "";
    };

    // Detectar inicio de la sección "DATOS DEL CLIENTE" para evitar capturar el header de la empresa
    let sectionStart = 0;
    for (let r = 0; r < Math.min(firstJson.length, 60); r++) {
        const rowText = (firstJson[r] || []).map(x => cleanVal(x)).join(" ").toUpperCase();
        if (rowText.includes("DATOS DEL CLIENTE")) { sectionStart = r; break; }
    }

    const labels = [
        { key: "razon", re: /RAZON\s*SOCIAL/i },
        { key: "dni", re: /DNI\s*\/\s*RUC|DNI|RUC/i },
        { key: "direccion", re: /DIRECCI[ÓO]N(?!\s*ENTREGA)/i },
        { key: "referencia", re: /REFERENCIA/i },
        { key: "entrega", re: /DIRECCI[ÓO]N\s*ENTREGA/i },
        { key: "contacto", re: /(TEL|CEL|TEL\/CEL)/i },
        { key: "fecEmision", re: /FEC\.?\s*EMISI[ÓO]N/i },
        { key: "fecEntrega", re: /FEC\.?\s*ENTREGA/i },
        { key: "pedido", re: /PEDIDO/i }
    ];

    const extracted = { razon: "", dni: "", direccion: "", referencia: "", entrega: "", contacto: "", fecEmision: "", fecEntrega: "", pedido: "" };

    for (let r = sectionStart; r < Math.min(firstJson.length, sectionStart + 40); r++) {
        const row = firstJson[r] || [];
        for (let c = 0; c < Math.min(row.length, 12); c++) {
            const cell = cleanVal(row[c]);
            if (!cell) continue;
            const upper = cell.toUpperCase();
            for (const lab of labels) {
                if (lab.re.test(upper)) {
                    let val = findRightValue(row, c);
                    if (lab.key === "fecEmision" || lab.key === "fecEntrega") val = validarFecha(val);
                    if (val && !extracted[lab.key]) extracted[lab.key] = val;
                }
            }
        }
    }

    if (!extracted.direccion) {
        for (let r = 0; r < Math.min(firstJson.length, 40); r++) {
            const row = firstJson[r] || [];
            for (let c = 0; c < Math.min(row.length, 12); c++) {
                const cell = cleanVal(row[c]);
                if (/DIRECCI[ÓO]N(?!\s*ENTREGA)/i.test(cell || "")) {
                    const part1 = findRightValue(row, c);
                    const nextRow = firstJson[r + 1] || [];
                    const part2 = findRightValue(nextRow, c);
                    extracted.direccion = [part1, part2].filter(Boolean).join(" ");
                }
            }
        }
    }

    // Sanitizar DNI/RUC: extraer solo 8 o 11 dígitos
    const pickDniRuc = (raw) => {
        const txt = cleanVal(raw);
        const m = txt.match(/\b\d{11}\b|\b\d{8}\b/);
        return m ? m[0] : "";
    };
    extracted.dni = pickDniRuc(extracted.dni);

    if (!extracted.dni) {
        for (let r = sectionStart; r < Math.min(firstJson.length, sectionStart + 40); r++) {
            const row = firstJson[r] || [];
            for (let c = 0; c < Math.min(row.length, 12); c++) {
                const cell = cleanVal(row[c]);
                if (/DNI\s*\/\s*RUC|DNI|RUC/i.test(cell || "")) {
                    const candidates = [findRightValue(row, c)];
                    const nextRow = firstJson[r + 1] || [];
                    candidates.push(findRightValue(nextRow, c));
                    const joined = candidates.filter(Boolean).join(" ");
                    const val = pickDniRuc(joined);
                    if (val) { extracted.dni = val; break; }
                }
            }
            if (extracted.dni) break;
        }
    }

    const clienteDataLocal = extracted;

    // ===============================
    // PRODUCTOS (todas las hojas)
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

        let idxCodigo = -1, idxDescripcion = -1, idxUM = -1, idxPrecio = -1, idxCantidad = -1, idxSubtotal = -1;
        const isHeaderRow = (rowArr) => {
            const rowU = (rowArr || []).map(h => (h ? String(h).trim().toUpperCase() : ""));
            const hasCod = rowU.some(h => /^(#|COD|CÓD|CÓDIGO|CODIGO)$/.test(h) || /\bCOD\b/.test(h));
            const hasDes = rowU.some(h => /DESCRIP|DESCRIPCIÓN|DESCRIPCION|\bDES\b/.test(h));
            return hasCod && hasDes;
        };

        const isUmCandidate = (s) => {
            const t = (s || "").toString().trim();
            if (!t) return false;
            const u = t.toUpperCase();
            if (/^\d+(?:[\.,]\d+)?$/.test(u)) return false;
            if (/^(TOTAL|SUBTOTAL|PRECIO|CANTIDAD)$/.test(u)) return false;
            if (/^S\/N$/.test(u)) return false;
            return /(BOX|CAJA|CAJON|DOCENA|UND|UNID|UNIDAD|JUEGO|PAQ|PACK|BOLSA|SOBRE|RESMA|HOJAS|HJS|X\s*\d+)/i.test(u) || u.length <= 20;
        };

        const extractUMFromRow = (row, idxUM, idxDescripcion, idxPrecio) => {
            if (idxUM >= 0) {
                const v = cleanVal(row[idxUM]);
                if (isUmCandidate(v)) return v;
            }
            if (idxPrecio >= 1) {
                const v1 = cleanVal(row[idxPrecio - 1]);
                if (isUmCandidate(v1)) return v1;
            }
            const end = idxPrecio >= 0 ? Math.min(idxPrecio, row.length) : row.length;
            for (let c = Math.max(0, idxDescripcion + 1); c < end; c++) {
                const v = cleanVal(row[c]);
                if (isUmCandidate(v)) return v;
            }
            return "";
        };

        for (let i = 0; i < jsonData.length; i++) {
            const row = jsonData[i] || [];
            if (isHeaderRow(row)) {
                const headers = (row || []).map(h => (h ? String(h).trim().toUpperCase() : ""));
                const findSafeIndex = (keyword) => headers.findIndex(h => h && h.includes(keyword));

                const matchIndex = (re) => headers.findIndex(h => re.test(h.replace(/[\s\.;:_-]+/g, " "))); // normaliza separadores

                idxCodigo = matchIndex(/\b(#|COD|CÓD|CÓDIGO|CODIGO)\b/);
                if (idxCodigo < 0) idxCodigo = findSafeIndex("COD");

                idxDescripcion = matchIndex(/DESCRIP|DESCRIPCIÓN|DESCRIPCION|\bDES\b/);
                if (idxDescripcion < 0) idxDescripcion = findSafeIndex("DES");

                idxUM = matchIndex(/\bU\.?\s*M\b|UNIDAD(\s*DE\s*MEDIDA)?|\bUND\b|\bUNID\b|U\/?M/);
                if (idxUM < 0) idxUM = findSafeIndex("UM");

                idxPrecio = matchIndex(/P\.?\s*UNIT(\s*DSCTO)?|PRECIO/);
                if (idxPrecio < 0) idxPrecio = headers.findIndex(h => h.includes("P.UNIT DSCTO"));
                if (idxPrecio < 0) idxPrecio = headers.findIndex(h => h.includes("P.UNIT"));
                if (idxPrecio < 0) idxPrecio = headers.findIndex(h => h.includes("PRECIO"));

                idxCantidad = matchIndex(/\bCANT(IDAD)?\b/);
                if (idxCantidad < 0) idxCantidad = findSafeIndex("CANT");

                idxSubtotal = matchIndex(/SUB\s*TOTAL|SUBTOTAL|\bSUB\b/);
                if (idxSubtotal < 0) idxSubtotal = findSafeIndex("SUB");

                if (idxUM < 0 && idxDescripcion >= 0 && idxPrecio >= 0) {
                    const candidate = idxPrecio - 1;
                    if (candidate >= 0) idxUM = candidate;
                }
                if (idxUM < 0 && idxDescripcion >= 0) {
                    idxUM = idxDescripcion + 1;
                }

                continue;
            }

            if (idxCodigo < 0) continue;
            if (!row || row.every(cell => cell === undefined || cell === null || String(cell).trim() === "")) continue;
            const anyTotal = (row || []).some(x => /TOTAL|SON\s*:|SON\b/i.test(String(x || "")));
            if (anyTotal) continue;

            const codigoRaw = cleanVal(row[idxCodigo]);
            const descripcion = idxDescripcion >= 0 ? cleanVal(row[idxDescripcion]) : "";
            const um = extractUMFromRow(row, idxUM, idxDescripcion, idxPrecio);
            const precio = idxPrecio >= 0 ? cleanVal(row[idxPrecio]) : "";
            const cantidad = idxCantidad >= 0 ? cleanVal(row[idxCantidad]) : "";
            const subtotal = idxSubtotal >= 0 ? cleanVal(row[idxSubtotal]) : "";
            const codigoNorm = normalizeCodigo(codigoRaw);
            if (codigoNorm) {
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

    let shapesText = "";
    try {
        const zip = await JSZip.loadAsync(data);
        const drawingFiles = Object.keys(zip.files).filter(f => f.match(/xl\/drawings\/drawing\d+\.xml$/));
        for (const fileName of drawingFiles) {
            const xmlText = await zip.file(fileName).async("text");
            const shapeTexts = Array.from(xmlText.matchAll(/<a:t[^>]*>([^<]+)<\/a:t>/g)).map(m => m[1]).join(" ");
            shapesText += " " + shapeTexts;
        }
    } catch (e) {}

    const rawText = (allRaw.join(" ") + " " + shapesText).replace(/\s+/g, " ").trim();

    const pick = (re) => {
        const m = rawText.match(re);
        return m ? String(m[1]).trim() : "";
    };
    if (!clienteDataLocal.razon) clienteDataLocal.razon = pick(/RAZON\s*SOCIAL\s*:\s*([^:]+?)(?=FEC\.|DNI|RUC|DNI\s*\/\s*RUC|DIRECCI|REFERENCIA|PEDIDO|$)/i);
    if (!clienteDataLocal.dni) clienteDataLocal.dni = pickDniRuc(pick(/DNI\s*\/\s*RUC\s*:\s*([^:]+?)(?=DIRECCI|REFERENCIA|PEDIDO|FEC\.|EMAIL|$)/i)) || pickDniRuc(rawText);
    if (!clienteDataLocal.direccion) clienteDataLocal.direccion = pick(/DIRECCI[ÓO]N\s*:\s*([^:]+?)(?=REFERENCIA|DIRECCI[ÓO]N\s*ENTREGA|FEC\.|PEDIDO|$)/i);
    if (!clienteDataLocal.referencia) clienteDataLocal.referencia = pick(/REFERENCIA\s*:\s*([^:]+?)(?=DIRECCI|FEC\.|PEDIDO|$)/i);
    if (!clienteDataLocal.fecEmision) clienteDataLocal.fecEmision = validarFecha(pick(/FEC\.?\s*EMISI[ÓO]N\s*:\s*(\d{2}[\/\-]\d{2}[\/\-]\d{4})/i));
    if (!clienteDataLocal.fecEntrega) clienteDataLocal.fecEntrega = validarFecha(pick(/FEC\.?\s*ENTREGA\s*:\s*(\d{2}[\/\-]\d{2}[\/\-]\d{4})/i));
    if (!clienteDataLocal.pedido) clienteDataLocal.pedido = pick(/PEDIDO\s*:\s*([^:]+?)(?=DIRECCI|REFERENCIA|FEC\.|$)/i);

    return { clienteData: clienteDataLocal, codes, rawCells: allRaw, rawText, cellsInfo };
    }

    function toISODate(fecha) {
        if (!fecha) return "";
        // Ya en formato correcto
        if (/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return fecha;
        // Si viene como 16/10/2025 o 16-10-2025
        const partes = fecha.split(/[\/\-]/);
        if (partes.length === 3) {
            const [dia, mes, año] = partes;
            return `${año}-${mes.padStart(2, "0")}-${dia.padStart(2, "0")}`;
        }
        // Si Excel exporta número de serie (opcional)
        if (!isNaN(fecha)) {
            const excelEpoch = new Date(Date.UTC(1899, 11, 30));
            const date = new Date(excelEpoch.getTime() + fecha * 86400000);
            return date.toISOString().split("T")[0];
        }
        return "";
    }


    // ==========================
    // Rellenar formulario con los datos del cliente extraídos del Excel
    // ==========================
    function rellenarFormularioCliente(clienteData) {
        if (!clienteData) return;

        const setVal = (id, val) => {
            const el = document.getElementById(id);
            if (!el) return;

            if (id === "clienteFecEmision" || id === "clienteFecEntrega") {
                el.value = toISODate(val);
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
    // Validación dinámica en los inputs de fecha
    // ==========================
    function validarFormatoFecha(inputId) {
        const input = document.getElementById(inputId);
        if (!input) return;

        input.addEventListener("blur", () => {
            const valor = input.value.trim();

            // Acepta formatos válidos: "dd/mm/yyyy" o "yyyy-mm-dd"
            const regexSlash = /^\d{2}\/\d{2}\/\d{4}$/;
            const regexISO = /^\d{4}-\d{2}-\d{2}$/;

            // Si está vacío, no hace nada
            if (!valor) return;

            // Si cumple alguno de los dos formatos → se acepta
            if (regexSlash.test(valor) || regexISO.test(valor)) return;

            // Si no cumple → lo borra
            console.warn(`Fecha inválida detectada en ${inputId}:`, valor);
            input.value = "";
        });
    }

    // Activar validación en ambos campos de fecha
    validarFormatoFecha("clienteFecEmision");
    validarFormatoFecha("clienteFecEntrega");

    function recalcularSubtotal(row) {
    const precio = parseFloat(row.children[3].textContent) || 0;
    const cantidad = parseFloat(row.children[4].textContent) || 0;
    const subtotal = precio * cantidad;

    const cell = row.children[5];
    const target = cell.querySelector('.cell-value') || cell;
    target.textContent = Number.isInteger(subtotal)
        ? subtotal.toString()
        : subtotal.toFixed(2);
    }

    let globalUnlock = {
        unlocked: false,
        expiresAt: 0,
        timeoutId: null
    };

    const UNLOCK_DURATION_MS = 2 * 60 * 1000;
    const PASSWORD = "primavera";

    // ---------------------------
    // Mostrar modal y pedir contraseña
    // ---------------------------
        function requestPasswordAndUnlockModal() {
            return new Promise((resolve) => {
                const modal = document.getElementById("passwordModal");
                const input = document.getElementById("modalPassword");
                const btnConfirm = document.getElementById("modalConfirm");
                const btnCancel = document.getElementById("modalCancel");

                input.value = ""; // limpiar input
                modal.style.display = "flex";
                input.focus();

                // Envolver input con grupo y añadir botón ojo para mostrar/ocultar
                if (!input.parentElement.classList.contains("password-group")) {
                    const group = document.createElement("div");
                    group.className = "password-group";
                    input.parentNode.insertBefore(group, input);
                    group.appendChild(input);
                    const eyeBtn = document.createElement("button");
                    eyeBtn.type = "button";
                    eyeBtn.className = "password-eye";
                    eyeBtn.innerHTML = '<i class="bi bi-eye"></i>';
                    group.appendChild(eyeBtn);
                    eyeBtn.addEventListener("click", () => {
                        input.type = input.type === "password" ? "text" : "password";
                        const icon = eyeBtn.querySelector("i");
                        if (icon) icon.className = input.type === "password" ? "bi bi-eye" : "bi bi-eye-slash";
                    });
                }

            function closeModal(result) {
                modal.style.display = "none";
                btnConfirm.removeEventListener("click", onConfirm);
                btnCancel.removeEventListener("click", onCancel);
                resolve(result);
            }

            function onConfirm() {
                if (input.value === PASSWORD) {
                    unlockAllFor(UNLOCK_DURATION_MS);
                    closeModal(true);
                } else {
                    alert("Contraseña incorrecta.");
                }
            }

            function onCancel() {
                closeModal(false);
            }

            btnConfirm.addEventListener("click", onConfirm);
            btnCancel.addEventListener("click", onCancel);
        });
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
            const ic = td.querySelector('.cell-lock-icon');
            if (ic) ic.className = 'cell-lock-icon bi bi-unlock-fill';
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
            const ic = td.querySelector('.cell-lock-icon');
            if (ic) ic.className = 'cell-lock-icon bi bi-lock-fill';
        });
    }

    // ---------------------------
    // Inicializa celda bloqueada
    // ---------------------------
    function makeCellLocked(td) {
        td.contentEditable = "false";
        td.classList.add("locked-cell");
        if (!td.querySelector('.cell-lock-icon')) {
            const icon = document.createElement('i');
            icon.className = 'cell-lock-icon bi bi-lock-fill';
            td.appendChild(icon);
        }

        td.addEventListener("click", async (e) => {
            if (globalUnlock.unlocked && Date.now() < globalUnlock.expiresAt) {
                td.contentEditable = "true";
                td.classList.add("unlocked-cell");
                td.classList.remove("locked-cell");
                const ic = td.querySelector('.cell-lock-icon');
                if (ic) ic.className = 'cell-lock-icon bi bi-unlock-fill';
                td.focus();
                return;
            }

            // Pedir contraseña usando modal
            const ok = await requestPasswordAndUnlockModal();
            if (ok) {
                td.contentEditable = "true";
                td.classList.add("unlocked-cell");
                td.classList.remove("locked-cell");
                const ic = td.querySelector('.cell-lock-icon');
                if (ic) ic.className = 'cell-lock-icon bi bi-unlock-fill';
                td.focus();
            }
        });
    }

    // ---------------------------
    // Inicializar todas las celdas bloqueadas
    // ---------------------------
    document.querySelectorAll(".locked-cell").forEach(td => makeCellLocked(td));


    // Obtener contador actual desde Supabase
    async function obtenerContador() {
        const { data, error } = await supabase
            .from("contador_pdf")
            .select("contador")
            .eq("id", 1)
            .single();

        if (error) {
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

        if (error) console.error(err);;

        return contador;
    }

    // ==========================
    //  Formatear número con prefijo y ceros
    // ==========================
    function formatearCodigo(contador) {
        const prefijo = "SP"; // <-- puedes cambiarlo (ej: "DOC", "CMP", "INV")
        const numeroFormateado = contador.toString().padStart(6, "0");
        return `${prefijo}-${numeroFormateado}`;
    }

    // ==========================
    //  Generar PDF con contador global desde Supabase
    // ==========================
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

        const esSPDoc = !!window.__esSPDocumento;
        const leftTitle = esSPDoc ? "Saldo de Proforma anterior" : "Proforma de Venta";
        const leftNumber = esSPDoc ? (proformaNumber || "-") : (proformaNumber || "-");
        doc.setFont("helvetica", "bold").setFontSize(10);
        doc.text(leftTitle, leftX, titleY);
        doc.setFont("helvetica", "normal").setFontSize(9);
        doc.text(leftNumber, leftX, numberY);

        // CONTADOR GLOBAL
        doc.setFont("helvetica", "bold").setFontSize(10);
        doc.text("Saldos de Proforma", centerX, titleY, { align: "center" });
        doc.setFont("helvetica", "normal").setFontSize(9);
        doc.text(codigoPDF, centerX, numberY, { align: "center" });

        // === TIPO DE DOCUMENTO DINÁMICO
        const tipoDocumento = document.getElementById("tipoDocumento")?.value || "—";

        // FACTURA
        doc.setFont("helvetica", "bold").setFontSize(10);
        doc.text(tipoDocumento, rightX, titleY, { align: "right" });
        doc.setFont("helvetica", "normal").setFontSize(9);
        doc.text(facturaNumber || "-", rightX, numberY, { align: "right" });

        // Línea separadora
        doc.setDrawColor(190, 30, 45);
        doc.line(MARGIN_X + 5, boxTop + boxHeight - 5, PAGE_WIDTH - MARGIN_X - 5, boxTop + boxHeight - 5);
        doc.setFontSize(8).setTextColor(80, 80, 80);
        const linkText = esSPDoc
            ? "Saldo de Proforma actual ligado directamente al Saldo de Proforma anterior indicado arriba."
            : `${tipoDocumento} ligada directamente a la Proforma indicada arriba.`;
        doc.text(linkText, PAGE_WIDTH / 2, boxTop + boxHeight - 1, { align: "center" });

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
        alert("Error generando PDF. Revisa la consola.");
    }
    });

    // ==========================================================
    // Número a letras (simple español)
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

    backBtn.addEventListener("click", () => {
        // Limpiar tabla
        const resultTableBody = document.querySelector("#resultTable tbody");
        if (resultTableBody) resultTableBody.innerHTML = "";

        // Reiniciar paginación
        const info = document.getElementById("infoPaginacion2");
        const numerosPaginas = document.getElementById("numerosPaginas2");
        const btnAnterior = document.getElementById("btnAnterior2");
        const btnSiguiente = document.getElementById("btnSiguiente2");

        if (info) info.textContent = "Mostrando registros del 0 al 0 de un total de 0";
        if (numerosPaginas) numerosPaginas.innerHTML = "";
        if (btnAnterior) btnAnterior.disabled = true;
        if (btnSiguiente) btnSiguiente.disabled = true;

        //Forzar que el selector de filas vuelva a 50
        function forzarSelectorFilas50() {
            const selector = document.getElementById("rowsPerPage2");
            if (!selector) return;

            // Si la opción "50" no existe, crearla
            if (![...selector.options].some(opt => opt.value === "50")) {
            const opt = document.createElement("option");
            opt.value = "50";
            opt.textContent = "50 filas";
            selector.appendChild(opt);
            }

            selector.value = "50";

            // Disparar manualmente el evento change
            const event = new Event("change", { bubbles: true });
            selector.dispatchEvent(event);

            // Refrescar paginación
            if (typeof aplicarPaginacionTabla === "function") {
            paginaActual = 1;
            aplicarPaginacionTabla();
            }
        }

        // Limpiar inputs, selects y textareas
        document.querySelectorAll("input, select, textarea").forEach(el => {
            // Texto, fecha y textarea
            if (["text", "date"].includes(el.type) || el.tagName === "TEXTAREA") {
            el.value = "";
            }

            // Selects → volver a primera opción
            if (el.tagName === "SELECT") {
            el.selectedIndex = 0;
            }

            // Archivos → reemplazar y reenganchar eventos
            if (el.type === "file") {
            const oldId = el.id;
            const newInput = el.cloneNode(true);
            newInput.value = "";
            el.parentNode.replaceChild(newInput, el);

            // Volver a registrar los listeners correctos
            if (oldId === "excelFile1") {
                newInput.addEventListener("change", async (e) => {
                const file = e.target.files[0];
                if (!file) return;
                try {
                    const textoExcel = await leerSoloFila1YShapes(file);
                    const numeroDetectado = findFacturaNumber(textoExcel) || "";
                    mostrarFacturaDetectada(numeroDetectado);
                } catch (err) {
                    console.error("Error al leer factura:", err);
                }
                });
            }

            if (oldId === "excelFile2") {
                newInput.addEventListener("change", async (e) => {
                const file = e.target.files[0];
                if (!file) return;
                try {
                    const textoExcel = await leerSoloFila1YShapes(file);
                    const numeroDetectado = findNumberByPrefixInText(textoExcel, "002") || "";
                    mostrarProformaDetectada(numeroDetectado);
                } catch (err) {
                    console.error("Error al leer proforma:", err);
                }
                });
            }
            }
        });

        // Restaurar selects con valores por defecto
        const pedidoSelect = document.getElementById("clientePedido");
        if (pedidoSelect) pedidoSelect.selectedIndex = 0;

        const tipoDocSelect = document.getElementById("tipoDocumento");
        if (tipoDocSelect) tipoDocSelect.selectedIndex = 0;

        //Ocultar toasts o modales
        ["toastConexion", "toastDuplicado", "conexionModal"].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = "none";
        });

        // Subir al inicio
        window.scrollTo({ top: 0, behavior: "smooth" });

        // 🧹 Reiniciar variables globales de numeración
        if (typeof facturaNumber !== "undefined") facturaNumber = "";
        if (typeof proformaNumber !== "undefined") proformaNumber = "";

        // Forzar selector y actualizar paginación
        forzarSelectorFilas50();
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
    // Función de Toast
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
    // Normalización de texto
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
    // Buscar número de proforma
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

    function findSaldoProformaNumberInText(rawText) {
    if (!rawText) return "";
    const txt = normalizeForMatch(rawText).toUpperCase();
    if (!/\bSP\b|SALDOS?\s*DE\s*PROFORMA/.test(txt)) return "";
    const direct = txt.match(/\bSP[-\s:/\\]*(\d{5,8})\b/);
    if (direct) return `SP-${String(direct[1]).padStart(8, "0")}`;
    const base = findNumberByPrefixInText(txt, "002");
    if (base) return `SP-${base}`;
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
    // Detectar proforma al subir Excel
    // ==========================
    document.getElementById("excelFile2").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
        const textoExcel = await leerSoloFila1YShapes(file);

        const numeroDetectado = findSaldoProformaNumberInText(textoExcel) || findNumberByPrefixInText(textoExcel, "002") || "";

        if (numeroDetectado) {
        mostrarProformaDetectada(numeroDetectado);
        } else {
        mostrarProformaDetectada("");
        }
    } catch (err) {
    }
    });

    // ==========================
    // Leer SOLO FILA 1 + Cuadros de texto (shapes)
    // ==========================
    async function leerSoloFila1YShapes(file) {
    const arrayBuffer = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);
    let textoTotal = "";

    // 1. Leer solo la fila 1 de cada hoja
    const data = new Uint8Array(arrayBuffer);
    const workbook = XLSX.read(data, { type: "array" });

    workbook.SheetNames.forEach((nombreHoja) => {
        const hoja = workbook.Sheets[nombreHoja];
        const json = XLSX.utils.sheet_to_json(hoja, { header: 1 });
        if (json.length > 0 && json[0].length > 0) {
        textoTotal += json[0].join(" ") + " ";
        }
    });

    // 2. Leer cuadros de texto (shapes)
    const drawingFiles = Object.keys(zip.files).filter(f => f.match(/xl\/drawings\/drawing\d+\.xml$/));
    for (const fileName of drawingFiles) {
        try {
        const xmlText = await zip.file(fileName).async("text");
        const shapeTexts = Array.from(xmlText.matchAll(/<a:t[^>]*>([^<]+)<\/a:t>/g))
            .map(m => m[1])
            .join(" ");
        textoTotal += " " + shapeTexts;
        } catch (err) {
        }
    }

    return textoTotal;
    }


    // ==========================
    // Buscar número de factura/boleta/NotaPedido
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
    // Detectar factura/boleta/nota al subir Excel
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
    }
    });

}

/* ======================================================
   CARGA DINÁMICA - Control de Registros
   ====================================================== */
document.querySelectorAll('[data-tool="controlFacturacion"]').forEach(link => {
  link.addEventListener("click", async e => {
    e.preventDefault();

    const iframeContainer = document.getElementById("iframe-container");
    const titleContainer = document.getElementById("tool-title-container");
    const inicioContent = document.getElementById("inicio-content");

    // Limpieza previa
    iframeContainer.innerHTML = "";
    titleContainer.innerHTML = "";
    if (inicioContent) inicioContent.style.display = "none";

    // Si existe función de limpieza anterior, ejecútala
    if (typeof window.cleanupControlFacturacion === "function") {
      try { window.cleanupControlFacturacion(); } catch (err) { console.warn("Error limpiando Control Facturación:", err); }
    }

    // Título y descripción
    titleContainer.innerHTML = `
      <div class="mb-4 text-start">
        <h3 class="fw-bold" style="color: #1a237e;">
          <i class="bi bi-file-earmark-text me-2"></i>
          Control de Registros
        </h3>
        <p class="text-muted mb-0">
          Compara dos archivos Excel y genera un reporte PDF con las diferencias.
        </p>
      </div>
    `;
  });
});

document.addEventListener("click", (e) => {
  const toast = document.getElementById("toastDuplicado");
  if (e.target === toast && e.offsetX > toast.clientWidth - 25) {
    toast.style.display = "none";
  }
});

document.addEventListener("click", (e) => {
  if (e.target && (e.target.id === "btnImprimir2" || e.target.closest("#btnImprimir2"))) {
    e.preventDefault();

    const tabla = document.querySelector("#resultSection");
    if (!tabla) return alert("No se encontró la tabla para imprimir.");

    // Clonamos la tabla para no afectar la original
    const tablaClonada = tabla.cloneNode(true);

    // Ocultar columna "ACC." (última columna)
    tablaClonada.querySelectorAll("th:last-child, td:last-child").forEach(el => el.remove());

    // Dimensiones de la ventana
    const width = 900;
    const height = 650;
    const left = (window.screen.width / 2) - (width / 2);
    const top = (window.screen.height / 2) - (height / 2);

    // 🪟 Abrimos ventana centrada
    const printWindow = window.open("", "_blank", `width=${width},height=${height},top=${top},left=${left}`);

    printWindow.document.write(`
      <html>
        <head>
          <title>Comprobante</title>
          <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet">
          <style>
            body {
              font-family: Arial, sans-serif;
              margin: 20px;
            }
            table { 
              width: 100%; 
              border-collapse: collapse; 
              margin-top: 20px;
            }
            th, td { 
              border: 1px solid #dee2e6; 
              padding: 0.5rem; 
              text-align: center; 
            }
            th { 
              background-color: #f8f9fa; 
            }
            h4 {
              text-align: center;
              margin-bottom: 20px;
            }
          </style>
        </head>
        <body>
          ${tablaClonada.outerHTML}
        </body>
      </html>
    `);

    printWindow.document.close();
    printWindow.focus();
    printWindow.print();

    // Cerramos la ventana después de imprimir
    printWindow.close();
  }
});

/* ======================================================
   PAGINACIÓN INTELIGENTE ADAPTADA A TU SISTEMA
   ------------------------------------------------------
   - Compatible con la tabla #resultTable (#tablaBody2)
   - Muestra botones: Anterior / 1 2 3 … / Siguiente
   - Texto: “Mostrando del X al Y de Z registros”
   - Reacciona al cambiar el selector de filas
   ====================================================== */

let paginaActual = 1;

// Esta función se ejecuta cada vez que cargas nuevos datos
function aplicarPaginacionTabla() {
  const tablaBody = document.getElementById("tablaBody2") || document.querySelector("#resultTable tbody");
  const selector = document.getElementById("rowsPerPage2");
  const info = document.getElementById("infoPaginacion2");
  const numerosPaginas = document.getElementById("numerosPaginas2");
  const btnAnterior = document.getElementById("btnAnterior2");
  const btnSiguiente = document.getElementById("btnSiguiente2");

  if (!tablaBody || !selector) return;

  const filas = Array.from(tablaBody.querySelectorAll("tr"));
  const totalFilas = filas.length;
  let filasPorPagina = selector.value === "todos" ? totalFilas : parseInt(selector.value);

  const totalPaginas = Math.ceil(totalFilas / filasPorPagina);
  if (paginaActual > totalPaginas) paginaActual = totalPaginas || 1;

  const inicio = (paginaActual - 1) * filasPorPagina;
  const fin = selector.value === "todos" ? totalFilas : inicio + filasPorPagina;

  // Mostrar solo las filas visibles
  filas.forEach((fila, index) => {
    fila.style.display = index >= inicio && index < fin ? "" : "none";
  });

  // Texto informativo
  if (info) {
    info.textContent =
      totalFilas === 0
        ? "Mostrando registros del 0 al 0 de un total de 0"
        : `Mostrando registros del ${inicio + 1} al ${Math.min(fin, totalFilas)} de un total de ${totalFilas}`;
  }

  // Construir botones de páginas
  if (numerosPaginas) {
    numerosPaginas.innerHTML = "";
    const maxVisible = 5;
    let pages = [];

    if (totalPaginas <= maxVisible + 2) {
      pages = Array.from({ length: totalPaginas }, (_, i) => i + 1);
    } else {
      const start = Math.max(2, paginaActual - Math.floor(maxVisible / 2));
      const end = Math.min(totalPaginas - 1, start + maxVisible - 1);

      pages = [1];
      if (start > 2) pages.push("...");
      for (let i = start; i <= end; i++) pages.push(i);
      if (end < totalPaginas - 1) pages.push("...");
      pages.push(totalPaginas);
    }

    // Render de los botones
    pages.forEach((p) => {
      if (p === "...") {
        const span = document.createElement("span");
        span.className = "mx-1 text-muted";
        span.textContent = "…";
        numerosPaginas.appendChild(span);
      } else {
        const btn = document.createElement("button");
        btn.className = `btn btn-sm mx-1 ${p === paginaActual ? "btn-primary" : "btn-outline-secondary"}`;
        btn.textContent = p;
        btn.addEventListener("click", () => {
          paginaActual = p;
          aplicarPaginacionTabla();
        });
        numerosPaginas.appendChild(btn);
      }
    });
  }

  // Botones de navegación
  if (btnAnterior && btnSiguiente) {
    btnAnterior.disabled = paginaActual === 1;
    btnSiguiente.disabled = paginaActual === totalPaginas || totalPaginas === 0;

    btnAnterior.onclick = () => {
      if (paginaActual > 1) {
        paginaActual--;
        aplicarPaginacionTabla();
      }
    };

    btnSiguiente.onclick = () => {
      if (paginaActual < totalPaginas) {
        paginaActual++;
        aplicarPaginacionTabla();
      }
    };
  }
}

// Reinicia paginación al cambiar cantidad de filas
document.addEventListener("change", (e) => {
  if (e.target && e.target.id === "rowsPerPage2") {
    paginaActual = 1;
    aplicarPaginacionTabla();
  }
});

// Cada vez que termines de renderizar tus resultados de factura/proforma
// lama a esta función: aplicarPaginacionTabla();
document.addEventListener("DOMContentLoaded", () => {
  aplicarPaginacionTabla();
});


window.initGeneradorControlFacturacion = initGeneradorControlFacturacion;
