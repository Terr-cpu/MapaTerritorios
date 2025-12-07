// =================================================================
// 1. CONFIGURACIÓN GLOBAL
// =================================================================

// URL Apps Script
const GOOGLE_SHEET_URL ='https://script.google.com/macros/s/AKfycbzi61cNO2ktIo8VyTYzomjyu6Dhcfmsmoc9VvV74uBRzOE7khNVUmcMPS2nnvNzHKxWzA/exec';

const GEOJSON_URL = "zonas.geojson";

// URL thumbnails Drive
const DRIVE_BASE_URL_THUMB = "https://drive.google.com/thumbnail?sz=w1200&id=";

const MAPA_ID = "mapa";
const TIEMPO_REFRESCO_MS = 5 * 60 * 1000;

// Variables globales
let estadoZonas = {};
let geoJsonLayer = null;
let map = null;

// NUEVO: guardar zona seleccionada
let zonaSeleccionada = null;

// Vista fija
const VISTA_GENERAL = {
  centro: [37.3355, -5.9282],
  zoom: 15,
};

// =================================================================
// 2. FUNCIONES DE ESTILO
// =================================================================

function obtenerColorEstado(estado) {
  if (typeof estado !== "string") return "#808080";

  switch (estado.toLowerCase()) {
    case "activo":
    case "completado":
      return "#dc3545";
    case "expirado":
    case "pendiente":
      return "#28a745";
    default:
      return "#808080";
  }
}

function styleZona(feature) {
  const idBruto = feature.properties.Name;
  const idZona = String(idBruto).trim();
  const datosZona = estadoZonas[idZona];

  let fillColor = obtenerColorEstado("No Definido");
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
    color: "white",
    dashArray: "3",
    fillOpacity: fillOpacity,
  };
}

// =================================================================
// 3. MANEJAR CLICK DE ZONA (CON SELECCIÓN PERSISTENTE + PANEL)
// =================================================================

function manejarClickZona(feature, layer) {
  const idBruto = feature.properties.Name;
  const idZona = String(idBruto).trim();
  const datosZona = estadoZonas[idZona];

  layer.on({
    mouseover: (e) => {
      if (zonaSeleccionada !== e.target) {
        e.target.setStyle({
          weight: 5,
          color: "#666",
          fillOpacity: 0.9,
        });
      }
    },

    mouseout: (e) => {
      if (zonaSeleccionada !== e.target) {
        geoJsonLayer.resetStyle(e.target);
      }
    },

    click: () => {
      // 1. Quitar selección anterior
      if (zonaSeleccionada) {
        geoJsonLayer.resetStyle(zonaSeleccionada);
      }

      // 2. Guardar nueva selección
      zonaSeleccionada = layer;

      // 3. Estilo de selección permanente
      layer.setStyle({
        weight: 4,
        color: "#0033ff",
        fillColor: "#0033ff",
        fillOpacity: 0.4,
      });

      // 4. Abrir panel
      if (datosZona && datosZona.pdfId) {
        abrirPanel(idZona, datosZona.pdfId.trim(), datosZona.estado);
      } else {
        abrirPanel(idZona, null, datosZona ? datosZona.estado : "Sin datos");
      }

      // Mantener vista fija siempre
      map.setView(VISTA_GENERAL.centro, VISTA_GENERAL.zoom, {
        animate: true,
      });
    },
  });
}

// =================================================================
// 4. Abrir Panel Lateral (SIN ENLACES + VISOR DE IMAGEN AMPLIABLE)
// =================================================================

