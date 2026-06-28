// @ts-nocheck
// Vendored from the earth-city-globe POC (https://github.com/visorcraft/earth-city-globe).
// Framework-agnostic Three.js globe: textured Earth, GeoNames city dots/labels,
// country borders, click-to-lat/lon, and zoom-to-cursor recentering.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const DEFAULT_OPTIONS = {
  container: null,
  radius: 100,
  background: 0x020712,
  antialias: true,
  alpha: false,
  autoStart: true,
  autoRotate: false,
  autoRotateSpeed: 0.35,
  cameraFov: 45,
  minDistanceMultiplier: 1.15,
  maxDistanceMultiplier: 8,
  recenterStrength: 1, // 0 disables; how fully the zoomed-toward point is centered by the time you're fully zoomed in
  textures: {
    day: null,
    bump: null,
    specular: null,
    clouds: null
  },
  earthColor: 0x1b4c72,
  earthShininess: 18,
  atmosphere: true,
  stars: true,
  countriesGeoJsonUrl: null,
  countryLineColor: 0xffffff,
  countryLineOpacity: 0.36,
  countryLineAltitude: 0.22,
  cityTilesUrl: null,
  cityIndexUrl: null,
  maxCityZoom: 6,
  minCityZoom: 0,
  cityZoomBias: 4, // higher = stay at low zoom (few, top-population cities) until closer in

  maxTilesInView: 900,
  tileFetchConcurrency: 16,
  tileRefreshIntervalMs: 260,
  tileVisibilityMargin: 0.08,
  cityPointColor: 0xffd36a,
  cityPointSize: 2.5,
  cityPointSizeAttenuation: false, // constant on-screen px so zooming in doesn't bloat dots into a yellow blob
  maxCityDots: 4000, // cap most-populous cities in view; with constant-size dots this stays legible and feeds label variety
  cityPointAltitude: 0.55,
  clickTolerancePx: 13,
  maxLabels: 90,
  labelMinPopulation: 50000,
  labelMinDistancePx: 62,
  labelClassName: 'ecg-city-label',
  controls: {}
};

const TILE_FIELDS = ['id', 'name', 'lat', 'lon', 'population', 'countryCode', 'featureCode'];

/**
 * Interactive Three.js globe with country boundary lines, GeoNames city tiles,
 * dynamic labels, and click-to-lat/lon selection.
 *
 * Events:
 *   - select: detail = { kind, lat, lon, clickLat, clickLon, city, point, originalEvent }
 *   - globe-click: same detail, kind === 'globe'
 *   - city-click: same detail, kind === 'city'
 *   - empty-click: click missed the globe
 *   - tiles-loaded: detail = { zoom, tileCount, cityCount }
 */
export class EarthCityGlobe extends EventTarget {
  constructor(options = {}) {
    super();
    this.options = mergeOptions(DEFAULT_OPTIONS, options);
    this.container = resolveContainer(this.options.container);

    if (!this.container) {
      throw new Error('EarthCityGlobe requires a DOM element or selector in options.container.');
    }

    this.radius = this.options.radius;
    this.scene = new THREE.Scene();
    this.scene.background = this.options.alpha ? null : new THREE.Color(this.options.background);

    this.camera = new THREE.PerspectiveCamera(this.options.cameraFov, 1, 0.1, this.radius * 80);
    this.camera.position.set(0, this.radius * 0.33, this.radius * 3.2);

    this.renderer = new THREE.WebGLRenderer({
      antialias: this.options.antialias,
      alpha: this.options.alpha
    });
    this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;
    this.controls.minDistance = this.radius * this.options.minDistanceMultiplier;
    this.controls.maxDistance = this.radius * this.options.maxDistanceMultiplier;
    this.controls.autoRotate = this.options.autoRotate;
    this.controls.autoRotateSpeed = this.options.autoRotateSpeed;
    Object.assign(this.controls, this.options.controls || {});

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();

    this.textureLoader = new THREE.TextureLoader();
    this._frameId = null;
    this._started = false;
    this._resizeObserver = null;
    this._destroyed = false;

    this._tileIndex = null;
    this._tileCache = new Map();
    this._activeTileKeyString = '';
    this._activeCities = [];
    this._activeCitiesByPopulation = [];
    this._manualCities = null;
    this._cityPoints = null;
    this._cityMaterial = null;
    this._cityGeometry = null;
    this._cityRefreshRunning = false;
    this._cityRefreshGeneration = 0;
    this._lastTileRefreshMs = 0;
    this._lastTileCameraKey = '';

    this._labelLayer = document.createElement('div');
    this._labelLayer.className = 'ecg-label-layer';
    this._labelLayer.style.position = 'absolute';
    this._labelLayer.style.inset = '0';
    this._labelLayer.style.overflow = 'hidden';
    this._labelLayer.style.pointerEvents = 'none';
    this._labelLayer.style.zIndex = '2';
    ensurePositioned(this.container);
    this.container.appendChild(this._labelLayer);
    this._labelPool = [];

    this._pointerDown = null;
    // Recenter-on-zoom state: lock the view direction + distance when a scroll burst
    // starts, then rotate toward the cursor point in proportion to how far you zoom in.
    this._recenterTo = null;       // locked world direction of the point under the cursor
    this._recenterFrom = null;     // view direction at the moment of lock
    this._recenterStartDist = 0;   // camera distance at the moment of lock
    this._lastWheelMs = 0;
    this._boundOnPointerDown = this._onPointerDown.bind(this);
    this._boundOnPointerUp = this._onPointerUp.bind(this);
    this._boundOnWheel = this._onWheel.bind(this);
    this._boundOnResize = this.resize.bind(this);
    this._boundAnimate = this._animate.bind(this);

    this._setupScene();
    this._setupEvents();
    this.resize();
  }

