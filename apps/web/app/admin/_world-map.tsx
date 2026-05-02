"use client";

import { WorldMap as VisaWorldMap } from "@visa/charts-react";
import { alpha2ToCountry } from "@/lib/iso-country-codes";

// The Visa React proxy declares every prop as required even though they
// have sensible defaults. Loosen the typing locally.
const WorldMap = VisaWorldMap as unknown as React.FC<Record<string, unknown>>;

type Props = {
  countries: Array<{ country: string; count: number }>;
};

export default function AdminWorldMap({ countries }: Props) {
  // Convert our { country: "US" / "Unknown", count: N } rows into the
  // shape Visa's world-map joins on (numeric ISO + display name).
  const data = countries
    .map((c, idx) => {
      const meta = alpha2ToCountry(c.country);
      if (!meta) return null;
      return {
        ID: idx,
        Name: meta.name,
        Value: c.count,
        "Country Code": meta.numeric,
      };
    })
    .filter((x): x is { ID: number; Name: string; Value: number; "Country Code": string } => x !== null);

  // Light → dark sequential. Higher traffic → darker country.
  // Empty data renders the world map with no countries highlighted (all
  // get the default unselected fill, no error placeholder).
  const colorPalette = [
    "#eef2ff",
    "#c7d2fe",
    "#818cf8",
    "#4f46e5",
    "#3730a3",
    "#1e1b4b",
  ];

  return (
    <WorldMap
      data={data}
      joinAccessor="Country Code"
      joinNameAccessor="Name"
      valueAccessor="Value"
      mainTitle=""
      subTitle=""
      height={360}
      width={780}
      mapProjection="Equal Earth"
      colorPalette="sequential_secBlue"
      colors={colorPalette}
      tooltipLabel={{
        labelAccessor: ["Name", "Value"],
        labelTitle: ["Country", "Visits"],
        format: ["", ""],
      }}
      sortOrder="asc"
      hoverOpacity={0.7}
    />
  );
}
