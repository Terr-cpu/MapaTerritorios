// =================================================================
// 1. CONFIGURACIÓN GLOBAL
// =================================================================

// 🚨 NUEVA URL DE LA HOJA DE CÁLCULO EN FORMATO JSON
// EJEMPLO: 'https://spreadsheets.google.com/feeds/list/ID_DOCUMENTO/ID_HOJA/public/values?alt=json'
const GOOGLE_SHEET_URL = 'https://spreadsheets.google.com/feeds/list/1vQ9XDZiBWcTtcYhYY_zav7eMzBT9H9NzP-9-pa4gmXdb-81r7JNC9aTVluoUKdxt1nDsjqaLwDGGvaN/1216622820/public/values?alt=json';

const GEOJSON_URL = 'zonas.geojson'; 

// Formato de vista previa de Drive (el más fiable para incrustar)
const DRIVE_BASE_URL_FILE = 'https://drive.google.com/file/d/';

const MAPA_ID = 'mapa'; 
const TIEMPO_REFRESCO_MS = 5 * 60 * 1000; 

// Variables globales para el estado y capas
let estadoZonas = {};
let geoJsonLayer = null;
let map = null; 

// =================================================================
// 2. FUNCIONES DE ESTILO Y EVENTOS
// =================================================================

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
    // Lectura de la ID de la zona: debe coincidir con la propiedad GeoJSON ('Name')
    const idZona = feature.properties.Name.trim(); 
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
    const idZona = feature.properties.Name.trim(); 
    const datosZona = estadoZonas[idZona];
    
    let popupContent = `<h4>Zona: ${idZona}</h4>`;

    if (datosZona) {
        popupContent += `<b>Estado:</b> ${datosZona.estado}<br>`;
        
        if (datosZona.pdfId) {
            const fileId = datosZona.pdfId;
            
            // Construcción de la URL /file/d/ID/preview
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
        popupContent += '<hr>Datos no encontrados en GSheet para esta zona.';
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


// =================================================================
// 3. CARGA DE DATOS PRINCIPAL (JSON)
// =================================================================

/**
 * Obtiene los datos de la hoja de cálculo usando el formato JSON de Google Sheets.
 */
async function actualizarMapa() {
    console.log('Buscando actualizaciones en GSheet vía JSON...');
    try {
        const response = await fetch(GOOGLE_SHEET_URL);
        const data = await response.json(); // Leemos directamente el JSON
        
        // Los registros de fila están en data.feed.entry
        const registros = data.feed.entry; 

        estadoZonas = {};

        registros.forEach(registro => {
            // 🚨 Acceso a las propiedades JSON de Google (gsx$nombre_columna_sin_espacios.$t)
            
            // 1. Clave de la Zona: Buscamos 'gsx$id_geojson.$t'
            const idBruto = registro.gsx$id_geojson.$t; 
            const idGeoJson = idBruto ? idBruto.trim() : null;

            if (idGeoJson) {
                estadoZonas[idGeoJson] = {
                    // 2. Estado
                    estado: registro.gsx$estado.$t, 
                    // 3. ID de Drive
                    pdfId: registro.gsx$pdfid.$t 
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
        console.error('Error al obtener datos de la hoja de cálculo. Falló el JSON fetch:', error);
    }
}

// =================================================================
// 4. INICIALIZACIÓN (Garantizada)
// =================================================================

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
