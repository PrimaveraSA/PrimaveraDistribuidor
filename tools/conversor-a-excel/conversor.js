// ================================
// conversor.js (versión final con IDs únicos para modal)
// ================================

function initConversorAExcel() {
  // Evitar múltiples inicializaciones
  if (window.conversorInicializado) return;
  window.conversorInicializado = true;

  const retry = setInterval(() => {
    const fileInput = document.getElementById("fileInput");
    if (fileInput) {
      clearInterval(retry);
      iniciarConversor();
    }
  }, 100);

  function iniciarConversor() {
    const fileInput = document.getElementById("fileInput");
    const dropzone = document.getElementById("dropzone");
    const dzInner = document.querySelector(".dz-inner");
    const convertBtn = document.getElementById("convertBtn");
    const downloadDebug = document.getElementById("downloadDebug");
    const mensajeCarga = document.getElementById("mensajeCarga");
    const mensajeExito = document.getElementById("mensajeExito");
    const progress = document.getElementById("progress");
    const progressBar = document.getElementById("progressBar");

    // === MODAL BOOTSTRAP con IDs únicos ===
    const confirmModalEl = document.getElementById("conv_confirmModal");
    const confirmModal = new bootstrap.Modal(confirmModalEl, {
      backdrop: "static",
      keyboard: false,
    });
    const confirmYes = document.getElementById("conv_confirmYes");
    const confirmNo = document.getElementById("conv_confirmNo");

    let selectedFile = null;
    let convertedExcelBlob = null;
    const accentColor = "#107C41";

    // === Manejo de archivo ===
    fileInput.addEventListener("change", (e) => {
      const file = e.target.files[0];
      actualizarArchivo(file);
    });

    function actualizarArchivo(file) {
      if (file && file.type === "application/pdf") {
        selectedFile = file;
        dzInner.innerHTML = `
          <div class="text-center py-3">
            <div class="mb-3">
              <i class="bi bi-file-earmark-pdf-fill" style="font-size: 3rem; color: ${accentColor};"></i>
            </div>
            <p class="fw-semibold mb-1" style="font-size: 1.1rem;">Archivo seleccionado:</p>
            <p class="mb-2 fw-bold" style="color: ${accentColor};">${file.name}</p>
            <small class="text-muted">Arrastra otro archivo para reemplazarlo o haz clic nuevamente.</small>
          </div>`;
        convertBtn.disabled = false;
        downloadDebug.disabled = true;
      } else {
        selectedFile = null;
        dzInner.innerHTML = `
          <div class="text-center py-4">
            <div class="mb-3">
              <i class="bi bi-upload" style="font-size: 3rem; color: ${accentColor};"></i>
            </div>
            <p class="fw-semibold mb-1" style="font-size: 1.15rem;">Arrastra y suelta tu archivo PDF aquí</p>
            <p class="mb-2 text-muted">o haz clic para seleccionarlo manualmente</p>
            <small class="text-muted">Solo se aceptan archivos PDF. Si está escaneado, usa OCR antes de convertirlo.</small>
          </div>`;
        convertBtn.disabled = true;
        downloadDebug.disabled = true;
      }
    }

    // === Drag & Drop ===
    dropzone.addEventListener("dragover", (e) => {
      e.preventDefault();
      dzInner.classList.add("drag-over");
    });
    dropzone.addEventListener("dragleave", () => dzInner.classList.remove("drag-over"));
    dropzone.addEventListener("drop", (e) => {
      e.preventDefault();
      dzInner.classList.remove("drag-over");
      const file = e.dataTransfer.files[0];
      actualizarArchivo(file);
    });

    // === Simular progreso ===
    function simulateProgress(callback) {
      progress.hidden = false;
      progressBar.style.width = "0%";
      mensajeCarga.classList.remove("d-none");
      mensajeExito.classList.add("d-none");

      let progreso = 0;
      const interval = setInterval(() => {
        progreso += Math.floor(Math.random() * 15) + 5;
        if (progreso >= 100) progreso = 100;
        progressBar.style.width = progreso + "%";
        if (progreso === 100) {
          clearInterval(interval);
          mensajeCarga.classList.add("d-none");
          mensajeExito.classList.remove("d-none");
          setTimeout(() => mensajeExito.classList.add("d-none"), 3000);
          progress.hidden = true;
          progressBar.style.width = "0%";
          if (callback) callback();
        }
      }, 300);
    }

    // === Confirmación con modal Bootstrap ===
    convertBtn.addEventListener("click", () => {
      if (!selectedFile) {
        alert("Por favor selecciona un archivo PDF válido.");
        return;
      }
      confirmModal.show();
    });

    confirmYes.addEventListener("click", () => {
      confirmModal.hide();
      convertirArchivo();
    });

    confirmNo.addEventListener("click", () => confirmModal.hide());

    // === Convertir PDF → Excel ===
    async function convertirArchivo() {
      simulateProgress(async () => {
        try {
          const formData = new FormData();
          formData.append("File", selectedFile);
          formData.append("StoreFile", "true");
          formData.append("IncludeFormatting", "true");
          formData.append("SingleSheet", "true");

          const token = "Bearer kCqsdQdOiaezz0PVGC9tKdKkmGuQsaoV";
          const response = await fetch("https://v2.convertapi.com/convert/pdf/to/xlsx", {
            method: "POST",
            headers: { Authorization: token },
            body: formData,
          });

          if (!response.ok) {
            // Si la API rechaza la solicitud
            mostrarErrorAPI("⚠️ Límite de conversiones alcanzado. No se puede completar la solicitud.");
            throw new Error("Error en la conversión: " + response.statusText);
          }

          const result = await response.json();
          const fileUrl = result.Files[0].Url;
          const fileName = result.Files[0].FileName || "ArchivoConvertido.xlsx";

          // Descargar Excel
          const excelResponse = await fetch(fileUrl);
          const excelBlob = await excelResponse.blob();
          convertedExcelBlob = excelBlob;

          const a = document.createElement("a");
          a.href = URL.createObjectURL(excelBlob);
          a.download = fileName;
          document.body.appendChild(a);
          a.click();
          a.remove();

          downloadDebug.disabled = false;
        } catch (error) {
          console.error(error);
        }
      });
    }

    // === Función para mostrar mensaje de error en pantalla ===
    function mostrarErrorAPI(mensaje) {
      // Evitar crear múltiples toasts
      let toast = document.getElementById("apiErrorToast");
      if (!toast) {
        toast = document.createElement("div");
        toast.id = "apiErrorToast";
        toast.style.position = "fixed";
        toast.style.top = "20px";
        toast.style.right = "20px";
        toast.style.background = "#dc3545"; // rojo alerta
        toast.style.color = "#fff";
        toast.style.padding = "12px 18px";
        toast.style.borderRadius = "8px";
        toast.style.boxShadow = "0 4px 12px rgba(0,0,0,0.25)";
        toast.style.fontSize = "0.95rem";
        toast.style.zIndex = 9999;
        toast.style.display = "flex";
        toast.style.alignItems = "center";
        toast.style.gap = "10px";
        document.body.appendChild(toast);
      }

      toast.textContent = mensaje;
      toast.style.opacity = "1";

      // Desaparece automáticamente después de 5s
      setTimeout(() => {
        toast.style.transition = "opacity 0.4s ease";
        toast.style.opacity = "0";
      }, 5000);
    }


    // === Exportar a CSV ===
    downloadDebug.addEventListener("click", async () => {
      if (!convertedExcelBlob) {
        alert("Primero convierte un archivo a Excel antes de exportar a CSV.");
        return;
      }
      try {
        const data = await convertedExcelBlob.arrayBuffer();
        const workbook = XLSX.read(data, { type: "array" });
        const firstSheet = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheet];
        const csv = XLSX.utils.sheet_to_csv(worksheet);

        const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${firstSheet || "archivo"}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch (err) {
        alert("⚠️ No se pudo generar el CSV: " + err.message);
        console.error(err);
      }
    });
  }
}