  static async create(options = {}) {
    const globe = new EarthCityGlobe(options);
    await globe.init();
    return globe;
  }

  async init() {
    const pending = [];

    if (this.options.cityIndexUrl) {
      pending.push(this.loadCityIndex(this.options.cityIndexUrl));
    }

    if (this.options.countriesGeoJsonUrl) {
      pending.push(this.loadCountryBoundaries(this.options.countriesGeoJsonUrl));
    }

    await Promise.allSettled(pending);

    if (this.options.autoStart) {
      this.start();
    }

    await this.refreshCityTiles(true);
    return this;
  }

  start() {
    if (this._started || this._destroyed) return;
    this._started = true;
    this._frameId = requestAnimationFrame(this._boundAnimate);
  }

  stop() {
    this._started = false;
    if (this._frameId !== null) {
      cancelAnimationFrame(this._frameId);
      this._frameId = null;
    }
  }

  dispose() {
    this.stop();
    this._destroyed = true;
    this.renderer.domElement.removeEventListener('pointerdown', this._boundOnPointerDown);
    this.renderer.domElement.removeEventListener('pointerup', this._boundOnPointerUp);
    this.container.removeEventListener('wheel', this._boundOnWheel, { capture: true });
    globalThis.removeEventListener?.('resize', this._boundOnResize);
    this._resizeObserver?.disconnect();
    this.controls.dispose();

    disposeObject3D(this.scene);
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this._labelLayer.remove();
  }

  on(type, listener, options) {
    this.addEventListener(type, listener, options);
    return () => this.removeEventListener(type, listener, options);
  }

