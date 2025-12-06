// =================================================================
// 1. CONFIGURACIÓN GLOBAL
// =================================================================

// 🚨 URL del Apps Script (DEBE SER LA URL /exec)
const GOOGLE_SHEET_URL = 'https://script.google.com/macros/s/AKfycbxym4UsG7Afk3sRLVmtHFAFoGbAMTomgpvbkxyUdaKA5oHgHsi2LmaVOoewOXw_6v0/exec';

const GEOJSON_URL = 'zonas.geojson'; 

// ✅ Constante para generar la URL de la miniatura (thumbnail) de Drive
const DRIVE_BASE_URL_THUMB = 'https://drive.google.com/thumbnail?sz=w1200&id=';

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
    // Lectura de la ID del GeoJSON (se asume que es el campo 'Name')
    const idBruto = feature.properties.Name; 
    // ✅ CLAVE: Limpieza rigurosa para asegurar que "001" coincide con "001"
    const idZona = String(idBruto).trim(); 
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

/** Muestra el contenido del popup (Incluye Thumbnail y Link). */
function manejarClickZona(feature, layer) {
    const idBruto = feature.properties.Name; 
    const idZona = String(idBruto).trim(); 
    
    let popupContent = `<h4>Territorio: ${idZona}</h4>`;
    const datosZona = estadoZonas[idZona];

    if (datosZona) {
        popupContent += `<b>Estado:</b> ${datosZona.estado}<br>`;
        

  if (datosZona.pdfId) {
    const fileId = datosZona.pdfId.trim();

    // URL del thumbnail (solo esto)
    const urlThumbnail = `${DRIVE_BASE_URL_THUMB}${fileId}`;

    popupContent += `
        <hr>
        <p><b>Vista del Territorio):</b></p>
        <img src="${urlThumbnail}"
             alt="Thumbnail"
             style="width:100%; max-height:300px; object-fit:cover; border-radius:6px;"
             onerror="this.style.display='none'">
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
// 3. CARGA DE DATOS PRINCIPAL (APPS SCRIPT - JSONP)
// =================================================================

/** Obtiene los datos de la hoja de cálculo usando el método JSONP (jQuery). */
function actualizarMapa() {
    console.log('Buscando actualizaciones en Apps Script con JSONP...');
    
    // 🚨 Usamos el método jQuery $.ajax con dataType: 'jsonp'
    $.ajax({
        url: GOOGLE_SHEET_URL,
        dataType: 'jsonp', 
        success: function(registros) {
            
            estadoZonas = {};

            registros.forEach(registro => {
                
                // 1. La clave del Sheet: 'idgeojson' (minúsculas)
                const idBruto = registro.idgeojson; 
                // ✅ CLAVE: Limpieza rigurosa para asegurar que "001" coincide con "001"
                const idGeoJson = String(idBruto).trim(); 

                if (idGeoJson) {
                    estadoZonas[idGeoJson] = {
                        estado: registro.estado, 
                        pdfId: registro.pdfid 
                    };
                }
            });
            
            // Si hay datos, forzar el repintado
            if (Object.keys(estadoZonas).length > 0) {
                cargarGeoJson(GEOJSON_URL);
            }
        },
        error: function(xhr, status, error) {
            console.error('ERROR CRÍTICO: Falló la conexión JSONP con Apps Script.', status, error);
        }
    });
}


// =================================================================
// 4. INICIALIZACIÓN (Garantizada)
// =================================================================

document.addEventListener('DOMContentLoaded', () => {
    
    // Inicialización del mapa
    map = L.map(MAPA_ID).setView([37.3355, -5.9282], 13);

    // Proveedor de Tiles (Calles)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: 'Map data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);


    // Carga inicial de datos
    actualizarMapa();
    
    setInterval(actualizarMapa, TIEMPO_REFRESCO_MS);
});






