import { ImageResponse } from "next/og";

export const size = {
  width: 64,
  height: 64,
};

export const contentType = "image/png";

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
          position: "relative",
          borderRadius: 14,
          background: "#173f49",
          color: "#ffffff",
          fontSize: 28,
          fontWeight: 800,
          letterSpacing: -2,
        }}
      >
        29
        <span
          style={{
            position: "absolute",
            top: 9,
            right: 9,
            width: 8,
            height: 8,
            borderRadius: 999,
            background: "#78d6c6",
          }}
        />
      </div>
    ),
    size,
  );
}