  resize() {
    const rect = this.container.getBoundingClientRect();
    const width = Math.max(1, rect.width || this.container.clientWidth || 1);
    const height = Math.max(1, rect.height || this.container.clientHeight || 1);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  async loadCityIndex(url) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Could not load city tile index: ${url} (${response.status})`);
    }
    this._tileIndex = await response.json();
    return this._tileIndex;
  }

  async loadCountryBoundaries(source) {
    const geoJson = typeof source === 'string'
      ? await fetchJson(source, 'country boundaries GeoJSON')
      : source;

    const geometry = buildBoundaryGeometry(geoJson, this.radius + this.options.countryLineAltitude);
    const material = new THREE.LineBasicMaterial({
      color: this.options.countryLineColor,
      transparent: true,
      opacity: this.options.countryLineOpacity,
      depthWrite: false
    });

    if (this.countryLines) {
      this.scene.remove(this.countryLines);
      this.countryLines.geometry.dispose();
      this.countryLines.material.dispose();
    }

    this.countryLines = new THREE.LineSegments(geometry, material);
    this.countryLines.name = 'EarthCityGlobe.countryLines';
    this.scene.add(this.countryLines);
    return this.countryLines;
  }

  setCities(cities) {
    this._manualCities = (cities || []).map((city) => this._prepareCity(city));
    this._activeCities = this._applyCityBudget(this._manualCities);
    this._activeTileKeyString = 'manual';
    this._rebuildCityPoints();
    this._prepareLabelCandidates();
    this._updateLabels();
    return this;
  }

  clearCities() {
    this._manualCities = [];
    this._activeCities = [];
    this._activeTileKeyString = '';
    this._rebuildCityPoints();
    this._prepareLabelCandidates();
    this._updateLabels();
    return this;
  }

  async refreshCityTiles(force = false) {
    if (this._manualCities || !this.options.cityTilesUrl) return;
    if (this._cityRefreshRunning) return;

    const now = performance.now();
    const zoom = this._resolveCityZoom();
    const cameraNormal = this.camera.position.clone().normalize();
    const cameraKey = `${zoom}:${cameraNormal.x.toFixed(2)},${cameraNormal.y.toFixed(2)},${cameraNormal.z.toFixed(2)}`;

    if (!force && now - this._lastTileRefreshMs < this.options.tileRefreshIntervalMs) return;
    if (!force && cameraKey === this._lastTileCameraKey) return;

    this._lastTileRefreshMs = now;
    this._lastTileCameraKey = cameraKey;

    const tileKeys = this._visibleTileKeys(zoom, cameraNormal);
    const tileKeyString = tileKeys.map((tile) => tile.key).join('|');
    if (!force && tileKeyString === this._activeTileKeyString) return;

    this._cityRefreshRunning = true;
    const generation = ++this._cityRefreshGeneration;

    try {
      const tileCities = await loadWithConcurrency(
        tileKeys,
        this.options.tileFetchConcurrency,
        (tile) => this._loadCityTile(tile)
      );

      if (generation !== this._cityRefreshGeneration || this._destroyed) return;

      this._activeTileKeyString = tileKeyString;
      this._activeCities = this._applyCityBudget(tileCities.flat());
      this._rebuildCityPoints();
      this._prepareLabelCandidates();
      this._updateLabels();
      this.dispatchEvent(new CustomEvent('tiles-loaded', {
        detail: {
          zoom,
          tileCount: tileKeys.length,
          cityCount: this._activeCities.length
        }
      }));
    } finally {
      this._cityRefreshRunning = false;
    }
  }

  screenToLatLon(clientX, clientY) {
    const hit = this._intersectGlobe(clientX, clientY);
    return hit ? vector3ToLatLon(hit.point) : null;
  }

  flyTo(lat, lon, distanceMultiplier = 2.15) {
    const normal = latLonToVector3(lat, lon, 1).normalize();
    const distance = this.radius * THREE.MathUtils.clamp(
      distanceMultiplier,
      this.options.minDistanceMultiplier,
      this.options.maxDistanceMultiplier
    );
    this.camera.position.copy(normal.multiplyScalar(distance));
    this.camera.lookAt(0, 0, 0);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
    this.refreshCityTiles(true);
    return this;
  }

  latLonToVector3(lat, lon, altitude = 0) {
    return latLonToVector3(lat, lon, this.radius + altitude);
  }

  vector3ToLatLon(vector) {
    return vector3ToLatLon(vector);
  }

  _setupScene() {
    const ambient = new THREE.AmbientLight(0xffffff, 0.8);
    this.scene.add(ambient);

    const sun = new THREE.DirectionalLight(0xffffff, 2.25);
    sun.position.set(this.radius * 5, this.radius * 2, this.radius * 3);
    this.scene.add(sun);

    const fill = new THREE.DirectionalLight(0x8ab4ff, 0.6);
    fill.position.set(-this.radius * 4, -this.radius * 0.5, -this.radius * 3);
    this.scene.add(fill);

    this.earth = this._createEarthMesh();
    this.scene.add(this.earth);

    if (this.options.atmosphere) {
      this.atmosphere = this._createAtmosphereMesh();
      this.scene.add(this.atmosphere);
    }

    if (this.options.stars) {
      this.stars = this._createStarfield();
      this.scene.add(this.stars);
    }
  }

  _setupEvents() {
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.style.position = 'relative';
    this.renderer.domElement.style.zIndex = '1';
    this.renderer.domElement.addEventListener('pointerdown', this._boundOnPointerDown);
    this.renderer.domElement.addEventListener('pointerup', this._boundOnPointerUp);
    // Capture phase on the container so this runs before OrbitControls' wheel handler
    // on the canvas (target-phase listeners fire in registration order regardless of capture).
    this.container.addEventListener('wheel', this._boundOnWheel, { capture: true, passive: true });

    if ('ResizeObserver' in globalThis) {
      this._resizeObserver = new ResizeObserver(this._boundOnResize);
      this._resizeObserver.observe(this.container);
    } else {
      globalThis.addEventListener?.('resize', this._boundOnResize);
    }
  }

  _createEarthMesh() {
    const geometry = new THREE.SphereGeometry(this.radius, 128, 64);
    const material = new THREE.MeshPhongMaterial({
      color: this.options.earthColor,
      shininess: this.options.earthShininess,
      specular: 0x222222
    });

    const { day, bump, specular } = this.options.textures || {};
    if (day) {
      const texture = this.textureLoader.load(day);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      material.map = texture;
      material.color.set(0xffffff);
    }
    if (bump) {
      material.bumpMap = this.textureLoader.load(bump);
      material.bumpScale = 0.75;
    }
    if (specular) {
      material.specularMap = this.textureLoader.load(specular);
      material.specular.set(0x666666);
    }

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'EarthCityGlobe.earth';
    return mesh;
  }

  _createAtmosphereMesh() {
    const geometry = new THREE.SphereGeometry(this.radius * 1.018, 96, 48);
    const material = new THREE.ShaderMaterial({
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.BackSide,
      uniforms: {
        glowColor: { value: new THREE.Color(0x5aa7ff) }
      },
      vertexShader: `
        varying vec3 vNormal;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 glowColor;
        varying vec3 vNormal;
        void main() {
          float intensity = pow(0.72 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 2.2);
          gl_FragColor = vec4(glowColor, clamp(intensity, 0.0, 0.42));
        }
      `
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'EarthCityGlobe.atmosphere';
    return mesh;
  }

  _createStarfield() {
    const count = 1700;
    const positions = new Float32Array(count * 3);
    const random = mulberry32(938475);
    for (let i = 0; i < count; i++) {
      const z = random() * 2 - 1;
      const theta = random() * Math.PI * 2;
      const r = Math.sqrt(1 - z * z) * this.radius * 28;
      positions[i * 3] = Math.cos(theta) * r;
      positions[i * 3 + 1] = z * this.radius * 28;
      positions[i * 3 + 2] = Math.sin(theta) * r;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 1,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0.72,
      depthWrite: false
    });
    const points = new THREE.Points(geometry, material);
    points.name = 'EarthCityGlobe.stars';
    return points;
  }

  _animate() {
    if (!this._started || this._destroyed) return;
    this._frameId = requestAnimationFrame(this._boundAnimate);
    this._applyRecenter();
    this.controls.update();
    this.refreshCityTiles(false);
    this._updateLabels();
    this.renderer.render(this.scene, this.camera);
  }

  _onWheel(event) {
    // Zoom-out or scroll on empty space: plain center zoom, no recenter.
    if (event.deltaY >= 0) {
      this._recenterTo = null;
      return;
    }
    // Lock the cursor point (and current view) at the start of a scroll burst. The
    // actual centering is driven by zoom distance in _applyRecenter, not per-tick, so
    // one notch nudges a little and it only fully centers once you've zoomed all the way.
    const now = performance.now();
    const newBurst = now - this._lastWheelMs > 200;
    this._lastWheelMs = now;
    if (newBurst) {
      const hit = this._intersectGlobe(event.clientX, event.clientY);
      this._recenterTo = hit ? hit.point.clone().normalize() : null;
      this._recenterFrom = this.camera.position.clone().normalize();
      this._recenterStartDist = this.camera.position.length();
    }
  }

  _applyRecenter() {
    if (!this._recenterTo || this._pointerDown) return;
    const denom = this._recenterStartDist - this.controls.minDistance;
    if (denom <= 1e-3) return;
    const dist = this.camera.position.length();
    // 0 at the locked distance, 1 when fully zoomed in: centering tracks zoom depth.
    const frac = THREE.MathUtils.clamp(
      ((this._recenterStartDist - dist) / denom) * this.options.recenterStrength, 0, 1);
    if (frac <= 0) return;
    // Rotate the locked view direction toward the cursor point by `frac` (absolute, so
    // no drift accumulates), keeping the current distance.
    const rotation = new THREE.Quaternion().setFromUnitVectors(this._recenterFrom, this._recenterTo);
    const partial = new THREE.Quaternion().slerp(rotation, frac);
    const dir = this._recenterFrom.clone().applyQuaternion(partial);
    this.camera.position.copy(dir.multiplyScalar(dist));
  }

  _onPointerDown(event) {
    this._recenterTo = null; // user took manual control; stop auto-centering
    this._pointerDown = {
      x: event.clientX,
      y: event.clientY,
      time: performance.now()
    };
  }

  _onPointerUp(event) {
    if (!this._pointerDown) return;
    const dx = event.clientX - this._pointerDown.x;
    const dy = event.clientY - this._pointerDown.y;
    const moved = Math.sqrt(dx * dx + dy * dy);
    const elapsed = performance.now() - this._pointerDown.time;
    this._pointerDown = null;

    if (moved > 6 || elapsed > 800) return;
    this._selectAt(event.clientX, event.clientY, event);
  }

  _selectAt(clientX, clientY, originalEvent) {
    const hit = this._intersectGlobe(clientX, clientY);
    if (!hit) {
      this.dispatchEvent(new CustomEvent('empty-click', { detail: { originalEvent } }));
      return;
    }

    const clickLatLon = vector3ToLatLon(hit.point);
    const city = this._findNearestCity(clientX, clientY);
    const detail = {
      kind: city ? 'city' : 'globe',
      lat: city ? city.lat : clickLatLon.lat,
      lon: city ? city.lon : clickLatLon.lon,
      clickLat: clickLatLon.lat,
      clickLon: clickLatLon.lon,
      city,
      point: hit.point.clone(),
      originalEvent
    };

    this.dispatchEvent(new CustomEvent('select', { detail }));
    this.dispatchEvent(new CustomEvent(city ? 'city-click' : 'globe-click', { detail }));
  }

  _intersectGlobe(clientX, clientY) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObject(this.earth, false);
    return hits[0] || null;
  }

  _findNearestCity(clientX, clientY) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const cameraNormal = this.camera.position.clone().normalize();
    const visibleThreshold = Math.max(0, this.radius / this.camera.position.length() - 0.03);
    const tolerance = this.options.clickTolerancePx;
    const toleranceSq = tolerance * tolerance;
    const v = new THREE.Vector3();
    let best = null;
    let bestDistanceSq = toleranceSq;

    for (const city of this._activeCities) {
      if (!city._normal || city._normal.dot(cameraNormal) < visibleThreshold) continue;
      v.copy(city._vector).project(this.camera);
      if (v.z < -1 || v.z > 1) continue;
      const x = rect.left + (v.x * 0.5 + 0.5) * rect.width;
      const y = rect.top + (-v.y * 0.5 + 0.5) * rect.height;
      const dx = x - clientX;
      const dy = y - clientY;
      const distanceSq = dx * dx + dy * dy;
      if (distanceSq < bestDistanceSq) {
        bestDistanceSq = distanceSq;
        best = city;
      }
    }

    return best ? publicCity(best) : null;
  }

  _resolveCityZoom() {
    const minZoom = this._tileIndex?.minZoom ?? this.options.minCityZoom;
    const maxZoom = this._tileIndex?.maxZoom ?? this.options.maxCityZoom;
    const distanceMultiplier = this.camera.position.length() / this.radius;
    const near = this.options.minDistanceMultiplier;
    const far = Math.min(this.options.maxDistanceMultiplier, 5.2);
    const t = THREE.MathUtils.clamp((far - distanceMultiplier) / (far - near), 0, 1);
    // ponytail: ease-in (t^bias) biases toward low zoom when pulled back, so the
    // global view shows only top-population cities and detail grows on zoom-in.
    // Raise options.cityZoomBias to require even more zoom before small cities load.
    const eased = Math.pow(t, this.options.cityZoomBias);
    return Math.round(THREE.MathUtils.lerp(minZoom, maxZoom, eased));
  }

  _visibleTileKeys(zoom, cameraNormal) {
    const { xCount, yCount } = tileGrid(zoom);
    const existingKeys = this._tileIndex?.tilesByZoom?.[zoom] || null;
    const candidates = [];

    if (existingKeys && Array.isArray(existingKeys)) {
      for (const shortKey of existingKeys) {
        const [xText, yText] = shortKey.split('/');
        const x = Number(xText);
        const y = Number(yText);
        const score = tileVisibilityScore(zoom, x, y, cameraNormal);
        if (score >= -this.options.tileVisibilityMargin) {
          candidates.push({ z: zoom, x, y, key: `${zoom}/${x}/${y}`, score });
        }
      }
    } else {
      for (let y = 0; y < yCount; y++) {
        for (let x = 0; x < xCount; x++) {
          const score = tileVisibilityScore(zoom, x, y, cameraNormal);
          if (score >= -this.options.tileVisibilityMargin) {
            candidates.push({ z: zoom, x, y, key: `${zoom}/${x}/${y}`, score });
          }
        }
      }
    }

    candidates.sort((a, b) => b.score - a.score);
    return candidates.slice(0, this.options.maxTilesInView);
  }

  async _loadCityTile(tile) {
    if (this._tileCache.has(tile.key)) return this._tileCache.get(tile.key);

    const promise = fetch(tileUrl(this.options.cityTilesUrl, tile))
      .then((response) => {
        if (response.status === 404) return null;
        if (!response.ok) throw new Error(`Tile ${tile.key} failed with HTTP ${response.status}`);
        return response.json();
      })
      .then((json) => parseCityTile(json, (city) => this._prepareCity(city)))
      .catch((error) => {
        console.warn(`[EarthCityGlobe] ${error.message}`);
        return [];
      });

    this._tileCache.set(tile.key, promise);
    return promise;
  }

  _prepareCity(city) {
    const lat = Number(city.lat ?? city.latitude);
    const lon = Number(city.lon ?? city.lng ?? city.longitude);
    const vector = latLonToVector3(lat, lon, this.radius + this.options.cityPointAltitude);
    return {
      id: city.id ?? city.geonameid ?? city.geonameId,
      name: String(city.name ?? city.asciiname ?? city.asciiName ?? ''),
      lat,
      lon: normalizeLon(lon),
      population: Number(city.population ?? city.pop ?? 0),
      countryCode: city.countryCode ?? city.country_code ?? city.cc,
      featureCode: city.featureCode ?? city.feature_code,
      _vector: vector,
      _normal: vector.clone().normalize()
    };
  }

  _applyCityBudget(cities) {
    const max = this.options.maxCityDots;
    if (!max || cities.length <= max) return cities;
    // ponytail: keep the most populous cities in view so dense regions stay
    // legible instead of becoming a solid wall of dots.
    return cities.slice().sort((a, b) => b.population - a.population).slice(0, max);
  }

  _rebuildCityPoints() {
    if (this._cityPoints) {
      this.scene.remove(this._cityPoints);
      this._cityGeometry?.dispose();
      this._cityPoints = null;
      this._cityGeometry = null;
    }

    if (!this._activeCities.length) return;

    const positions = new Float32Array(this._activeCities.length * 3);
    for (let i = 0; i < this._activeCities.length; i++) {
      const city = this._activeCities[i];
      positions[i * 3] = city._vector.x;
      positions[i * 3 + 1] = city._vector.y;
      positions[i * 3 + 2] = city._vector.z;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    if (!this._cityMaterial) {
      this._cityMaterial = new THREE.PointsMaterial({
        color: this.options.cityPointColor,
        size: this.options.cityPointSize,
        map: createDotTexture(),
        transparent: true,
        alphaTest: 0.08,
        depthWrite: false,
        sizeAttenuation: this.options.cityPointSizeAttenuation
      });
    }

    this._cityGeometry = geometry;
    this._cityPoints = new THREE.Points(geometry, this._cityMaterial);
    this._cityPoints.name = 'EarthCityGlobe.cityPoints';
    this.scene.add(this._cityPoints);
  }

  _prepareLabelCandidates() {
    this._activeCitiesByPopulation = this._activeCities
      .filter((city) => city.name && city.population >= this.options.labelMinPopulation)
      .sort((a, b) => b.population - a.population);
  }

  _updateLabels() {
    const maxLabels = this.options.maxLabels;
    if (!maxLabels || !this._activeCitiesByPopulation.length) {
      hideLabelPool(this._labelPool);
      return;
    }

    const rect = this.renderer.domElement.getBoundingClientRect();
    const cameraNormal = this.camera.position.clone().normalize();
    const visibleThreshold = Math.max(0, this.radius / this.camera.position.length() - 0.02);
    const projected = new THREE.Vector3();
    const occupied = new Set();
    let shown = 0;

    for (const city of this._activeCitiesByPopulation) {
      if (shown >= maxLabels) break;
      if (!city._normal || city._normal.dot(cameraNormal) < visibleThreshold) continue;

      projected.copy(city._vector).project(this.camera);
      if (projected.z < -1 || projected.z > 1) continue;

      const x = (projected.x * 0.5 + 0.5) * rect.width;
      const y = (-projected.y * 0.5 + 0.5) * rect.height;
      if (x < -80 || y < -20 || x > rect.width + 80 || y > rect.height + 20) continue;

      const gridX = Math.round(x / this.options.labelMinDistancePx);
      const gridY = Math.round(y / 24);
      const gridKey = `${gridX}:${gridY}`;
      if (occupied.has(gridKey)) continue;
      occupied.add(gridKey);

      const label = this._labelPool[shown] || this._createLabelElement(shown);
      label.textContent = city.name;
      label.title = `${city.name} (${city.lat.toFixed(5)}, ${city.lon.toFixed(5)})`;
      label.style.display = 'block';
      label.style.transform = `translate(-50%, -100%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      shown++;
    }

    for (let i = shown; i < this._labelPool.length; i++) {
      this._labelPool[i].style.display = 'none';
    }
  }

