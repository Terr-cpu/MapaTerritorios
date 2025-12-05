// =================================================================
// 1. CONFIGURACIÓN GLOBAL
// =================================================================

// Reemplaza estos valores con tus URLs
const GOOGLE_SHEET_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQ9XDZiBWcTtcYhYY_zav7eMzBT9H9NzP-9-pa4gmXdb-81r7JNC9aTVluoUKdxt1nDsjqaLwDGGvaN/pub?gid=1216622820&single=true&output=csv';
const GEOJSON_URL = 'zonas.geojson'; 
const DRIVE_BASE_URL = 'https://drive.google.com/uc?export=view&id='; // Formato de vista directa de Drive

// Variables globales (declaradas aquí, inicializadas en DOMContentLoaded)
let estadoZonas = {};
let geoJsonLayer = null;
let map = null; // Inicializaremos 'map' dentro de DOMContentLoaded
const MAPA_ID = 'mapa'; // ID asumido del div en index.html

// Tiempo de refresco de la Google Sheet (en milisegundos). Aquí, cada 5 minutos.
const TIEMPO_REFRESCO_MS = 5 * 60 * 1000; 

// =================================================================
// 2. FUNCIONES AUXILIARES (INCLUYE parseCSV)
// =================================================================

/**
 * Función robusta para parsear el CSV de Google Sheets.
 */
function parseCSV(csvString) {
    const lines = csvString.trim().split('\n');
    if (lines.length === 0) return [];
    
    // Normaliza los encabezados (elimina espacios y comillas)
    const headers = lines[0].split(',').map(h => 
        h.trim().replace(/^"|"$/g, '').replace(/\s+/g, '_')
    );

    const data = [];
    
    // NOTA: Para diagnosticar errores de encabezado, descomenta temporalmente:
    // console.log('ENCABEZADOS LEÍDOS:', headers);

    for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',');
        if (values.length === headers.length) {
            let obj = {};
            for (let j = 0; j < headers.length; j++) {
                obj[headers[j]] = values[j].trim().replace(/^"|"$/g, '');
            }
            data.push(obj);
        } else {
            // console.error(`Error de parseo en la línea ${i + 1}: El número de columnas no coincide.`);
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
    // CORRECCIÓN 3: Usamos 'Name' del GeoJSON para la ID de la zona
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
    // CORRECCIÓN 3: Usamos 'Name' del GeoJSON
    const idZona = feature.properties.Name; 
    const datosZona = estadoZonas[idZona];
    
    let popupContent = `<h4>Zona: ${idZona}</h4>`;

    if (datosZona) {
        popupContent += `<b>Estado:</b> ${datosZona.estado}<br>`;
        
        // La propiedad 'pdfId' es la que guardamos en actualizarMapa()
        if (datosZona.pdfId) {
            const urlImagenCompleta = DRIVE_BASE_URL + datosZona.pdfId;
            popupContent += `<hr><a href="${urlImagenCompleta}" target="_blank">Ver Documento (ID: ${datosZona.pdfId})</a>`;
            // NOTA: Para mostrar la imagen directamente en el pop-up (si es JPG/PNG):
            // popupContent += `<img src="${urlImagenCompleta}" alt="Documento de la zona" style="max-width: 100%;">`;
        } else {
            popupContent += '<hr>Sin documento asociado.';
        }
    } else {
        popupContent += '<hr>Datos no encontrados en GSheet.';
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

            // Ajustar la vista del mapa al GeoJSON cargado
            map.fitBounds(geoJsonLayer.getBounds());
        })
        .catch(error => console.error('Error al cargar el GeoJSON:', error));
}

/**
 * Obtiene los datos de la hoja de cálculo y actualiza el estado de las zonas.
 */
async function actualizarMapa() {
    console.log('Buscando actualizaciones en GSheet...');
    try {
        const response = await fetch(GOOGLE_SHEET_URL);
        const csvText = await response.text();
        const registros = parseCSV(csvText); // Usamos la función parseCSV

        // Limpiar el estado anterior
        estadoZonas = {};

        registros.forEach(registro => {
            // Asumiendo que el nombre de la columna en el CSV es 'ID_GEOJSON'
            const idGeoJson = registro.ID_GEOJSON; 

            if (idGeoJson) {
                estadoZonas[idGeoJson] = {
                    estado: registro.Estado, 
                    // CORRECCIÓN 4: Almacenamos el ID de Drive como 'pdfId'
                    pdfId: registro.PDF_ID 
                };
            }
        });

        // Aplicar los nuevos estilos a las zonas del mapa (si ya existen)
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

// 🚨 CORRECCIÓN 1: Envolvemos toda la inicialización para evitar "Map container not found"
document.addEventListener('DOMContentLoaded', () => {
    
    // Inicialización del mapa (antes fallaba porque el div no existía aún)
    map = L.map(MAPA_ID).setView([37.3355, -5.9282], 13); // Coordenadas aproximadas de Montequinto

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
