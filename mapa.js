// =================================================================
// 1. CONFIGURACIÓN GLOBAL
// =================================================================

// 🚨 IMPORTANTE: Verifica que esta URL sea la correcta y esté publicada en formato CSV
const GOOGLE_SHEET_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQ9XDZiBWcTtcYhYY_zav7eMzBT9H9NzP-9-pa4gmXdb-81r7JNC9aTVluoUKdxt1nDsjqaLwDGGvaN/pub?gid=1216622820&single=true&output=csv';
const GEOJSON_URL = 'zonas.geojson'; 

// ⚠️ SOLUCIÓN PARA IMÁGENES/PDFs: Usaremos el formato /file/d/ID/preview para visualización de Drive
const DRIVE_BASE_URL_PREVIEW = 'https://drive.google.com/file/d/';

// Variables globales (declaradas aquí, inicializadas en DOMContentLoaded)
let estadoZonas = {};
let geoJsonLayer = null;
let map = null; 
const MAPA_ID = 'mapa'; // ID asumido del div en index.html

// Tiempo de refresco de la Google Sheet (5 minutos)
const TIEMPO_REFRESCO_MS = 5 * 60 * 1000; 

// =================================================================
// 2. FUNCIONES AUXILIARES
// =================================================================

/**
 * Función robusta para parsear CSV (esencial para leer GSheet).
 */
function parseCSV(csvString) {
    let lines = csvString.trim().split('\n');
    if (lines.length === 0) return [];
    
    lines = lines.filter(line => line.trim().length > 0);
    if (lines.length === 0) return [];

    // Normaliza los encabezados (MAYÚSCULAS y reemplazo de espacios por guiones bajos)
    const headers = lines[0].split(',').map(h => 
        h.trim().replace(/^"|"$/g, '').replace(/\s+/g, '_').toUpperCase()
    );

    const data = [];
    
    for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',');
        if (values.length === headers.length) {
            let obj = {};
            for (let j = 0; j < headers.length; j++) {
                obj[headers[j]] = values[j].trim().replace(/^"|"$/g, '');
            }
            data.push(obj);
        }
    }
    return data;
}

/**
 * Retorna el color de relleno basado en el estado.
 */
function obtenerColorEstado(estado) {
    if (typeof estado !== 'string') return '#808080';
    
    switch (estado.toLowerCase()) {
        case 'activo':
        case 'completado': 
            return '#28a745'; // Verde fuerte
        case 'expirado':
        case 'pendiente': 
            return '#dc3545'; // Rojo fuerte
        default: 
            return '#808080'; // Gris (No Definido)
    }
}

/**
 * Define el estilo de una zona (polígono).
 */
function styleZona(feature) {
    // Lectura de la ID de la zona: debe coincidir con la propiedad GeoJSON ('Name')
    const idZona = feature.properties.Name; 
    const datosZona = estadoZonas[idZona];

    let fillColor = obtenerColorEstado('No Definido'); 
    let weight = 1;
    let opacity = 0.5;
    let fillOpacity = 0.5;

    if (datosZona) {
        fillColor = obtenerColorEstado(datosZona.estado);
        weight = 2;
        fillOpacity = 0.7;
    }

    return {
        fillColor: fillColor,
        weight: weight,
        opacity: opacity,
        color: 'white',
        dashArray: '3',
        fillOpacity: fillOpacity
    };
}

/**
 * Muestra el contenido del popup y configura los eventos de interacción.
 */
