"use client";
import "leaflet/dist/leaflet.css";
import { CircleMarker, MapContainer, TileLayer, Tooltip, useMapEvents } from "react-leaflet";

export type MapPin = {
  id: string;
  lat: number;
  lng: number;
  label: string;
  /** Scales the circle: e.g. number of reports in a cluster. */
  weight?: number;
  color?: string;
  selected?: boolean;
};

const LUCKNOW: [number, number] = [26.8467, 80.9462];

function ClickCatcher({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onPick(e.latlng.lat, e.latlng.lng) });
  return null;
}

/** OpenStreetMap view with circle pins (size = weight). Circles avoid Leaflet's icon assets. */
export default function MapView({
  pins,
  center,
  zoom = 13,
  onPick,
  onSelect,
  height = 320,
}: {
  pins: MapPin[];
  center?: [number, number];
  zoom?: number;
  onPick?: (lat: number, lng: number) => void;
  onSelect?: (id: string) => void;
  height?: number;
}) {
  return (
    <MapContainer center={center ?? LUCKNOW} zoom={zoom} style={{ height, width: "100%" }} scrollWheelZoom={false}>
      <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      {onPick && <ClickCatcher onPick={onPick} />}
      {pins.map((p) => (
        <CircleMarker
          key={p.id}
          center={[p.lat, p.lng]}
          radius={Math.min(8 + 4 * Math.sqrt(p.weight ?? 1), 30)}
          pathOptions={{ color: p.selected ? "#ffffff" : (p.color ?? "#ff9933"), fillColor: p.color ?? "#ff9933", fillOpacity: 0.55, weight: p.selected ? 3 : 1.5 }}
          eventHandlers={onSelect ? { click: () => onSelect(p.id) } : undefined}
        >
          <Tooltip>{p.label}</Tooltip>
        </CircleMarker>
      ))}
    </MapContainer>
  );
}
