// =========================================================
// CONFIG
// =========================================================

const ID_SHEET = "1NMjJQ4Q-w3NjODwHB4Ti5WwVYMYc5eUAPoSOeWNUDT";
const HOJA = "terr";

const URL_CSV = `https://docs.google.com/spreadsheets/d/${ID_SHEET}/gviz/tq?tqx=out:csv&sheet=${HOJA}`;

let estadoZonas = {};

console.log("URL final de carga CSV:", URL_CSV);

// =========================================================
// CARGA DEL CSV EN VIVO DESDE GOOGLE SHEETS (modo 2024+ seguro)
// =========================================================

async function cargarDatosZonas() {
    try {
        console.log("Iniciando carga del CSV...");

        const response = await fetch(URL_CSV, {
            method: "GET",
            headers: { "Content-Type": "text/csv" },
            mode: "cors"
        });

        const rawCsv = await response.text();
        console.log("=== RAW CSV RECIBIDO ===");
        console.log(rawCsv);

        Papa.parse(rawCsv, {
            header: true,
            skipEmptyLines: true,
            complete: function (resultado) {
                console.log("=== OBJETOS PARSEADOS ===");
                console.log(resultado.data);

                estadoZonas = {}; // limpiar antes

                resultado.data.forEach(registro => {
                    if (!registro.ID_GEOJSON) return;

                    const id = registro.ID_GEOJSON.trim(); // mantener "001"

                    estadoZonas[id] = {
                        estado: registro.ESTADO?.trim() || "",
                        pdfId: registro.PDF_ID?.trim() || "",
                        imagen: registro.IMAGEN?.trim() || "",
                        iframe: registro.IFRAME?.trim() || "",
                        descripcion: registro.DESCRIPCION?.trim() || ""
                    };
                });

                console.log("=== estadoZonas FINAL ===");
                console.log(estadoZonas);
            }
        });

    } catch (err) {
        console.error("Error cargando CSV:", err);
    }
}

// Lanzamos la carga
cargarDatosZonas();

// =========================================================
// MAPA LEAFLET
// =========================================================

const map = L.map('map').setView([37.34, -5.93], 16);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 20,
}).addTo(map);

// =========================================================
// CARGAR GEOJSON
// =========================================================

fetch("zonas.geojson")
    .then(r => r.json())
    .then(data => {
        console.log("GEOJSON cargado:", data);

        L.geoJSON(data, {
            style: {
                color: "#444",
                weight: 1,
                fillColor: "#999",
                fillOpacity: 0.2
            },
            onEachFeature: onEachZona
        }).addTo(map);
    })
    .catch(err => console.error("Error cargando GeoJSON:", err));

// =========================================================
// POPUP POR ZONA
// =========================================================

function onEachZona(feature, layer) {
    const id = feature.properties?.Name?.trim();

    console.log("Zona clicada:", id);

    const datos = estadoZonas[id];

    if (!datos) {
        layer.bindPopup(`<b>ZONA ${id}</b><br>No hay datos en Google Sheet para esta zona.`);
        return;
    }

    let html = `<h3>ZONA ${id}</h3>`;

    if (datos.estado) {
        html += `<p><b>Estado:</b> ${datos.estado}</p>`;
    }

    if (datos.descripcion) {
        html += `<p>${datos.descripcion}</p>`;
    }

    // IMAGEN
    if (datos.imagen) {
        html += `
        <p><b>Imagen:</b></p>
        <img src="${datos.imagen}" style="width:100%; border-radius:6px; margin-bottom:10px;">
        `;
    }

    // PDF
    if (datos.pdfId) {
        html += `
        <p>
            <a href="https://drive.google.com/uc?export=view&id=${datos.pdfId}" target="_blank">
                Ver PDF asociado
            </a>
        </p>`;
    }

    // IFRAME
    if (datos.iframe) {
        html += `
        <p><b>Documento embebido:</b></p>
        <iframe src="${datos.iframe}" width="100%" height="250" style="border:1px solid #ccc; border-radius:6px;"></iframe>
        `;
    }

    layer.bindPopup(html, { maxWidth: 400 });
}