  _createLabelElement(index) {
    const label = document.createElement('div');
    label.className = this.options.labelClassName;
    label.dataset.index = String(index);
    label.style.position = 'absolute';
    label.style.left = '0';
    label.style.top = '0';
    label.style.whiteSpace = 'nowrap';
    label.style.willChange = 'transform';
    label.style.display = 'none';
    this._labelLayer.appendChild(label);
    this._labelPool.push(label);
    return label;
  }
}

export function latLonToVector3(lat, lon, radius = 1) {
  const phi = THREE.MathUtils.degToRad(90 - Number(lat));
  const theta = THREE.MathUtils.degToRad(normalizeLon(Number(lon)) + 180);
  const sinPhi = Math.sin(phi);
  return new THREE.Vector3(
    -radius * sinPhi * Math.cos(theta),
    radius * Math.cos(phi),
    radius * sinPhi * Math.sin(theta)
  );
}

export function vector3ToLatLon(vector) {
  const v = vector.clone().normalize();
  const lat = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(v.y, -1, 1)));
  const lon = normalizeLon(THREE.MathUtils.radToDeg(Math.atan2(v.z, -v.x)) - 180);
  return { lat, lon };
}

export function tileGrid(z) {
  const xCount = 2 ** Math.max(0, z);
  const yCount = 2 ** Math.max(0, z - 1);
  return { xCount, yCount };
}

