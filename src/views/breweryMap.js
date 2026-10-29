import { getBreweryMapLogs, getBreweryLocations, saveBreweryLocation } from '../store/db.js';

const LEAFLET_CSS_URL = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
const LEAFLET_SCRIPT_URL = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
const PHOTON_URL = 'https://photon.komoot.io/api/';
const GEOCODE_INTERVAL_MS = 1100;
const JAPAN_MAP_BOUNDS = { south: 20, west: 122, north: 46, east: 154 };
const GSI_ATTRIBUTION = '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener noreferrer">地理院タイル</a>';
const ESRI_ATTRIBUTION = 'Tiles &copy; <a href="https://www.esri.com/" target="_blank" rel="noopener noreferrer">Esri</a>, HERE, Garmin, &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a> and GIS user community';
const JAPAN_REGIONS = [
  { name: '北海道', lat: 43.4, lng: 142.7 },
  { name: '東北', lat: 39.2, lng: 140.8 },
  { name: '関東', lat: 36.1, lng: 139.5 },
  { name: '中部', lat: 36.2, lng: 137.2 },
  { name: '近畿', lat: 34.7, lng: 135.4 },
  { name: '中国', lat: 34.9, lng: 132.8 },
  { name: '四国', lat: 33.7, lng: 133.6 },
  { name: '九州', lat: 32.2, lng: 130.7 },
  { name: '沖縄', lat: 26.2, lng: 127.7 }
];
const JAPAN_MAJOR_CITIES = [
  { name: '札幌', lat: 43.0618, lng: 141.3545 },
  { name: '仙台', lat: 38.2682, lng: 140.8694 },
  { name: '東京', lat: 35.6762, lng: 139.6503 },
  { name: '新潟', lat: 37.9161, lng: 139.0364 },
  { name: '名古屋', lat: 35.1815, lng: 136.9066 },
  { name: '大阪', lat: 34.6937, lng: 135.5023 },
  { name: '広島', lat: 34.3853, lng: 132.4553 },
  { name: '福岡', lat: 33.5902, lng: 130.4017 },
  { name: '那覇', lat: 26.2124, lng: 127.6809 }
];
const JAPAN_DETAIL_CITIES = [
  { name: '金沢', lat: 36.5613, lng: 136.6562 },
  { name: '長野', lat: 36.6513, lng: 138.181 },
  { name: '静岡', lat: 34.9756, lng: 138.3828 },
  { name: '京都', lat: 35.0116, lng: 135.7681 },
  { name: '神戸', lat: 34.6901, lng: 135.1955 },
  { name: '松山', lat: 33.8416, lng: 132.7657 },
  { name: '熊本', lat: 32.8031, lng: 130.7079 }
];

let leafletPromise = null;
let refreshPromise = null;
let refreshQueued = false;
let geocodePromise = null;
let lastGeocodeAt = 0;
let leaflet;
let map;
let baseTileLayer;
let worldLabelLayer;
let baseMapRegion;
let markerLayer;
let placeLabelLayer;
let placeSearchLayer;
let activeFilter = '';
let places = [];
let placeSearchResults = [];
let placeSearchMarkers = [];
let markersByKey = new Map();
let geocodeRetryAfter = 0;
let photonRequestQueue = Promise.resolve();

