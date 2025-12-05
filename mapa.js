
// =================================================================
// 1. CONFIGURACIÓN
// =================================================================

// Reemplaza estos valores con tus URLs
const GOOGLE_SHEET_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQ9XDZiBWcTtcYhYY_zav7eMzBT9H9NzP-9-pa4gmXdb-81r7JNC9aTVluoUKdxt1nDsjqaLwDGGvaN/pub?gid=1216622820&single=true&output=csv';
const GEOJSON_URL = 'zonas.geojson'; 
const DRIVE_BASE_URL = 'https://drive.google.com/uc?export=view&id=';

// Variables de estado
let estadoZonas = {};
let geoJsonLayer;
const MAPA_ID = 'mapa-id'; // Asegúrate de que este es el ID de tu contenedor <div>

// =================================================================
// 2. INICIALIZACIÓN DEL MAPA
// =================================================================

const map = L.map(MAPA_ID).setView([25, -100], 5);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap contributors'
}).addTo(map);

/**
 * Función robusta para parsear CSV: Normaliza encabezados y verifica consistencia.
 */
function parseCSV(csvString) {
    const lines = csvString.trim().split('\n');
    if (lines.length === 0) return [];
    
    // Normaliza los encabezados: elimina comillas y espacios para coincidir
    const headers = lines[0].split(',').map(h => 
        h.trim().replace(/^"|"$/g, '').replace(/\s+/g, '_')
    );
    
    // Si los encabezados son 'ID GEOJSON' y 'PDF ID', ahora serán 'ID_GEOJSON' y 'PDF_ID'

    const data = [];
    console.log('--- ENCABEZADOS LEÍDOS (IMPORTANTE) ---');
    console.log(headers); // MIRA ESTO EN LA CONSOLA DEL NAVEGADOR
    console.log('---------------------------------------');


    for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',');
        if (values.length === headers.length) {
            let obj = {};
            for (let j = 0; j < headers.length; j++) {
                obj[headers[j]] = values[j].trim().replace(/^"|"$/g, '');
            }
            data.push(obj);
        } else {
            console.error(`Error de parseo en la línea ${i + 1}: El número de columnas no coincide.`);
        }
    }
    return data;
}

// =================================================================
// 3. FUNCIONES DE ESTILO Y EVENTOS
// =================================================================

/**
 * Retorna el color de relleno basado en el estado.
 */
function obtenerColorEstado(estado) {
    switch (estado) {
        case 'Pendiente': 
            return '#ff0000'; // Rojo
        case 'En Proceso': 
            return '#ffa500'; // Naranja
        case 'Completado': 
            return '#008000'; // Verde
        default: 
            return '#808080'; // Gris
    }
}

/**
 * Define el estilo de una zona (polígono).
 */
function styleZona(feature) {
    // CORRECCIÓN 1: Usamos 'Name' ya que es el campo que contiene el ID después de la conversión KML/Drive a GeoJSON
    const idZona = feature.properties.Name; 
    const datosZona = estadoZonas[idZona];

    let fillColor = obtenerColorEstado('No Definido'); // Estado por defecto
    let weight = 1;
    let opacity = 0.5;
    let fillOpacity = 0.5;

    if (datosZona) {
        fillColor = obtenerColorEstado(datosZona.estado);
        weight = 2; // Más grueso si tiene datos
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
    // CORRECCIÓN 2a: Usamos 'Name' para obtener el ID de la zona
    const idZona = feature.properties.Name; 
    const datosZona = estadoZonas[idZona];
    
    let popupContent = `<h4>Zona: ${idZona}</h4>`;

    if (datosZona) {
        popupContent += `<b>Estado:</b> ${datosZona.estado}<br>`;
        
        if (datosZona.pdfId) {
            // CORRECCIÓN 2b: Usamos 'pdfId' para acceder al ID de Drive que guardamos en actualizarMapa()
            const urlImagenCompleta = DRIVE_BASE_URL + datosZona.pdfId;
            popupContent += `<a href="${urlImagenCompleta}" target="_blank">Ver Documento (PDF ID: ${datosZona.pdfId})</a>`;
        } else {
            popupContent += 'Sin documento asociado.';
        }
    } else {
        popupContent += 'Datos no disponibles o sin sincronizar.';
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
// 4. CARGA DE DATOS
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

            // Ajustar el mapa al GeoJSON cargado
            map.fitBounds(geoJsonLayer.getBounds());
        })
        .catch(error => console.error('Error al cargar el GeoJSON:', error));
}

/**
 * Obtiene los datos de la hoja de cálculo y actualiza el estado de las zonas.
 */
async function actualizarMapa() {
    try {
        const response = await fetch(GOOGLE_SHEET_URL);
        const data = await response.json();
        const registros = data.feed.entry;

        // Limpiar el estado anterior
        estadoZonas = {};

        registros.forEach(registro => {
            // Asumiendo que el campo de la zona es 'gsx$zonaid' en el JSON de Google Sheets
            const idGeoJson = registro.gsx$zonaid.$t; 

            if (idGeoJson) {
                estadoZonas[idGeoJson] = {
                    estado: registro.gsx$estado.$t,
                    // CORRECCIÓN 3: Almacenamos el ID de Drive como 'pdfId'
                    // Asumiendo que el campo del ID de Drive es 'gsx$pdfid'
                    pdfId: registro.gsx$pdfid.$t 
                };
            }
        });

        // Aplicar los nuevos estilos a las zonas del mapa
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
// 5. EJECUCIÓN
// =================================================================

document.addEventListener('DOMContentLoaded', () => {
    // 1. Cargar el GeoJSON de las zonas
    cargarGeoJson(GEOJSON_URL); 

    // 2. Cargar los datos de la hoja de cálculo y actualizar estilos
    actualizarMapa();
    
    // Opcional: Actualizar el mapa cada 60 segundos para refrescar los datos de la hoja
    // setInterval(actualizarMapa, 60000); 
});

