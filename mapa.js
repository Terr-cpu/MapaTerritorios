// ==============================================================================
// 1. CONFIGURACIÓN
// ==============================================================================

// URL de tu Google Sheet publicada (Archivo -> Compartir -> Publicar en la web -> CSV)
// Reemplaza ESTA URL por la que te dio Google Sheets.
const GSheet_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQ9XDZiBWcTtcYhYY_zav7eMzBT9H9NzP-9-pa4gmXdb-81r7JNC9aTVluoUKdxt1nDsjqaLwDGGvaN/pub?gid=1216622820&single=true&output=csv';

// Nombre del archivo GeoJSON convertido de tu KMZ
const GEOJSON_FILE = 'zonas.geojson'; 

// URL base para descargar imágenes de Google Drive, usando el ID del fichero.
// ESTA PARTE YA CONSTRUYE EL ENLACE COMPLETO.
const DRIVE_BASE_URL = 'https://drive.google.com/uc?id='; 

// Tiempo de refresco de la Google Sheet (en milisegundos). Aquí, cada 5 minutos.
const TIEMPO_REFRESCO_MS = 5 * 60 * 1000; 

// ==============================================================================
// 2. INICIALIZACIÓN DEL MAPA
// ==============================================================================

// Configura las coordenadas centrales y el zoom inicial
const map = L.map('mapa').setView([40.416775, -3.703790], 6); 

// Proveedor de Tiles (Calles). Puedes cambiar esta URL si quieres otro estilo:
// - CartoDB Light: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png'
// - OpenStreetMap (detallado): 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: 'Map data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);

// Variables globales para almacenar los datos y la capa de zonas
let estadoZonas = {};
let geoJsonLayer = null;

// ==============================================================================
// 3. FUNCIONES AUXILIARES
// ==============================================================================

/**
 * Función simple para parsear los datos del Google Sheet (asumiendo formato CSV).
 */
function parseCSV(csvString) {
    const lines = csvString.trim().split('\n');
    if (lines.length === 0) return [];
    
    // Asumimos que los encabezados son la primera línea
    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    const data = [];

    for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',');
        if (values.length === headers.length) {
            let obj = {};
            for (let j = 0; j < headers.length; j++) {
                // Limpia los valores de comillas
                obj[headers[j]] = values[j].trim().replace(/^"|"$/g, '');
            }
            data.push(obj);
        }
    }
    return data;
}

/**
 * Define el estilo de color (rojo o verde) de las zonas.
 */
function styleZona(feature) {
    // Reemplaza 'ID_ZONA' si el nombre de la propiedad en tu GeoJSON es diferente
    const idZona = feature.properties.Name; 
    const datosZona = estadoZonas[idZona];
    
    let colorRelleno = 'gray'; // Color por defecto si no se encuentra el ID
    if (datosZona) {
        const estado = datosZona.estado.toLowerCase();
        if (estado === 'activo') {
            colorRelleno = '#28a745'; // Verde fuerte
        } else if (estado === 'expirado') {
            colorRelleno = '#dc3545'; // Rojo fuerte
        }
    }

    return {
        fillColor: colorRelleno,
        weight: 1, // Grosor del borde
        opacity: 1,
        color: 'white', // Color del borde
        fillOpacity: 0.7
    };
}

/**
 * Maneja el evento de clic en una zona (mostrar pop-up con imagen).
 */
function manejarClickZona(feature, layer) {
    const idZona = feature.properties.Name; 
    const datosZona = estadoZonas[idZona];
    
    let popupContent = `<h3>Zona: ${idZona}</h3><p>Información no disponible.</p>`;

    if (datosZona) {
        // CONSTRUCCIÓN DEL ENLACE COMPLETO con el ID de la GSheet
        const urlImagenCompleta = DRIVE_BASE_URL + datosZona.idpdf;
        
        popupContent = `
            <h3>Zona: ${idZona}</h3>
            <p><strong>Estado:</strong> <span style="color: ${datosZona.estado.toLowerCase() === 'activo' ? 'green' : 'red'};">${datosZona.estado}</span></p>
            <hr>
            <a href="${urlImagenCompleta}" target="_blank">
                <img src="${urlImagenCompleta}" alt="Imagen de la zona ${idZona}">
            </a>
            <small>Haz clic para ver la imagen en grande.</small>
        `;
    }
    
    layer.bindPopup(popupContent).openPopup();
}

/**
 * Configura la interactividad de cada zona al cargarse.
 */
function onEachFeature(feature, layer) {
    layer.on('click', function(e) {
        manejarClickZona(feature, layer);
    });
    // Opcional: Resaltar al pasar el ratón
    layer.on('mouseover', function (e) {
        this.setStyle({
            weight: 3,
            color: 'yellow',
            fillOpacity: 0.9
        });
        this.bringToFront();
    });
    layer.on('mouseout', function (e) {
        geoJsonLayer.resetStyle(this);
    });
}


// ==============================================================================
// 4. LÓGICA PRINCIPAL DE CARGA Y REFRESCADO
// ==============================================================================

/**
 * 1. Carga el GeoJSON y lo añade al mapa con estilos.
 */
function cargarZonasGeoJSON() {
    fetch(GEOJSON_FILE)
        .then(response => response.json())
        .then(data => {
            // Eliminar la capa anterior si existe
            if (geoJsonLayer) {
                map.removeLayer(geoJsonLayer);
            }

            // Crear y añadir la nueva capa GeoJSON
            geoJsonLayer = L.geoJSON(data, {
                style: styleZona,
                onEachFeature: onEachFeature
            }).addTo(map);

            // Ajustar la vista del mapa a las zonas cargadas
            if (geoJsonLayer) {
                 map.fitBounds(geoJsonLayer.getBounds());
            }

            console.log('GeoJSON de zonas cargado y estilizado.');
        })
        .catch(error => console.error('Error al cargar el archivo GeoJSON:', error));
}


/**
 * 2. Descarga y procesa los datos de estado del Google Sheet.
 */
function actualizarMapa() {
    console.log(`Buscando actualizaciones en GSheet... (${new Date().toLocaleTimeString()})`);

    fetch(GSheet_URL)
        .then(response => response.text())
        .then(csvText => {
            const registros = parseCSV(csvText); 
            
            estadoZonas = {}; // Limpia el objeto de estados

            registros.forEach(registro => {
                // Aquí usamos los nombres de las columnas de tu Sheet:
                const idGeoJson = registro.ID_GEOJSON; 
                
                estadoZonas[idGeoJson] = {
                    estado: registro.Estado, 
                    // Asegúrate de usar el nombre de columna correcto para el ID de imagen
                    idImagen: registro.PDF_ID 
                };
            });
            
            // Una vez que los datos de estado están actualizados, repintamos el mapa
            cargarZonasGeoJSON();
        })
        .catch(error => {
            console.error('Error al descargar datos de Google Sheet:', error);
            // Si falla, al menos intenta cargar las zonas con los datos anteriores o sin color
            if (!geoJsonLayer) {
                cargarZonasGeoJSON();
            }
        });
}


// ==============================================================================
// 5. INICIO DEL PROGRAMA
// ==============================================================================

// 1. Cargar el mapa inmediatamente al iniciar
actualizarMapa(); 

// 2. Programar la actualización automática (refresco)

setInterval(actualizarMapa, TIEMPO_REFRESCO_MS);
