// ================================
// gestion_precios.js
// ================================

// Se exporta una función para inicializar la herramienta
function initGestionPrecios() {

  // 📘 Leer Excel desde fila 2 como encabezado y fila 3 en adelante como datos
  async function readExcelDesdeFila2(file) {
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data, { type: "array" });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];

    const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
    const headers = jsonData[1].map(h => String(h).trim());
    const dataRows = jsonData.slice(2);

    return dataRows.map(row => {
      const obj = {};
      headers.forEach((h, i) => {
        obj[h.toLowerCase()] = row[i] !== undefined ? String(row[i]).trim() : "";
      });
      return obj;
    });
  }

  // Función auxiliar para obtener valor de columna
  function getValue(row, colName) {
    return row[colName.toLowerCase()] !== undefined ? row[colName.toLowerCase()] : "";
  }

  // 📊 Comparar productos vs pedidos
  function compararPorCodigo(productos, pedidos) {
    const productosMap = new Map();
    productos.forEach(p => {
      const codigoProd = getValue(p, '#');
      if (codigoProd) productosMap.set(codigoProd, p);
    });

    const resultados = pedidos.map(ped => {
      const codPedido = getValue(ped, 'COD');
      if (!codPedido) return null;

      const prod = productosMap.get(codPedido);
      const cantidadSolicita = Number(getValue(ped, 'CANTIDAD') || 0);
      if (!prod) return null;

      const stockSistema = Number(getValue(prod, 'Stock') || 0);
      const costo = Number(getValue(prod, 'Costo') || 0);
      const descripcion = getValue(prod, 'Descripcion');
      const unidad = getValue(ped, 'UNIDAD');

      const faltantes = cantidadSolicita > stockSistema ? cantidadSolicita - stockSistema : 0;
      const sobrantes = stockSistema > cantidadSolicita ? stockSistema - cantidadSolicita : 0;

      return {
        'Código': codPedido,
        'Descripción del Producto': descripcion,
        'Unidad': unidad,
        'Cantidad Requerida': cantidadSolicita,
        'Cantidad en Almacén': stockSistema,
        'Cantidad Faltante': faltantes,
        'Cantidad Sobrante': sobrantes,
        'Costo Unitario (S/)': costo,
        'Costo Total (S/)': costo * cantidadSolicita
      };
    }).filter(f => f !== null);

    return resultados;
  }

  // === Generar Excel con estilo profesional ===
  async function generarExcel(data) {
    const headers = [
      'Código',
      'Descripción del Producto',
      'Unidad',
      'Cantidad Requerida',
      'Cantidad en Almacén',
      'Cantidad Faltante',
      'Cantidad Sobrante',
      'Costo Unitario (S/)',
      'Costo Total (S/)'
    ];

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Comparación');

    sheet.columns = [
      { header: headers[0], key: 'codigo', width: 12 },
      { header: headers[1], key: 'descripcion', width: 85 },
      { header: headers[2], key: 'unidad', width: 20 },
      { header: headers[3], key: 'cantReq', width: 20 },
      { header: headers[4], key: 'cantAlm', width: 20 },
      { header: headers[5], key: 'falt', width: 20 },
      { header: headers[6], key: 'sobr', width: 20 },
      { header: headers[7], key: 'costoUnit', width: 20 },
      { header: headers[8], key: 'costoTotal', width: 20 }
    ];

    const headerRow = sheet.getRow(1);
    headerRow.eachCell(cell => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '4472C4' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = {
        top: { style: 'thin', color: { argb: 'CCCCCC' } },
        bottom: { style: 'thin', color: { argb: 'CCCCCC' } },
        left: { style: 'thin', color: { argb: 'CCCCCC' } },
        right: { style: 'thin', color: { argb: 'CCCCCC' } }
      };
    });

    // Filas con efecto zebra
    data.forEach((item, index) => {
      const row = sheet.addRow({
        codigo: Number(item['Código']),
        descripcion: item['Descripción del Producto'],
        unidad: item['Unidad'],
        cantReq: Number(item['Cantidad Requerida']),
        cantAlm: Number(item['Cantidad en Almacén']),
        falt: Number(item['Cantidad Faltante']),
        sobr: Number(item['Cantidad Sobrante']),
        costoUnit: Number(item['Costo Unitario (S/)']),
        costoTotal: Number(item['Costo Total (S/)'])
      });

      const isEven = index % 2 === 0;
      row.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: isEven ? 'D9E1F2' : 'FFFFFF' } };
        cell.border = {
          top: { style: 'thin', color: { argb: 'CCCCCC' } },
          bottom: { style: 'thin', color: { argb: 'CCCCCC' } },
          left: { style: 'thin', color: { argb: 'CCCCCC' } },
          right: { style: 'thin', color: { argb: 'CCCCCC' } }
        };
      });
    });

    [4,5,6,7].forEach(c => sheet.getColumn(c).numFmt = '0');
    [8,9].forEach(c => sheet.getColumn(c).numFmt = '#,##0.00');
    for (let i = 4; i <= 9; i++) sheet.getColumn(i).alignment = { horizontal: 'right' };

    sheet.views = [{ state: 'frozen', ySplit: 1 }];

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = "lista_comparada.xlsx";
    link.click();
  }

  // === Evento principal del botón ===
  const compararBtn = document.getElementById('compararBtn');
  if (compararBtn) {
    compararBtn.addEventListener('click', async () => {
      const fileProductos = document.getElementById('excelProductos').files[0];
      const filePedidos = document.getElementById('excelPedidos').files[0];

      if (!fileProductos || !filePedidos) {
        alert("Selecciona ambos archivos Excel.");
        return;
      }

      const productos = await readExcelDesdeFila2(fileProductos);
      const pedidos = await readExcelDesdeFila2(filePedidos);
      const resultado = compararPorCodigo(productos, pedidos);

      if (resultado.length === 0) {
        alert("No se encontraron coincidencias entre los códigos.");
        return;
      }
      
      mostrarResumen(resultado);
      renderTabla(resultado);
      mostrarAlertas(resultado);
      window.__ultimoResultado = resultado; // 🟦 Guardar globalmente

      document.getElementById("descargarExcelBtn").disabled = false;

    });
  } else {
    console.error("No se encontró el botón #compararBtn en el DOM.");
  }

  // === Evento del botón Descargar Excel ===
  const descargarBtn = document.getElementById("descargarExcelBtn");
    if (descargarBtn) {
      descargarBtn.addEventListener("click", async () => {
        if (!window.__ultimoResultado || window.__ultimoResultado.length === 0) {
          alert("Primero procesa los datos antes de descargar.");
          return;
        }
        await generarExcel(window.__ultimoResultado);
      });
    }
    const productosFile = document.getElementById("excelProductos");
  if (productosFile) {
    productosFile.addEventListener("change", async () => {
      const file = productosFile.files[0];
      if (!file) return;

      const dataRows = await readExcelDesdeFila2(file);
      const contadorSpan = productosFile.parentElement.querySelector("small");
      if (contadorSpan) {
        contadorSpan.textContent = `Última carga: ${new Date().toLocaleString()} | Registros: ${dataRows.length}`;
      }
    });
  }

  const pedidosFile = document.getElementById("excelPedidos");
  if (pedidosFile) {
    pedidosFile.addEventListener("change", async () => {
      const file = pedidosFile.files[0];
      if (!file) return;

      const dataRows = await readExcelDesdeFila2(file);
      const contadorSpan = pedidosFile.parentElement.querySelector("small");
      if (contadorSpan) {
        contadorSpan.textContent = `Última carga: ${new Date().toLocaleString()} | Registros: ${dataRows.length}`;
      }
    });
  }


  // === Evento del botón Limpiar Todo ===
  const limpiarBtn = document.getElementById("limpiarTodoBtn");
  if (limpiarBtn) {
    limpiarBtn.addEventListener("click", () => {
      // Limpiar inputs de archivos
      const productosInput = document.getElementById("excelProductos");
      const pedidosInput = document.getElementById("excelPedidos");
      if (productosInput) productosInput.value = "";
      if (pedidosInput) pedidosInput.value = "";

      // Limpiar contadores de última carga
      const contadorProductos = productosInput?.parentElement.querySelector("small");
      const contadorPedidos = pedidosInput?.parentElement.querySelector("small");
      if (contadorProductos) contadorProductos.textContent = "Última carga: 0 | Registros: 0";
      if (contadorPedidos) contadorPedidos.textContent = "Última carga: 0 | Registros: 0";

      // Limpiar tabla y contenedor de resultados
      const tablaResultados = document.getElementById("tablaResultados");
      if (tablaResultados) tablaResultados.innerHTML = `
        <table class="table table-striped table-bordered align-middle">
          <thead class="text-center">
            <tr>
              <th>Código</th>
              <th>Descripción del Producto</th>
              <th>Unidad</th>
              <th>Cantidad Requerida</th>
              <th>Cantidad en Almacén</th>
              <th>Cantidad Faltante</th>
              <th>Cantidad Sobrante</th>
              <th>Costo Unitario (S/)</th>
              <th>Costo Total (S/)</th>
            </tr>
          </thead>
          <tbody id="tablaBody"></tbody>
        </table>
      `;

      // Ocultar resumen
      const resumen = document.getElementById("resumen");
      if (resumen) resumen.classList.add("d-none");

      // Limpiar alertas visuales
      const contenedorAlertas = document.getElementById("alertasDashboard");
      if (contenedorAlertas) contenedorAlertas.innerHTML = "";

      // Reiniciar variables globales
      window.__ultimoResultado = [];
      paginaActual = 1;

      // Reiniciar indicadores principales
      const indicadores = [
        "totalCoincidencias",
        "totalFaltantes",
        "totalSobrantes",
        "totalCoincidenciasResumen",
        "totalFaltantesResumen",
        "totalSobrantesResumen"
      ];
      indicadores.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = "0";
      });

      // Reiniciar selector de filas a "50 filas"
      const selector = document.getElementById("rowsPerPage");
      if (selector) selector.value = "50";

      // Reiniciar información de paginación
      const info = document.getElementById("infoPaginacion");
      const numerosPaginas = document.getElementById("numerosPaginas");
      if (info) info.textContent = "Mostrando registros del 0 al 0 de un total de 0";
      if (numerosPaginas) numerosPaginas.innerHTML = "";

      // Deshabilitar botones anterior/siguiente
      const btnAnterior = document.getElementById("btnAnterior");
      const btnSiguiente = document.getElementById("btnSiguiente");
      if (btnAnterior) btnAnterior.disabled = true;
      if (btnSiguiente) btnSiguiente.disabled = true;

      // Deshabilitar botón Descargar Excel
      const descargarBtn = document.getElementById("descargarExcelBtn");
      if (descargarBtn) descargarBtn.disabled = true;
    });
  }


}

