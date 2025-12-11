"use strict";
// main.js (principal - global)

// =========================================
// Cargar herramientas dinámicamente
// =========================================
document.addEventListener("DOMContentLoaded", () => {
  const links = document.querySelectorAll(".sidebar a[data-tool]");
  const allNavLinks = document.querySelectorAll(".sidebar .nav-link");
  const iframeContainer = document.getElementById("iframe-container");
  const iframeInicio = document.getElementById("iframe-container_principal");
  const titleContainer = document.getElementById("tool-title-container");
  const inicioContent = document.getElementById("inicio-content");
  const toggleBtn = document.getElementById("toggleSidebarBtn");
  const sidebar = document.getElementById("sidebar");
  const mainContent = document.getElementById("main-content");
  const modal = document.getElementById("conexionModal");
  const modalTitulo = document.getElementById("modalTitulo");
  const modalMensaje = document.getElementById("modalMensaje");
  const recargarBtn = document.getElementById("recargarBtn");
  const toast = document.getElementById("toastConexion");
  const chevrons = document.querySelectorAll('.collapse-toggle');
  const rows = document.querySelectorAll('.sidebar .nav-item > .d-flex');

  // === Mostrar "Inicio" por defecto ===
  if (iframeInicio) iframeInicio.style.display = "block";
  if (iframeContainer) iframeContainer.style.display = "none";

  const inicioLink = document.querySelector('.sidebar a[data-tool="inicio"]');
  if (inicioLink) inicioLink.classList.add("active");

  // === Utilidad para marcar activo ===
  function clearActive(){
    allNavLinks.forEach(a => a.classList.remove('active'));
    chevrons.forEach(b => b.classList.remove('active'));
    rows.forEach(r => r.classList.remove('activeRow'));
  }
  function setActive(el){ clearActive(); if (el) el.classList.add('active'); }
  function setActiveHeaderRow(item){
    clearActive();
    const header = item && item.querySelector('.header-toggle');
    const chev = item && item.querySelector('.collapse-toggle');
    const row = item && item.querySelector('.d-flex');
    if (header) header.classList.add('active');
    if (chev) chev.classList.add('active');
    if (row) row.classList.add('activeRow');
  }

  // === Manejo de clic en herramientas ===
  links.forEach(link => {
    link.addEventListener("click", async e => {
      e.preventDefault();

      const tool = link.getAttribute("data-tool");
      setActive(link);
      iframeContainer.dataset.currentTool = tool;

      if (tool === "inicio") {
        if (iframeInicio) iframeInicio.style.display = "block";
        if (iframeContainer) {
          iframeContainer.innerHTML = "";
          iframeContainer.style.display = "none";
        }
        if (inicioContent) inicioContent.style.display = "block";
        if (titleContainer) titleContainer.innerHTML = "";
        return;
      }

      if (iframeInicio) iframeInicio.style.display = "none";
      if (inicioContent) inicioContent.style.display = "none";
      if (titleContainer) titleContainer.innerHTML = "";
      if (iframeContainer) {
        iframeContainer.style.display = "block";
        iframeContainer.innerHTML = "<p class='loading-msg'>Cargando herramienta...</p>";
      }

      const url = generarURL(tool);
      if (url) await cargarHTML(url, tool);
      else iframeContainer.innerHTML = "<p>En mantenimiento, seleccione otra herramienta.</p>";
    });
  });

  // === Generar URL de herramienta según data-tool ===
  function generarURL(tool) {
    switch (tool) {
      case "controlFacturacion": return "tools/control-facturacion/control_facturacion.html";
      case "conversorAExcel": return "tools/conversor-a-excel/conversor.html";
      case "inventarioPedidos": return "tools/control-precios/control_precios.html";
      case "controlPreciosComparacion": return "tools/control-precios/control_precios.html";
      case "controlPreciosPorcentajes": return "tools/control-precios/porcentajes_only.html";
      case "controlPreciosEjemplo": return "tools/control-precios/control_precios.html";
      case "gestionPrecios": return "tools/gestion-precios/gestion_precios.html";
      default: return "";
    }
  }

  // === Cargar HTML dinámico ===
  async function cargarHTML(ruta, tool) {
    try {
      const res = await fetch(ruta + "?v=" + Date.now());
      if (!res.ok) throw new Error("Error al cargar el archivo HTML");

      const html = await res.text();
      iframeContainer.innerHTML = html;
      try {
        if (titleContainer) {
          if (tool === "controlPreciosComparacion") {
            titleContainer.innerHTML = `
              <div class="mb-3 text-start">
                <h3 class="fw-bold" style="color: #1a237e;"><i class="bi bi-sliders me-2"></i> Comparación de Precios</h3>
                <p class="text-muted mb-0">Compara archivos de referencia y maestro para detectar coincidencias y diferencias.</p>
              </div>`;
          } else if (tool === "controlPreciosPorcentajes") {
            titleContainer.innerHTML = `
              <div class="mb-3 text-start">
                <h3 class="fw-bold" style="color: #1a237e;"><i class="bi bi-percent me-2"></i> Ajustes por Porcentajes</h3>
                <p class="text-muted mb-0">Aplica reglas de porcentaje por marca, línea y unidad.</p>
              </div>`;
          } else if (tool === "gestionPrecios") {
            titleContainer.innerHTML = `
              <div class="mb-3 text-start">
                <h3 class="fw-bold" style="color: #1a237e;"><i class="bi bi-diagram-3 me-2"></i> Comparar Productos en Stock</h3>
                <p class="text-muted mb-0">Compara productos solicitados contra el inventario del sistema.</p>
              </div>`;
          } else if (tool === "controlFacturacion") {
            titleContainer.innerHTML = `
              <div class="mb-3 text-start">
                <h3 class="fw-bold" style="color: #1a237e;"><i class="bi bi-file-earmark-text me-2"></i> Control de Registros</h3>
                <p class="text-muted mb-0">Compara dos archivos Excel y genera un reporte PDF con las diferencias.</p>
              </div>`;
          } else if (tool === "conversorAExcel") {
            titleContainer.innerHTML = `
              <div class="mb-3 text-start">
                <h3 class="fw-bold" style="color: #1a237e;"><i class="bi bi-file-earmark-spreadsheet me-2"></i> Conversor PDF → Excel</h3>
                <p class="text-muted mb-0">Convierte archivos PDF con tablas o texto directamente a formato Excel (.xlsx).</p>
              </div>`;
          }
        }
      } catch {}

      //Limpieza de estados previos
      ["conversorInicializado","_controlFacturacionInicializado","__ultimoResultado","gestionPreciosInicializado","_controlPreciosInicializado"].forEach(k => delete window[k]);
      ["cleanupGestionPrecios","cleanupControlFacturacion","cleanupConversorAExcel"].forEach(fn => {
        if (typeof window[fn] === "function") window[fn]();
      });

      // === Reinyectar solo scripts externos de la sección cargada (no inline) ===
      // Evitar duplicar scripts externos entre herramientas
      window.__loadedScripts = window.__loadedScripts || new Set();
      iframeContainer.querySelectorAll("script").forEach(oldScript => {
        if (oldScript.src) {
          try {
            const base = new URL(oldScript.src, location.href);
            const key = base.origin + base.pathname; // ignorar query
            if (!window.__loadedScripts.has(key)) {
              const newScript = document.createElement("script");
              newScript.defer = true;
              newScript.src = oldScript.src + "?v=" + Date.now();
              newScript.onerror = () => { setToolHealth(tool, "warning", "Script no cargó: " + oldScript.src); };
              document.body.appendChild(newScript);
              window.__loadedScripts.add(key);
            }
          } catch {}
        }
        oldScript.remove();
      });

      // === Inicializar la herramienta correspondiente después de cargar el DOM ===
      await esperarCargaDOM(tool);
      // Cerrar menú móvil tras cargar la herramienta para evitar desplazamientos
      try { if (typeof toggleBtn !== 'undefined') { const isMobile = () => window.matchMedia('(max-width: 768px)').matches; if (isMobile()) { const overlay = document.getElementById('sidebarOverlay'); const sidebar = document.getElementById('sidebar'); if (sidebar) sidebar.classList.remove('mobile-open'); if (overlay) overlay.classList.remove('show'); document.body.classList.remove('mobile-locked'); } } } catch {}

    } catch (err) {
      console.error("Error cargando herramienta:", err);
      iframeContainer.innerHTML = "<p class='error-msg'>Error al cargar la herramienta.</p>";
      setToolHealth(tool, "offline", "HTML no cargó");
    }
  }

  async function esperarCargaDOM(tool) {
    return new Promise(resolve => {
      let intentos = 0;
      const maxIntentos = 50;
      const intervalo = setInterval(() => {
        intentos++;

        // Inicializar cada herramienta cuando el DOM esté listo
        if (tool === "gestionPrecios" && typeof initGestionPrecios === "function" && document.querySelector("#compararBtn")) {
          clearInterval(intervalo);
          initGestionPrecios();
          setToolHealth(tool, "ok");
          resolve(true);
          return;
        }

        if (tool === "inventarioPedidos" && typeof initControlPrecios === "function" && document.querySelector("#processBtn, #fileInput")) {
          clearInterval(intervalo);
          initControlPrecios();
          setToolHealth(tool, "ok");
          resolve(true);
          return;
        }

        if (tool === "controlPreciosComparacion" && typeof initControlPrecios === "function" && document.querySelector("#processBtn, #fileInput")) {
          clearInterval(intervalo);
          initControlPrecios();
          setToolHealth(tool, "ok");
          resolve(true);
          return;
        }

        if (tool === "controlPreciosPorcentajes" && typeof initPorcentajesOnly === "function" && document.querySelector("#fileInput, #downloadPorcBtn")) {
          clearInterval(intervalo);
          initPorcentajesOnly();
          setToolHealth(tool, "ok");
          resolve(true);
          return;
        }

        if (tool === "controlFacturacion" && typeof initGeneradorControlFacturacion === "function" &&
            document.querySelector("#downloadBtn, #compareBtn, #excelFile1")) {
          clearInterval(intervalo);
          initGeneradorControlFacturacion();
          setToolHealth(tool, "ok");
          resolve(true);
          return;
        }

        if (tool === "conversorAExcel" && typeof initConversorAExcel === "function" &&
            document.querySelector("#convertBtn, #fileInput")) {
          clearInterval(intervalo);
          initConversorAExcel();
          setToolHealth(tool, "ok");
          resolve(true);
          return;
        }

        if (intentos >= maxIntentos) {
          clearInterval(intervalo);
          console.warn(`⚠ Timeout esperando DOM para ${tool}.`);
          setToolHealth(tool, "warning", "Timeout inicialización");
          resolve(false);
        }
      }, 100);
    });
  }

  // =======================
  // Interceptar fetch para errores de red
  // =======================
  const originalFetch = window.fetch;
  window.fetch = async (...args) => {
    try {
      const res = await originalFetch(...args);
      if (!res.ok && res.status === 0) {
        mostrarModalConexion("⚠ Error de descarga", "Un archivo no se pudo descargar completamente. Esto puede ser un problema de internet.");
        if (typeof window.__setServidoresStatus === "function") window.__setServidoresStatus("warning", "Descarga incompleta");
      }
      try {
        const url = typeof args[0] === "string" ? args[0] : (args[0] && args[0].url) || "";
        const actMeta = document.querySelector("meta[name='activity-endpoint']");
        const renderOrigin = actMeta && actMeta.content ? new URL(actMeta.content, location.href).origin : "";
        const supOrigin = (window.SUPABASE_URL || "");
        const origin = url ? new URL(url, location.href).origin : "";
        if (!res.ok) {
          if (origin && renderOrigin && origin === renderOrigin) {
            if (typeof window.__setServidoresStatus === "function") window.__setServidoresStatus("offline", "Servidor no responde");
          } else if (origin && supOrigin && url.startsWith(supOrigin)) {
            if (typeof window.__setServidoresStatus === "function") window.__setServidoresStatus("warning", "Supabase error");
          } else if (typeof window.__setServidoresStatus === "function") {
            window.__setServidoresStatus("warning", "Error HTTP");
          }
        } else {
          if (typeof window.__setServidoresStatus === "function") window.__setServidoresStatus("online");
        }
      } catch {}
      return res;
    } catch (err) {
      if (!navigator.onLine || (err.message && err.message.includes("ERR_CONTENT_LENGTH_MISMATCH"))) {
        mostrarModalConexion("⚠ Error de red", "No se pudo conectar al servidor. Verifica tu internet.");
        if (typeof window.__setServidoresStatus === "function") window.__setServidoresStatus("offline", "Sin conexión");
      }
      throw err;
    }
  };

  // === Toggle sidebar móvil ===
  if (toggleBtn) {
    const overlay = document.getElementById("sidebarOverlay");
    const isMobile = () => window.matchMedia('(max-width: 768px)').matches;
    function syncSidebarMode(){
      if (isMobile()) {
        sidebar.classList.remove('expanded');
        mainContent.style.marginLeft = '';
      }
    }
    syncSidebarMode();
    window.addEventListener('resize', syncSidebarMode);
    function openMobile(){ sidebar.classList.add("mobile-open"); if(overlay) overlay.classList.add("show"); document.body.classList.add("mobile-locked"); }
    function closeMobile(){ sidebar.classList.remove("mobile-open"); if(overlay) overlay.classList.remove("show"); document.body.classList.remove("mobile-locked"); }
    toggleBtn.addEventListener("click", () => {
      if (isMobile()) {
        if (sidebar.classList.contains("mobile-open")) closeMobile(); else openMobile();
      } else {
        const expanded = sidebar.classList.toggle("expanded");
        mainContent.style.marginLeft = expanded ? "240px" : "80px";
      }
    });
    if (overlay) overlay.addEventListener("click", closeMobile);
    document.addEventListener("keyup", e=>{ if(e.key==="Escape") closeMobile(); });
    // Cerrar al navegar
    document.querySelectorAll(".sidebar a[data-tool], .sidebar .nav-link, .sidebar .collapse-toggle, .sidebar .header-toggle").forEach(a=> a.addEventListener("click", ()=>{ if(isMobile()) closeMobile(); }));
  }

  // === Colapsables del sidebar sin alterar ancho ===
  function toggleSubmenuBy(item){
    const submenu = item && item.querySelector('.submenu');
    const btn = item.querySelector('.collapse-toggle');
    if (!submenu || !btn) return;
    const expanded = btn.getAttribute('aria-expanded') === 'true';
    const icon = btn.querySelector('i');
    btn.setAttribute('aria-expanded', String(!expanded));
    submenu.style.display = expanded ? 'none' : 'block';
    const header = item.querySelector('.header-toggle');
    if (header) header.setAttribute('aria-expanded', String(!expanded));
    if (icon) icon.className = expanded ? 'bi bi-chevron-right' : 'bi bi-chevron-down';
  }

  document.querySelectorAll('.collapse-toggle').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault();
      const item = btn.closest('.nav-item');
      toggleSubmenuBy(item);
      setActiveHeaderRow(item);
    });
  });

  // Abrir/cerrar al pulsar todo el encabezado
  document.querySelectorAll('.header-toggle').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      const item = link.closest('.nav-item');
      toggleSubmenuBy(item);
      setActiveHeaderRow(item);
    });
  });

  // =======================
  // Modal conexión
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
  // Toast conexión
  // =======================
  function mostrarToastConexion(mensaje = "✅ Conexión restablecida", duracion = 3000) {
    if (!toast) return;
    const icon = toast.querySelector(".toast-icon");
    const message = toast.querySelector(".toast-message");
    const closeBtn = toast.querySelector(".toast-close");

    const emojiMatch = mensaje.match(/^([^\w\s]+)/);
    if (emojiMatch && icon) {
      icon.textContent = emojiMatch[1];
      message.textContent = mensaje.replace(emojiMatch[1], "").trim();
    } else {
      message.textContent = mensaje;
    }

    toast.style.display = "flex";
    toast.style.opacity = "1";
    toast.style.transform = "translateY(0)";
    toast.style.transition = "opacity 0.4s ease, transform 0.4s ease";

    const timeout = setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateY(20px)";
      setTimeout(() => (toast.style.display = "none"), 400);
    }, duracion);

    if (closeBtn) {
      closeBtn.onclick = () => {
        clearTimeout(timeout);
        toast.style.opacity = "0";
        toast.style.transform = "translateY(20px)";
        setTimeout(() => (toast.style.display = "none"), 400);
      };
    }
  }

  // =======================
  // Botón recargar
  // =======================
  recargarBtn.addEventListener("click", () => {
    if (navigator.onLine) {
      window.location.reload();
    } else {
      modalTitulo.textContent = "🚫 Sin conexión";
      modalMensaje.textContent = "Aún no tienes conexión a internet. Reintenta más tarde.";
      recargarBtn.textContent = "Reintentar";
      recargarBtn.disabled = true;
      recargarBtn.style.opacity = "0.6";

      const checkInterval = setInterval(() => {
        if (navigator.onLine) {
          clearInterval(checkInterval);
          recargarBtn.disabled = false;
          recargarBtn.style.opacity = "1";
          recargarBtn.textContent = "Recargar";
          modalTitulo.textContent = "✅ Conexión recuperada";
          modalMensaje.textContent = "Ya puedes recargar la página.";
        }
      }, 3000);
    }
  });

  // =======================
  // Eventos conexión
  // =======================
  window.addEventListener("offline", () => {
    if (!navigator.onLine) mostrarModalConexion();
  });

  window.addEventListener("online", () => {
    ocultarModal();
    mostrarToastConexion("✅ ¡Conexión restablecida!");
  });
});
  // === Fecha, hora y estado de conexión ===
  (function initFechaHoraYEstado() {
    const fechaEl = document.getElementById("fechaActual");
    const horaEl = document.getElementById("horaActual");
    const servidores = document.getElementById("servidoresStatus");

    if (fechaEl) {
      const fecha = new Date();
      const dia = String(fecha.getDate()).padStart(2, "0");
      const mes = String(fecha.getMonth() + 1).padStart(2, "0");
      const anio = fecha.getFullYear();
      fechaEl.textContent = `${dia}/${mes}/${anio}`;
    }

    function actualizarHora() {
      if (!horaEl) return;
      const now = new Date();
      const h = String(now.getHours()).padStart(2, "0");
      const m = String(now.getMinutes()).padStart(2, "0");
      const s = String(now.getSeconds()).padStart(2, "0");
      horaEl.textContent = `${h}:${m}:${s}`;
    }
    actualizarHora();
    setInterval(actualizarHora, 1000);

    window.__setServidoresStatus = function(state, reason){
      if (!servidores) return;
      if (state === "online") { servidores.textContent = "Online ✓"; servidores.className = "text-success"; servidores.title = ""; }
      else if (state === "offline") { servidores.textContent = "Offline"; servidores.className = "text-danger"; servidores.title = reason || ""; }
      else { servidores.textContent = "Warning"; servidores.className = "text-warning"; servidores.title = reason || ""; }
    };

    function actualizarEstado() {
      if (!servidores) return;
      if (navigator.onLine) { window.__setServidoresStatus("online"); } else { window.__setServidoresStatus("offline", "Sin internet"); }
    }
    actualizarEstado();
    window.addEventListener("online", actualizarEstado);
    window.addEventListener("offline", actualizarEstado);

    async function checkBackends(){
      if (!servidores) return;
      if (!navigator.onLine) { window.__setServidoresStatus("offline", "Sin internet"); return; }
      try {
        const actMeta = document.querySelector("meta[name='activity-endpoint']");
        const ep = actMeta && actMeta.content ? actMeta.content : "";
        if (ep) {
          const ctrl = new AbortController(); const t = setTimeout(()=> ctrl.abort(), 5000);
          const r = await fetch(ep + "?health=1", { method:"GET", mode:"cors", cache:"no-store", signal: ctrl.signal });
          clearTimeout(t);
          if (!r.ok) { window.__setServidoresStatus("offline", "Render falló"); return; }
        }
        if (window.SUPABASE_URL && window.SUPABASE_KEY) {
          const u = window.SUPABASE_URL.replace(/\/$/, "") + "/rest/v1/";
          const r2 = await fetch(u, { method: "OPTIONS", headers: { apikey: window.SUPABASE_KEY, Authorization: "Bearer " + window.SUPABASE_KEY }, mode: "cors" });
          if (!r2.ok) { window.__setServidoresStatus("warning", "Supabase falló"); return; }
        }
        window.__setServidoresStatus("online");
      } catch { window.__setServidoresStatus("offline", "Backends sin respuesta"); }
    }
    checkBackends();
    setInterval(checkBackends, 15000);
  })();
  // === Estado de herramientas ===
  window.__toolsHealth = window.__toolsHealth || {};
  function setToolHealth(tool, state, reason){
    window.__toolsHealth[tool] = { state: state || "ok", reason: reason || "" };
    updateToolsStatus();
  }
  function updateToolsStatus(){
    const item = document.getElementById("toolsStatusItem");
    const icon = document.getElementById("toolsStatusIcon");
    const msg = document.getElementById("toolsStatus");
    if (!item || !icon || !msg) return;
    const entries = Object.entries(window.__toolsHealth||{});
    const offline = entries.filter(([_,v])=> v.state === "offline").map(([k])=> k);
    const warn = entries.filter(([_,v])=> v.state === "warning").map(([k])=> k);
    if (offline.length > 0) {
      item.classList.remove("text-success","text-warning"); icon.className = "bi bi-exclamation-octagon text-danger me-1";
      msg.textContent = `Herramientas con fallas: ${offline.join(", ")}`;
    } else if (warn.length > 0) {
      item.classList.remove("text-success"); icon.className = "bi bi-exclamation-triangle text-warning me-1";
      msg.textContent = `Herramientas con advertencias: ${warn.join(", ")}`;
    } else {
      icon.className = "bi bi-check-circle text-success me-1";
      msg.textContent = "Todas las herramientas activas.";
    }
  }
