import { ImageResponse } from "next/og";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";
export const revalidate = false;

// Bot icon paths (lucide-react "Bot"), rendered at 512×512 for all PWA icon sizes.
// The inner white disc creates visual depth against the red gradient background.
export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(145deg, #ff5a67 0%, #e8192c 55%, #c0121f 100%)",
          borderRadius: "115px",
        }}
      >
        {/* Subtle inner glow disc */}
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
        {/* Bot icon */}
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