export function lonLatToTile(lon, lat, z) {
  const { xCount, yCount } = tileGrid(z);
  const x = clampInt(Math.floor(((normalizeLon(lon) + 180) / 360) * xCount), 0, xCount - 1);
  const y = clampInt(Math.floor(((90 - clamp(Number(lat), -90, 90)) / 180) * yCount), 0, yCount - 1);
  return { z, x, y, key: `${z}/${x}/${y}` };
}

function buildBoundaryGeometry(geoJson, radius) {
  const positions = [];
  const features = geoJson?.type === 'FeatureCollection' ? geoJson.features : [geoJson];

  for (const feature of features || []) {
    const geometry = feature.type === 'Feature' ? feature.geometry : feature;
    if (!geometry) continue;
    addGeometryLines(geometry, positions, radius);
  }

  const buffer = new Float32Array(positions);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(buffer, 3));
  return geometry;
}

function addGeometryLines(geometry, positions, radius) {
  if (geometry.type === 'Polygon') {
    for (const ring of geometry.coordinates) addRingSegments(ring, positions, radius);
  } else if (geometry.type === 'MultiPolygon') {
    for (const polygon of geometry.coordinates) {
      for (const ring of polygon) addRingSegments(ring, positions, radius);
    }
  } else if (geometry.type === 'LineString') {
    addRingSegments(geometry.coordinates, positions, radius, false);
  } else if (geometry.type === 'MultiLineString') {
    for (const line of geometry.coordinates) addRingSegments(line, positions, radius, false);
  } else if (geometry.type === 'GeometryCollection') {
    for (const child of geometry.geometries || []) addGeometryLines(child, positions, radius);
  }
}

