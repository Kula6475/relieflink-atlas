"use client";

import L from "leaflet";
import {
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  useMap,
} from "react-leaflet";
import { useEffect } from "react";

const sourceIcon = L.divIcon({
  className: "route-marker source",
  html: "<span>S</span>",
  iconSize: [30, 30],
  iconAnchor: [15, 15],
});
const destinationIcon = L.divIcon({
  className: "route-marker destination",
  html: "<span>D</span>",
  iconSize: [30, 30],
  iconAnchor: [15, 15],
});

function Fit({ coordinates }: { coordinates: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    const refresh = () => map.invalidateSize({ pan: false });
    const frame = requestAnimationFrame(refresh);
    const timer = window.setTimeout(refresh, 250);
    if (coordinates.length > 1)
      map.fitBounds(coordinates, { padding: [28, 28], maxZoom: 12 });
    const observer = new ResizeObserver(refresh);
    observer.observe(map.getContainer());
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      observer.disconnect();
    };
  }, [coordinates, map]);
  return null;
}

export default function ReallocationMap({
  coordinates,
  from,
  to,
}: {
  coordinates: [number, number][];
  from: string;
  to: string;
}) {
  const validCoordinates = coordinates.filter(
    ([latitude, longitude]) =>
      Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude)),
  );
  if (validCoordinates.length < 2) return null;
  return (
    <MapContainer
      center={validCoordinates[0]}
      zoom={9}
      className="reallocation-map"
    >
      <TileLayer
        attribution="&copy; OpenStreetMap contributors"
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <Fit coordinates={validCoordinates} />
      <Polyline
        positions={validCoordinates}
        pathOptions={{ color: "#087f70", weight: 5 }}
      />
      <Marker position={validCoordinates[0]} icon={sourceIcon}>
        <Popup>Source: {from}</Popup>
      </Marker>
      <Marker
        position={validCoordinates[validCoordinates.length - 1]}
        icon={destinationIcon}
      >
        <Popup>Destination: {to}</Popup>
      </Marker>
    </MapContainer>
  );
}
