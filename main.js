// === ELEMENTOS DEL DOM ===
const fileInput = document.getElementById('fileInput');
const dzInner = document.querySelector('.dz-inner');
const convertBtn = document.getElementById('convertBtn');
const downloadDebug = document.getElementById('downloadDebug');
const mensajeCarga = document.getElementById('mensajeCarga');
const mensajeExito = document.getElementById('mensajeExito');
const progress = document.getElementById('progress');
const progressBar = document.getElementById('progressBar');

let selectedFile = null;

// === ACTUALIZAR DROPZONE Y BOTONES AL SELECCIONAR PDF ===
fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];

    if (file && file.type === 'application/pdf') {
        selectedFile = file;
        dzInner.innerHTML = `
            <strong>Archivo seleccionado:</strong> ${file.name}
            <small>Puedes arrastrar otro archivo para reemplazarlo.</small>
        `;
        convertBtn.disabled = false;
        downloadDebug.disabled = false;
    } else {
        selectedFile = null;
        dzInner.innerHTML = `
            <strong>Arrastra y suelta</strong> o haz clic para seleccionar un archivo PDF
            <small>Se procesan mejor los PDFs con texto (no escaneados). Para PDFs escaneados, usa OCR antes.</small>
        `;
        convertBtn.disabled = true;
        downloadDebug.disabled = true;
    }
});

// === FUNCION SIMULADA DE PROGRESO Y MENSAJE ===
const simulateProgress = (callback) => {
    progress.hidden = false;
    progressBar.style.width = '0%';
    mensajeCarga.style.display = 'block';
    mensajeExito.style.display = 'none';

    let progreso = 0;

    const interval = setInterval(() => {
        progreso += Math.floor(Math.random() * 15) + 5; // incremento aleatorio
        if (progreso >= 100) progreso = 100;
        progressBar.style.width = progreso + '%';

        if (progreso === 100) {
            clearInterval(interval);
            mensajeCarga.style.display = 'none';
            mensajeExito.style.display = 'block';
            setTimeout(() => { mensajeExito.style.display = 'none'; }, 3000);

            progress.hidden = true;
            progressBar.style.width = '0%';

            if (callback) callback();
        }
    }, 300);
};

// === CONVERTIR A EXCEL CON CONVERTAPI ===
convertBtn.addEventListener('click', async () => {
    if (!selectedFile) return;

    convertBtn.disabled = true;

    // Simular la barra de progreso mientras se realiza la conversión real
    simulateProgress(async () => {
        try {
            const formData = new FormData();
            formData.append('File', selectedFile);
            formData.append('StoreFile', 'true');
            formData.append('IncludeFormatting', 'true');
            formData.append('SingleSheet', 'true');

            const token = 'Bearer kCqsdQdOiaezz0PVGC9tKdKkmGuQsaoV';

            const response = await fetch('https://v2.convertapi.com/convert/pdf/to/xlsx', {
                method: 'POST',
                headers: {
                    'Authorization': token
                },
                body: formData
            });

            if (!response.ok) throw new Error(`Error en la conversión: ${response.statusText}`);

            const result = await response.json();
            const fileUrl = result.Files[0].Url;

            // Descargar automáticamente
            const a = document.createElement('a');
            a.href = fileUrl;
            a.download = result.Files[0].FileName;
            document.body.appendChild(a);
            a.click();
            a.remove();

        } catch (error) {
            alert('Error al convertir PDF a Excel: ' + error.message);
            console.error(error);
        } finally {
            convertBtn.disabled = false;
        }
    });
});

// === DESCARGAR CSV DE EJEMPLO (BOTÓN SECUNDARIO) ===
downloadDebug.addEventListener('click', () => {
    const csvContent = 'data:text/csv;charset=utf-8,Columna1,Columna2,Columna3\nValor1,Valor2,Valor3';
    const encodedUri = encodeURI(csvContent);
    const a = document.createElement('a');
    a.setAttribute('href', encodedUri);
    a.setAttribute('download', 'ejemplo.csv');
    document.body.appendChild(a);
    a.click();
    a.remove();
});
