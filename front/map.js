const statusElement = document.getElementById('status');
const cityInput = document.getElementById('city-filter');
const dateFromInput = document.getElementById('date-from');
const dateToInput = document.getElementById('date-to');
const applyFilterButton = document.getElementById('apply-filter');

const map = L.map('map').setView([46.603354, 1.888334], 6);
const markersLayer = L.layerGroup().addTo(map);
let allRows = [];
let latestUpdatedAt = null;

L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);

function setStatus(message) {
    if (statusElement) {
        statusElement.textContent = message;
    }
}

function getField(row, candidates) {
    const normalized = Object.fromEntries(
        Object.entries(row).map(([key, value]) => [key.trim().toLowerCase(), value])
    );

    for (const candidate of candidates) {
        const value = normalized[candidate.toLowerCase()];
        if (value !== undefined && value !== null && String(value).trim() !== '') {
            return value;
        }
    }

    return null;
}

function parseNumber(value) {
    if (value === null || value === undefined) {
        return NaN;
    }
    return Number(String(value).replace(',', '.').trim());
}

function getIndiceFromRow(row) {
    const rawValue = getField(row, ['indice', 'valeur', 'valeur brute', 'concentration', 'mesure']);
    const numericValue = parseNumber(rawValue);

    if (!Number.isFinite(numericValue)) {
        return null;
    }

    return Math.round(numericValue);
}

function getColorByIndice(indice) {
    if (indice <= 10) return '#22c55e';
    if (indice <= 25) return '#84cc16';
    if (indice <= 40) return '#facc15';
    if (indice <= 55) return '#fb923c';
    return '#ef4444';
}

function getIndiceLabel(indice) {
    if (indice <= 10) return 'Bon';
    if (indice <= 25) return 'Moyen';
    if (indice <= 40) return 'Degrade';
    if (indice <= 55) return 'Mauvais';
    return 'Tres mauvais';
}

function extractCoordinates(row) {
    const lat = parseNumber(getField(row, ['latitude', 'lat', 'coord_y', 'y_wgs84', 'y']));
    const lon = parseNumber(getField(row, ['longitude', 'lon', 'lng', 'coord_x', 'x_wgs84', 'x']));

    if (Number.isFinite(lat) && Number.isFinite(lon)) {
        return { lat, lon };
    }
    return null;
}

function normalizeText(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
}

function parseFrDateInput(value) {
    const match = String(value || '').trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!match) {
        return null;
    }

    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);
    const parsed = new Date(year, month - 1, day, 0, 0, 0, 0);

    if (
        parsed.getFullYear() !== year ||
        parsed.getMonth() !== month - 1 ||
        parsed.getDate() !== day
    ) {
        return null;
    }

    return parsed;
}

