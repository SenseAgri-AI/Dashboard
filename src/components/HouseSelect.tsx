"use client";

import { useEffect, useState } from "react";

type House = { id: string; name: string };

// Shared house picker: "Whole farm" ("") + the farm's registered houses (Houses tab).
export default function HouseSelect({
  value,
  onChange,
  style,
}: {
  value: string;
  onChange: (v: string) => void;
  style?: React.CSSProperties;
}) {
  const [houses, setHouses] = useState<House[]>([]);
  useEffect(() => {
    fetch("/api/houses")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setHouses(d.houses ?? []))
      .catch(() => {});
  }, []);
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={style}>
      <option value="">Whole farm</option>
      {houses.map((h) => (
        <option key={h.id} value={h.id}>{h.name || h.id}</option>
      ))}
    </select>
  );
}

/** Display label for a stored house value. */
export function houseLabel(house: string): string {
  return house ? house : "Whole farm";
}
