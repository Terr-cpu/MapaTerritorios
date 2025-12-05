// mapa.js - versión robusta con múltiples estrategias de emparejado y logging

// =======================
// CONFIGURACIÓN
// =======================
const GOOGLE_SHEET_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQ9XDZiBWcTtcYhYY_zav7eMzBT9H9NzP-9-pa4gmXdb-81r7JNC9aTVluoUKdxt1nDsjqaLwDGGvaN/pub?gid=1216622820&single=true&output=csv';
const GEOJSON_URL = 'zonas.geojson';
const DRIVE_BASE_URL_FILE = 'https://drive.google.com/file/d/';
const MAPA_ID = 'mapa';
const TIEMPO_REFRESCO_MS = 5 * 60 * 1000;

let estadoZonas = {};   // mapa "clave" -> datos
let lookupMap = {};     // mapa de variantes -> clave original
let geoJsonLayer = null;
let map = null;

// =======================
// UTIL: limpieza y variantes de ID
// =======================
function trimSafe(s) {
    return (typeof s === 'string') ? s.trim() : s;
}

function removeTrailingDotZero(s) {
    if (!s) return s;
    return s.replace(/\.0+$/, '');
}

function onlyDigits(s) {
    if (!s) return s;
    const m = s.match(/\d+/g);
    return m ? m.join('') : s;
}

function variantsForId(raw) {
    // devuelve array de variantes para intentar emparejar
    if (raw === null || raw === undefined) return [];
    const t = trimSafe(String(raw));
    const v = new Set();

    v.add(t); // tal cual "001" o "1"
    v.add(removeTrailingDotZero(t)); // "1.0" -> "1"
    const digits = onlyDigits(t);
    if (digits) {
        v.add(digits); // "001" -> "001" ; "1" -> "1"
        // versión numeric sin ceros a la izquierda
        const asNum = String(parseInt(digits, 10));
        if (!isNaN(parseInt(digits, 10))) {
            v.add(asNum);
        }
        // padded 2 y 3 (por si tu geojson usa 2 o 3 dígitos)
        v.add(asNum.padStart(2, '0'));
        v.add(asNum.padStart(3, '0'));
    }
    // otra variante: quitar ceros iniciales sólo (ej "007" -> "7")
    v.add(t.replace(/^0+/, ''));

    // limpiar comillas / caracteres invisibles
    const cleaned = t.replace(/[\u200B-\u200D\uFEFF]/g, '');
    v.add(cleaned);

    return Array.from(v).filter(x => x !== undefined && x !== null);
}

// =======================
// PARSE CSV (mejorado, pero simple) — normaliza headers y elimina BOM
// =======================
function parseCSV(csvString) {
    if (!csvString) return [];
    // eliminar BOM si existe
    csvString = csvString.replace(/^\uFEFF/, '');

    const lines = csvString.split('\n').filter(l => l.trim().length > 0);
    if (lines.length === 0) return [];

    // split headers considerando comillas y posibles comas dentro
    const rawHeaders = splitCSVLine(lines[0]);
    const headers = rawHeaders.map(h => normalizeHeader(h));

    const data = [];
    for (let i = 1; i < lines.length; i++) {
        const parts = splitCSVLine(lines[i]);
        if (parts.length === 0) continue;
        // si hay menos o más columnas, todavía intentamos alinear por índice
        const row = {};
        for (let j = 0; j < headers.length; j++) {
            const key = headers[j] || `col_${j}`;
            const val = (j < parts.length) ? parts[j] : '';
            row[key] = val;
        }
        data.push(row);
    }
    return data;
}

