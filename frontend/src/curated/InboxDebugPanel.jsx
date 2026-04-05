function formatJson(value) {
  return JSON.stringify(value, null, 2);
}

export default function InboxDebugPanel({ snapshot, loading, error, onRefresh }) {
  return (
    <section className="draft-panel">
      <h3>Inbox debug</h3>
      <p>Use this to verify whether Canvas returned the message before blaming the UI.</p>

      <div className="autonomous-page-actions" style={{ marginTop: 16 }}>
        <button type="button" className="page-button-secondary" onClick={onRefresh} disabled={loading}>
          {loading ? "Refreshing..." : "Refresh raw inbox"}
        </button>
      </div>

      {error ? <div className="autonomous-error" style={{ marginTop: 16 }}>{error}</div> : null}

      <div className="draft-stack">
        <article className="draft-card">
          <span className="draft-label">Raw inbox payload</span>
          <div className="draft-body">{snapshot ? formatJson(snapshot) : "No debug payload loaded yet."}</div>
        </article>
      </div>
    </section>
  );
}
