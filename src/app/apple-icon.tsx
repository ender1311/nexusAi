import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          background: "#ff3d4d",
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span
          style={{
            color: "white",
            fontSize: 100,
            fontWeight: 800,
            fontFamily: "system-ui, -apple-system, sans-serif",
            lineHeight: 1,
            letterSpacing: "-0.05em",
          }}
        >
          N
        </span>
      </div>
    ),
    { ...size },
  );
}