const normalize = value => String(value || '').trim().toLocaleLowerCase().replace(/\s+/g, ' ');
const escapeHtml = value => String(value || '').replace(/[&<>"']/g, char => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}[char]));
const hasCoordinates = place => Number.isFinite(place.lat) && Number.isFinite(place.lng);

function getPlaceKey(brewery, region) {
  return `${normalize(brewery)}|${normalize(region)}`;
}

function ensureMapMarkup(container) {
  if (container.dataset.mapInitialized === 'true') return;
  container.dataset.mapInitialized = 'true';
  container.innerHTML = `
    <div class="brewery-map-header">
      <h3>酒造マップ</h3>
      <span id="brewery-map-count" class="brewery-map-count">酒造情報を読み込み中...</span>
    </div>
    <p class="brewery-map-description">酒造名・地域を位置検索サービスPhotonへ送信します。ログに紐づく位置はこの端末に保存され、地図タイルはオンライン接続時に表示されます。</p>
    <form id="brewery-map-place-search-form" class="brewery-map-place-search-form">
      <label class="brewery-map-search-label" for="brewery-map-place-search">酒造の場所を検索</label>
      <div class="brewery-map-place-search-controls">
        <input id="brewery-map-place-search" class="brewery-map-search" type="search" placeholder="例: 獺祭、山田酒造、海外のメーカー" autocomplete="off">
        <button class="brewery-map-place-search-button" type="submit">検索</button>
      </div>
    </form>
    <div id="brewery-map-place-results" class="brewery-map-results" aria-live="polite"></div>
    <label class="brewery-map-search-label" for="brewery-map-search">登録済みログを絞り込み</label>
    <input id="brewery-map-search" class="brewery-map-search" type="search" placeholder="例: 新潟、獺祭、山田酒造" autocomplete="off">
    <div id="brewery-map-results" class="brewery-map-results" aria-live="polite"></div>
    <div id="brewery-map-canvas" class="brewery-map-canvas" role="application" aria-label="酒造の場所を示す地図"></div>
    <div id="brewery-map-attribution" class="brewery-map-attribution" aria-label="地図データの出典"></div>
    <div id="brewery-map-status" class="brewery-map-status" role="status">地図を準備しています...</div>
  `;
  container.querySelector('#brewery-map-search').addEventListener('input', event => {
    activeFilter = normalize(event.target.value);
    renderResults();
    renderMarkers();
  });
  container.querySelector('#brewery-map-results').addEventListener('click', event => {
    const button = event.target.closest('[data-map-place]');
    if (!button) return;
    focusPlace(button.dataset.mapPlace);
  });
  container.querySelector('#brewery-map-place-search-form').addEventListener('submit', event => {
    event.preventDefault();
    const input = container.querySelector('#brewery-map-place-search');
    void searchBreweryLocation(input.value);
  });
  container.querySelector('#brewery-map-place-results').addEventListener('click', event => {
    const button = event.target.closest('[data-search-result]');
    if (!button) return;
    focusSearchResult(Number(button.dataset.searchResult));
  });
}

function setStatus(message, isError = false) {
  const status = document.getElementById('brewery-map-status');
  if (!status) return;
  status.textContent = message;
  status.classList.toggle('is-error', isError);
}

function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (leafletPromise) return leafletPromise;

  leafletPromise = new Promise((resolve, reject) => {
    if (!document.querySelector(`link[href="${LEAFLET_CSS_URL}"]`)) {
      const stylesheet = document.createElement('link');
      stylesheet.rel = 'stylesheet';
      stylesheet.href = LEAFLET_CSS_URL;
      document.head.appendChild(stylesheet);
    }

    const script = document.createElement('script');
    script.src = LEAFLET_SCRIPT_URL;
    script.async = true;
    const timeout = setTimeout(() => {
      script.remove();
      leafletPromise = null;
      reject(new Error('地図ライブラリの読み込みがタイムアウトしました。オンライン接続を確認してください。'));
    }, 15000);
    script.onload = () => {
      clearTimeout(timeout);
      if (window.L) resolve(window.L);
      else {
        leafletPromise = null;
        reject(new Error('地図ライブラリを初期化できませんでした。'));
      }
    };
    script.onerror = () => {
      clearTimeout(timeout);
      script.remove();
      leafletPromise = null;
      reject(new Error('地図ライブラリを読み込めません。オンライン接続を確認してください。'));
    };
    document.head.appendChild(script);
  });
  return leafletPromise;
}

function isMapVisible() {
  const container = document.getElementById('sidebar-brewery-map');
  if (!container) return false;
  const rect = container.getBoundingClientRect();
  const style = window.getComputedStyle(container);
  return style.display !== 'none' &&
    style.visibility !== 'hidden' &&
    rect.width > 0 &&
    rect.height > 0 &&
    rect.right > 0 &&
    rect.left < window.innerWidth;
}

function initializeMap(L) {
  if (map) return;
  leaflet = L;
  map = L.map('brewery-map-canvas', {
    worldCopyJump: true,
    attributionControl: false
  }).setView([36.2, 138.25], 5);
  markerLayer = L.layerGroup().addTo(map);
  map.createPane('breweryPlaceLabelsPane').style.zIndex = '625';
  placeLabelLayer = L.layerGroup().addTo(map);
  placeSearchLayer = L.layerGroup().addTo(map);
  updateBaseMap();
  map.on('moveend', () => {
    updateBaseMap();
    renderJapanesePlaceLabels();
  });
  map.on('zoomend', renderJapanesePlaceLabels);
  setTimeout(() => map?.invalidateSize(), 150);
}

function renderJapanesePlaceLabels() {
  if (!map || !leaflet || !placeLabelLayer) return;
  placeLabelLayer.clearLayers();
  if (baseMapRegion !== 'japan') return;
  const zoom = map.getZoom();
  const candidates = zoom <= 5
    ? JAPAN_REGIONS
    : zoom < 8
      ? JAPAN_MAJOR_CITIES
      : [...JAPAN_MAJOR_CITIES, ...JAPAN_DETAIL_CITIES];
  const bounds = map.getBounds();
  const accepted = [];

  for (const place of candidates) {
    const position = leaflet.latLng(place.lat, place.lng);
    if (!bounds.contains(position)) continue;
    const point = map.latLngToContainerPoint(position);
    const width = place.name.length * 12 + 12;
    const box = {
      left: point.x - width / 2,
      right: point.x + width / 2,
      top: point.y - 10,
      bottom: point.y + 10
    };
    const mapSize = map.getSize();
    if (box.left < 0 || box.right > mapSize.x || box.top < 0 || box.bottom > mapSize.y) continue;
    if (accepted.some(other => box.left < other.right + 4 &&
      box.right + 4 > other.left &&
      box.top < other.bottom + 3 &&
      box.bottom + 3 > other.top)) continue;
    accepted.push(box);

    const icon = leaflet.divIcon({
      className: 'brewery-map-place-label-icon',
      html: `<span>${escapeHtml(place.name)}</span>`,
      iconSize: [width, 20],
      iconAnchor: [width / 2, 10]
    });
    leaflet.marker(position, {
      icon,
      pane: 'breweryPlaceLabelsPane',
      keyboard: false,
      interactive: false
    }).addTo(placeLabelLayer);
  }
}

function updateBaseMap() {
  if (!map || !leaflet) return;
  const center = map.getCenter();
  const region = center.lat >= JAPAN_MAP_BOUNDS.south &&
    center.lat <= JAPAN_MAP_BOUNDS.north &&
    center.lng >= JAPAN_MAP_BOUNDS.west &&
    center.lng <= JAPAN_MAP_BOUNDS.east
    ? 'japan'
    : 'world';
  if (baseMapRegion === region) return;
  baseMapRegion = region;
  if (baseTileLayer) map.removeLayer(baseTileLayer);

  const isJapan = region === 'japan';
  const attribution = document.getElementById('brewery-map-attribution');
  if (attribution) attribution.innerHTML = isJapan
    ? `${GSI_ATTRIBUTION}（白地図を加工して表示、国土地理院）`
    : `地図データ：${ESRI_ATTRIBUTION}`;
  if (worldLabelLayer) {
    map.removeLayer(worldLabelLayer);
    worldLabelLayer = null;
  }
  baseTileLayer = isJapan
    ? leaflet.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/blank/{z}/{x}/{y}.png', {
      maxZoom: 18,
      className: 'brewery-map-japanese'
    })
    : leaflet.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19,
      className: 'brewery-map-world'
    });
  baseTileLayer.on('tileerror', () => setStatus('地図タイルを取得できません。接続を確認してください。', true));
  baseTileLayer.on('load', () => {
    const pending = places.filter(place => !hasCoordinates(place) && !place.notFound).length;
    if (pending === 0) {
      setStatus(places.length
        ? `${places.filter(hasCoordinates).length}/${places.length}酒造にピンを表示中`
        : 'ログがなくても上の検索から酒造の場所を探せます。');
    }
  });
  baseTileLayer.addTo(map);
  renderJapanesePlaceLabels();
  if (!isJapan) {
    worldLabelLayer = leaflet.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 19,
        pane: 'overlayPane',
        className: 'brewery-map-world-labels'
    }).addTo(map);
  }
}

