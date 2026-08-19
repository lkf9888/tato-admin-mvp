"use client";

/**
 * Last-resort boundary.
 *
 * `app/error.tsx` runs inside the root layout, so it cannot catch an
 * error thrown *by* that layout -- and the layout is where the shell,
 * the nav and the i18n bootstrap live, which is exactly the code that
 * took the site down once already. This one replaces the whole
 * document, so it has to ship its own <html> and its own styles: the
 * stylesheet may be the thing that failed.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="zh">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily:
            'Avenir, "Avenir Next", -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
          background: "#ffffff",
          color: "#121214",
          padding: "16px",
        }}
      >
        <div style={{ maxWidth: 420, textAlign: "center" }}>
          <p
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "#6e6e73",
              margin: 0,
            }}
          >
            TATO
          </p>
          <h1 style={{ fontSize: 18, fontWeight: 900, letterSpacing: "-0.2px", margin: "8px 0 0" }}>
            平台暂时无法加载
          </h1>
          <p style={{ fontSize: 13, lineHeight: 1.6, color: "#6e6e73", margin: "8px 0 0" }}>
            我们已经记录了这个问题。你的数据没有受影响。
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: 16,
              minHeight: 44,
              padding: "0 20px",
              borderRadius: 8,
              border: "none",
              background: "#121214",
              color: "#ffffff",
              fontSize: 13,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            重新加载
          </button>
          {error.digest ? (
            <p style={{ fontSize: 11, color: "#6e6e73", marginTop: 12 }}>
              编号 <strong style={{ color: "#121214" }}>{error.digest}</strong>
            </p>
          ) : null}
        </div>
      </body>
    </html>
  );
}
