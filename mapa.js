// ================================================================
// mapa.js - Versión corregida que respeta la estructura original
// - Usa Google Sheets gviz/tq?tqx=out:csv para evitar bloqueos
// - Mantiene IDs con ceros ("001")
// - Construye iframe de Drive con /file/d/ID/preview
// ================================================================

// ==================== 1. CONFIGURACIÓN GLOBAL ====================
const SPREADSHEET_ID = '1NMjJQ4Q-w3NjODwHB4Ti5WwVYMYc5eUAPoSOeWNUDT';
const SHEET_NAME = 'terr';
const GOOGLE_SHEET_CSV = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(SHEET_NAME)}`;

const GEOJSON_URL = 'zonas.geojson';
const DRIVE_BASE_URL_FILE = 'https://drive.google.com/file/d/';
const MAPA_ID = 'mapa';
const TIEMPO_REFRESCO_MS = 5 * 60 * 1000;

// Estado global
let estadoZonas = {};
let geoJsonLayer = null;
let map = null;

// ==================== 2. UTIL / PARSE CSV ====================

/**
 * Split CSV line handling quoted fields
 */
function splitCSVLine(line) {
    const result = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            if (inQuotes && line[i + 1] === '"') {
                cur += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
            continue;
        }
        if (ch === ',' && !inQuotes) {
            result.push(cur);
            cur = '';
            continue;
        }
        cur += ch;
    }
    result.push(cur);
    return result;
}

/**
 * Normaliza encabezados: lowercase, espacios -> _
 */
function normalizeHeader(h) {
    if (!h && h !== '') return h;
    let s = h.replace(/[\u200B-\u200D\uFEFF]/g, '').trim(); // eliminar BOM/caracteres invisibles
    s = s.replace(/^"|"$/g, ''); // quitar comillas en extremos
    s = s.toLowerCase().replace(/\s+/g, '_');
    return s;
}

/**
 * Parse CSV sin dependencias (devuelve array de objetos)
 */
function parseCSV(csvString) {
    if (!csvString) return [];
    // eliminar BOM al inicio del documento
    csvString = csvString.replace(/^\uFEFF/, '');
    const lines = csvString.split(/\r?\n/).filter(l => l.trim().length > 0);
    if (lines.length === 0) return [];

    const rawHeaders = splitCSVLine(lines[0]);
    const headers = rawHeaders.map(h => normalizeHeader(h));

    const data = [];
    for (let i = 1; i < lines.length; i++) {
        const parts = splitCSVLine(lines[i]);
        // Si hay menos campos rellenamos con ''
        const rowObj = {};
        for (let j = 0; j < headers.length; j++) {
            const key = headers[j] || `col_${j}`;
            const val = (j < parts.length) ? parts[j].trim().replace(/^"|"$/g, '') : '';
            rowObj[key] = val;
        }
        data.push(rowObj);
    }
    return data;
}

// ==================== 3. ESTILO Y UTILIDADES ====================

function obtenerColorEstado(estado) {
    if (!estado || typeof estado !== 'string') return '#808080';
    switch (estado.trim().toLowerCase()) {
        case 'activo':
        case 'completado':
            return '#28a745';
        case 'pendiente':
        case 'expirado':
            return '#dc3545';
        case 'en progreso':
        case 'en_progreso':
            return '#ffc107';
        default:
            return '#808080';
    }
}

function styleZona(feature) {
    const idZona = feature.properties && feature.properties.Name ? feature.properties.Name.trim() : null;
    const datosZona = idZona ? estadoZonas[idZona] : null;

    return {
        fillColor: datosZona ? obtenerColorEstado(datosZona.estado) : '#808080',
        weight: datosZona ? 2 : 1,
        opacity: 0.5,
        color: 'white',
        dashArray: '3',
        fillOpacity: datosZona ? 0.7 : 0.4
    };
}

// ==================== 4. POPUPS Y EVENTOS ====================

function manejarClickZona(feature, layer) {
    const idZona = feature.properties && feature.properties.Name ? feature.properties.Name.trim() : '(sin id)';
    const datosZona = idZona ? estadoZonas[idZona] : null;

    console.log('Click en zona:', idZona, 'datosZona:', datosZona);

    let popupContent = `<h4>Zona: ${idZona}</h4>`;

    if (datosZona) {
        popupContent += `<b>Estado:</b> ${datosZona.estado || '---'}<br>`;
        if (datosZona.descripcion) {
            popupContent += `<p>${datosZona.descripcion}</p>`;
        }

        // Si hay imagen directa (URL)
        if (datosZona.imagen) {
            popupContent += `<img src="${datosZona.imagen}" alt="imagen zona" style="width:100%; max-height:200px; object-fit:cover; border-radius:6px;"><br>`;
        }

        // Si hay pdfId (ID de Drive) construimos preview
        if (datosZona.pdfid) {
            const fileId = datosZona.pdfid.trim();
            const urlVistaPrevia = `${DRIVE_BASE_URL_FILE}${fileId}/preview`;

            popupContent += `
                <hr>
                <p><b>Documento:</b></p>
                <iframe src="${urlVistaPrevia}" style="width:100%; height:300px; border:0;" allow="autoplay"></iframe>
                <p><a href="${urlVistaPrevia}" target="_blank">Abrir en nueva pestaña</a></p>
            `;
        } else if (datosZona.pdf) {
            // Por si la columna se llama 'pdf' o 'pdf_id' distinto
            const maybe = datosZona.pdf.trim();
            if (maybe) {
                const urlVistaPrevia = `${DRIVE_BASE_URL_FILE}${maybe}/preview`;
                popupContent += `
                    <hr>
                    <p><b>Documento:</b></p>
                    <iframe src="${urlVistaPrevia}" style="width:100%; height:300px; border:0;" allow="autoplay"></iframe>
                    <p><a href="${urlVistaPrevia}" target="_blank">Abrir en nueva pestaña</a></p>
                `;
            }
        } else {
            popupContent += `<hr>Sin documento asociado.`;
        }
    } else {
        popupContent += `<hr>No hay datos en Google Sheet para esta zona.`;
    }

    layer.bindPopup(popupContent);

    layer.on({
        mouseover: (e) => e.target.setStyle({ weight: 5, color: '#666', fillOpacity: 0.9 }),
        mouseout: (e) => geoJsonLayer.resetStyle(e.target),
        click: (e) => map.fitBounds(e.target.getBounds())
    });
}

// ==================== 5. CARGA GEOJSON ====================

function cargarGeoJson(url) {
    fetch(url)
        .then(resp => {
            if (!resp.ok) throw new Error('Error fetch GeoJSON: ' + resp.status);
            return resp.json();
        })
        .then(data => {
            if (geoJsonLayer) map.removeLayer(geoJsonLayer);

            geoJsonLayer = L.geoJson(data, {
                style: styleZona,
                onEachFeature: manejarClickZona
            }).addTo(map);

            if (map.getZoom && map.getZoom() < 7) {
                map.fitBounds(geoJsonLayer.getBounds());
            } else {
                // Ajustar al menos a la primera carga
                try { map.fitBounds(geoJsonLayer.getBounds()); } catch (e) {}
            }

            console.log('GeoJSON cargado con', data.features ? data.features.length : 0, 'features.');
        })
        .catch(err => console.error('Error al cargar el GeoJSON:', err));
}

// ==================== 6. OBTENER DATOS DE GOOGLE SHEETS ====================

async function actualizarMapa() {
    console.log('Intentando cargar datos desde Google Sheets (CSV):', GOOGLE_SHEET_CSV);
    try {
        const response = await fetch(GOOGLE_SHEET_CSV, { cache: "no-store", mode: "cors" });

        // debug: mostrar status y primer trozo de texto
        console.log('Fetch CSV status:', response.status, response.statusText);
        const raw = await response.text();
        console.log('RAW CSV (primeros 1000 chars):', raw.slice(0, 1000));

        const registros = parseCSV(raw);
        console.log('Registros parseados:', registros.length);

        // reconstruir estadoZonas
        estadoZonas = {};
        registros.forEach((registro, idx) => {
            // detectamos posibles nombres de columna (por si varían)
            // normalizamos keys a minúsculas con guiones bajos ya en parseCSV
            const keys = Object.keys(registro);

            // posibles nombres: id_geojson, idgeojson, id_geo, id, id_geojson (normalizados)
            const idKeyCandidates = ['id_geojson', 'idgeojson', 'id', 'id_geo', 'id_geo_json', 'id_geojson_'];
            const estadoKeyCandidates = ['estado', 'state', 'status'];
            const pdfKeyCandidates = ['pdf_id', 'pdfid', 'pdf', 'file_id', 'fileid', 'drive_id'];
            const imagenCandidates = ['imagen','image','foto','foto_url'];
            const descCandidates = ['descripcion','description','desc'];

            const findKey = (cands) => {
                for (const c of cands) {
                    if (keys.includes(c)) return c;
                }
                // aproximación contains
                for (const k of keys) {
                    const kk = k.toLowerCase();
                    for (const c of cands) {
                        if (kk.includes(c.replace(/_/g,''))) return k;
                    }
                }
                return null;
            };

            const idKey = findKey(idKeyCandidates);
            if (!idKey) {
                // si no encuentra idKey, hacemos fallback a la primera columna
                // (esto permite depurar)
                console.warn(`Registro ${idx}: no se detectó columna ID (keys: ${keys.slice(0,10).join(', ')})`);
                return; // saltamos registro si no hay id
            }
            const estadoKey = findKey(estadoKeyCandidates);
            const pdfKey = findKey(pdfKeyCandidates);
            const imagenKey = findKey(imagenCandidates);
            const descKey = findKey(descCandidates);

            let rawId = registro[idKey] ? registro[idKey].trim() : null;
            if (!rawId) return; // saltar si id vacío

            // conservamos el formato EXACTO del Sheet (ej "001")
            const finalId = rawId.replace(/^\uFEFF|\uFEFF$/g, '');

            estadoZonas[finalId] = {
                estado: estadoKey ? registro[estadoKey].trim() : '',
                pdfid: pdfKey ? registro[pdfKey].trim() : '',
                imagen: imagenKey ? registro[imagenKey].trim() : '',
                descripcion: descKey ? registro[descKey].trim() : ''
            };
        });

        console.log('estadoZonas cargado. Count:', Object.keys(estadoZonas).length);

        // repintar si ya está cargado el geoJson
        if (geoJsonLayer) {
            geoJsonLayer.eachLayer(layer => {
                layer.setStyle(styleZona(layer.feature));
            });
        }
    } catch (error) {
        console.error('Error al obtener/parsear CSV:', error);
    }
}

// ==================== 7. INICIALIZACIÓN ====================

document.addEventListener('DOMContentLoaded', () => {
    // inicializar mapa con las mismas coordenadas que antes
    map = L.map(MAPA_ID).setView([37.3355, -5.9282], 13);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: 'Map data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);

    // cargar geojson y datos (no bloqueantes)
    cargarGeoJson(GEOJSON_URL);
    actualizarMapa();

    // refresco periódico
    setInterval(actualizarMapa, TIEMPO_REFRESCO_MS);

    console.log('Mapa inicializado; esperando clicks en zonas. URL CSV:', GOOGLE_SHEET_CSV);
});