function buildPlaces(logs, cachedLocations) {
  const cachedByKey = new Map(cachedLocations.map(location => [location.key, location]));
  const grouped = new Map();
  for (const log of logs) {
    const brewery = String(log.brewery || '').trim();
    if (!brewery) continue;
    const region = String(log.region || '').trim();
    const key = getPlaceKey(brewery, region);
    let place = grouped.get(key);
    if (!place) {
      const cached = cachedByKey.get(key);
      place = {
        key,
        brewery,
        region,
        logs: [],
        lat: cached?.lat,
        lng: cached?.lng,
        notFound: Boolean(cached?.notFound)
      };
      grouped.set(key, place);
    }
    place.logs.push(log);
  }
  return Array.from(grouped.values()).sort((a, b) => a.brewery.localeCompare(b.brewery, 'ja'));
}

function placeMatches(place, query) {
  if (!query) return true;
  return normalize([
    place.brewery,
    place.region,
    ...place.logs.map(log => log.name)
  ].join(' ')).includes(query);
}

function renderResults() {
  const results = document.getElementById('brewery-map-results');
  const count = document.getElementById('brewery-map-count');
  if (!results || !count) return;

  const matchingPlaces = places.filter(place => placeMatches(place, activeFilter));
  const locatedCount = places.filter(hasCoordinates).length;
  count.textContent = `${locatedCount}/${places.length}酒造にピン`;
  const visiblePlaces = matchingPlaces.slice(0, activeFilter ? 12 : 5);
  results.innerHTML = visiblePlaces.length
    ? visiblePlaces.map(place => `
      <button type="button" class="brewery-map-result" data-map-place="${escapeHtml(place.key)}">
        <span>${hasCoordinates(place) ? '📍' : place.notFound ? '・' : '…'}</span>
        <span class="brewery-map-result-name">${escapeHtml(place.brewery)}</span>
        <span class="brewery-map-result-count">${place.logs.length}</span>
      </button>
    `).join('')
    : `<span class="brewery-map-empty">${places.length ? '一致する酒造がありません。' : '登録済みログはありません。上の検索から酒造の場所を探せます。'}</span>`;
}