function addRingSegments(ring, positions, radius, close = true) {
  if (!ring || ring.length < 2) return;
  const length = close ? ring.length : ring.length - 1;

  for (let i = 0; i < length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    if (!a || !b) continue;
    if (Math.abs(a[0] - b[0]) > 180) continue;
    const va = latLonToVector3(a[1], a[0], radius);
    const vb = latLonToVector3(b[1], b[0], radius);
    positions.push(va.x, va.y, va.z, vb.x, vb.y, vb.z);
  }
}

function tileVisibilityScore(z, x, y, cameraNormal) {
  const { xCount, yCount } = tileGrid(z);
  const lon0 = (x / xCount) * 360 - 180;
  const lon1 = ((x + 1) / xCount) * 360 - 180;
  const lat0 = 90 - (y / yCount) * 180;
  const lat1 = 90 - ((y + 1) / yCount) * 180;
  const samples = [
    [(lat0 + lat1) / 2, (lon0 + lon1) / 2],
    [lat0, lon0],
    [lat0, lon1],
    [lat1, lon0],
    [lat1, lon1]
  ];

  let best = -Infinity;
  for (const [lat, lon] of samples) {
    const normal = latLonToVector3(lat, lon, 1).normalize();
    best = Math.max(best, normal.dot(cameraNormal));
  }
  return best;
}

