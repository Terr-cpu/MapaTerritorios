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
    const datosZona = estadoZonas[idZona];

    layer.on({
        mouseover: (e) => e.target.setStyle({ weight: 5, color: '#666', fillOpacity: 0.9 }),

        mouseout: (e) => geoJsonLayer.resetStyle(e.target),

        click: (e) => {

            // AUTO-ZOOM INTELIGENTE SEGÚN TAMAÑO DEL POLÍGONO
            const bounds = e.target.getBounds();
            const area = bounds.getSouthWest().distanceTo(bounds.getNorthEast());

            if (area < 80) map.fitBounds(bounds, { maxZoom: 18, animate: true });
            else if (area < 200) map.fitBounds(bounds, { maxZoom: 17, animate: true });
            else map.fitBounds(bounds, { maxZoom: 16, animate: true });

            // Abrir panel lateral directamente si hay datos
            if (datosZona && datosZona.pdfId) {
                abrirPanel(
                    idZona,
                    datosZona.pdfId.trim(),
                    datosZona.estado
                );
            } else {
                abrirPanel(idZona, null, datosZona ? datosZona.estado : "Sin datos");
            }
        }
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

            // Encajar todas las zonas con padding
const bounds = geoJsonLayer.getBounds();
map.fitBounds(bounds, { padding: [20, 20], animate: true });
            
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

function abrirPanel(idZona, fileId, estado) {

    // Si hay imagen
    if (fileId) {
        const thumbnail = `https://drive.google.com/thumbnail?sz=w1200&id=${fileId}`;
        const linkCompleto = `https://drive.google.com/file/d/${fileId}/view`;

        document.getElementById("panel-imagen").src = thumbnail;
        document.getElementById("panel-link").href = linkCompleto;
        document.getElementById("panel-imagen").style.display = "block";
        document.getElementById("panel-link").style.display = "inline-block";
    } else {
        document.getElementById("panel-imagen").style.display = "none";
        document.getElementById("panel-link").style.display = "none";
    }

    document.getElementById("panel-titulo").textContent = `Territorio ${idZona}`;
    document.getElementById("panel-estado").textContent = `Estado: ${estado}`;

    // Mostrar el panel
    document.getElementById("panel-detalle").classList.add("activo");

    // Ajustar tamaño del mapa (muy importante para móvil)
    setTimeout(() => {
        map.invalidateSize();
    }, 350);

    // Desplazar el mapa visualmente a la izquierda cuando el panel se abre
    setTimeout(() => {
        const despl = Math.round(window.innerWidth * 0.22);
map.panBy([-despl, 0], { animate: true });
    }, 450);
}

// =================================================================
// 4. INICIALIZACIÓN (Garantizada)
// =================================================================

document.addEventListener('DOMContentLoaded', () => {

    // Inicialización del mapa
    map = L.map(MAPA_ID).setView([37.3355, -5.9282], 15);

    // Ajuste imprescindible para móvil
    setTimeout(() => {
        map.invalidateSize();
    }, 500);

    // Proveedor de Tiles (Calles)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 19,
        attribution: 'Map data © OpenStreetMap contributors'
    }).addTo(map);

    // Carga inicial de datos
    actualizarMapa();

    setInterval(actualizarMapa, TIEMPO_REFRESCO_MS);
});

// Cerrar panel lateral y restaurar vista general
document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("panel-cerrar").addEventListener("click", () => {

        document.getElementById("panel-detalle").classList.remove("activo");

        // Restaurar vista general (solo ajustar a los polígonos)
        if (geoJsonLayer) {
            const bounds = geoJsonLayer.getBounds();
            map.fitBounds(bounds, { padding: [20, 20], animate: true });

            // Reajustar tamaño móvil// Ajuste REAL del mapa en móvil
setTimeout(() => map.invalidateSize(), 300);
setTimeout(() => map.invalidateSize(), 800);
setTimeout(() => map.invalidateSize(), 1500);

// Aumentar zoom inicial SOLO en móviles
if (window.innerWidth < 768) {
    setTimeout(() => {
        map.setZoom(16); // puedes subirlo a 17 si quieres más cerca
    }, 900);
}

            // Acercar un poco la vista para que no quede tan lejos
            setTimeout(() => {
                map.zoomIn(1);
            }, 550);

            // Desplazar mapa hacia la derecha, recuperando la posición original
            setTimeout(() => {
               // Desplazamiento proporcional al tamaño de pantalla
const desplazamiento = Math.round(window.innerWidth * 0.22);

// Restaurar posición original
map.panBy([desplazamiento, 0], { animate: true });

            }, 650);
        }

    });
});




















