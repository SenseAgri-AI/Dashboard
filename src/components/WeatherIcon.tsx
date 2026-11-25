import type { WeatherIconName } from "@/lib/ventilation";

// Inline forecast icons. No image URLs. Strokes use the ventilation palette.

const SUN = "#E8A317";
const CLOUD = "#5C6B73";
const RAIN = "#1D4ED8";
const NIGHT = "#3E4C59";

function Svg({ size, children }: { size: number; children: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {children}
    </svg>
  );
}

function Rays() {
  return (
    <g stroke={SUN} strokeWidth="1.7" strokeLinecap="round">
      <path d="M12 2.2v2.2M12 19.6v2.2M2.2 12h2.2M19.6 12h2.2M4.8 4.8l1.6 1.6M17.6 17.6l1.6 1.6M19.2 4.8l-1.6 1.6M6.4 17.6l-1.6 1.6" />
    </g>
  );
}

function Cloud({ fill = "#fff" }: { fill?: string }) {
  return <path d="M7.2 16.5h9.2a3.3 3.3 0 0 0 .4-6.6 4.2 4.2 0 0 0-8.1-1.2 2.8 2.8 0 0 0-1.5 7.8Z" fill={fill} stroke={CLOUD} strokeWidth="1.6" strokeLinejoin="round" />;
}

export default function WeatherIcon({ name, size = 32 }: { name: WeatherIconName; size?: number }) {
  switch (name) {
    case "sun":
      return <Svg size={size}><circle cx="12" cy="12" r="3.4" fill={SUN} /><Rays /></Svg>;
    case "moon":
      return <Svg size={size}><path d="M14.5 3.2a7.2 7.2 0 1 0 6.2 10.6A5.8 5.8 0 0 1 14.5 3.2Z" fill={NIGHT} /></Svg>;
    case "partly":
      return (
        <Svg size={size}>
          <circle cx="8.2" cy="8.2" r="2.5" fill={SUN} />
          <g stroke={SUN} strokeWidth="1.5" strokeLinecap="round"><path d="M8.2 3.2v1.3M8.2 12v1.3M3.2 8.2h1.3M12 8.2h1.3M4.6 4.6l.9.9M10.9 10.9l.9.9M11.8 4.6l-.9.9M5.5 10.9l-.9.9" /></g>
          <Cloud />
        </Svg>
      );
    case "partly-night":
      return (
        <Svg size={size}>
          <path d="M9.2 3.4a4.6 4.6 0 1 0 4.2 6.6A3.6 3.6 0 0 1 9.2 3.4Z" fill={NIGHT} />
          <Cloud />
        </Svg>
      );
    case "cloud":
      return <Svg size={size}><Cloud fill="#E7EEEF" /></Svg>;
    case "fog":
      return (
        <Svg size={size}>
          <path d="M8 9.2h8.2a2.6 2.6 0 0 0 .3-5.2 3.3 3.3 0 0 0-6.4-.8A2.2 2.2 0 0 0 8 9.2Z" fill="#E7EEEF" stroke={CLOUD} strokeWidth="1.5" />
          <g stroke={CLOUD} strokeWidth="1.6" strokeLinecap="round"><path d="M4 13.2h16M6 16.4h12M8 19.6h8" /></g>
        </Svg>
      );
    case "rain":
      return (
        <Svg size={size}>
          <Cloud />
          <g stroke={RAIN} strokeWidth="1.6" strokeLinecap="round"><path d="M9 18.2l-.8 2M12.2 18.2l-.8 2M15.4 18.2l-.8 2" /></g>
        </Svg>
      );
    case "heavy-rain":
      return (
        <Svg size={size}>
          <Cloud />
          <g stroke={RAIN} strokeWidth="2" strokeLinecap="round"><path d="M8.2 17.6l-1.1 3.2M12 17.6l-1.1 3.2M15.8 17.6l-1.1 3.2" /></g>
        </Svg>
      );
    case "thunder":
      return (
        <Svg size={size}>
          <Cloud />
          <path d="M13.2 15.2h-2.4l.6 2.4H9.4L13 22l-.6-3h2.2l-1.4-3.8Z" fill="#B45309" />
        </Svg>
      );
    case "snow":
      return (
        <Svg size={size}>
          <Cloud />
          <g stroke={RAIN} strokeWidth="1.4" strokeLinecap="round">
            <path d="M8.5 17.4v3.2M7.2 18.2l2.6 1.6M7.2 19.8l2.6-1.6M12.4 17.4v3.2M11.1 18.2l2.6 1.6M11.1 19.8l2.6-1.6M16.2 17.4v3.2M14.9 18.2l2.6 1.6M14.9 19.8l2.6-1.6" />
          </g>
        </Svg>
      );
  }
}

export function Droplet({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
      <path d="M6 1.2C6 1.2 2.4 5 2.4 7.3a3.6 3.6 0 0 0 7.2 0C9.6 5 6 1.2 6 1.2Z" fill={RAIN} />
    </svg>
  );
}

export function WindMark({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M1.2 4.2h6.2a1.5 1.5 0 1 0-1.4-2M1.2 7.8h8a1.6 1.6 0 1 1-1.5 2.2" stroke={CLOUD} strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}
