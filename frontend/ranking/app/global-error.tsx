"use client";

/**
 * Catches failures in the root layout itself, so this page cannot rely on
 * any of the app's own styling or components — it must carry everything.
 */
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, sans-serif",
          background: "#f7f7f5",
          color: "#111",
        }}
      >
        <div style={{ textAlign: "center", padding: 24, maxWidth: 420 }}>
          <h1 style={{ fontSize: 22, marginBottom: 8 }}>Something went wrong</h1>
          <p style={{ fontSize: 14, color: "#666", marginBottom: 20 }}>
            The app hit a problem it could not recover from. Your data is safe.
          </p>
          <button
            onClick={reset}
            style={{
              padding: "10px 20px",
              borderRadius: 999,
              border: "none",
              background: "#111",
              color: "#fff",
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
          <p style={{ marginTop: 16 }}>
            <a href="/" style={{ fontSize: 13, color: "#666" }}>
              Back to home
            </a>
          </p>
        </div>
      </body>
    </html>
  );
}
