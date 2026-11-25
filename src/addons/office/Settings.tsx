/** Workspace has nothing to set up: it runs on this computer and stores ordinary pages. */
export function OfficeSettings() {
  return (
    <div className="ai-settings">
      <p className="ai-note">
        Open <strong>Studio</strong> in the sidebar to start a document, spreadsheet or presentation. Pages you made stay yours if you switch this off: they open as ordinary canvas pages, and
        everything on them is still there.
      </p>
    </div>
  );
}
