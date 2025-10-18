// main.js (principal - global)

// =========================================
// 🧭 Cargar herramientas dinámicamente
// =========================================
document.addEventListener("DOMContentLoaded", () => {
  const links = document.querySelectorAll(".sidebar a[data-tool]");
  const iframeContainer = document.getElementById("iframe-container");
  const iframeInicio = document.getElementById("iframe-container_principal");
  const toggleBtn = document.getElementById("toggleSidebarBtn");
  const sidebar = document.getElementById("sidebar");
  const mainContent = document.getElementById("main-content");
  const modal = document.getElementById("conexionModal");
  const modalTitulo = document.getElementById("modalTitulo");
  const modalMensaje = document.getElementById("modalMensaje");
  const recargarBtn = document.getElementById("recargarBtn");
  const toast = document.getElementById("toastConexion");

  // === Mostrar "Inicio" por defecto ===
  if (iframeInicio) iframeInicio.style.display = "block";
  if (iframeContainer) iframeContainer.style.display = "none";

  const inicioLink = document.querySelector('.sidebar a[data-tool="inicio"]');
  if (inicioLink) inicioLink.classList.add("active");

  // === Manejo de clic en herramientas ===
  links.forEach(link => {
    link.addEventListener("click", async e => {
      e.preventDefault();

      const tool = link.getAttribute("data-tool");
      links.forEach(l => l.classList.remove("active"));
      link.classList.add("active");
      iframeContainer.dataset.currentTool = tool;

      if (tool === "inicio") {
        if (iframeInicio) iframeInicio.style.display = "block";
        if (iframeContainer) {
          iframeContainer.innerHTML = "";
          iframeContainer.style.display = "none";
        }
        return;
      }

      if (iframeInicio) iframeInicio.style.display = "none";
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
      case "compararExcel": return "tools/comparar-excel/comparar_excel.html";
      case "controlFacturacion": return "tools/control-facturacion/control_facturacion.html";
      case "conversorAExcel": return "tools/conversor-a-excel/conversor.html";
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

      // 🧹 Limpieza de estados previos
      ["conversorInicializado","_controlFacturacionInicializado","__ultimoResultado","gestionPreciosInicializado"].forEach(k => delete window[k]);
      ["cleanupGestionPrecios","cleanupControlFacturacion","cleanupConversorAExcel"].forEach(fn => {
        if (typeof window[fn] === "function") window[fn]();
      });

      // === Reinyectar scripts de la sección cargada ===
      iframeContainer.querySelectorAll("script").forEach(oldScript => {
        const newScript = document.createElement("script");
        if (oldScript.src) newScript.src = oldScript.src + "?v=" + Date.now();
        else newScript.textContent = oldScript.textContent;
        document.body.appendChild(newScript);
        oldScript.remove();
      });

      // === Inicializar la herramienta correspondiente después de cargar el DOM ===
      await esperarCargaDOM(tool);

    } catch (err) {
      console.error("❌ Error cargando herramienta:", err);
      iframeContainer.innerHTML = "<p class='error-msg'>❌ Error al cargar la herramienta.</p>";
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
          resolve(true);
          return;
        }

        if (tool === "controlFacturacion" && typeof initGeneradorControlFacturacion === "function" &&
            document.querySelector("#downloadBtn, #compareBtn, #excelFile1")) {
          clearInterval(intervalo);
          initGeneradorControlFacturacion();
          resolve(true);
          return;
        }

        if (tool === "conversorAExcel" && typeof initConversorAExcel === "function" &&
            document.querySelector("#convertBtn, #fileInput")) {
          clearInterval(intervalo);
          initConversorAExcel();
          resolve(true);
          return;
        }

        if (intentos >= maxIntentos) {
          clearInterval(intervalo);
          console.warn(`⚠ Timeout esperando DOM para ${tool}.`);
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
      }
      return res;
    } catch (err) {
      if (!navigator.onLine || (err.message && err.message.includes("ERR_CONTENT_LENGTH_MISMATCH"))) {
        mostrarModalConexion("⚠ Error de red", "No se pudo conectar al servidor. Verifica tu internet.");
      }
      throw err;
    }
  };

  // === Toggle sidebar móvil ===
  if (toggleBtn) {
    toggleBtn.addEventListener("click", () => {
      const expanded = sidebar.classList.toggle("expanded");
      mainContent.style.marginLeft = expanded ? "240px" : "80px";
    });
  }

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