/* ======================================================
   🚀 CARGA DINÁMICA - Conversor PDF → Excel
   ====================================================== */
document.querySelectorAll('[data-tool="conversorAExcel"]').forEach(link => {
  link.addEventListener("click", async e => {
    e.preventDefault();

    const iframeContainer = document.getElementById("iframe-container");
    const titleContainer = document.getElementById("tool-title-container");
    const inicioContent = document.getElementById("inicio-content");

    iframeContainer.innerHTML = "";
    titleContainer.innerHTML = "";
    if (inicioContent) inicioContent.style.display = "none";

    if (typeof window.cleanupConversorAExcel === "function") {
      try { window.cleanupConversorAExcel(); } catch (err) { console.warn("Error limpiando conversor:", err); }
    }

    titleContainer.innerHTML = `
      <div class="mb-4 text-start">
        <h3 class="fw-bold" style="color: #1a237e; margin-bottom: 6px;">
          <i class="bi bi-file-earmark-spreadsheet me-2"></i>
          Conversor PDF → Excel
        </h3>
        <p class="text-muted mb-0" style="font-size: 15px;">
          Convierte archivos PDF con tablas o texto directamente a formato Excel (.xlsx)
        </p>
      </div>
    `;

    try {
      const res = await fetch("/tools/conversor-a-excel/conversor.html");
      if (!res.ok) throw new Error("Error al cargar el archivo HTML");
      const html = await res.text();

      iframeContainer.innerHTML = html;
      requestAnimationFrame(() => {
        if (typeof window.initConversorAExcel === "function") {
          window.initConversorAExcel();
        } else {
          console.warn("⚠ initConversorAExcel() no encontrada.");
        }
      });

    } catch (err) {
      iframeContainer.innerHTML = `<p class="text-danger text-center mt-3">❌ Error al cargar el conversor PDF → Excel.</p>`;
      console.error("Error cargando conversor:", err);
    }
  });
});

window.initConversorAExcel = initConversorAExcel;