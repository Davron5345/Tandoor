import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

function makeMarker(color, radius = 8) {
  return L.circleMarker([], {
    radius,
    color,
    fillColor: color,
    fillOpacity: 1,
    weight: 2,
  });
}

function toLatLngs(points) {
  return points
    .map((p) => [Number(p.latitude), Number(p.longitude)])
    .filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng));
}

function drawRoute(layerGroup, latlngs) {
  layerGroup.clearLayers();
  if (!latlngs.length) return null;

  if (latlngs.length === 1) {
    makeMarker('#2563eb', 9).setLatLng(latlngs[0]).addTo(layerGroup);
    return { center: latlngs[0], zoom: 15 };
  }

  const bounds = L.latLngBounds(latlngs);
  L.polyline(latlngs, { color: '#2563eb', weight: 5, opacity: 0.9 }).addTo(layerGroup);
  latlngs.forEach((latlng, index) => {
    if (index === 0 || index === latlngs.length - 1) return;
    makeMarker('#3b82f6', 5).setLatLng(latlng).addTo(layerGroup);
  });
  makeMarker('#16a34a', 9).setLatLng(latlngs[0]).addTo(layerGroup);
  makeMarker('#dc2626', 9).setLatLng(latlngs[latlngs.length - 1]).addTo(layerGroup);

  const ne = bounds.getNorthEast();
  const sw = bounds.getSouthWest();
  const samePoint = Math.abs(ne.lat - sw.lat) < 1e-6 && Math.abs(ne.lng - sw.lng) < 1e-6;
  if (samePoint) {
    return { center: latlngs[0], zoom: 15 };
  }

  return { bounds: bounds.pad(0.15) };
}

function applyMapView(map, view) {
  if (!view) return;
  if (view.center) {
    map.setView(view.center, view.zoom ?? 15);
    return;
  }
  if (view.bounds) {
    map.fitBounds(view.bounds, { padding: [48, 48], maxZoom: 16 });
  }
}

export default function StaffRouteMap({ points = [] }) {
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const layerGroupRef = useRef(null);

  useEffect(() => {
    if (!mapRef.current || !points.length) return undefined;

    const latlngs = toLatLngs(points);
    if (!latlngs.length) return undefined;

    if (!mapInstance.current) {
      const map = L.map(mapRef.current, { zoomControl: true });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap',
        maxZoom: 19,
      }).addTo(map);
      mapInstance.current = map;
      layerGroupRef.current = L.layerGroup().addTo(map);
    }

    const map = mapInstance.current;
    const layerGroup = layerGroupRef.current;

    const syncMap = () => {
      map.invalidateSize({ animate: false });
      const view = drawRoute(layerGroup, latlngs);
      applyMapView(map, view);
    };

    syncMap();
    requestAnimationFrame(syncMap);
    const timers = [120, 400].map((ms) => window.setTimeout(syncMap, ms));

    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => syncMap())
      : null;
    resizeObserver?.observe(mapRef.current);

    return () => {
      timers.forEach((id) => window.clearTimeout(id));
      resizeObserver?.disconnect();
    };
  }, [points]);

  useEffect(() => () => {
    mapInstance.current?.remove();
    mapInstance.current = null;
    layerGroupRef.current = null;
  }, []);

  if (!points.length) {
    return <div className="staff-route-map-empty">Нет точек за выбранный период</div>;
  }

  return <div ref={mapRef} className="staff-route-map" aria-label="Карта маршрута" />;
}
