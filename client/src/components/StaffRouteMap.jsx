import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

function makeMarker(color) {
  return L.circleMarker([], {
    radius: 7,
    color,
    fillColor: color,
    fillOpacity: 1,
    weight: 2,
  });
}

export default function StaffRouteMap({ points = [] }) {
  const mapRef = useRef(null);
  const mapInstance = useRef(null);

  useEffect(() => {
    if (!mapRef.current) return undefined;

    if (mapInstance.current) {
      mapInstance.current.remove();
      mapInstance.current = null;
    }

    if (!points.length) return undefined;

    const latlngs = points.map((p) => [Number(p.latitude), Number(p.longitude)]);
    const map = L.map(mapRef.current, { zoomControl: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap',
      maxZoom: 19,
    }).addTo(map);

    if (latlngs.length === 1) {
      makeMarker('#2563eb').setLatLng(latlngs[0]).addTo(map);
      map.setView(latlngs[0], 15);
    } else {
      L.polyline(latlngs, { color: '#2563eb', weight: 4, opacity: 0.85 }).addTo(map);
      makeMarker('#16a34a').setLatLng(latlngs[0]).addTo(map);
      makeMarker('#dc2626').setLatLng(latlngs[latlngs.length - 1]).addTo(map);
      map.fitBounds(L.latLngBounds(latlngs), { padding: [48, 48] });
    }

    mapInstance.current = map;
    return () => {
      map.remove();
      mapInstance.current = null;
    };
  }, [points]);

  if (!points.length) {
    return <div className="staff-route-map-empty">Нет точек за выбранный период</div>;
  }

  return <div ref={mapRef} className="staff-route-map" aria-label="Карта маршрута" />;
}
