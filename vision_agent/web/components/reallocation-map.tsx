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
    if (coordinates.length > 1)
      map.fitBounds(coordinates, { padding: [28, 28], maxZoom: 12 });
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
  if (coordinates.length < 2) return null;
  return (
    <MapContainer center={coordinates[0]} zoom={9} className="reallocation-map">
      <TileLayer
        attribution="&copy; OpenStreetMap contributors"
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <Fit coordinates={coordinates} />
      <Polyline
        positions={coordinates}
        pathOptions={{ color: "#087f70", weight: 5 }}
      />
      <Marker position={coordinates[0]} icon={sourceIcon}>
        <Popup>Source: {from}</Popup>
      </Marker>
      <Marker
        position={coordinates[coordinates.length - 1]}
        icon={destinationIcon}
      >
        <Popup>Destination: {to}</Popup>
      </Marker>
    </MapContainer>
  );
}
