'use client';

// Last resort, when even the root layout failed: no translations or styles
// are available here, so the message is plain and in both languages.
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="ar" dir="rtl">
      <body style={{ fontFamily: 'system-ui, sans-serif', display: 'grid', placeItems: 'center', minHeight: '100vh', margin: 0 }}>
        <div style={{ textAlign: 'center', padding: 24 }}>
          <p style={{ fontSize: 18, fontWeight: 600 }}>تعذّر تحميل الصفحة</p>
          <p style={{ color: '#666' }} dir="ltr">
            This page couldn&apos;t load.
          </p>
          <button onClick={reset} style={{ marginTop: 12, padding: '8px 16px', borderRadius: 8, border: '1px solid #ccc', cursor: 'pointer' }}>
            حاول مرة أخرى · Try again
          </button>
        </div>
      </body>
    </html>
  );
}
