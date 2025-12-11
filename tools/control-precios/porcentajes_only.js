function initPorcentajesOnly(){
  const MARCAS = window.MARCAS || [];
  const LINEAS = window.LINEAS || [];
  const fileInput = document.getElementById('fileInput');
  const downloadBtn = document.getElementById('downloadPorcBtn');
  const clearBtn = document.getElementById('clearPorcBtn');
  const addRuleBtn = document.getElementById('addRuleBtn');
  const rulesList = document.getElementById('rulesList');
  const previewArea = document.getElementById('previewArea');

  const marcaSelect = document.getElementById('marcaInput');
  const lineaSelect = document.getElementById('lineaInput');
  const unidadSelect = document.getElementById('unidadInput');
  const mayoristaInput = document.getElementById('mayoristaInput');
  const especialInput = document.getElementById('especialInput');

  function cellToString(cell){
    if(cell === null || cell === undefined) return '';
    if(typeof cell === 'object'){
      if(cell.richText) return cell.richText.map(r=>r.text).join('');
      if(cell.text) return cell.text;
      if(cell.formula) return (cell.result ?? '');
      if(cell.value !== undefined && cell.value !== null) return String(cell.value);
      return String(cell);
    }
    return String(cell);
  }

  MARCAS.forEach(m=>{ const opt=document.createElement('option'); opt.value=m.toUpperCase(); opt.textContent=m; marcaSelect.appendChild(opt); });
  LINEAS.forEach(l=>{ const opt=document.createElement('option'); opt.value=l.toUpperCase(); opt.textContent=l; lineaSelect.appendChild(opt); });

  let rules = [];
  let loadedRows = []; let headers = [];
  let originalFileName = "Archivo";

  function renderRules(){
    if(rules.length===0){ rulesList.innerHTML = '<p class="text-muted">No hay reglas agregadas. Crea una regla para aplicar ajustes automáticamente.</p>'; downloadBtn.disabled = true; return; }
    const rows = rules.map((r,i)=> `<tr data-index='${i}'><td>${r.marca}</td><td>${r.linea||"-"}</td><td>${r.unidad}</td><td>${r.mayorista}</td><td>${r.especial}</td><td><button class='btn btn-sm btn-outline-danger' data-remove-rule='${i}'>Eliminar</button></td></tr>`).join("");
    rulesList.innerHTML = `<table class='table table-sm table-bordered'><thead><tr><th>Marca</th><th>Línea</th><th>Unidad</th><th>% Mayorista</th><th>% Especial</th><th>Acción</th></tr></thead><tbody>${rows}</tbody></table>`;
    downloadBtn.disabled = false;
  }

  function addRule(){
    const marca = marcaSelect.value.trim().toUpperCase();
    const linea = lineaSelect.value.trim().toUpperCase();
    const unidad = unidadSelect.value.trim().toUpperCase();
    const mayorista = parseFloat(mayoristaInput.value);
    const especial = parseFloat(especialInput.value);
    if(!marca || !unidad || isNaN(mayorista) || isNaN(especial)) return;
    rules.push({ marca, linea, unidad, mayorista, especial });
    renderRules();
  }
  addRuleBtn.addEventListener('click', addRule);

  document.addEventListener('click', e=>{ const btn=e.target.closest('[data-remove-rule]'); if(btn){ const i=Number(btn.getAttribute('data-remove-rule')); rules.splice(i,1); renderRules(); } });

  fileInput.addEventListener('change', async e=>{
    previewArea.innerHTML = '';
    const file = e.target.files[0]; if(!file) return;
    originalFileName = (file.name || '').split('.').slice(0,-1).join('.') || 'Archivo';
    const data = await file.arrayBuffer();
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(data);
    const worksheet = workbook.worksheets[0];
    loadedRows = []; worksheet.eachRow(row => { loadedRows.push(row.values.slice(1).map(cellToString)); });
    if (loadedRows.length < 2) { previewArea.innerHTML = '<div class="text-danger">El archivo está vacío o no tiene encabezados.</div>'; return; }
    headers = loadedRows[1]; const dataRows = loadedRows.slice(2);
    const table=document.createElement('table'); table.className='table table-sm table-bordered';
    const thead=document.createElement('thead'); const trh=document.createElement('tr'); headers.forEach(h=>{ const th=document.createElement('th'); th.textContent=h; trh.appendChild(th); }); thead.appendChild(trh); table.appendChild(thead);
    const tbody=document.createElement('tbody'); for(let r=0;r<Math.min(dataRows.length,10);r++){ const tr=document.createElement('tr'); (dataRows[r]||[]).forEach(v=>{ const td=document.createElement('td'); td.textContent=cellToString(v); tr.appendChild(td); }); tbody.appendChild(tr);} table.appendChild(tbody);
    previewArea.appendChild(table);
    downloadBtn.disabled = rules.length === 0;
  });

  clearBtn.addEventListener('click', ()=>{ rules=[]; renderRules(); previewArea.innerHTML=''; fileInput.value=''; mayoristaInput.value=''; especialInput.value=''; unidadSelect.value=''; });

  downloadBtn.addEventListener('click', async ()=>{
    if (loadedRows.length < 3) return;
    const wb = new ExcelJS.Workbook(); const sheet = wb.addWorksheet('Hoja1');
    sheet.mergeCells(1,1,1,headers.length); const titleCell = sheet.getCell(1,1); titleCell.value = loadedRows[0][0] || 'LISTAR-PRODUCTO - Sistema Comercial'; titleCell.alignment = { horizontal:'center' };
    const headerRow = sheet.addRow(headers.map(h=> h || '')); headerRow.eachCell(cell => { cell.font = { bold: true }; });
    sheet.columns = [
      { key: 'cod_prod', width: 10.14 },
      { key: 'cod_um',   width: 10.14 },
      { key: 'cod_cost', width: 10.14 },
      { key: 'producto', width: 60 },
      { key: 'marca',    width: 15 },
      { key: 'familia',  width: 28 },
      { key: 'linea',    width: 18 },
      { key: 'u.medid',  width: 12 },
      { key: 'multip',   width: 8 },
      { key: 'Costo IGV', width: 12 },
      { key: 'Autocalcular', width: 15 },
      { key: '% Minorista', width: 14.14 },
      { key: '% Mayorista', width: 14.14 },
      { key: '% Especial', width: 12.72 }
    ];

    function toNumberIfPossible(v){
      const s = String(v==null?"":v).replace(/,/g,'.').trim();
      if(s==="") return "";
      const n = parseFloat(s);
      return (!isNaN(n) && isFinite(n)) ? n : v;
    }
    const dataRows = loadedRows.slice(2);
    dataRows.forEach(r => sheet.addRow(r.map(cell => toNumberIfPossible(cell))));
    const idxMarca = headers.findIndex(h => String(h||'').trim().toLowerCase().includes('marca'));
    const idxLinea = headers.findIndex(h => String(h||'').trim().toLowerCase().includes('linea'));
    const idxUmedid = headers.findIndex(h => String(h||'').trim().toLowerCase().includes('u.medid'));
    const idxMayorista = headers.findIndex(h => String(h||'').trim().toLowerCase().includes('mayorista'));
    const idxEspecial = headers.findIndex(h => String(h||'').trim().toLowerCase().includes('especial'));
    const idxAutocalc = headers.findIndex(h => String(h||'').trim().toLowerCase().includes('autocalcular'));
    const highlightColors = ['FFFF99','CCFFCC','99CCFF']; let colorIndex = 0;
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber > 2) {
        const valM = String(row.getCell(idxMarca+1).value || '').toUpperCase();
        const valL = String(row.getCell(idxLinea+1).value || '').toUpperCase();
        const valU = String(row.getCell(idxUmedid+1).value || '').toUpperCase();
        let modified = false;
        rules.forEach(rule => {
          if (valM === rule.marca && valU.includes(rule.unidad) && (!rule.linea || valL === rule.linea)) {
            row.getCell(idxMayorista+1).value = Number(rule.mayorista);
            row.getCell(idxEspecial+1).value = Number(rule.especial);
            modified = true;
          }
        });
        if (modified) {
          const color = highlightColors[colorIndex % highlightColors.length];
          row.eachCell(cell => { cell.fill = { type:'pattern', pattern:'solid', fgColor:{argb: color} }; });
          colorIndex++;
        }
        if (idxAutocalc !== -1) {
          row.getCell(idxAutocalc+1).value = valU.includes('UNIDAD') ? 'S' : 'N';
        }
      }
    });
    const buf = await wb.xlsx.writeBuffer(); (function(name, buffer){ const blob=new Blob([buffer]); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=name; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url); })(`${originalFileName} - ${marcaSelect.value || 'MARCA'}.xlsx`, buf);
  });
}

window.initPorcentajesOnly = initPorcentajesOnly;