function mostrarResumen(resultados) {
  const resumen = document.getElementById("resumen");
  resumen.classList.remove("hidden");

  const totalCoincidencias = resultados.length;
  const totalFaltantes = resultados.filter(r => r["Cantidad Faltante"] > 0).length;
  const totalSobrantes = resultados.filter(r => r["Cantidad Sobrante"] > 0).length;

  document.getElementById("totalCoincidencias").textContent = totalCoincidencias;
  document.getElementById("totalFaltantes").textContent = totalFaltantes;
  document.getElementById("totalSobrantes").textContent = totalSobrantes;
}

function renderTabla(data) {
  const tbody = document.getElementById("tablaBody");
  if (!tbody) return;
  tbody.innerHTML = "";

  data.forEach(row => {
    const tr = document.createElement("tr");

    Object.entries(row).forEach(([key, value]) => {
      const td = document.createElement("td");

      // Columnas numéricas (alinear a la derecha)
      const columnasNumericas = [
        "Cantidad Requerida",
        "Cantidad en Almacén",
        "Cantidad Faltante",
        "Cantidad Sobrante",
        "Costo Unitario (S/)",
        "Costo Total (S/)"
      ];

      if (columnasNumericas.includes(key)) {
        td.classList.add("num-align");
      }

      // Aplicar badges de color
      if (key === "Cantidad Requerida") {
        td.innerHTML = `<span class="stock-badge badge-requerida">${value}</span>`;
      } else if (key === "Cantidad en Almacén") {
        td.innerHTML = `<span class="stock-badge ${value > 0 ? 'badge-verde' : 'badge-rojo'}">${value}</span>`;
      } else if (key === "Cantidad Faltante") {
        td.innerHTML = `<span class="stock-badge ${value > 0 ? 'badge-naranja' : 'badge-amarillo-claro'}">${value}</span>`;
      } else if (key === "Cantidad Sobrante") {
        td.innerHTML = `<span class="stock-badge ${value > 0 ? 'badge-azul' : 'badge-celeste-claro'}">${value}</span>`;
      } else {
        td.textContent = value;
      }

      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  });

  aplicarPaginacionTabla();
}


/* ======================================================
   SCRIPT: CARGA DINÁMICA DE HERRAMIENTAS EN EL DASHBOARD
   ------------------------------------------------------
   - Carga el contenido correspondiente según la opción
     seleccionada en el sidebar.
   - Muestra el título fuera del card principal.
   - El título solo aparece en "Gestión de Precios".
   - Limpia el contenido anterior al cambiar de vista.
   ====================================================== */

document.querySelectorAll('[data-tool]').forEach(link => {
  link.addEventListener('click', e => {
    e.preventDefault();

    const tool = link.getAttribute('data-tool');
    const iframeContainer = document.getElementById('iframe-container');
    const titleContainer = document.getElementById('tool-title-container');
    const inicioContent = document.getElementById('inicio-content');

    // --- Limpieza previa de contenedores ---
    iframeContainer.innerHTML = '';
    titleContainer.innerHTML = '';
    inicioContent.style.display = 'none';

    // --- Cargar herramienta "Gestión de Precios" ---
    if (tool === 'gestionPrecios') {

      // Insertar el título y descripción fuera del card (alineado a la izquierda)
      titleContainer.innerHTML = `
        <h2 class="tool-title text-start">
          <i class="bi bi-diagram-3 me-2"></i> Comparar Productos en Stock
        </h2>
        <p class="text-muted mb-4" style="text-align: left; max-width: 800px;">
          Esta herramienta permite comparar los productos solicitados contra el inventario del sistema. 
        </p>
      `;

      // Cargar contenido dentro del card principal
      fetch('tools/gestion-precios/gestion_precios.html')
        .then(res => res.text())
        .then(html => {
          iframeContainer.innerHTML = html;
          initGestionPrecios();
        })
        .catch(err => {
          iframeContainer.innerHTML = `<p class="text-danger text-center mt-3">Error al cargar la herramienta.</p>`;
          console.error("Error cargando la herramienta:", err);
        });

    } else {
      // --- Si se cambia a otra herramienta o al inicio ---
      titleContainer.innerHTML = '';
      iframeContainer.innerHTML = '';
      inicioContent.style.display = 'block';
    }
  });
});


/* ======================================================
   CONTROL DE CANTIDAD DE FILAS Y PAGINACIÓN INTELIGENTE
   ------------------------------------------------------
   - Muestra botones tipo: Anterior 1 2 3 4 5 … 195 Siguiente
   - Muestra máx. 10 páginas visibles
   - Se actualiza automáticamente al cambiar selector
   - Mantiene texto "Mostrando del X al Y de Z"
   ====================================================== */

let paginaActual = 1;

function aplicarPaginacionTabla() {
  const tablaBody = document.getElementById("tablaBody");
  const selector = document.getElementById("rowsPerPage");
  const info = document.getElementById("infoPaginacion");
  const numerosPaginas = document.getElementById("numerosPaginas");
  const btnAnterior = document.getElementById("btnAnterior");
  const btnSiguiente = document.getElementById("btnSiguiente");

  if (!tablaBody || !selector) return;

  const filas = Array.from(tablaBody.querySelectorAll("tr"));
  const totalFilas = filas.length;
  let filasPorPagina =
    selector.value === "todos" ? totalFilas : parseInt(selector.value);

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
        : `Mostrando registros del ${inicio + 1} al ${Math.min(
            fin,
            totalFilas
          )} de un total de ${totalFilas}`;
  }

  // ------------------------
  // Paginación visual
  // ------------------------
  if (numerosPaginas) {
    numerosPaginas.innerHTML = "";

    const maxVisible = 4; // Número de páginas centrales visibles
    let pages = [];

    if (totalPaginas <= maxVisible + 3) {
      // Si son pocas páginas, mostrar todas
      pages = Array.from({ length: totalPaginas }, (_, i) => i + 1);
    } else {
      // Siempre mostramos primera, última, y rango centrado
      const start = Math.max(2, paginaActual - Math.floor(maxVisible / 2));
      const end = Math.min(totalPaginas - 1, start + maxVisible - 1);

      pages = [1];
      if (start > 2) pages.push("...");
      for (let i = start; i <= end; i++) pages.push(i);
      if (end < totalPaginas - 1) pages.push("...");
      pages.push(totalPaginas);
    }

    // Crear botones
    pages.forEach((p) => {
      if (p === "...") {
        const span = document.createElement("span");
        span.className = "mx-1 text-muted";
        span.textContent = "…";
        numerosPaginas.appendChild(span);
      } else {
        const btn = document.createElement("button");
        btn.className = `btn btn-sm mx-1 ${
          p === paginaActual ? "btn-primary" : "btn-outline-secondary"
        }`;
        btn.textContent = p;
        btn.addEventListener("click", () => {
          paginaActual = p;
          aplicarPaginacionTabla();
        });
        numerosPaginas.appendChild(btn);
      }
    });
  }

  // ------------------------
  // Botones anterior / siguiente
  // ------------------------
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

// 🔄 Cambiar número de filas = reinicia paginación
document.addEventListener("change", (e) => {
  if (e.target && e.target.id === "rowsPerPage") {
    paginaActual = 1;
    aplicarPaginacionTabla();
  }
});

// 🟢 Si ya hay resultados cargados, se actualiza dinámicamente
document.addEventListener("DOMContentLoaded", () => {
  const selector = document.getElementById("rowsPerPage");
  if (selector) {
    selector.addEventListener("change", () => {
      if (window.__ultimoResultado && window.__ultimoResultado.length > 0) {
        renderTabla(window.__ultimoResultado);
      }
    });
  }
});

document.addEventListener("click", (e) => {
  if (e.target && (e.target.id === "btnImprimir" || e.target.closest("#btnImprimir"))) {
    e.preventDefault();

    // Seleccionamos solo la tabla
    const tabla = document.querySelector("#tablaResultados");
    if (!tabla) return alert("No se encontró la tabla para imprimir.");

    // 📏 Dimensiones de la ventana
    const width = 900;
    const height = 650;
    const left = (window.screen.width / 2) - (width / 2);
    const top = (window.screen.height / 2) - (height / 2);

    // Abrimos una nueva ventana temporal para imprimir
    const printWindow = window.open("", "_blank", `width=${width},height=${height},top=${top},left=${left}`);
    printWindow.document.write(`
      <html>
        <head>
          <title>Productos en Stock</title>
          <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet">
          <style>
            table { width: 100%; border-collapse: collapse; }
            th, td { border: 1px solid #dee2e6; padding: 0.5rem; text-align: center; }
            th { background-color: #f8f9fa; }
          </style>
        </head>
        <body>
          ${tabla.outerHTML}
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
    printWindow.close();
  }
});

function mostrarAlertas(resultados) {
  const contenedor = document.getElementById("alertasDashboard");
  contenedor.innerHTML = ""; // Limpiar alertas anteriores

  // === Productos con faltante crítico (>50 unidades) ===
  const faltantesCriticos = resultados.filter(r => r["Cantidad Faltante"] > 50);
  if (faltantesCriticos.length > 0) {
    const alerta = document.createElement("div");
    alerta.className = "alert alert-danger d-flex align-items-center";
    alerta.innerHTML = `
      <i class="bi bi-exclamation-triangle-fill me-2 fs-5"></i>
      <div>
        <strong>${faltantesCriticos.length}</strong> producto(s) con <strong>faltante crítico</strong><br>
        <small class="text-light-emphasis">Detectado en la columna <strong>"Cantidad Faltante"</strong> (valor > 50)</small>
      </div>
    `;
    contenedor.appendChild(alerta);
  }

  // === Productos sin stock disponible ===
  const stockCero = resultados.filter(r => r["Cantidad en Almacén"] === 0);
  if (stockCero.length > 0) {
    const alerta = document.createElement("div");
    alerta.className = "alert alert-warning d-flex align-items-center";
    alerta.innerHTML = `
      <i class="bi bi-exclamation-circle-fill me-2 fs-5"></i>
      <div>
        <strong>${stockCero.length}</strong> producto(s) sin <strong>stock disponible</strong><br>
        <small class="text-dark">Detectado en la columna <strong>"Cantidad en Almacén"</strong> (valor = 0)</small>
      </div>
    `;
    contenedor.appendChild(alerta);
  }

  // === Productos con sobrante muy alto (>100 unidades) ===
  const sobrantesAltos = resultados.filter(r => r["Cantidad Sobrante"] > 100);
  if (sobrantesAltos.length > 0) {
    const alerta = document.createElement("div");
    alerta.className = "alert alert-info d-flex align-items-center";
    alerta.innerHTML = `
      <i class="bi bi-info-circle-fill me-2 fs-5"></i>
      <div>
        <strong>${sobrantesAltos.length}</strong> producto(s) con <strong>sobrante muy alto</strong><br>
        <small class="text-dark">Detectado en la columna <strong>"Cantidad Sobrante"</strong> (valor > 100)</small>
      </div>
    `;
    contenedor.appendChild(alerta);
  }

  // === Si no hay alertas ===
  if (contenedor.innerHTML === "") {
    const alerta = document.createElement("div");
    alerta.className = "alert alert-success d-flex align-items-center";
    alerta.innerHTML = `
      <i class="bi bi-check-circle-fill me-2 fs-5"></i>
      <div>
        Todos los productos se encuentran dentro de los rangos normales ✅
      </div>
    `;
    contenedor.appendChild(alerta);
  }
}

// Exponer la función globalmente para que main.js pueda llamarla
window.initGestionPrecios = initGestionPrecios;