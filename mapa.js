// =================================================================
// 1. CONFIGURACIÓN GLOBAL
// =================================================================

// 🚨 URL de la Google Sheet publicada en formato CSV
const GOOGLE_SHEET_URL = 'const GOOGLE_SHEET_URL =
    'https://docs.google.com/spreadsheets/d/1NMjJQ4Q-w3NjODwHB4Ti5WwVYMYc5eUAPoSOeWNUDT/gviz/tq?tqx=out:csv&sheet=terr';
const GEOJSON_URL = 'zonas.geojson'; 

// ✅ CORRECCIÓN FINAL DE LA URL: Formato /file/d/ID/preview
const DRIVE_BASE_URL_FILE = 'https://drive.google.com/file/d/';

const MAPA_ID = 'mapa'; // Debe coincidir con el ID del <div> en index.html
const TIEMPO_REFRESCO_MS = 5 * 60 * 1000; 

// Variables globales para el estado y capas
let estadoZonas = {};
let geoJsonLayer = null;
let map = null; 

// =================================================================
// 2. FUNCIONES AUXILIARES (Datos y Estilos)
// =================================================================

/**
 * Función simple para parsear CSV (Sin forzar mayúsculas).
 */
/**
 * Función robusta para parsear CSV: Limpia y normaliza encabezados a MINÚSCULAS.
 */
function parseCSV(csvString) {
    let lines = csvString.trim().split('\n').filter(line => line.trim().length > 0);
    if (lines.length === 0) return [];
    
    // Normaliza encabezados a MINÚSCULAS y reemplaza espacios por '_'
    const headers = lines[0].split(',').map(h => 
        h.trim().replace(/^"|"$/g, '').toLowerCase().replace(/\s+/g, '_')
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
    const idZona = feature.properties.Name.trim(); // Clave del GeoJSON
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
    const idZona = feature.properties.Name.trim(); // Clave del GeoJSON
    const datosZona = estadoZonas[idZona];
    
    let popupContent = `<h4>Zona: ${idZona}</h4>`;

    if (datosZona) {
        popupContent += `<b>Estado:</b> ${datosZona.estado}<br>`;
        
        if (datosZona.pdfId) {
            const fileId = datosZona.pdfId;
            
            // ✅ CORRECCIÓN FINAL: Construcción de la URL /file/d/ID/preview
            const urlVistaPrevia = `${DRIVE_BASE_URL_FILE}${fileId}/preview`;

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
        popupContent += '<hr>Datos no encontrados en GSheet para esta zona. (Verifique IDs)';
    }

    layer.bindPopup(popupContent);
    
    layer.on({
        mouseover: (e) => e.target.setStyle({ weight: 5, color: '#666', fillOpacity: 0.9 }),
        mouseout: (e) => geoJsonLayer.resetStyle(e.target),
        click: (e) => map.fitBounds(e.target.getBounds())
    });
}


// OTRAS FUNCIONES (sin modificaciones sustanciales)
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
        const registros = parseCSV(csvText); // Usamos la función parseCSV normalizada

        estadoZonas = {};

        registros.forEach(registro => {
            // ✅ SOLUCIÓN FINAL: Buscamos las claves en MINÚSCULAS
            
            // 1. Clave de la Zona: Buscamos 'id_geojson' (normalizado)
            const idBruto = registro.id_geojson; 
            const idGeoJson = idBruto ? idBruto.trim() : null;

            if (idGeoJson) {
                estadoZonas[idGeoJson] = {
                    // 2. Estado: Buscamos 'estado' (normalizado)
                    estado: registro.estado, 
                    // 3. ID de Drive: Buscamos 'pdf_id' (normalizado)
                    pdfId: registro.pdf_id 
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

// 🚨 La inicialización ocurre aquí, después de la carga del DOM
document.addEventListener('DOMContentLoaded', () => {
    
    // Inicialización del mapa
    map = L.map(MAPA_ID).setView([37.3355, -5.9282], 13);

    // Proveedor de Tiles (Calles)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: 'Map data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);


    // Carga de datos
    cargarGeoJson(GEOJSON_URL); 
    actualizarMapa();
    
    setInterval(actualizarMapa, TIEMPO_REFRESCO_MS);
});

