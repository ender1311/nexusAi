import { ImageResponse } from "next/og";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";
export const revalidate = 3600; // regenerate hourly so color changes at midnight

// One gradient per day of week (Sun–Sat), using the app's agent color palette.
const DAY_GRADIENTS = [
  { from: "#f87171", mid: "#e85d75", to: "#c0314e" }, // Sun — rose
  { from: "#60a5fa", mid: "#4f8ef7", to: "#1d4ed8" }, // Mon — blue
  { from: "#6fcf8d", mid: "#57a16c", to: "#3a7a50" }, // Tue — green (primary)
  { from: "#a78bfa", mid: "#8b5cf6", to: "#6d28d9" }, // Wed — purple
  { from: "#fbbf24", mid: "#f59e0b", to: "#b45309" }, // Thu — amber
  { from: "#2dd4bf", mid: "#14b8a6", to: "#0f766e" }, // Fri — teal
  { from: "#818cf8", mid: "#6366f1", to: "#4338ca" }, // Sat — indigo
];

export default function Icon() {
  const { from, mid, to } = DAY_GRADIENTS[new Date().getDay()];
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: `linear-gradient(145deg, ${from} 0%, ${mid} 55%, ${to} 100%)`,
          borderRadius: "115px",
        }}
      >
        <div
          style={{
            position: "absolute",
            width: "380px",
            height: "380px",
            borderRadius: "50%",
            background: "radial-gradient(circle at 40% 35%, rgba(255,255,255,0.18) 0%, transparent 70%)",
            display: "flex",
          }}
        />
        <svg
          width="288"
          height="288"
          viewBox="0 0 24 24"
          fill="none"
          stroke="white"
          strokeWidth="1.35"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ filter: "drop-shadow(0px 4px 12px rgba(0,0,0,0.25))" }}
        >
          <path d="M12 8V4H8" />
          <rect width="16" height="12" x="4" y="8" rx="2" />
          <path d="M2 14h2" />
          <path d="M20 14h2" />
          <path d="M15 13v2" />
          <path d="M9 13v2" />
        </svg>
      </div>
    ),
    { ...size },
  );
}
