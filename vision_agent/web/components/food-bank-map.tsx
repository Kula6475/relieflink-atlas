"use client";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import { useEffect } from "react";
type Summary = {
  category: string;
  quantity: number;
  committed: number;
  safetyStock: number;
  available: number;
};
type Bank = {
  id: string;
  name: string;
  address: string;
  county: string;
  state: string;
  latitude: string;
  longitude: string;
  agent_name: string | null;
  inventory_units: string;
  inventory_summary: Summary[];
};
const icon = L.divIcon({
  className: "bank-marker",
  html: "<span>R</span>",
  iconSize: [36, 36],
  iconAnchor: [18, 18],
});
function Fit({ banks }: { banks: Bank[] }) {
  const map = useMap();
  useEffect(() => {
    const points = banks
      .map(
        (bank) =>
          [Number(bank.latitude), Number(bank.longitude)] as [number, number],
      )
      .filter(
        ([latitude, longitude]) =>
          Number.isFinite(latitude) && Number.isFinite(longitude),
      );
    const refresh = () => map.invalidateSize({ pan: false });
    const frame = requestAnimationFrame(refresh);
    const timer = window.setTimeout(refresh, 250);
    if (points.length)
      map.fitBounds(points, { padding: [45, 45], maxZoom: 11 });
    const observer = new ResizeObserver(refresh);
    observer.observe(map.getContainer());
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      observer.disconnect();
    };
  }, [banks, map]);
  return null;
}
export default function FoodBankMap({ foodBanks }: { foodBanks: Bank[] }) {
  const visibleBanks = foodBanks.filter(
    (bank) =>
      Number.isFinite(Number(bank.latitude)) &&
      Number.isFinite(Number(bank.longitude)),
  );
  return (
    <MapContainer center={[37.77, -122.25]} zoom={9} className="network-map">
      <TileLayer
        attribution="&copy; OpenStreetMap contributors"
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <Fit banks={visibleBanks} />
      {visibleBanks.map((bank) => (
        <Marker
          key={bank.id}
          position={[Number(bank.latitude), Number(bank.longitude)]}
          icon={icon}
        >
          <Popup>
            <strong>{bank.name}</strong>
            <br />
            {bank.address}
            <br />
            {bank.county} County, {bank.state}
            <hr />
            {(bank.inventory_summary || []).map((row) => (
              <div key={row.category}>
                <b>{row.category.replaceAll("_", " ")}</b>:{" "}
                {Number(row.available).toLocaleString()} available
              </div>
            ))}
            {!bank.inventory_summary?.length && "No inventory reported"}
            <hr />
            {bank.agent_name || "Agent not configured"}
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
