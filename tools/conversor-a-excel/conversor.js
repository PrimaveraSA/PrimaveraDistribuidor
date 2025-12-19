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
        const safeName = escapeHTML(file.name);
        dzInner.innerHTML = `
          <div class="text-center py-3">
            <div class="mb-3">
              <i class="bi bi-file-earmark-pdf-fill" style="font-size: 3rem; color: ${accentColor};"></i>
            </div>
            <p class="fw-semibold mb-1" style="font-size: 1.1rem;">Archivo seleccionado:</p>
            <p class="mb-2 fw-bold" style="color: ${accentColor};">${safeName}</p>
            <small class="text-muted">Arrastra otro archivo para reemplazarlo o haz clic nuevamente.</small>
          </div>`;
        convertBtn.disabled = false;
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

    // === Progreso concurrente (no bloquea la conversión) ===
    function startProgress() {
      progress.hidden = false;
      progressBar.style.width = "0%";
      mensajeCarga.classList.remove("d-none");
      mensajeExito.classList.add("d-none");

      let progreso = 0;
      const interval = setInterval(() => {
        progreso += Math.floor(Math.random() * 15) + 5;
        if (progreso > 95) progreso = 95; // no completar hasta terminar
        progressBar.style.width = progreso + "%";
      }, 300);

      return function stop(success) {
        clearInterval(interval);
        progressBar.style.width = "100%";
        setTimeout(() => {
          progress.hidden = true;
          progressBar.style.width = "0%";
        }, 300);
        mensajeCarga.classList.add("d-none");
        if (success) {
          mensajeExito.classList.remove("d-none");
          setTimeout(() => mensajeExito.classList.add("d-none"), 4000);
        }
      };
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
      const stopProgress = startProgress();
      try {
        mensajeCarga.classList.remove("d-none");
        mensajeExito.classList.add("d-none");

          const formData = new FormData();
          formData.append("File", selectedFile);
          formData.append("StoreFile", "true");
          formData.append("IncludeFormatting", "true");
          formData.append("SingleSheet", "true");

          let token = await getConvertApiTokenWithRetry(2500);
          if (!token) {
            setTokenGuideVisible(true);
            token = await openTokenModal("missing");
            if (token) {
              await saveTokenToSupabase(token);
            } else {
              alert("Debes proporcionar un token de ConvertAPI para continuar.");
              stopProgress(false);
              return;
            }
          }
          token = typeof token === "string" ? token.trim().replace(/^['"]|['"]$/g, "") : token;
          let response = await fetch("https://v2.convertapi.com/convert/pdf/to/xlsx", {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
            body: formData,
          });

          let result;
          try { result = await response.json(); } catch (_) { result = {}; }
          if (!response.ok || !result || !result.Files || !result.Files[0] || !result.Files[0].Url) {
            if (response.status === 401 || response.status === 403) {
              let silentRetried = false;
              if (token) {
                silentRetried = true;
                response = await fetch("https://v2.convertapi.com/convert/pdf/to/xlsx", {
                  method: "POST",
                  headers: { Authorization: `Bearer ${token}` },
                  body: formData,
                });
                try { result = await response.json(); } catch (_) { result = {}; }
                if (response.ok && result && result.Files && result.Files[0] && result.Files[0].Url) {
                  // continúa flujo normal
                } else {
                  // requiere pedir nuevo token
                  setTokenGuideVisible(true);
                  const newToken = await handleTokenFailure(result);
                  if (newToken) {
                    token = typeof newToken === "string" ? newToken.trim().replace(/^['"]|['"]$/g, "") : newToken;
                    response = await fetch("https://v2.convertapi.com/convert/pdf/to/xlsx", {
                      method: "POST",
                      headers: { Authorization: `Bearer ${token}` },
                      body: formData,
                    });
                    try { result = await response.json(); } catch (_) { result = {}; }
                    if (!response.ok || !result || !result.Files || !result.Files[0] || !result.Files[0].Url) {
                      stopProgress(false);
                      return;
                    }
                  } else {
                    stopProgress(false);
                    return;
                  }
                }
              } else {
              setTokenGuideVisible(true);
              const newToken = await handleTokenFailure(result);
              if (newToken) {
                token = typeof newToken === "string" ? newToken.trim().replace(/^['"]|['"]$/g, "") : newToken;
                response = await fetch("https://v2.convertapi.com/convert/pdf/to/xlsx", {
                  method: "POST",
                  headers: { Authorization: `Bearer ${token}` },
                  body: formData,
                });
                try { result = await response.json(); } catch (_) { result = {}; }
                if (!response.ok || !result || !result.Files || !result.Files[0] || !result.Files[0].Url) {
                  stopProgress(false);
                  return;
                }
              } else {
                stopProgress(false);
                return;
              }
              }
            } else {
              setTokenGuideVisible(false);
              stopProgress(false);
              return;
            }
          }
          const fileUrl = result.Files[0].Url;
          const fileName = result.Files[0].FileName || "ArchivoConvertido.xlsx";

          const excelResponse = await fetch(fileUrl);
          const excelBlob = await excelResponse.blob();
          convertedExcelBlob = excelBlob;

          const a = document.createElement("a");
          a.href = URL.createObjectURL(excelBlob);
          a.download = fileName;
          document.body.appendChild(a);
          a.click();
          a.remove();

          const count = await incrementTokenCounter(token);
          if (typeof count === "number") {
            const remaining = 250 - count;
            const msg = `¡Conversión completada correctamente! Uso del token: ${count}/250${remaining <= 10 ? " (quedan " + remaining + ")" : ""}`;
            if (mensajeExito) mensajeExito.innerHTML = `<i class="bi bi-check-circle me-2"></i> ${msg}`;
            if (remaining <= 0) alert("Se alcanzó el límite de 250 conversiones del token actual.");
          }

          // 🔹 Finalizar progreso con éxito
          stopProgress(true);

          setTokenGuideVisible(false);

      } catch (error) {
        console.error(error);
        mensajeCarga.classList.add("d-none");
        alert("Ocurrió un error durante la conversión. Intenta nuevamente.");
        setTokenGuideVisible(true);
        stopProgress(false);
      }
    }

    // (CSV eliminado)
  }
}

/* ======================================================
   CARGA DINÁMICA - Conversor PDF → Excel
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
        <div id="convTokenGuide" class="conv-token-guide mt-3 hidden">
          <div class="conv-token-header">
            <i class="bi bi-shield-lock me-2"></i>
            <span class="fw-semibold">Cómo obtener y usar tu token de ConvertAPI</span>
          </div>
          <div class="conv-token-body">
            <ol class="mb-2 ps-3">
              <li><a href="https://www.convertapi.com/" target="_blank" rel="noopener">Abre convertapi.com</a> y entra con tu cuenta de Google.</li>
              <li>Ve a <span style="color:#ff6f61; text-decoration:underline;">https://www.convertapi.com/a/api/pdf-to-xlsx</span>.</li>
              <li>En el lado derecho, el cuadro "Code snippet". Cambia a <b>JavaScript</b> y copia el texto que está entre comillas en:<br>
                <code>let convertApi = ConvertApi.auth('<span style="color:#ff6f61; font-weight:600;">TU_TOKEN_AQUI</span>')</code>
              </li>
            </ol>
            <div class="small">Cuándo pegarlo: al presionar "Convertir" se abrirá un modal con candado rojo. Pega tu token allí y pulsa "Guardar".</div>
          </div>
        </div>
      </div>
    `;
  });
});

window.initConversorAExcel = initConversorAExcel;

function escapeHTML(str = "") {
  return String(str).replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c] || c);
}

async function supaClient() {
  return window.SUPABASE_CLIENT || window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_KEY);
}

async function fetchTokenFromSupabase() {
  try {
    const supa = await supaClient();
    const { data, error } = await supa.from("convertapi_tokens").select("token,created_at").order("created_at", { ascending: false }).limit(1);
    if (error) return "";
    const row = (data && data[0]) || null;
    const t = row ? row.token : "";
    return typeof t === "string" ? t.trim().replace(/^['"]|['"]$/g, "") : "";
  } catch (_) { return ""; }
}

async function saveTokenToSupabase(token) {
  try {
    token = typeof token === "string" ? token.trim().replace(/^['"]|['"]$/g, "") : token;
    const supa = await supaClient();
    const { data, error } = await supa
      .from("convertapi_tokens")
      .select("id, contador_token")
      .eq("token", token)
      .limit(1);
    if (error) return false;
    const row = (data && data[0]) || null;
    if (row) {
      return true;
    }
    const { error: insErr } = await supa.from("convertapi_tokens").insert({ token, contador_token: 0 });
    return !insErr;
  } catch (_) { return false; }
}

async function incrementTokenCounter(token) {
  try {
    token = typeof token === "string" ? token.trim().replace(/^['"]|['"]$/g, "") : token;
    const supa = await supaClient();
    let { data, error } = await supa
      .from("convertapi_tokens")
      .select("id, contador_token, created_at")
      .eq("token", token)
      .order("created_at", { ascending: false })
      .limit(1);
    if (error) return null;
    let row = (data && data[0]) || null;
    if (!row) {
      const saved = await saveTokenToSupabase(token);
      if (!saved) return null;
      ({ data, error } = await supa
        .from("convertapi_tokens")
        .select("id, contador_token, created_at")
        .eq("token", token)
        .order("created_at", { ascending: false })
        .limit(1));
      if (error) return null;
      row = (data && data[0]) || null;
      if (!row) return null;
    }
    const current = parseFloat(row.contador_token ?? 0);
    const next = isNaN(current) ? 1 : Math.min(current + 1, 250);
    const { error: upErr } = await supa.from("convertapi_tokens").update({ contador_token: next }).eq("id", row.id);
    if (upErr) return null;
    return next;
  } catch (_) {
    return null;
  }
}

function ensureTokenModal() {
  let el = document.getElementById("conv_tokenModal");
  if (!el) {
    const div = document.createElement("div");
    div.innerHTML = `
      <div class="modal fade" id="conv_tokenModal" tabindex="-1" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered">
          <div class="modal-content">
            <div class="modal-header" style="background:#9c1f1f;color:#fff;">
              <h5 class="modal-title">Token de ConvertAPI</h5>
              <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Close"></button>
            </div>
            <div class="modal-body">
              <p class="mb-2" style="font-size:14px;">Ingresa tu token de ConvertAPI. Se guardará temporalmente en esta sesión y se registrará en tu base de datos para poder reutilizarlo.</p>
              <div class="input-group">
                <input id="conv_tokenInput" type="password" class="form-control" autocomplete="off" placeholder="Token"/>
                <button class="btn btn-outline-secondary" type="button" id="conv_tokenReveal"><i class="bi bi-eye"></i></button>
              </div>
              <div class="form-text mt-2">No compartas este token. Úsalo sólo para la conversión.</div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" id="conv_tokenCancel">Cancelar</button>
              <button type="button" class="btn btn-primary" id="conv_tokenSave">Guardar</button>
            </div>
          </div>
        </div>
      </div>`;
    document.body.appendChild(div.firstElementChild);
    el = document.getElementById("conv_tokenModal");
    const reveal = el.querySelector("#conv_tokenReveal");
    const input = el.querySelector("#conv_tokenInput");
    reveal.addEventListener("click", () => {
      input.type = input.type === "password" ? "text" : "password";
      const icon = reveal.querySelector("i");
      if (icon) icon.className = input.type === "password" ? "bi bi-eye" : "bi bi-eye-slash";
    });
  }
  return el;
}

async function openTokenModal(reason) {
  const el = ensureTokenModal();
  const modal = new bootstrap.Modal(el, { backdrop: "static", keyboard: false });
  const input = el.querySelector("#conv_tokenInput");
  const btnCancel = el.querySelector("#conv_tokenCancel");
  const btnSave = el.querySelector("#conv_tokenSave");
  input.value = "";
  return new Promise((resolve) => {
    const onCancel = () => { btnCancel.removeEventListener("click", onCancel); btnSave.removeEventListener("click", onSave); modal.hide(); resolve(""); };
    const onSave = () => { const v = (input.value || "").trim(); btnCancel.removeEventListener("click", onCancel); btnSave.removeEventListener("click", onSave); modal.hide(); resolve(v); };
    btnCancel.addEventListener("click", onCancel);
    btnSave.addEventListener("click", onSave);
    modal.show();
    input.focus();
  });
}

async function getConvertApiToken() {
  const fromDb = await fetchTokenFromSupabase();
  if (fromDb) return fromDb;
  const token = await openTokenModal("missing");
  if (token) {
    await saveTokenToSupabase(token);
    return token;
  }
  return "";
}

// Intento con espera para cuando Supabase todavía no está listo
async function getConvertApiTokenWithRetry(maxWaitMs = 2000) {
  const start = Date.now();
  while (!window.SUPABASE_CLIENT && !window.supabase && Date.now() - start < maxWaitMs) {
    await new Promise(r => setTimeout(r, 100));
  }
  let token = await fetchTokenFromSupabase();
  if (token) return token;
  token = await openTokenModal("missing");
  if (token) {
    await saveTokenToSupabase(token);
    return token;
  }
  return "";
}

async function handleTokenFailure(result) {
  const token = await openTokenModal("expired");
  if (!token) return "";
  await saveTokenToSupabase(token);
  return token;
}

function setTokenGuideVisible(visible) {
  let guide = document.getElementById("convTokenGuide");
  if (!guide) {
    const container = document.getElementById("tool-title-container") || document.body;
    const div = document.createElement("div");
    div.id = "convTokenGuide";
    div.className = "conv-token-guide mt-3";
    div.innerHTML = `
      <div class="conv-token-header">
        <i class="bi bi-shield-lock me-2"></i>
        <span class="fw-semibold">Cómo obtener y usar tu token de ConvertAPI</span>
      </div>
      <div class="conv-token-body">
        <ol class="mb-2 ps-3">
          <li><a href="https://www.convertapi.com/" target="_blank" rel="noopener">Abre convertapi.com</a> y entra con tu cuenta de Google.</li>
          <li>Ve a <span style="color:#ff6f61; text-decoration:underline;">https://www.convertapi.com/a/api/pdf-to-xlsx</span>.</li>
          <li>En el lado derecho, el cuadro "Code snippet". Cambia a <b>JavaScript</b> y copia el texto que está entre comillas en:<br>
            <code>let convertApi = ConvertApi.auth('<span style="color:#ff6f61; font-weight:600;">TU_TOKEN_AQUI</span>')</code>
          </li>
        </ol>
        <div class="small">Cuándo pegarlo: al presionar "Convertir" se abrirá un modal con candado rojo. Pega tu token allí y pulsa "Guardar".</div>
      </div>
    `;
    container.appendChild(div);
    guide = document.getElementById("convTokenGuide");
  }
  if (visible) {
    guide.classList.remove("hidden");
    guide.classList.remove("d-none");
  } else {
    guide.classList.add("hidden");
    guide.classList.add("d-none");
  }
}
