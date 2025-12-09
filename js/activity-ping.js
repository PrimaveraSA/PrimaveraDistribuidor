"use strict";
import { supabaseUrl, supabaseKey } from "./DB.js";
(() => {
  const meta = document.querySelector('meta[name="activity-endpoint"]');
  const urlParam = new URLSearchParams(location.search).get("activity-endpoint") || "";
  const stored = sessionStorage.getItem("ACTIVITY_ENDPOINT") || localStorage.getItem("ACTIVITY_ENDPOINT") || "";
  const rawEndpoint = (urlParam || stored || (meta && meta.content) || "/actividad");
  const isServerEndpoint = /^https?:\/\//i.test(rawEndpoint);
  const endpoint = isServerEndpoint ? rawEndpoint : "img/IconoLogo.png";
  let lastSent = Number(sessionStorage.getItem("ACTIVITY_LAST_SENT") || 0);
  const minIntervalMs = 5 * 60 * 1000;
  let pending = false;
  function canSend() {
    const now = Date.now();
    return !pending && (now - lastSent >= minIntervalMs);
  }
  function markSent() {
    lastSent = Date.now();
    sessionStorage.setItem("ACTIVITY_LAST_SENT", String(lastSent));
  }
  function send(payload) {
    try {
      pending = true;
      lastSent = Date.now();
      sessionStorage.setItem("ACTIVITY_LAST_SENT", String(lastSent));
      const url = new URL(endpoint, location.href);
      url.searchParams.set("t", Date.now());
      url.searchParams.set("p", location.pathname);
      fetch(url.toString(), { method: "GET", cache: "no-store", keepalive: true, mode: "cors" })
        .then(() => { console.log("[actividad] OK", url.toString()); })
        .catch((err) => { console.warn("[actividad] FAIL", url.toString(), String(err && err.message || err)); })
        .finally(() => { pending = false; });
      if (!isServerEndpoint) {
        const su = supabaseUrl || "";
        if (su) {
          const pingUrl = new URL("rest/v1/", su);
          pingUrl.searchParams.set("ping", Date.now());
          const img = new Image();
          img.src = pingUrl.toString();
        }
      }
    } catch (_) {}
  }
  function showToast(mensaje = "Acción realizada", duracion = 3000) {
    if (typeof window.mostrarToastConexion === "function") { window.mostrarToastConexion(mensaje, duracion); return; }
    const toast = document.getElementById("toastConexion");
    if (!toast) return;
    const icon = toast.querySelector(".toast-icon");
    const message = toast.querySelector(".toast-message");
    const closeBtn = toast.querySelector(".toast-close");
    const m = mensaje;
    const emojiMatch = m.match(/^([^\w\s]+)/);
    if (emojiMatch && icon) { icon.textContent = emojiMatch[1]; message.textContent = m.replace(emojiMatch[1], "").trim(); }
    else { message.textContent = m; }
    toast.style.display = "flex";
    toast.style.opacity = "1";
    toast.style.transform = "translateY(0)";
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
  function doKeepalive() {
    try {
      if (isServerEndpoint) {
        const s = new URL(endpoint, location.href);
        s.searchParams.set("manual", Date.now());
        s.searchParams.set("p", location.pathname);
        fetch(s.toString(), { method: "GET", cache: "no-store", keepalive: true, mode: "cors" })
          .then(() => { console.log("[actividad] MANUAL OK", s.toString()); })
          .catch((err) => { console.warn("[actividad] MANUAL FAIL", s.toString(), String(err && err.message || err)); });
      }
      const su = supabaseUrl || "";
      if (su) {
        const u = new URL("rest/v1/", su);
        u.searchParams.set("ping", Date.now());
        const img = new Image();
        img.src = u.toString();
        console.log("[supabase] keepalive SENT", u.toString());
      }
    } catch (_) {}
  }
  function onActivity() {
    if (canSend()) {
      send({ t: Date.now(), p: location.pathname });
    }
  }
  document.addEventListener("DOMContentLoaded", () => {
    send({ t: Date.now(), p: location.pathname, init: true });
    const btn = document.getElementById("keepaliveBtn");
    if (btn) btn.addEventListener("click", () => { doKeepalive(); showToast("Activando conexion con el servidor"); });
    ["click","keydown","scroll","touchstart","mousemove"].forEach(ev => document.addEventListener(ev, onActivity, { passive: true }));
  });
})();