function tileUrl(template, tile) {
  return template
    .replace(/\{z\}/g, String(tile.z))
    .replace(/\{x\}/g, String(tile.x))
    .replace(/\{y\}/g, String(tile.y));
}

function parseCityTile(tile, prepareCity) {
  if (!tile) return [];
  const rows = tile.c || tile.cities || tile.data || [];
  const fields = tile.f || tile.fields || TILE_FIELDS;

  return rows
    .map((row) => {
      if (!Array.isArray(row)) return prepareCity(row);
      const city = {};
      for (let i = 0; i < fields.length; i++) city[fields[i]] = row[i];
      return prepareCity(city);
    })
    .filter((city) => Number.isFinite(city.lat) && Number.isFinite(city.lon));
}

function publicCity(city) {
  return {
    id: city.id,
    name: city.name,
    lat: city.lat,
    lon: city.lon,
    population: city.population,
    countryCode: city.countryCode,
    featureCode: city.featureCode
  };
}

function createDotTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 31);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.35, 'rgba(255,255,255,0.95)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

async function fetchJson(url, label) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not load ${label}: ${url} (${response.status})`);
  }
  return response.json();
}

async function loadWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let index = 0;
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (index < items.length) {
      const current = index++;
      results[current] = await mapper(items[current], current);
    }
  });
  await Promise.all(workers);
  return results;
}

function mergeOptions(defaults, options) {
  return {
    ...defaults,
    ...options,
    textures: {
      ...defaults.textures,
      ...(options.textures || {})
    },
    controls: {
      ...defaults.controls,
      ...(options.controls || {})
    }
  };
}

function resolveContainer(container) {
  if (typeof container === 'string') return document.querySelector(container);
  return container;
}

function ensurePositioned(element) {
  const style = globalThis.getComputedStyle?.(element);
  if (!style || style.position === 'static') {
    element.style.position = 'relative';
  }
}

function hideLabelPool(pool) {
  for (const label of pool) label.style.display = 'none';
}

function disposeObject3D(root) {
  root.traverse?.((object) => {
    object.geometry?.dispose?.();
    if (Array.isArray(object.material)) {
      object.material.forEach((material) => material.dispose?.());
    } else {
      object.material?.dispose?.();
    }
  });
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function clampInt(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeLon(lon) {
  const normalized = ((((Number(lon) + 180) % 360) + 360) % 360) - 180;
  return normalized === -180 ? 180 : normalized;
}

function mulberry32(seed) {
  return function random() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