function getPopupHtml(place) {
  const searchText = [place.brewery, place.region].filter(Boolean).join(' ');
  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(searchText)}`;
  const logs = place.logs.slice(0, 5).map(log => `<li>${escapeHtml(log.name || '名称未設定')}</li>`).join('');
  const extraCount = place.logs.length > 5 ? `<li>ほか ${place.logs.length - 5} 件</li>` : '';
  return `
    <div class="brewery-map-popup">
      <strong>${escapeHtml(place.brewery)}</strong>
      ${place.region ? `<div>${escapeHtml(place.region)}</div>` : ''}
      <div>${place.logs.length}件の飲酒ログ</div>
      ${logs ? `<ul>${logs}${extraCount}</ul>` : ''}
      <a href="${searchUrl}" target="_blank" rel="noopener noreferrer">酒造をWeb検索 ↗</a>
    </div>
  `;
}

function renderMarkers() {
  if (!map || !markerLayer || !leaflet) return;
  markerLayer.clearLayers();
  markersByKey.clear();
  const visiblePlaces = places.filter(place => hasCoordinates(place) && placeMatches(place, activeFilter));
  visiblePlaces.forEach(addMarker);

  if (activeFilter && visiblePlaces.length > 0) {
    const bounds = leaflet.latLngBounds(visiblePlaces.map(place => [place.lat, place.lng]));
    if (visiblePlaces.length === 1) {
      map.flyTo([visiblePlaces[0].lat, visiblePlaces[0].lng], Math.max(map.getZoom(), 10));
    } else {
      map.fitBounds(bounds, { padding: [24, 24], maxZoom: 12 });
    }
  }
}

function addMarker(place) {
  if (!map || !markerLayer || !leaflet || !hasCoordinates(place) || !placeMatches(place, activeFilter)) return;
  const marker = leaflet.marker([place.lat, place.lng], { title: place.brewery });
  marker.bindPopup(getPopupHtml(place));
  marker.addTo(markerLayer);
  markersByKey.set(place.key, marker);
}

function focusPlace(key) {
  const place = places.find(candidate => candidate.key === key);
  if (!place) return;
  if (!hasCoordinates(place)) {
    setStatus(place.notFound ? '場所を特定できませんでした。酒造名や地域を確認してください。' : '位置情報を検索中です...');
    return;
  }
  const marker = markersByKey.get(key);
  map?.flyTo([place.lat, place.lng], Math.max(map.getZoom(), 10));
  marker?.openPopup();
}

function getFeatureLabel(feature) {
  const properties = feature.properties || {};
  return String(properties.name || properties.city || properties.state || '名称未設定').trim();
}

function getFeatureRegion(feature) {
  const properties = feature.properties || {};
  return [properties.city, properties.state, properties.country].filter(Boolean).join(', ');
}

function renderPlaceSearchResults(message = '') {
  const results = document.getElementById('brewery-map-place-results');
  if (!results) return;
  results.innerHTML = placeSearchResults.length
    ? placeSearchResults.map((feature, index) => `
      <button type="button" class="brewery-map-result" data-search-result="${index}">
        <span>📍</span>
        <span class="brewery-map-result-name">${escapeHtml(getFeatureLabel(feature))}${getFeatureRegion(feature) ? ` · ${escapeHtml(getFeatureRegion(feature))}` : ''}</span>
      </button>
    `).join('')
    : message ? `<span class="brewery-map-empty">${escapeHtml(message)}</span>` : '';
}

function focusSearchResult(index) {
  const feature = placeSearchResults[index];
  if (!feature || !map || !leaflet) return;
  const [lng, lat] = feature.geometry.coordinates;
  map.flyTo([lat, lng], Math.max(map.getZoom(), 10));
  placeSearchMarkers[index]?.openPopup();
}

function getSearchResultPopupHtml(feature) {
  const searchText = [getFeatureLabel(feature), getFeatureRegion(feature)].filter(Boolean).join(' ');
  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(searchText)}`;
  return `
    <div class="brewery-map-popup">
      <strong>${escapeHtml(getFeatureLabel(feature))}</strong>
      ${getFeatureRegion(feature) ? `<div>${escapeHtml(getFeatureRegion(feature))}</div>` : ''}
      <a href="${searchUrl}" target="_blank" rel="noopener noreferrer">酒造をWeb検索 ↗</a>
    </div>
  `;
}

