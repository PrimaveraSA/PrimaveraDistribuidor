const sbClient = window.SUPABASE_CLIENT || (window.supabase && window.SUPABASE_URL && window.SUPABASE_KEY ? window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_KEY) : null);

function initControlPrecios() {
  if (window._controlPreciosInicializado) return;
  window._controlPreciosInicializado = true;

  const UMBRAL_BUENA = 67;
  const UMBRAL_DESCARTE = 0;
  let cacheCoincidenciasBuenas = new Map();
  const ignoreWords = new Set(["DEL","LA","EL","LOS","LAS","Y","EN","CON","PARA","S/"]);

  const priceFile = document.getElementById("priceFile");
  const masterFile = document.getElementById("masterFile");
  const processBtn = document.getElementById("processBtn");
  const descargarBtn = document.getElementById("descargarBtn");
  const resetBtn = document.getElementById("resetBtn");
  const priceHeaders = document.getElementById("priceHeaders");
  const masterHeaders = document.getElementById("masterHeaders");
  const pricePreview = document.getElementById("pricePreview");
  const masterPreview = document.getElementById("masterPreview");
  const tablaBuenas = document.querySelector("#tablaBuenas tbody");
  const tablaPendientes = document.querySelector("#tablaPendientes tbody");
  const tablaDuplicados = document.querySelector("#tablaDuplicados tbody");
  const log = document.getElementById("log");

  let priceData = [];
  let masterData = [];
  let priceCols = { codigo:null, desc:null, precio:null };
  let masterCols = { producto:null, unidad:null, costo:null };
  let reemplazosCosto = new Map();

  const normalize = s => String(s||"")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[-*\/().,]/g, "").replace(/\s+/g, " ")
    .replace(/^S\/|^\$|^USD|^US\$|^€|^EUR|^£/i, "")
    .toUpperCase().trim();

  function toNumberStrict(v){ const s=String(v||"").replace(/,/g,".").trim(); if(s==="") return ""; const n=parseFloat(s); return (!isNaN(n)&&isFinite(n))?n:v; }
  function formatRowNumbers(row){ return row.map(v=> toNumberStrict(v)); }
  function buildSelects(headers, spec){ const opts=headers.map((x,i)=>`<option value='${i+1}'>${x}</option>`).join(""); return spec.map(s=>`${s.label}: <select id='${s.id}'>${opts}</select>`).join(" "); }
  function autoPick(headersLC, selectId, keys){ const sel=document.getElementById(selectId); for(const k of keys){ const i=headersLC.findIndex(x=> x.includes(k)); if(i!==-1){ sel.value=String(i+1); break; } } }
  function show(el){ if(!el) return; el.style.display=""; el.classList.remove("d-none"); }
  function hide(el){ if(!el) return; el.style.display="none"; el.classList.add("d-none"); }

  async function precargarCoincidenciasBuenas(){
    const { data, error } = await sbClient
      .from("coincidencias_buenas")
      .select("id, producto_excel1, producto_excel2, precio_excel1, precio_excel2, similitud");
    if (error) return;
    cacheCoincidenciasBuenas.clear();
    data.forEach(c=>{ const clave = normalize(c.producto_excel2); cacheCoincidenciasBuenas.set(clave, c); });
  }
  function simpleSimilarity(t1, t2){
    const w1 = t1.split(/\s+/); const w2 = t2.split(/\s+/); let hits = 0; w1.forEach(w=>{ if(w2.includes(w)) hits++; }); return (hits/Math.max(w1.length,1))*100;
  }
  function simpleWordSim(a,b){ if(!a||!b) return 0; const min=Math.min(a.length,b.length); let same=0; for(let i=0;i<min;i++) if(a[i]===b[i]) same++; return same/Math.max(a.length,b.length); }
  function similarity(a,b){
    const listaBuenas = Array.isArray(cacheCoincidenciasBuenas) ? cacheCoincidenciasBuenas : Array.from(cacheCoincidenciasBuenas?.values?.()||[]);
    let textA = normalize(a); let textB = normalize(b); let diccionarioAprendido = {};
    listaBuenas.forEach(c=>{
      if(!c?.producto_excel1 || !c?.producto_excel2) return;
      const p1 = normalize(c.producto_excel1); const p2 = normalize(c.producto_excel2);
      const similitudBase = simpleSimilarity(p1,p2); if (similitudBase<50) return;
      const palabras1 = p1.split(/\s+/).filter(w=>!ignoreWords.has(w));
      const palabras2 = p2.split(/\s+/).filter(w=>!ignoreWords.has(w));
      const len = Math.min(palabras1.length, palabras2.length);
      for(let i=0;i<len;i++){ const w1=palabras1[i]; const w2=palabras2[i]; if(w1!==w2 && w1.length>2 && w2.length>2 && simpleWordSim(w1,w2)>=0.8){ diccionarioAprendido[w1]=w2; diccionarioAprendido[w2]=w1; } }
    });
    for(const [key,val] of Object.entries(diccionarioAprendido)){ const regex = new RegExp(`\\b${key}\\b`, "gi"); textA=textA.replace(regex,val); textB=textB.replace(regex,val); }
    let wordsA = textA.split(/\s+/).filter(w=>!ignoreWords.has(w)); let wordsB = textB.split(/\s+/).filter(w=>!ignoreWords.has(w));
    if (wordsA.length===0) wordsA = textA.split(/\s+/); if (wordsB.length===0) wordsB = textB.split(/\s+/);
    const productosConfirmados = new Set(listaBuenas.map(c=> normalize(c.producto_excel1)));
    if (productosConfirmados.has(normalize(a)) || productosConfirmados.has(normalize(b))) return 0;
    let matches=0; const palabrasContadas = new Set();
    wordsA.forEach(word=>{ if(palabrasContadas.has(word)) return; const isNum=/\d/.test(word); const matched = wordsB.includes(word) || wordsB.some(bw=> bw.includes(word) || word.includes(bw)) || (isNum && wordsB.some(bw=> bw.replace(/\D/g,"")===word.replace(/\D/g,""))); if(matched){ matches++; palabrasContadas.add(word);} });
    return (matches/wordsA.length)*100;
  }
  function cellToString(cell){
    if(cell === null || cell === undefined) return "";
    if(typeof cell === "object"){
      if(cell.richText) return cell.richText.map(r=>r.text).join('');
      if(cell.text) return cell.text;
      if(cell.formula) return (cell.result ?? "");
      if(cell.value !== undefined && cell.value !== null) return String(cell.value);
      return String(cell);
    }
    return String(cell);
  }
  function cleanPrice(v){
    const s = String(v||"").replace(/,/g,".");
    const n = parseFloat(s);
    return isNaN(n)?0:n;
  }

  function limpiarMonedas(data){
    if (!data || data.length === 0) return data;
    const monedaRegex = /^\s*(S\/|\$|USD|US\$|€|EUR|£)\s*$/i;
    const simboloInicioRegex = /^\s*(S\/|\$|USD|US\$|€|EUR|£)\s*/i;
    const cleaned = data.map(row => row.map(cell => {
      if (typeof cell === "string") return cell.replace(simboloInicioRegex, "").trim();
      return cell;
    }));
    const numCols = cleaned[0].length;
    const columnasAEliminar = new Set();
    for (let c = 0; c < numCols; c++){
      let simbolos = 0; let vacios = 0;
      for (let r = 1; r < cleaned.length; r++){
        const val = (cleaned[r][c] || "").trim();
        if (val !== "") { if (monedaRegex.test(val)) simbolos++; } else { vacios++; }
      }
      const totalFilas = cleaned.length - 1;
      const ratioSimbolos = simbolos / totalFilas;
      const ratioVacios = vacios / totalFilas;
      if (ratioSimbolos + ratioVacios > 0.9) columnasAEliminar.add(c);
    }
    const result = cleaned.map(row => row.filter((_, idx) => !columnasAEliminar.has(idx)));
    return result;
  }

  async function guardarBuena(prod1, prod2, p1, p2, sim){
    const { data, error } = await sbClient.from("coincidencias_buenas").insert([{ producto_excel1: prod1, producto_excel2: prod2, precio_excel1: p1, precio_excel2: p2, similitud: sim }]).select("id");
    if (error) console.error(error);
    return data && data[0] ? data[0].id : null;
  }
  async function guardarPendiente(prod1, prod2, p1, p2, sim){
    const { data, error } = await sbClient.from("coincidencias_pendientes").insert([{ producto_excel1: prod1, producto_excel2: prod2, precio_excel1: p1, precio_excel2: p2, similitud: sim, estado: "pendiente" }]).select("id");
    if (error) console.error(error);
    return data && data[0] ? data[0].id : null;
  }

  function renderPreview(containerId, rows){
    const container = document.getElementById(containerId);
    container.innerHTML = "";
    const table = document.createElement("table");
    table.className = "table table-sm table-bordered";
    const thead = document.createElement("thead");
    const trh = document.createElement("tr");
    (rows[0]||[]).forEach(h=>{ const th=document.createElement("th"); th.textContent=h; trh.appendChild(th); });
    thead.appendChild(trh); table.appendChild(thead);
    const tbody = document.createElement("tbody");
    for(let i=1;i<Math.min(rows.length,11);i++){ const tr=document.createElement("tr"); (rows[i]||[]).forEach(v=>{ const td=document.createElement("td"); td.textContent=v; tr.appendChild(td); }); tbody.appendChild(tr); }
    table.appendChild(tbody);
    container.appendChild(table);
  }

  priceFile.addEventListener("change", async e=>{
    const file = e.target.files[0]; if(!file) return;
    const data = await file.arrayBuffer();
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(data);
    const ws = wb.worksheets[0];
    priceData = [];
    ws.eachRow(row=>{ priceData.push(row.values.slice(1).map(cellToString)); });
    priceData = limpiarMonedas(priceData);
    if(priceData.length===0){ log.textContent="Archivo vacío"; return; }
    renderPreview("pricePreview", priceData);
    show(pricePreview);
    show(priceHeaders);
    const headers = priceData[0]||[];
    priceHeaders.innerHTML = buildSelects(headers, [
      { label:"Código", id:"priceCodigo" },
      { label:"Descripción", id:"priceDesc" },
      { label:"Precio", id:"pricePrecio" }
    ]);
    const headersLC = headers.map(h=> String(h||"").toLowerCase());
    autoPick(headersLC, "priceCodigo", ["cod","#","codigo"]);
    autoPick(headersLC, "priceDesc", ["descripcion","producto","descrip","nombre"]);
    autoPick(headersLC, "pricePrecio", ["precio","price","pvp","p. unit","p unit","p.unit"]);
    masterFile.disabled = false;
    log.textContent = `Archivo de precios cargado (${priceData.length-1} registros).`;
  });

  masterFile.addEventListener("change", async e=>{
    const file = e.target.files[0]; if(!file) return;
    const data = await file.arrayBuffer();
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(data);
    const ws = wb.worksheets[0];
    masterData = [];
    ws.eachRow((row, rowNumber)=>{ if(rowNumber>=2){ masterData.push(row.values.slice(1).map(cellToString)); } });
    masterData = limpiarMonedas(masterData);
    renderPreview("masterPreview", masterData);
    show(masterPreview);
    show(masterHeaders);
    const headers = masterData[0]||[];
    masterHeaders.innerHTML = buildSelects(headers, [
      { label:"Producto", id:"masterProd" },
      { label:"Unidad", id:"masterUmed" },
      { label:"Costo IGV", id:"masterCosto" }
    ]);
    const headersLCm = headers.map(h=> String(h||"").toLowerCase());
    autoPick(headersLCm, "masterProd", ["producto","descripcion","descrip","nombre"]);
    autoPick(headersLCm, "masterUmed", ["u.medid","unidad","u.m.","umedid"]);
    autoPick(headersLCm, "masterCosto", ["costo","igv","costo igv","precio"]);
    processBtn.disabled = false;
    log.textContent = `Archivo maestro cargado (${masterData.length-1} registros).`;
  });

  processBtn.addEventListener("click", async ()=>{
    await precargarCoincidenciasBuenas();
    tablaBuenas.innerHTML = ""; tablaPendientes.innerHTML = ""; tablaDuplicados.innerHTML = ""; reemplazosCosto.clear();
    const resultados = document.getElementById("resultadoComparacion"); if(resultados) resultados.style.display = "block";
    hide(pricePreview);
    hide(masterPreview);
    hide(priceHeaders);
    hide(masterHeaders);
    priceCols.codigo = parseInt(document.getElementById("priceCodigo").value);
    priceCols.desc   = parseInt(document.getElementById("priceDesc").value);
    priceCols.precio = parseInt(document.getElementById("pricePrecio").value);
    masterCols.producto = parseInt(document.getElementById("masterProd").value);
    masterCols.unidad   = parseInt(document.getElementById("masterUmed").value);
    masterCols.costo    = parseInt(document.getElementById("masterCosto").value);

    const vistosMaestro = new Set();
    const usadosPrecio = new Set();
    const paresUsados = new Set();

    let cambios=0, pendientes=0, duplicados=0;
    for(let i=1;i<masterData.length;i++){
      const row = masterData[i];
      const masterDesc = normalize(row[masterCols.producto-1]);
      if(!masterDesc) continue;
      let bestSim = -1; let bestRow = null;
      for(let j=1;j<priceData.length;j++){
        const prow = priceData[j];
        const pdesc = normalize(prow[priceCols.desc-1]);
        if(usadosPrecio.has(pdesc)) continue;
        const sim = similarity(masterDesc, pdesc);
        if(sim>bestSim){ bestSim=sim; bestRow=prow; }
      }
      if(!bestRow) continue;
      const precioNuevo = cleanPrice(bestRow[priceCols.precio-1]);
      const precioViejo = cleanPrice(row[masterCols.costo-1]);
      const keyM = masterDesc; const keyP = normalize(bestRow[priceCols.desc-1]); const clave = keyM+"||"+keyP;
      if(vistosMaestro.has(keyM) || paresUsados.has(clave)){
        duplicados++;
        const tr = document.createElement("tr");
        tr.innerHTML = `<td>${bestRow[priceCols.desc-1]}</td><td>${row[masterCols.producto-1]}</td><td>${precioNuevo}</td><td>${precioViejo}</td><td>${bestSim.toFixed(2)}</td>`;
        tablaDuplicados.appendChild(tr);
        continue;
      }
      vistosMaestro.add(keyM); usadosPrecio.add(keyP); paresUsados.add(clave);
      if(bestSim>=UMBRAL_BUENA){
        const descPrecio = String(bestRow[priceCols.desc-1]||"");
        const descMaestro = String(row[masterCols.producto-1]||"");
        const validaTexto = (s)=>{ const t=normalize(s); return /[A-Z]/.test(t) && t.length>=3; };
        if(validaTexto(descPrecio) && validaTexto(descMaestro)){
          cambios++;
          const id = await guardarBuena(bestRow[priceCols.desc-1], row[masterCols.producto-1], precioNuevo, precioViejo, bestSim);
          reemplazosCosto.set(row[masterCols.producto-1], precioNuevo);
          const tr = document.createElement("tr");
          tr.innerHTML = `<td>${bestRow[priceCols.desc-1]}</td><td>${row[masterCols.producto-1]}</td><td>${precioNuevo}</td><td>${precioViejo}</td><td>${bestSim.toFixed(2)}</td><td><button class='btn btn-sm btn-outline-danger' data-borrar-buena='${id}'>Eliminar</button></td>`;
          tablaBuenas.appendChild(tr);
        } else {
          pendientes++;
          const id = await guardarPendiente(bestRow[priceCols.desc-1], row[masterCols.producto-1], precioNuevo, precioViejo, bestSim);
          const tr = document.createElement("tr");
          tr.innerHTML = `<td>${bestRow[priceCols.desc-1]}</td><td>${row[masterCols.producto-1]}</td><td>${precioNuevo}</td><td>${precioViejo}</td><td>${bestSim.toFixed(2)}</td><td><button class='btn btn-sm btn-success' data-aceptar-pendiente='${id}'>Aceptar</button> <button class='btn btn-sm btn-outline-danger' data-borrar-pendiente='${id}'>Eliminar</button></td>`;
          tablaPendientes.appendChild(tr);
        }
      } else if(bestSim>=UMBRAL_DESCARTE){
        pendientes++;
        const id = await guardarPendiente(bestRow[priceCols.desc-1], row[masterCols.producto-1], precioNuevo, precioViejo, bestSim);
        const tr = document.createElement("tr");
        tr.innerHTML = `<td>${bestRow[priceCols.desc-1]}</td><td>${row[masterCols.producto-1]}</td><td>${precioNuevo}</td><td>${precioViejo}</td><td>${bestSim.toFixed(2)}</td><td><button class='btn btn-sm btn-success' data-aceptar-pendiente='${id}'>Aceptar</button> <button class='btn btn-sm btn-outline-danger' data-borrar-pendiente='${id}'>Eliminar</button></td>`;
        tablaPendientes.appendChild(tr);
      }
    }
    descargarBtn.disabled = false;
    log.textContent = `Coincidencias: ${cambios} | Pendientes: ${pendientes} | Duplicados: ${duplicados}`;
  });

  document.addEventListener("click", async e=>{
    const btnA = e.target.closest("[data-aceptar-pendiente]");
    const btnB = e.target.closest("[data-borrar-pendiente]");
    const btnC = e.target.closest("[data-borrar-buena]");
    if(btnA){
      const id = Number(btnA.getAttribute("data-aceptar-pendiente"));
      try{
        const { data } = await sbClient.from("coincidencias_pendientes").select("*").eq("id", id).limit(1);
        if(data && data[0]){
          await sbClient.from("coincidencias_pendientes").delete().eq("id", id);
          await guardarBuena(data[0].producto_excel1, data[0].producto_excel2, data[0].precio_excel1, data[0].precio_excel2, data[0].similitud);
          e.target.closest("tr").remove();
        }
      }catch{}
    }
    if(btnB){ const id = Number(btnB.getAttribute("data-borrar-pendiente")); await sbClient.from("coincidencias_pendientes").delete().eq("id", id); e.target.closest("tr").remove(); }
    if(btnC){ const id = Number(btnC.getAttribute("data-borrar-buena")); await sbClient.from("coincidencias_buenas").delete().eq("id", id); e.target.closest("tr").remove(); }
  });

  descargarBtn.addEventListener("click", async ()=>{
    const wbM = new ExcelJS.Workbook(); const wsM = wbM.addWorksheet("Maestro");
    wsM.columns = [
      { key: "cod_prod", width: 10.14 },
      { key: "cod_um", width: 10.14 },
      { key: "cod_cost", width: 10.14 },
      { key: "producto", width: 54 },
      { key: "marca", width: 15 },
      { key: "familia", width: 22.29 },
      { key: "linea", width: 15 },
      { key: "u.medid", width: 8 },
      { key: "multip", width: 8 },
      { key: "Costo IGV", width: 12 },
      { key: "Autocalcular", width: 15 },
      { key: "% Minorista", width: 14.14 },
      { key: "% Mayorista", width: 14.14 },
      { key: "% Especial", width: 12.72 }
    ];
    wsM.mergeCells(1,1,1,(masterData[0]||[]).length); wsM.getCell(1,1).value = "LISTAR-PRODUCTO - Sistema Comercial"; wsM.getCell(1,1).alignment = { horizontal:"center" };
    const hrM = wsM.addRow(masterData[0]||[]); hrM.eachCell(c=> c.font = { bold:true });
    const colores = ["C6EFCE","FFF2CC","FFCCE5","CCE5FF","E2EFDA","F4CCCC","D9E1F2","EAD1DC"]; const colorMap = new Map(); let cidx=0;
    document.querySelectorAll("#tablaBuenas tbody tr").forEach(tr=>{ const a=normalize(tr.cells[0].textContent); const b=normalize(tr.cells[1].textContent); if(!colorMap.has(a)&&!colorMap.has(b)){ const col=colores[cidx%colores.length]; colorMap.set(a,col); colorMap.set(b,col); cidx++; } });
    for(let i=1;i<masterData.length;i++){
      const row = formatRowNumbers(masterData[i]);
      const prod = masterData[i][masterCols.producto-1]; if(reemplazosCosto.has(prod)) row[masterCols.costo-1] = reemplazosCosto.get(prod);
      const r = wsM.addRow(row); const d = normalize(masterData[i][masterCols.producto-1]); if(colorMap.has(d)){ const col = colorMap.get(d); r.eachCell(cell=> cell.fill={ type:"pattern", pattern:"solid", fgColor:{ argb: col } }); }
    }
    const bufM = await wbM.xlsx.writeBuffer(); (function(name, buffer){ const blob=new Blob([buffer]); const url=URL.createObjectURL(blob); const a=document.createElement("a"); a.href=url; a.download=name; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url); })(`Maestro_${Date.now()}.xlsx`, bufM);

    const wbP = new ExcelJS.Workbook(); const wsP = wbP.addWorksheet("Precios");
    (function(){
      const headers = priceData[0]||[]; const widths = [];
      const lower = headers.map(h=> String(h||"").toLowerCase());
      for(let i=0;i<lower.length;i++){
        const h = lower[i]; let w = 12;
        if(/n\u00b0|^n$|^#/.test(h)) w = 6;
        else if(h.includes("codigo")) w = 20;
        else if(h.includes("descrip")) w = 54;
        else if(h.includes("precio")) w = 12;
        else if(h.includes("paquete")||h.includes("multip")) w = 10;
        widths.push({ key: `col_${i+1}`, width: w });
      }
      if(widths.length) wsP.columns = widths;
    })();
    wsP.mergeCells(1,1,1,(priceData[0]||[]).length); wsP.getCell(1,1).value = "LISTAR-PRECIOS - Sistema Comercial"; wsP.getCell(1,1).alignment = { horizontal:"center" };
    const hrP = wsP.addRow(priceData[0]||[]); hrP.eachCell(c=> c.font = { bold:true });
    for(let i=1;i<priceData.length;i++){
      const rowVals = formatRowNumbers(priceData[i]||[]);
      const r = wsP.addRow(rowVals);
      const d = normalize(priceData[i][priceCols.desc-1]);
      if(colorMap.has(d)){ const col=colorMap.get(d); r.eachCell(cell=> cell.fill={ type:"pattern", pattern:"solid", fgColor:{ argb: col } }); }
    }
    const bufP = await wbP.xlsx.writeBuffer(); (function(name, buffer){ const blob=new Blob([buffer]); const url=URL.createObjectURL(blob); const a=document.createElement("a"); a.href=url; a.download=name; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url); })(`Precios_${Date.now()}.xlsx`, bufP);
  });

  resetBtn.addEventListener("click", ()=>{
    priceFile.value=""; masterFile.value=""; masterFile.disabled = true; processBtn.disabled = true; descargarBtn.disabled = true; priceHeaders.innerHTML=""; masterHeaders.innerHTML=""; pricePreview.innerHTML=""; masterPreview.innerHTML=""; tablaBuenas.innerHTML=""; tablaPendientes.innerHTML=""; tablaDuplicados.innerHTML=""; reemplazosCosto.clear(); log.textContent = ""; const resultados = document.getElementById("resultadoComparacion"); if(resultados) resultados.style.display = "none";
  });

  // === Bloque de "Ajustes por Porcentajes" solo si existe el formulario ===
  (function(){
    const marcaSelect = document.getElementById("marcaInput");
    const lineaSelect = document.getElementById("lineaInput");
    const unidadSelect = document.getElementById("unidadInput");
    const mayoristaInput = document.getElementById("mayoristaInput");
    const especialInput = document.getElementById("especialInput");
    const addRuleBtn = document.getElementById("addRuleBtn");
    const rulesList = document.getElementById("rulesList");
    const fileInput = document.getElementById("fileInput");
    const downloadPorcBtn = document.getElementById("downloadPorcBtn");
    const clearPorcBtn = document.getElementById("clearPorcBtn");
    const previewArea = document.getElementById("previewArea");

    if(!marcaSelect || !lineaSelect || !unidadSelect || !mayoristaInput || !especialInput || !addRuleBtn || !rulesList || !fileInput || !downloadPorcBtn || !clearPorcBtn || !previewArea){
      return;
    }

    const MARCAS_LIST = window.MARCAS || [];
    const LINEAS_LIST = window.LINEAS || [];

    MARCAS_LIST.forEach(m=>{ const opt=document.createElement("option"); opt.value=m.toUpperCase(); opt.textContent=m; marcaSelect.appendChild(opt); });
    LINEAS_LIST.forEach(l=>{ const opt=document.createElement("option"); opt.value=l.toUpperCase(); opt.textContent=l; lineaSelect.appendChild(opt); });

    let reglas = [];
    function renderRules(){
      if(reglas.length===0){ rulesList.innerHTML = '<p class="text-muted">No hay reglas agregadas. Crea una regla para aplicar ajustes automáticamente.</p>'; downloadPorcBtn.disabled = true; return; }
      let html = "<table class='table table-sm table-bordered'><thead><tr><th>Marca</th><th>Línea</th><th>Unidad</th><th>% Mayorista</th><th>% Especial</th><th>Acción</th></tr></thead><tbody>";
      reglas.forEach((r,i)=>{ html += `<tr data-index='${i}'><td>${r.marca}</td><td>${r.linea||"-"}</td><td>${r.unidad}</td><td>${r.mayorista}</td><td>${r.especial}</td><td><button class='btn btn-sm btn-outline-danger' data-remove-rule='${i}'>Eliminar</button></td></tr>`; });
      html += "</tbody></table>"; rulesList.innerHTML = html; downloadPorcBtn.disabled = false; }

    addRuleBtn.addEventListener("click", ()=>{
      const marca = marcaSelect.value.trim().toUpperCase();
      const linea = lineaSelect.value.trim().toUpperCase();
      const unidad = unidadSelect.value.trim().toUpperCase();
      const mayorista = parseFloat(mayoristaInput.value);
      const especial = parseFloat(especialInput.value);
      if(!marca || !unidad || isNaN(mayorista) || isNaN(especial)) return;
      reglas.push({ marca, linea, unidad, mayorista, especial });
      renderRules();
    });

    document.addEventListener("click", e=>{ const btn=e.target.closest("[data-remove-rule]"); if(btn){ const i=Number(btn.getAttribute("data-remove-rule")); reglas.splice(i,1); renderRules(); } });

    let loadedRows = []; let headers = [];
    fileInput.addEventListener("change", async e=>{
      previewArea.innerHTML = ""; const file = e.target.files[0]; if(!file) return; const data = await file.arrayBuffer(); const wb = new ExcelJS.Workbook(); await wb.xlsx.load(data); const ws = wb.worksheets[0]; loadedRows = []; ws.eachRow(r=> loadedRows.push(r.values.slice(1))); if(loadedRows.length<2){ previewArea.innerHTML = '<div class="text-danger">El archivo está vacío o no tiene encabezados.</div>'; return; } headers = loadedRows[1]; const dr = loadedRows.slice(2); const table=document.createElement("table"); table.className="table table-sm table-bordered"; const thead=document.createElement("thead"); const trh=document.createElement("tr"); headers.forEach(h=>{ const th=document.createElement("th"); th.textContent=h; trh.appendChild(th); }); thead.appendChild(trh); table.appendChild(thead); const tbody=document.createElement("tbody"); for(let r=0;r<Math.min(dr.length,10);r++){ const tr=document.createElement("tr"); (dr[r]||[]).forEach(v=>{ const td=document.createElement("td"); td.textContent=v; tr.appendChild(td); }); tbody.appendChild(tr); } table.appendChild(tbody); previewArea.appendChild(table); downloadPorcBtn.disabled = reglas.length===0 ? true : false; });

    clearPorcBtn.addEventListener("click", ()=>{ reglas=[]; renderRules(); previewArea.innerHTML=""; fileInput.value=""; mayoristaInput.value=""; especialInput.value=""; unidadSelect.value=""; });

    downloadPorcBtn.addEventListener("click", async ()=>{
      if(loadedRows.length<3){ return; }
      const wb = new ExcelJS.Workbook(); const sheet = wb.addWorksheet("Hoja1");
      sheet.mergeCells(1,1,1,headers.length); const titleCell = sheet.getCell(1,1); titleCell.value = loadedRows[0][0] || "LISTAR-PRODUCTO - Sistema Comercial"; titleCell.alignment = { horizontal:"center" };
      const headerRow = sheet.addRow(headers.map(h=> h||"")); headerRow.eachCell(c=>{ c.font = { bold:true }; });
      const dataRows = loadedRows.slice(2); dataRows.forEach(r=> sheet.addRow(r.map(cell=> cell==null?"":cell)));
      const idxMarca = headers.findIndex(h=> String(h||"").trim().toLowerCase().includes("marca"));
      const idxLinea = headers.findIndex(h=> String(h||"").trim().toLowerCase().includes("linea"));
      const idxUmedid = headers.findIndex(h=> String(h||"").trim().toLowerCase().includes("u.medid"));
      const idxMayorista = headers.findIndex(h=> String(h||"").trim().toLowerCase().includes("mayorista"));
      const idxEspecial = headers.findIndex(h=> String(h||"").trim().toLowerCase().includes("especial"));
      const idxAutocalc = headers.findIndex(h=> String(h||"").trim().toLowerCase().includes("autocalcular"));
      const colors = ["FFFF99","CCFFCC","99CCFF"]; let colorIndex = 0;
      sheet.eachRow((row, rn)=>{ if(rn>2){ const valM = String(row.getCell(idxMarca+1).value||"").toUpperCase(); const valL = String(row.getCell(idxLinea+1).value||"").toUpperCase(); const valU = String(row.getCell(idxUmedid+1).value||"").toUpperCase(); let modified=false; reglas.forEach(rule=>{ if(valM===rule.marca && valU.includes(rule.unidad) && (!rule.linea || valL===rule.linea)){ row.getCell(idxMayorista+1).value = rule.mayorista; row.getCell(idxEspecial+1).value = rule.especial; modified=true; } }); if(modified){ const color = colors[colorIndex%colors.length]; row.eachCell(cell=>{ cell.fill = { type:"pattern", pattern:"solid", fgColor:{ argb: color } }; }); colorIndex++; } if(idxAutocalc!==-1){ row.getCell(idxAutocalc+1).value = valU.includes("UNIDAD") ? "S" : "N"; } } });
      const buf = await wb.xlsx.writeBuffer(); (function(name, buffer){ const blob=new Blob([buffer]); const url=URL.createObjectURL(blob); const a=document.createElement("a"); a.href=url; a.download=name; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url); })(`Ajustes_${Date.now()}.xlsx`, buf);
    });
  })();
}

window.initControlPrecios = initControlPrecios;