function abrirPanel(idZona, fileId, estado) {

    // ----- IMAGEN DEL TERRITORIO -----
    if (fileId) {
        const thumbnail = `https://drive.google.com/thumbnail?sz=w1600&id=${fileId}`;
        document.getElementById("panel-imagen").src = thumbnail;
        document.getElementById("panel-imagen").style.display = "block";
    } else {
        document.getElementById("panel-imagen").style.display = "none";
    }

    // ----- TEXTO -----
    document.getElementById("panel-titulo").textContent = `Territorio ${idZona}`;
    document.getElementById("panel-estado").textContent = `Estado: ${estado}`;

    // ----- WEB APP -----
    // Puedes añadir parámetros GET como id, estado, etc.
    // ----- ENLACE A WEB APP -----
const webAppURL = `https://script.google.com/macros/s/AKfycbxoDr8Cu3iFlAPX749WFJunR7cVpaoDO0RskbuoIykmY6rz0wJeCq6D_Nvr8MTWISmRgw/exec`;

const link = document.getElementById("panel-webapp-link");
link.href = webAppURL;
link.style.display = "block";

    // ----- MOSTRAR PANEL -----
    document.getElementById("panel-detalle").classList.add("activo");

    // Ajuste de mapa al abrir
    setTimeout(() => map.invalidateSize(), 350);
    setTimeout(() => {
        const offset = Math.round(window.innerWidth * 0.22);
        map.panBy([-offset, 0], { animate: true });
    }, 450);
}

// =================================================================
// 5. Cargar GeoJSON
// =================================================================

function cargarGeoJson(url) {
  fetch(url)
    .then((response) => response.json())
    .then((data) => {
      if (geoJsonLayer) {
        map.removeLayer(geoJsonLayer);
      }

      geoJsonLayer = L.geoJson(data, {
        style: styleZona,
        onEachFeature: manejarClickZona,
      }).addTo(map);
      

      map.setView(VISTA_GENERAL.centro, VISTA_GENERAL.zoom, {
        animate: true,
      });
    })
    .catch((error) => console.error("Error al cargar el GeoJSON:", error));
}


// =================================================================
// 6. Cargar datos del Sheet (JSONP)
// =================================================================

function actualizarMapa() {
  $.ajax({
    url: GOOGLE_SHEET_URL,
    dataType: "jsonp",
    success: function (registros) {
      estadoZonas = {};

      registros.forEach((registro) => {
        const idBruto = registro.idgeojson;
        const idGeoJson = String(idBruto).trim();

        if (idGeoJson) {
          estadoZonas[idGeoJson] = {
            estado: registro.estado,
            pdfId: registro.pdfid,
          };
        }
      });

      if (Object.keys(estadoZonas).length > 0) {
        cargarGeoJson(GEOJSON_URL);
      }
    },

    error: (xhr, status, error) => {
      console.error("Error JSONP:", status, error);
    },
  });
}

// =================================================================
// 7. Inicialización del mapa
// =================================================================

document.addEventListener("DOMContentLoaded", () => {
  map = L.map(MAPA_ID).setView(VISTA_GENERAL.centro, VISTA_GENERAL.zoom);

  setTimeout(() => map.invalidateSize(), 300);

  L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png",
    {
      maxZoom: 19,
      attribution: "Map data © OpenStreetMap",
    }
 ).addTo(map);

  actualizarMapa();
  setInterval(actualizarMapa, TIEMPO_REFRESCO_MS);
});

// =================================================================
// 8. CERRAR PANEL Y MANTENER VISTA FIJA
// =================================================================

document.getElementById("panel-cerrar").addEventListener("click", () => {

    document.getElementById("panel-detalle").classList.remove("activo");

    // Ocultar Web App
    // Ocultar botón WebApp
document.getElementById("panel-webapp-link").style.display = "none";


    // Ocultar imagen
    document.getElementById("panel-imagen").style.display = "none";

    // Restaurar vista general
    if (geoJsonLayer) {
        const bounds = geoJsonLayer.getBounds();
        map.fitBounds(bounds, { padding: [20, 20], animate: true });

        setTimeout(() => map.invalidateSize(), 300);

        // Corrección de desplazamiento proporcional
        const offset = Math.round(window.innerWidth * 0.22);
        setTimeout(() => {
            map.panBy([offset, 0], { animate: true });
        }, 650);
    }
});
