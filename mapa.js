// =================================================================
// 1. CONFIGURACIÓN GLOBAL
// =================================================================

// 🚨 URL de la Google Sheet publicada en formato CSV
const GOOGLE_SHEET_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQ9XDZiBWcTtcYhYY_zav7eMzBT9H9NzP-9-pa4gmXdb-81r7JNC9aTVluoUKdxt1nDsjqaLwDGGvaN/pub?gid=1216622820&single=true&output=csv';
const GEOJSON_URL = 'zonas.geojson'; 

// Formato de vista previa de Drive (el más fiable para incrustar)
const DRIVE_BASE_URL_PREVIEW = 'https://drive.google.com/file/d/';

const MAPA_ID = 'mapa'; // Debe coincidir con el ID del <div> en index.html
const TIEMPO_REFRESCO_MS = 5 * 60 * 1000; 

// Variables globales para el estado y capas
let estadoZonas = {};
let geoJsonLayer = null;
let map = null; // Inicializado en DOMContentLoaded

// =================================================================
// 2. FUNCIONES AUXILIARES (Datos y Estilos)
// =================================================================

/**
 * Función robusta para parsear CSV (Normaliza y usa MAYÚSCULAS).
 */
function parseCSV(csvString) {
    let lines = csvString.trim().split('\n').filter(line => line.trim().length > 0);
    if (lines.length === 0) return [];
    
    // Normaliza encabezados a MAYÚSCULAS para lectura consistente
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
 * Retorna el color de relleno basado en el estado (ACTIVO/EXPIRADO).
 */
function obtenerColorEstado(estado) {
    if (typeof estado !== 'string') return '#808080';
    
    switch (estado.toLowerCase()) {
        case 'activo':
        case 'completado': 
            return '#28a745'; // Verde
        case 'expirado':
        case 'pendiente': 
            return '#dc3545'; // Rojo
        default: 
            return '#808080'; // Gris
    }
}

/**
 * Define el estilo visual de la zona.
 */
function styleZona(feature) {
    const idZona = feature.properties.Name; // Usamos 'Name' del GeoJSON
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
 * Muestra el contenido del popup (Incluye IFRAME de Drive).
 */
function manejarClickZona(feature, layer) {
    const idZona = feature.properties.Name; 
    const datosZona = estadoZonas[idZona];
    
    let popupContent = `<h4>Zona: ${idZona}</h4>`;

    if (datosZona) {
        popupContent += `<b>Estado:</b> ${datosZona.estado}<br>`;
        
        if (datosZona.pdfId) {
            const fileId = datosZona.pdfId;
            // Construcción de la URL de Drive para el visor seguro
            const urlVistaPrevia = `${DRIVE_BASE_URL_PREVIEW}${fileId}/preview`;

            popupContent += `
                <hr>
                <p>Documento (ID: ${fileId}):</p>
                <iframe src="${urlVistaPrevia}" style="width:100%; height:300px; border:0;" allow="autoplay"></iframe>
                <a href="${urlVistaPrevia}" target="_blank">Abrir en Pestaña Nueva</a>
            `;
        } else {
            popupContent += '<hr>Sin documento asociado.';
        }
    } else {
        popupContent += '<hr>Datos no encontrados en GSheet para esta zona.';
    }

    layer.bindPopup(popupContent);
    
    layer.on({
        // Eventos de interacción (mouseover, click)
        mouseover: (e) => e.target.setStyle({ weight: 5, color: '#666', fillOpacity: 0.9 }),
        mouseout: (e) => geoJsonLayer.resetStyle(e.target),
        click: (e) => map.fitBounds(e.target.getBounds())
    });
}

// =================================================================
// 3. FUNCIONES DE CARGA Y REFRESCADO
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
 * Obtiene los datos de la hoja de cálculo y actualiza el estado.
 */
async function actualizarMapa() {
    console.log('Buscando actualizaciones en GSheet...');
    try {
        const response = await fetch(GOOGLE_SHEET_URL);
        const csvText = await response.text();
        const registros = parseCSV(csvText); 

        estadoZonas = {};

        registros.forEach(registro => {
            // Accedemos a las propiedades en MAYÚSCULAS, según parseCSV
            const idGeoJson = registro.ID_GEOJSON; 

            if (idGeoJson) {
                estadoZonas[idGeoJson] = {
                    estado: registro.ESTADO, 
                    pdfId: registro.PDF_ID 
                };
            }
        });

        // Repintar las zonas si ya están cargadas
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
// 4. INICIALIZACIÓN (Garantizada)
// =================================================================

// 🚨 CORRECCIÓN CRÍTICA: Aseguramos la inicialización después de la carga del DOM
document.addEventListener('DOMContentLoaded', () => {
    
    // 1. Inicialización del mapa
    map = L.map(MAPA_ID).setView([37.3355, -5.9282], 13); // Vista centrada en Montequinto

    // Proveedor de Tiles (Calles)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: 'Map data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);


    // 2. Cargar el GeoJSON de las zonas
    cargarGeoJson(GEOJSON_URL); 

    // 3. Cargar los datos de la hoja de cálculo y actualizar estilos
    actualizarMapa();
    
    // 4. Programar el refresco
    setInterval(actualizarMapa, TIEMPO_REFRESCO_MS);
});