function manejarClickZona(feature, layer) {
    const idZona = feature.properties.Name; 
    const datosZona = estadoZonas[idZona];
    
    let popupContent = `<h4>Zona: ${idZona}</h4>`;

    if (datosZona) {
        popupContent += `<b>Estado:</b> ${datosZona.estado}<br>`;
        
        if (datosZona.pdfId) {
            const fileId = datosZona.pdfId;
            // 🚨 SOLUCIÓN 1: Usamos el formato /preview para forzar el visor de Drive
            const urlVistaPrevia = `${DRIVE_BASE_URL_PREVIEW}${fileId}/preview`;

            popupContent += `
                <hr>
                <p>Documento (ID: ${fileId}):</p>
                <iframe src="${urlVistaPrevia}" style="width:100%; height:300px; border:0;" allow="autoplay"></iframe>
                <a href="${urlVistaPrevia}" target="_blank">Abrir en Pestaña Nueva</a>
            `;
        } else {
            popupContent += '<hr>Sin documento asociado (Falta PDF_ID en Sheet).';
        }
    } else {
        popupContent += '<hr>Datos no encontrados en GSheet. (Verificar ID: ' + idZona + ')';
    }

    layer.bindPopup(popupContent);
    
    layer.on({
        mouseover: highlightFeature,
        mouseout: resetHighlight,
        click: zoomToFeature
    });
}

function highlightFeature(e) {
    const layer = e.target;
    layer.setStyle({
        weight: 5,
        color: '#666',
        dashArray: '',
        fillOpacity: 0.9
    });
    if (!L.Browser.ie && !L.Browser.opera && !L.Browser.edge) {
        layer.bringToFront();
    }
}

function resetHighlight(e) {
    if (geoJsonLayer) {
        geoJsonLayer.resetStyle(e.target);
    }
}

function zoomToFeature(e) {
    map.fitBounds(e.target.getBounds());
}

// =================================================================
// 3. CARGA DE DATOS Y LÓGICA PRINCIPAL
// =================================================================

/**
 * Carga el archivo GeoJSON y lo añade al mapa.
 */
function cargarGeoJson(url) {
    fetch(url)
        .then(response => response.json())
        .then(data => {
            if (geoJsonLayer) {
                map.removeLayer(geoJsonLayer);
            }
            geoJsonLayer = L.geoJson(data, {
                style: styleZona,
                onEachFeature: manejarClickZona
            }).addTo(map);

            if (map.getZoom() < 7) {
                 map.fitBounds(geoJsonLayer.getBounds());
            }
        })
        .catch(error => console.error('Error al cargar el GeoJSON:', error));
}

/**
 * Obtiene los datos de la hoja de cálculo y actualiza el estado de las zonas.
 */
async function actualizarMapa() {
    try {
        const response = await fetch(GOOGLE_SHEET_URL);
        const csvText = await response.text();
        const registros = parseCSV(csvText); // Usamos la función parseCSV

        estadoZonas = {};

        registros.forEach(registro => {
            // Asumimos MAYÚSCULAS para las claves de columna por la función parseCSV
            const idGeoJson = registro.ID_GEOJSON; 

            if (idGeoJson) {
                estadoZonas[idGeoJson] = {
                    estado: registro.ESTADO, 
                    pdfId: registro.PDF_ID 
                };
            }
        });

        if (geoJsonLayer) {
            geoJsonLayer.eachLayer(layer => {
                layer.setStyle(styleZona(layer.feature));
            });
        }
        
    } catch (error) {
        console.error('Error al obtener datos de la hoja de cálculo:', error);
    }
}

// =================================================================
// 4. EJECUCIÓN: Aseguramos que el DOM esté cargado
// =================================================================

// 🚨 CORRECCIÓN FINAL: Inicializamos todo DESPUÉS de que el DOM esté listo
document.addEventListener('DOMContentLoaded', () => {
    
    // Inicialización del mapa
    map = L.map(MAPA_ID).setView([37.3355, -5.9282], 13); // Coordenadas aproximadas

    // Proveedor de Tiles (Calles)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: 'Map data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);


    // 1. Cargar el GeoJSON de las zonas
    cargarGeoJson(GEOJSON_URL); 

    // 2. Cargar los datos de la hoja de cálculo y actualizar estilos
    actualizarMapa();
    
    // 3. Programar la actualización automática (refresco)
    setInterval(actualizarMapa, TIEMPO_REFRESCO_MS);
});
