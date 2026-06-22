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
