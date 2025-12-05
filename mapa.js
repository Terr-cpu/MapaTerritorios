// =================================================================
// 1. CONFIGURACIÓN GLOBAL
// =================================================================

// URL de Google Sheet publicada como CSV
const GOOGLE_SHEET_URL =
    'https://docs.google.com/spreadsheets/d/e/2PACX-1vQ9XDZiBWcTtcYhYY_zav7eMzBT9H9NzP-9-pa4gmXdb-81r7JNC9aTVluoUKdxt1nDsjqaLwDGGvaN/pub?gid=1216622820&single=true&output=csv';

const GEOJSON_URL = 'zonas.geojson';

// Correcta para vista previa embebida
const DRIVE_BASE_URL_FILE = 'https://drive.google.com/file/d/';

const MAPA_ID = 'mapa';
const TIEMPO_REFRESCO_MS = 5 * 60 * 1000;

let estadoZonas = {};
let geoJsonLayer = null;
let map = null;

// =================================================================
// 2. FUNCIONES AUXILIARES
// =================================================================

/**
 * Parseo robusto CSV → Array de objetos
 */
function parseCSV(csvString) {
    let lines = csvString.trim().split('\n').filter(l => l.trim().length > 0);
    if (lines.length === 0) return [];

    const headers = lines[0]
        .split(',')
        .map(h =>
            h.trim()
                .replace(/^"|"$/g, '')
                .toLowerCase()
                .replace(/\s+/g, '_')
        );

    const data = [];
    for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',');
        if (values.length !== headers.length) continue;

        let row = {};
        for (let j = 0; j < headers.length; j++) {
            row[headers[j]] = values[j].trim().replace(/^"|"$/g, '');
        }
        data.push(row);
    }
    return data;
}

/**
 * Colores según estado
 */
function obtenerColorEstado(estado) {
    if (typeof estado !== 'string') return '#808080';

    switch (estado.toLowerCase()) {
        case 'activo':
        case 'completado':
            return '#28a745'; // verde
        case 'expirado':
        case 'pendiente':
            return '#dc3545'; // rojo
        default:
            return '#808080'; // gris
    }
}

/**
 * Estilo de cada zona del GeoJSON
 */
function styleZona(feature) {
    const idZona = feature.properties.Name.trim();
    const datos = estadoZonas[idZona];

    return {
        fillColor: datos ? obtenerColorEstado(datos.estado) : '#808080',
        weight: datos ? 2 : 1,
        opacity: 0.5,
        color: 'white',
        dashArray: '3',
        fillOpacity: datos ? 0.7 : 0.5
    };
}

/**
 * Popup al hacer clic en una zona
 */
function manejarClickZona(feature, layer) {
    const idZona = feature.properties.Name.trim();
    const datos = estadoZonas[idZona];

    let popupContent = `<h4>Zona: ${idZona}</h4>`;

    if (datos) {
        popupContent += `<b>Estado:</b> ${datos.estado}<br>`;

        if (datos.pdfId) {
            const fileId = datos.pdfId.trim();
            const urlVista = `${DRIVE_BASE_URL_FILE}${fileId}/preview`;

            popupContent += `
                <hr>
                <p><b>Documento asociado:</b></p>
                <iframe src="${urlVista}" 
                    style="width:100%;height:300px;border:0;" 
                    allow="autoplay"></iframe>
                <br>
                <a href="${urlVista}" target="_blank">Abrir en nueva pestaña</a>
            `;
        } else {
            popupContent += `<hr>No hay PDF asociado.`;
        }
    } else {
        popupContent += `<hr>No hay datos en Google Sheet para esta zona.`;
    }

    layer.bindPopup(popupContent);

    layer.on({
        mouseover: (e) =>
            e.target.setStyle({
                weight: 5,
                color: '#666',
                fillOpacity: 0.9
            }),
        mouseout: (e) => geoJsonLayer.resetStyle(e.target),
        click: (e) => map.fitBounds(e.target.getBounds())
    });
}

/**
 * Cargar zonas (GeoJSON)
 */
function cargarGeoJson(url) {
    fetch(url)
        .then((r) => r.json())
        .then((data) => {
            if (geoJsonLayer) map.removeLayer(geoJsonLayer);

            geoJsonLayer = L.geoJson(data, {
                style: styleZona,
                onEachFeature: manejarClickZona
            }).addTo(map);

            map.fitBounds(geoJsonLayer.getBounds());
        })
        .catch((err) => console.error('Error cargando GeoJSON:', err));
}

/**
 * Actualizar estados desde GSheet
 */
async function actualizarMapa() {
    try {
        const response = await fetch(GOOGLE_SHEET_URL);
        const csvText = await response.text();
        const registros = parseCSV(csvText);

        estadoZonas = {};

        registros.forEach((r) => {
            const idBruto = r.id_geojson;

            // 🔥 NORMALIZACIÓN CRÍTICA — elimina ceros iniciales
            const id = idBruto
                ? String(parseInt(idBruto.trim(), 10)) // "007" → "7"
                : null;

            if (id) {
                estadoZonas[id] = {
                    estado: r.estado,
                    pdfId: r.pdf_id
                };
            }
        });

        if (geoJsonLayer) {
            geoJsonLayer.eachLayer((layer) => {
                layer.setStyle(styleZona(layer.feature));
            });
        }
    } catch (err) {
        console.error('Error cargando datos del Sheet:', err);
    }
}

// =================================================================
// INICIALIZACIÓN
// =================================================================

document.addEventListener('DOMContentLoaded', () => {
    map = L.map(MAPA_ID).setView([37.3355, -5.9282], 13);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19
    }).addTo(map);

    cargarGeoJson(GEOJSON_URL);
    actualizarMapa();

    setInterval(actualizarMapa, TIEMPO_REFRESCO_MS);
});