function parseRowDate(value) {
    const raw = String(value || '').trim();
    if (!raw) {
        return null;
    }

    const parsed = new Date(raw.replace(' ', 'T'));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function buildPopup(row) {
    const station = getField(row, ['nom site', 'station', 'nom_station', 'site', 'id_station']) || 'Station inconnue';
    const value = getField(row, ['valeur', 'concentration', 'mesure']) || 'n/a';
    const unit = getField(row, ['unité de mesure', 'unite', 'unit']) || '';
    const date = getField(row, ['date de debut', 'date de fin', 'date', 'date_mesure', 'datetime']) || 'date inconnue';
    const polluant = getField(row, ['polluant']) || 'Inconnu';
    const influence = getField(row, ["type d'influence", 'influence']) || 'n/a';
    const indice = getIndiceFromRow(row);
    const indiceLabel = indice !== null ? getIndiceLabel(indice) : 'n/a';

    return `
        <div class="popup-content">
            <strong>${station}</strong><br>
            Indice: ${indice !== null ? indice : 'n/a'} (${indiceLabel})<br>
            Valeur: ${value} ${unit}<br>
            Polluant: ${polluant}<br>
            Influence: ${influence}<br>
            Date: ${date}
        </div>
    `;
}

function createIndiceMarker(coords, indice) {
    const color = getColorByIndice(indice);
    const icon = L.divIcon({
        className: 'indice-marker-wrapper',
        html: `<div class="indice-marker" style="background:${color};">${indice}</div>`,
        iconSize: [38, 38],
        iconAnchor: [19, 19],
        popupAnchor: [0, -16]
    });

    return L.marker([coords.lat, coords.lon], { icon });
}

function renderRows(rows) {
    markersLayer.clearLayers();

    const bounds = [];
    let addedMarkers = 0;

    for (const row of rows) {
        const coords = extractCoordinates(row);
        const indice = getIndiceFromRow(row);

        if (!coords || indice === null) {
            continue;
        }

        const marker = createIndiceMarker(coords, indice).addTo(markersLayer);
        marker.bindPopup(buildPopup(row));
        bounds.push([coords.lat, coords.lon]);
        addedMarkers += 1;
    }

    if (addedMarkers > 0) {
        map.fitBounds(bounds, { padding: [30, 30] });
    }

    const updatedSuffix = latestUpdatedAt ? ` (maj ${new Date(latestUpdatedAt).toLocaleString('fr-FR')})` : '';
    setStatus(`${addedMarkers} point(s) affiche(s) sur ${allRows.length}${updatedSuffix}`);
}

function applyFilters() {
    const cityQuery = normalizeText(cityInput ? cityInput.value : '');
    const fromDate = parseFrDateInput(dateFromInput ? dateFromInput.value : '');
    const toDateStart = parseFrDateInput(dateToInput ? dateToInput.value : '');

    if (dateFromInput && dateFromInput.value.trim() !== '' && !fromDate) {
        setStatus('Date Du invalide. Utilise le format JJ/MM/AAAA.');
        return;
    }

    if (dateToInput && dateToInput.value.trim() !== '' && !toDateStart) {
        setStatus('Date Au invalide. Utilise le format JJ/MM/AAAA.');
        return;
    }

    const toDate = toDateStart ? new Date(toDateStart.getTime() + (24 * 60 * 60 * 1000) - 1) : null;

    if (fromDate && toDate && fromDate > toDate) {
        setStatus('La date Du doit etre anterieure ou egale a la date Au.');
        return;
    }

    const filtered = allRows.filter((row) => {
        const station = normalizeText(getField(row, ['nom site', 'station', 'nom_station', 'site', 'ville']) || '');
        const rowDate = parseRowDate(getField(row, ['date de debut', 'date de fin', 'date', 'date_mesure', 'datetime']));

        if (cityQuery && !station.includes(cityQuery)) {
            return false;
        }

        if (fromDate && (!rowDate || rowDate < fromDate)) {
            return false;
        }

        if (toDate && (!rowDate || rowDate > toDate)) {
            return false;
        }

        return true;
    });

    renderRows(filtered);
}

function initFilters() {
    if (applyFilterButton) {
        applyFilterButton.addEventListener('click', applyFilters);
    }

    const submitOnEnter = (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            applyFilters();
        }
    };

    if (cityInput) cityInput.addEventListener('keydown', submitOnEnter);
    if (dateFromInput) dateFromInput.addEventListener('keydown', submitOnEnter);
    if (dateToInput) dateToInput.addEventListener('keydown', submitOnEnter);
}

async function loadData() {
    setStatus('Chargement des donnees...');

    try {
        const response = await fetch('./data/latest.json', { cache: 'no-store' });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const payload = await response.json();
        allRows = Array.isArray(payload) ? payload : (payload.rows || []);
        latestUpdatedAt = payload && typeof payload === 'object' ? payload.updatedAt : null;
        applyFilters();
    } catch (error) {
        setStatus('Impossible de charger data/latest.json. Lance d\'abord fetcher.js');
        console.error('Erreur de chargement de donnees:', error);
    }
}

initFilters();
loadData();