function requestPhoton(query, limit) {
  const request = photonRequestQueue.then(async () => {
    if (Date.now() < geocodeRetryAfter) {
      throw new Error('位置検索の利用上限に達しています。時間をおいて再度お試しください。');
    }
    if (lastGeocodeAt) {
      await new Promise(resolve => setTimeout(resolve, Math.max(0, GEOCODE_INTERVAL_MS - (Date.now() - lastGeocodeAt))));
    }
    lastGeocodeAt = Date.now();
    const url = `${PHOTON_URL}?q=${encodeURIComponent(query)}&limit=${limit}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/geo+json' },
        signal: controller.signal
      });
      if (response.status === 429) geocodeRetryAfter = Date.now() + 10 * 60 * 1000;
      return response;
    } finally {
      clearTimeout(timeout);
    }
  });
  photonRequestQueue = request.catch(() => {});
  return request;
}

async function searchBreweryLocation(rawQuery) {
  const query = String(rawQuery || '').trim();
  const input = document.getElementById('brewery-map-place-search');
  const button = document.querySelector('#brewery-map-place-search-form button[type="submit"]');
  if (!query) {
    setStatus('酒造名や地域を入力してください。');
    input?.focus();
    return;
  }
  if (navigator.onLine === false) {
    setStatus('酒造の場所検索にはオンライン接続が必要です。', true);
    return;
  }
  if (!map || !placeSearchLayer) {
    setStatus('地図を準備できていません。オンライン接続を確認してください。', true);
    return;
  }

  button.disabled = true;
  placeSearchResults = [];
  placeSearchMarkers = [];
  placeSearchLayer.clearLayers();
  renderPlaceSearchResults('検索中...');
  setStatus(`「${query}」を検索しています...`);
  try {
    const response = await requestPhoton(query, 5);
    if (response.status === 429) {
      throw new Error('位置検索の利用上限に達しました。時間をおいて再度お試しください。');
    }
    if (!response.ok) throw new Error(`位置検索サービスの応答: ${response.status}`);
    const data = await response.json();
    placeSearchResults = (data.features || []).filter(feature => {
      const coordinates = feature?.geometry?.coordinates;
      return Array.isArray(coordinates) &&
        Number.isFinite(coordinates[0]) &&
        coordinates[0] >= -180 && coordinates[0] <= 180 &&
        Number.isFinite(coordinates[1]) &&
        coordinates[1] >= -90 && coordinates[1] <= 90;
    });
    renderPlaceSearchResults(placeSearchResults.length ? '' : '場所が見つかりませんでした。別の酒造名や地域でお試しください。');
    if (placeSearchResults.length) {
      const markers = placeSearchResults.map(feature => {
        const [lng, lat] = feature.geometry.coordinates;
        const marker = leaflet.marker([lat, lng], { title: getFeatureLabel(feature) });
        marker.bindPopup(getSearchResultPopupHtml(feature));
        marker.addTo(placeSearchLayer);
        return marker;
      });
      placeSearchMarkers = markers;
      const bounds = leaflet.latLngBounds(placeSearchResults.map(feature => [
        feature.geometry.coordinates[1],
        feature.geometry.coordinates[0]
      ]));
      if (placeSearchResults.length === 1) {
        const [lng, lat] = placeSearchResults[0].geometry.coordinates;
        map.flyTo([lat, lng], Math.max(map.getZoom(), 10));
        markers[0].openPopup();
      } else {
        map.fitBounds(bounds, { padding: [24, 24], maxZoom: 12 });
      }
      setStatus(`${placeSearchResults.length}件の場所が見つかりました。候補を選ぶと地図で確認できます。`);
    } else {
      setStatus('場所が見つかりませんでした。');
    }
  } catch (error) {
    console.error('[BreweryMap] Place search failed:', error);
    renderPlaceSearchResults('検索できませんでした。オンライン接続を確認して再度お試しください。');
    setStatus(`位置検索に失敗しました: ${error.message}`, true);
  } finally {
    button.disabled = false;
  }
}

function selectBestFeature(features, place) {
  const brewery = normalize(place.brewery);
  const scoreName = name => {
    const normalizedName = normalize(name);
    if (!normalizedName) return 0;
    if (normalizedName === brewery) return 4;
    if (normalizedName.includes(brewery)) return 3;
    const genericTokens = new Set([
      'brewery', 'brewing', 'company', 'co', 'distillery',
      'inc', 'incorporated', 'limited', 'ltd', 'sake', 'shuzo', 'jozo'
    ]);
    const tokens = brewery.split(/[\s,./-]+/)
      .filter(token => token.length > 2 && !genericTokens.has(token));
    if (tokens.length === 1) return normalizedName === tokens[0] ? 1 : 0;
    const matches = tokens.filter(token => normalizedName.includes(token)).length;
    return tokens.length > 0 && matches / tokens.length >= 0.6 ? 1 : 0;
  };
  return features
    .filter(feature => {
      const coordinates = feature?.geometry?.coordinates;
      return Array.isArray(coordinates) &&
        Number.isFinite(coordinates[0]) &&
        coordinates[0] >= -180 && coordinates[0] <= 180 &&
        Number.isFinite(coordinates[1]) &&
        coordinates[1] >= -90 && coordinates[1] <= 90 &&
        scoreName(feature.properties?.name) > 0;
    })
    .sort((a, b) => {
      const nameA = scoreName(a.properties?.name);
      const nameB = scoreName(b.properties?.name);
      const region = normalize(place.region);
      const regionScore = feature => region && normalize([
        feature.properties?.city,
        feature.properties?.state,
        feature.properties?.country
      ].join(' ')).includes(region) ? 1 : 0;
      return nameB + regionScore(b) - nameA - regionScore(a);
    })[0];
}

async function geocodeMissingPlaces() {
  if (geocodePromise) return geocodePromise;
  if (Date.now() < geocodeRetryAfter) return;
  geocodePromise = (async () => {
    const queue = places.filter(place => !hasCoordinates(place) && !place.notFound);
    for (let index = 0; index < queue.length; index++) {
      const place = queue[index];
      if (!places.some(current => current.key === place.key) || navigator.onLine === false) break;
      if (lastGeocodeAt) {
        await new Promise(resolve => setTimeout(resolve, Math.max(0, GEOCODE_INTERVAL_MS - (Date.now() - lastGeocodeAt))));
      }

      try {
        const query = [place.brewery, place.region].filter(Boolean).join(', ');
        const response = await requestPhoton(query, 5);
        if (response.status === 429) {
          geocodeRetryAfter = Date.now() + 10 * 60 * 1000;
          setStatus('位置検索の利用上限に達しました。時間をおいて再度お試しください。', true);
          break;
        }
        if (!response.ok) throw new Error(`位置検索サービスの応答: ${response.status}`);
        const data = await response.json();
        const feature = selectBestFeature(data.features || [], place);
        const coordinates = feature?.geometry?.coordinates;
        const location = {
          key: place.key,
          brewery: place.brewery,
          region: place.region,
          lat: coordinates ? coordinates[1] : null,
          lng: coordinates ? coordinates[0] : null,
          displayName: feature?.properties?.name || '',
          notFound: !feature
        };
        await saveBreweryLocation(location);
        const currentPlace = places.find(current => current.key === location.key);
        if (currentPlace) {
          Object.assign(currentPlace, location);
          addMarker(currentPlace);
        }
        renderResults();
        setStatus(`酒造の位置を検索中 (${index + 1}/${queue.length})`);
      } catch (error) {
        console.error('[BreweryMap] Geocoding failed:', error);
        geocodeRetryAfter = Date.now() + 60 * 1000;
        setStatus(`位置検索に失敗しました: ${error.message}`, true);
        break;
      }
    }

    const pendingCount = places.filter(place => !hasCoordinates(place) && !place.notFound).length;
    if (places.length === 0 && navigator.onLine !== false) {
      setStatus('ログがなくても上の検索から酒造の場所を探せます。');
    } else if (pendingCount === 0 && navigator.onLine !== false) {
      setStatus(`${places.filter(hasCoordinates).length}/${places.length}酒造にピンを表示中`);
    } else if (navigator.onLine === false) {
      setStatus('保存済みの位置は表示できます。地図タイルと未検索の位置にはオンライン接続が必要です。');
    }
  })().finally(() => {
    geocodePromise = null;
  });
  return geocodePromise;
}

export async function renderBreweryMap() {
  const container = document.getElementById('sidebar-brewery-map');
  if (!container) return;
  ensureMapMarkup(container);

  if (refreshPromise) {
    refreshQueued = true;
    return refreshPromise;
  }
  refreshPromise = (async () => {
    try {
      const [logs, cachedLocations] = await Promise.all([
        getBreweryMapLogs(),
        getBreweryLocations()
      ]);
      places = buildPlaces(logs, cachedLocations);
      renderResults();

      if (!isMapVisible()) return;
      if (navigator.onLine === false) {
        setStatus('保存済みの位置は表示できます。地図タイルと未検索の位置にはオンライン接続が必要です。');
        return;
      }

      initializeMap(await loadLeaflet());
      renderMarkers();
      void geocodeMissingPlaces();
    } catch (error) {
      console.error('[BreweryMap] Failed to load or initialize the map:', error);
      setStatus(`酒造マップを表示できません: ${error.message}`, true);
      throw error;
    }
  })().finally(() => {
    refreshPromise = null;
    if (refreshQueued) {
      refreshQueued = false;
      void renderBreweryMap().catch(error => {
        console.error('[BreweryMap] Refresh failed:', error);
        setStatus(`酒造マップを更新できません: ${error.message}`, true);
      });
    }
  });
  return refreshPromise;
}

window.addEventListener('online', () => {
  void renderBreweryMap().catch(error => {
    console.error('[BreweryMap] Online refresh failed:', error);
  });
});
window.addEventListener('resize', () => map?.invalidateSize());
