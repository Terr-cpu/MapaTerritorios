// =================================================================
// 1. CONFIGURACIÓN GLOBAL
// =================================================================

// 🚨 URL del Apps Script (DEBE SER LA URL /exec)
const GOOGLE_SHEET_URL = 'https://script.google.com/macros/s/AKfycbxym4UsG7Afk3sRLVmtHFAFoGbAMTomgpvbkxyUdaKA5oHgHsi2LmaVOoewOXw_6v0/exec';

const GEOJSON_URL = 'zonas.geojson'; 
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

/** Retorna el color de relleno basado en el estado. */
function obtenerColorEstado(estado) {
    if (typeof estado !== 'string') return '#808080';
    
    switch (estado.toLowerCase()) {
        case 'activo': case 'completado': 
            return '#28a745'; 
        case 'expirado': case 'pendiente': 
            return '#dc3545'; 
        default: 
            return '#808080'; 
    }
}

/** Define el estilo visual de la zona. */
function styleZona(feature) {
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
 * Muestra el contenido del popup (Ahora usa Thumbnail y Link).
 */
function manejarClickZona(feature, layer) {
    const idZona = feature.properties.Name.trim(); 
    const datosZona = estadoZonas[idZona];
    
    let popupContent = `<h4>Zona: ${idZona}</h4>`;

    if (datosZona) {
        popupContent += `<b>Estado:</b> ${datosZona.estado}<br>`;
        
        if (datosZona.pdfId) {
            const fileId = datosZona.pdfId;
            
            // 1. URL para el ENLACE (permite ver el PDF/Imagen en el navegador)
            const urlEnlaceDirecto = `https://drive.google.com/file/d/${fileId}/view`;
            
            // 2. URL para el THUMBNAIL (incrustar la imagen pequeña en el popup)
            const urlThumbnail = `${DRIVE_BASE_URL_THUMB}${fileId}`;

            popupContent += `
                <hr>
                <a href="${urlEnlaceDirecto}" target="_blank">
                    <img src="${urlThumbnail}" alt="Vista previa del documento" style="max-width: 100%; height: auto; border-radius: 4px;">
                </a>
                <p><small>Haz clic en la imagen para abrir el documento completo.</small></p>
                <a href="${urlEnlaceDirecto}" target="_blank">Abrir Documento Completo</a>
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
// 3. CARGA DE DATOS PRINCIPAL (APPS SCRIPT)
// =================================================================

/** Obtiene los datos de la hoja de cálculo usando la URL del Apps Script. */
async function actualizarMapa() {
    console.log('Buscando actualizaciones en Apps Script...');
    try {
        const response = await fetch(GOOGLE_SHEET_URL);
        // Leemos la respuesta como JSON puro que el script nos devuelve
        const registros = await response.json(); 
        
        estadoZonas = {};

   registros.forEach(registro => {
            
            // 1. Clave de la Zona: Buscamos 'idgeojson'
            const idBruto = registro.idgeojson; 
            const idGeoJson = idBruto ? idBruto.trim() : null;

            if (idGeoJson) {
                estadoZonas[idGeoJson] = {
                    // 2. Estado: Buscamos 'estado'
                    estado: registro.estado, 
                    // 3. ID de Drive: Buscamos 'pdfid' (la clave de menor caso que aparece en el JSON)
                    pdfId: registro.pdfid 
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
        console.error('Error al obtener datos del Apps Script. Falló el fetch:', error);
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