// Split line CSV básico (maneja comillas escapadas)
function splitCSVLine(line) {
    const result = [];
    let cur = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"' ) {
            // si siguiente también es comilla, es comilla escapada
            if (inQuotes && line[i+1] === '"') {
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

function normalizeHeader(h) {
    if (!h) return h;
    // eliminar BOM y caracteres invisibles
    let s = h.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
    s = s.toLowerCase().replace(/\s+/g, '_');
    // quitar comillas sobrantes
    s = s.replace(/^"|"$/g, '');
    return s;
}

// =======================
// Cargar GeoJSON y bindear capas
// =======================
function styleZona(feature) {
    const id = feature.properties && feature.properties.Name ? feature.properties.Name.trim() : null;
    const datos = id ? estadoZonas[id] : undefined;
    return {
        fillColor: datos ? obtenerColorEstado(datos.estado) : '#808080',
        weight: datos ? 2 : 1,
        opacity: 0.5,
        color: 'white',
        dashArray: '3',
        fillOpacity: datos ? 0.7 : 0.5
    };
}

function manejarClickZona(feature, layer) {
    const props = feature.properties || {};
    const rawId = props.Name || props.name || props.ID || props.id || props.CODIGO || props.codigo || props.descripcion || props.description;
    console.log('--- Click zona ---');
    console.log('Feature properties:', props);
    console.log('Raw id detected from properties.Name/name/ID/... =', rawId);

    // Generar variantes del id de la feature
    const featureVariants = variantsForId(rawId);
    console.log('Feature variants to try:', featureVariants);

    // Intentos de emparejado (informe en consola)
    let matchedKey = null;
    let matchedDatos = null;
    const tried = [];

    // 1) Intentar matches directos sobre lookupMap (que contiene variantes)
    for (const fv of featureVariants) {
        tried.push(fv);
        if (lookupMap.hasOwnProperty(fv)) {
            matchedKey = lookupMap[fv];
            matchedDatos = estadoZonas[matchedKey];
            console.log('Matched via lookupMap variant:', fv, '=>', matchedKey);
            break;
        }
    }

    // 2) Si no encontrado, intentar búsqueda por índice en estadoZonas: exact match rawId
    if (!matchedDatos && rawId && estadoZonas.hasOwnProperty(trimSafe(String(rawId)))) {
        matchedKey = trimSafe(String(rawId));
        matchedDatos = estadoZonas[matchedKey];
        console.log('Matched via exact rawId key:', matchedKey);
    }

    // 3) Intentar eliminar ceros iniciales o .0 y reintentar
    if (!matchedDatos && rawId) {
        const cleaned = removeTrailingDotZero(trimSafe(String(rawId))).replace(/^0+/, '');
        if (lookupMap.hasOwnProperty(cleaned)) {
            matchedKey = lookupMap[cleaned];
            matchedDatos = estadoZonas[matchedKey];
            console.log('Matched via cleaned (no leading zeros):', cleaned, '=>', matchedKey);
        }
    }

    // 4) Como último recurso, intentar buscar por coincidencia parcial en 'description' o 'nombre'
    if (!matchedDatos && props.description) {
        const d = trimSafe(props.description);
        if (estadoZonas.hasOwnProperty(d)) {
            matchedKey = d;
            matchedDatos = estadoZonas[d];
            console.log('Matched via properties.description:', d);
        }
    }

    // Mostrar info completa en consola para debugging si no se encontró nada
    if (!matchedDatos) {
        console.warn('No se encontró match para esta zona. Intentos:', tried);
        console.warn('Listado keys de estadoZonas (primeras 30):', Object.keys(estadoZonas).slice(0,30));
        console.warn('lookupMap sample (primeras 50 entradas):', Object.entries(lookupMap).slice(0,50));
    }

    // Construcción del popup
    let popupContent = `<h4>Zona: ${rawId ?? '(sin id)'}</h4>`;

    if (matchedDatos) {
        popupContent += `<b>Estado:</b> ${matchedDatos.estado || '---'}<br>`;
        const pid = matchedDatos.pdfId ? matchedDatos.pdfId.trim() : null;
        if (pid) {
            const urlVista = `${DRIVE_BASE_URL_FILE}${pid}/preview`;
            popupContent += `
                <hr>
                <p><b>Documento asociado:</b></p>
                <iframe src="${urlVista}" style="width:100%;height:300px;border:0;" allow="autoplay"></iframe>
                <br><a href="${urlVista}" target="_blank">Abrir en nueva pestaña</a>
            `;
        } else {
            popupContent += '<hr>No hay PDF asociado (pdf_id vacío).';
        }
    } else {
        popupContent += '<hr>No hay datos en Google Sheet para esta zona. Revisa la consola para detalles.';
    }

    layer.bindPopup(popupContent);
    layer.on({
        mouseover: e => e.target.setStyle({ weight: 5, color: '#666', fillOpacity: 0.9 }),
        mouseout: e => geoJsonLayer.resetStyle(e.target),
        click: e => map.fitBounds(e.target.getBounds())
    });
}

function cargarGeoJson(url) {
    fetch(url)
        .then(r => {
            if (!r.ok) throw new Error('GeoJSON fetch status: ' + r.status);
            return r.json();
        })
        .then(data => {
            if (geoJsonLayer) map.removeLayer(geoJsonLayer);
            geoJsonLayer = L.geoJson(data, {
                style: styleZona,
                onEachFeature: manejarClickZona
            }).addTo(map);
            map.fitBounds(geoJsonLayer.getBounds());
            console.log('GeoJSON cargado con', data.features.length, 'features.');
        })
        .catch(err => console.error('Error al cargar GeoJSON:', err));
}

// =======================
// Obtener datos Sheet y construir lookupMap
// =======================
function buildLookupMap() {
    lookupMap = {}; // variante -> original key
    for (const key of Object.keys(estadoZonas)) {
        const variants = variantsForId(key);
        // incluir variante exacta también
        variants.push(key);
        for (const v of variants) {
            if (!v) continue;
            lookupMap[v] = key;
        }
    }
    console.log('LookupMap creado. Entradas:', Object.keys(lookupMap).length);
}

function obtenerClavesRegistro(registro) {
    // devolver las keys reales del objeto registro (útil para debug de BOM)
    return Object.keys(registro || {});
}

async function actualizarMapa() {
    console.log('Solicitando CSV desde:', GOOGLE_SHEET_URL);
    try {
        const resp = await fetch(GOOGLE_SHEET_URL);
        if (!resp.ok) {
            console.error('Error fetching CSV:', resp.status, resp.statusText);
            return;
        }
        const csvText = await resp.text();
        const registros = parseCSV(csvText);
        console.log('Registros parseados desde CSV:', registros.length);

        estadoZonas = {};
        for (const r of registros) {
            // Mostrar keys detectadas (solo para el primer registro)
            // Normalizamos nombres de campos: buscamos campos comunes
            const keys = obtenerClavesRegistro(r);
            // Encontrar las posibles columnas que pueden contener el id y pdf y estado
            const idKeyCandidates = ['id_geojson','id_geojson','id_geo','id','id_geo_json','id_geojson_','idgeojson','id_geojson'];
            const pdfKeyCandidates = ['pdf_id','pdfid','pdf','file_id','fileid'];
            const estadoKeyCandidates = ['estado','state','status'];

            // Buscamos entre las keys del registro (ya normalizadas por parseCSV)
            const findKey = (cands) => {
                for (const c of cands) {
                    if (keys.includes(c)) return c;
                }
                // fallback: intentar aproximación (contains)
                for (const k of keys) {
                    const kk = k.toLowerCase();
                    for (const c of cands) {
                        if (kk.includes(c.replace(/_/g,''))) return k;
                    }
                }
                return null;
            };

            const idKey = findKey(idKeyCandidates);
            const pdfKey = findKey(pdfKeyCandidates);
            const estadoKey = findKey(estadoKeyCandidates);

            if (!idKey) {
                // intentar si las keys están en mayúsculas o con BOM
                console.warn('No se encontró idKey en registro. Keys detectadas:', keys.slice(0,30));
            }

            const rawId = idKey ? trimSafe(r[idKey]) : null;
            if (!rawId) continue; // sin id no lo añadimos

            // conservar el id tal cual del sheet (no eliminar ceros por defecto)
            const finalId = trimSafe(String(rawId)).replace(/^\uFEFF|\uFEFF$/g,''); // limpiar BOM

            estadoZonas[finalId] = {
                estado: estadoKey ? r[estadoKey] : '',
                pdfId: pdfKey ? r[pdfKey] : ''
            };
        }

        console.log('estadoZonas keys loaded (count):', Object.keys(estadoZonas).length);
        buildLookupMap();

        // repintar si existe geoJsonLayer
        if (geoJsonLayer) {
            geoJsonLayer.eachLayer(layer => {
                layer.setStyle(styleZona(layer.feature));
            });
        }
    } catch (err) {
        console.error('Error al actualizar mapa:', err);
    }
}

// =======================
// colores por estado
// =======================
function obtenerColorEstado(estado) {
    if (!estado || typeof estado !== 'string') return '#808080';
    switch (estado.trim().toLowerCase()) {
        case 'activo':
        case 'completado':
            return '#28a745';
        case 'expirado':
        case 'pendiente':
            return '#dc3545';
        default:
            return '#808080';
    }
}

// =======================
// INICIALIZACIÓN
// =======================
document.addEventListener('DOMContentLoaded', () => {
    map = L.map(MAPA_ID).setView([37.3355, -5.9282], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19
    }).addTo(map);

    cargarGeoJson(GEOJSON_URL);
    actualizarMapa();
    setInterval(actualizarMapa, TIEMPO_REFRESCO_MS);

    console.log('mapa.js inicializado. Cuando hagas click en una zona verás logs detallados en la consola.');
});
