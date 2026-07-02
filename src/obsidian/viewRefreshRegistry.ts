// Tracks open plugin views so a mutating action in one view can refresh the others.
//
// Obsidian-free on purpose: register/unregister are synchronous; notifyMutation re-renders every
// registered view EXCEPT the origin (which refreshes itself in place after its own action). A single
// view's refresh failure must never block the rest, and the view set may change during a refresh
// (a view can close), so we iterate over a snapshot.

export interface RefreshableView {
  refresh(): void | Promise<void>;
}

export class ViewRefreshRegistry {
  private readonly views = new Set<RefreshableView>();

  /**
   * @param beforeNotify Optional hook run ONCE before views are refreshed on each mutation. The plugin
   * uses it to recompute live health (e.g. embedding reindex status) so a mutation like upload/extraction
   * leaves the dashboard/settings showing current — not startup-frozen — status. Best-effort: a failure
   * here must never block view refresh, so it is caught and logged.
   */
  constructor(private readonly beforeNotify?: () => void | Promise<void>) {}

  register(view: RefreshableView): void {
    this.views.add(view);
  }

  unregister(view: RefreshableView): void {
    this.views.delete(view);
  }

  size(): number {
    return this.views.size;
  }

  /** Refresh every registered view except `origin`. Never throws; logs and continues per view. */
  async notifyMutation(origin?: RefreshableView): Promise<void> {
    if (this.beforeNotify) {
      try { await this.beforeNotify(); } catch (error) { console.error("Transcript Memory Vault pre-refresh hook failed", error); }
    }
    for (const view of [...this.views]) {
      if (view === origin) continue;
      try {
        await view.refresh();
      } catch (error) {
        console.error("Transcript Memory Vault view refresh failed", error);
      }
    }
  }
}
