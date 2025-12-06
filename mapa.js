// =================================================================
// 1. CONFIGURACIÓN GLOBAL
// =================================================================

// 🚨 URL del Apps Script (DEBE SER LA URL /exec)
const GOOGLE_SHEET_URL = 'https://script.google.com/macros/s/AKfycbxym4UsG7Afk3sRLVmtHFAFoGbAMTomgpvbkxyUdaKA5oHgHsi2LmaVOoewOXw_6v0/exec';

const GEOJSON_URL = 'zonas.geojson';

// URL de thumbnails de Google Drive
const DRIVE_BASE_URL_THUMB = 'https://drive.google.com/thumbnail?sz=w1200&id=';

const MAPA_ID = 'mapa';
const TIEMPO_REFRESCO_MS = 5 * 60 * 1000;

// Variables globales
let estadoZonas = {};
let geoJsonLayer = null;
let map = null;

// Vista general FIJA (PC + móvil)
const VISTA_GENERAL = {
    centro: [37.3355, -5.9282],
    zoom: 15
};


// =================================================================
// 2. FUNCIONES DE ESTILO Y EVENTOS
// =================================================================

// Colores según estado
function obtenerColorEstado(estado) {
    if (typeof estado !== 'string') return '#808080';

    switch (estado.toLowerCase()) {
        case 'activo':
        case 'completado':
            return '#28a745';
        case 'expirado':
        case 'pendiente':
            return '#dc3545';
        default:
            return '#808080';
    }
}

// Estilo de zona
function styleZona(feature) {
    const idBruto = feature.properties.Name;
    const idZona = String(idBruto).trim();
    const datosZona = estadoZonas[idZona];

    let fillColor = obtenerColorEstado('No Definido');
    let weight = 1;
    let fillOpacity = 0.5;

    if (datosZona) {
        fillColor = obtenerColorEstado(datosZona.estado);
        weight = 2;
        fillOpacity = 0.7;
    }

    return {
        fillColor: fillColor,
        weight: weight,
        opacity: 0.5,
        color: 'white',
        dashArray: '3',
        fillOpacity: fillOpacity
    };
}


// =================================================================
// 3. FUNCIÓN manejarClickZona (SIN mover el mapa)
// =================================================================

function manejarClickZona(feature, layer) {
    const idBruto = feature.properties.Name;
    const idZona = String(idBruto).trim();
    const datosZona = estadoZonas[idZona];

    layer.on({
        mouseover: (e) => e.target.setStyle({ weight: 5, color: '#666', fillOpacity: 0.9 }),

        mouseout: (e) => geoJsonLayer.resetStyle(e.target),

        click: () => {

            // Abrir panel sin mover el mapa
            if (datosZona && datosZona.pdfId) {
                abrirPanel(idZona, datosZona.pdfId.trim(), datosZona.estado);
            } else {
                abrirPanel(idZona, null, datosZona ? datosZona.estado : "Sin datos");
            }

            // Asegurar que la vista se mantiene fija
            map.setView(VISTA_GENERAL.centro, VISTA_GENERAL.zoom, { animate: true });
        }
    });
}


// =================================================================
// 4. FUNCIÓN abrirPanel (sin desplazamientos)
// =================================================================

function abrirPanel(idZona, fileId, estado) {

    if (fileId) {
        const thumbnail = `${DRIVE_BASE_URL_THUMB}${fileId}`;
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

    document.getElementById("panel-detalle").classList.add("activo");

    // Reajuste en móvil
    setTimeout(() => map.invalidateSize(), 300);
}



// =================================================================
// 5. FUNCIÓN cargarGeoJson (se mantiene intacta salvo fitBounds duplicado)
// =================================================================

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

            // Asegurar vista fija
            map.setView(VISTA_GENERAL.centro, VISTA_GENERAL.zoom, { animate: true });
        })
        .catch(error => console.error('Error al cargar el GeoJSON:', error));
}



// =================================================================
// 6. CARGA JSONP (NO MODIFICADA)
// =================================================================

function actualizarMapa() {
    console.log('Buscando actualizaciones en Apps Script con JSONP...');

    $.ajax({
        url: GOOGLE_SHEET_URL,
        dataType: 'jsonp',
        success: function (registros) {

            estadoZonas = {};

            registros.forEach(registro => {
                const idBruto = registro.idgeojson;
                const idGeoJson = String(idBruto).trim();

                if (idGeoJson) {
                    estadoZonas[idGeoJson] = {
                        estado: registro.estado,
                        pdfId: registro.pdfid
                    };
                }
            });

            if (Object.keys(estadoZonas).length > 0) {
                cargarGeoJson(GEOJSON_URL);
            }
        },
        error: function (xhr, status, error) {
            console.error('ERROR CRÍTICO: Falló JSONP.', status, error);
        }
    });
}



// =================================================================
// 7. INICIALIZACIÓN (FIJA, ESTABLE, COMPATIBLE MÓVIL/PC)
// =================================================================

document.addEventListener('DOMContentLoaded', () => {

    map = L.map(MAPA_ID).setView(VISTA_GENERAL.centro, VISTA_GENERAL.zoom);

    // Ajuste móvil
    setTimeout(() => map.invalidateSize(), 300);
    setTimeout(() => map.invalidateSize(), 700);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 19,
        attribution: 'Map data © OpenStreetMap'
    }).addTo(map);

    actualizarMapa();
    setInterval(actualizarMapa, TIEMPO_REFRESCO_MS);
});



// =================================================================
// 8. CERRAR PANEL (RESTAURA VISTA FIJA SIN MOVER EL MAPA)
// =================================================================

document.getElementById("panel-cerrar").addEventListener("click", () => {

    document.getElementById("panel-detalle").classList.remove("activo");

    map.setView(VISTA_GENERAL.centro, VISTA_GENERAL.zoom, { animate: true });

    setTimeout(() => map.invalidateSize(), 300);
});
