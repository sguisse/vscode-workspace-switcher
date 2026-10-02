# PR: Create the VS Code Workspace Switcher

## Summary

Build a Visual Studio Code extension that adds a **Workspace Switcher** tree view to the Explorer. It shows other currently open VS Code workspaces and a deduplicated history of recent workspaces, with actions to switch, open, close, or remove entries.

This specification is intended to be usable as one complete implementation prompt for an LLM. Treat the requirements below as the source of truth; do not rely on access to the original repository.

## Single-prompt implementation brief

> Implement a production-ready VS Code extension named `vscode-workspace-switcher` that provides a **Workspace Switcher** view in the Explorer sidebar.
>
> ### Platform and project
>
> - Use TypeScript and the VS Code Extension API.
> - Support VS Code `^1.80.0` or newer.
> - Use strict TypeScript checking, compile source from `src` into `out`, and set the extension entry point to `out/extension.js`.
> - The extension display name is `🔀 Workspace Switcher`; its description is “Switches between opened and recent VS Code workspaces in the Explorer”.
> - Activate at `onStartupFinished`.
> - Provide the standard npm commands `compile`, `watch`, and `vscode:prepublish` (the latter compiles).
> - Keep the implementation self-contained. Persist recent history in VS Code extension global state and coordinate separate VS Code processes through a small JSON registry in the operating system temporary directory.
>
> ### Explorer view
>
> - Contribute a tree view with ID `workspaceSwitcherView`, name and contextual title **Workspace Switcher**, and a folder icon.
> - Always show two expanded groups, in this order: **opened**, then **recent**. Keep the groups visible when they have no children.
> - The **opened** group lists other live VS Code processes registered as working in a workspace. Do not list the current extension-host process as an opened workspace.
> - Sort opened entries newest-first using the time the process began representing its current workspace. Keep the original time when refreshing an unchanged workspace; assign a new time when that process changes workspace.
> - Show the workspace/window title for each opened entry. Use the workspace name when available, otherwise the first workspace folder’s basename, otherwise `Untitled Workspace`. Show the full workspace or folder path as its tooltip.
> - The **recent** group lists workspace paths remembered by the extension, newest-first. Exclude paths that match any currently open workspace, including the current window. Limit the displayed entries to the configured recent-workspace limit.
> - Label each recent entry with the basename of its path, removing the file extension where applicable; fall back to the full path if no basename is available. Show its full path as the tooltip.
> - Use a blue `folder-opened` icon for opened entries and a `folder` icon for recent entries. Use a blue `folder-opened` theme icon for the opened group and a `history` icon for the recent group.
> - Set tree item context values so the opened entry exposes the close action and the recent entry exposes the remove action.
> - Give workspace paths file resource URIs. Register a file decoration provider that marks a URI matching a currently open workspace with the `charts.blue` theme color and tooltip **Currently open**; provide no decoration for other URIs.
>
> ### Workspace tracking and persistence
>
> - Identify a workspace using `workspaceFile.fsPath` when a `.code-workspace` file is open; otherwise use the first `workspaceFolders` folder’s `uri.fsPath`. A window with neither has no workspace path.
> - Track each participating VS Code process in a shared JSON file under `os.tmpdir()`. Each record contains the process ID, display title, optional first-folder path, optional workspace path, and timestamp.
> - On activation, register the current process and add its current workspace path to recent history if one exists.
> - On workspace-folder changes, add the new current workspace path to recent history, refresh the current process’s registry record, and refresh the view and decorations.
> - On deactivation, add the current workspace path to recent history and remove the current process from the registry.
> - Re-register the current process, refresh the view, and refresh decorations every three seconds. This keeps separate VS Code windows reasonably current even though they do not share an in-process event.
> - Before presenting registry entries, ignore processes that are no longer alive. Updating the registry must discard stale records and replace the current process’s record rather than create duplicates.
> - Compare workspace paths using normalized absolute paths (`path.resolve`) so equivalent relative/absolute representations deduplicate. Use the same comparison for recent history and open-workspace exclusion.
> - Store recent paths in extension `globalState` under `recentWorkspaces`. Add a path to the front, remove any equivalent existing path first, and do not add an absent path. Keep history deduplicated; the display limit controls presentation, not history insertion.
> - Handle missing or malformed registry data without preventing extension activation. Do not let a registry write failure crash the extension.
>
> ### Configuration
>
> - Contribute integer setting `workspaceSwitcher.recentWorkspacesLimit`, under the **Workspace Switcher** configuration section.
> - Default to `10`; minimum is `0`. Its description is “Maximum number of recent workspaces shown in the Workspace Switcher view.”
> - Clamp the effective limit at zero or greater. A value of zero means the recent group is empty, not that recent history is deleted.
> - Refresh the tree when this setting changes.
>
> ### Commands and interactions
>
> Register and contribute these commands:
>
> | Command ID | User-facing title | Required behavior |
> | --- | --- | --- |
> | `workspaceSwitcher.refresh` | Refresh Workspaces | Re-register the current process, then refresh the tree and file decorations. Add it to the view title toolbar in the `navigation` group with a refresh icon. |
> | `workspaceSwitcher.switchWorkspace` | Switch to Workspace | For an opened entry with a workspace or folder path, execute `vscode.openFolder` for that path with `{ forceNewWindow: false }`. If the entry has no path, invoke `workbench.action.switchWindow`. |
> | `workspaceSwitcher.closeWorkspace` | Close Workspace | Available as an inline context-menu action only for opened entries. Terminate that entry’s process, remove its registry record, and refresh the tree and decorations. Match the existing implementation’s behavior: it first attempts `SIGKILL`, then falls back to the default process signal if that attempt throws. This is forceful and may prevent unsaved-work recovery; do not present it as a graceful close. |
> | `workspaceSwitcher.openRecentWorkspace` | Open Recent Workspace | Available by activating a recent entry. If the path is already open in another process, switch to it. If it is open in the current process, do nothing. Otherwise execute `vscode.openFolder` for the path with `{ forceNewWindow: true }`. |
> | `workspaceSwitcher.removeRecentWorkspace` | Remove Recent Workspace | Available as an inline context-menu action only for recent entries. Remove the matching path from global recent history, then refresh the tree and decorations. |
>
> - Configure view context menus using `view == workspaceSwitcherView` and item context values `openedWorkspaceItem` and `recentWorkspaceItem`.
> - Activating an opened entry invokes the switch command; activating a recent entry invokes the open-recent command.
> - Refresh decorations whenever the tree is refreshed, a workspace changes, an entry is closed or removed, or the periodic cross-window refresh runs.
> - Dispose all registered commands, providers, listeners, and timers with the extension context. On disposal, clear the timer and unregister the current process.
>
> ### Acceptance criteria
>
> 1. After activation, the Explorer contains the **Workspace Switcher** view with expanded **opened** and **recent** sections.
> 2. With multiple live VS Code processes using this extension, each window appears in the other windows’ opened lists, not in its own. Entries are newest-first, and stale/dead process records are not shown.
> 3. Opening or changing a workspace adds it to the front of recent history without duplicates. A currently open workspace is absent from recent results; when no longer open, its remembered entry can appear again.
> 4. Recent entries display newest-first up to the configured limit. Setting the limit to zero empties only the displayed recent list.
> 5. Activating an opened item switches to that workspace. Activating a recent item switches to an already-open copy or opens the workspace in a new window if it is not open.
> 6. The opened-item close action removes the target process from the list; the recent-item remove action removes only that path from recent history.
> 7. Workspace paths matching a live workspace receive the blue **Currently open** file decoration.
> 8. The refresh toolbar command and three-second polling both update cross-window state and decorations; changing the recent limit updates the view immediately.
> 9. The extension compiles successfully with strict TypeScript settings, and tests cover path deduplication, recent ordering/limit behavior, opened-versus-recent filtering, and command decision logic where practical.
>
> ### Delivery
>
> - Include all necessary extension manifest contributions, TypeScript source, and focused tests where the project’s test setup allows.
> - Update the README with the view’s features, the recent-workspace setting, and build/package/install instructions.
> - Keep behavior limited to workspace switching/history; do not add unrelated workspace management, cloud synchronization, or settings beyond those specified.

## Behavioral notes and constraints

- Recent history is collected while the extension is active in a workspace; it is not imported from VS Code’s global recent list.
- The implementation tracks only the first workspace folder when a multi-root folder workspace is used, or the workspace file itself when one is open.
- Path identity uses `path.resolve`, not filesystem realpath or case-folding. Do not claim symlink or case-insensitive equivalence beyond what the platform’s `path.resolve` provides.
- The registry is shared through a temporary file and is best-effort coordination, not a durable or transactional database.
- The close action is intentionally documented as forceful because process termination can lose unsaved changes.

## Build and package

```bash
npm install
npm run compile
npx @vscode/vsce package
code --install-extension vscode-workspace-switcher-1.0.0.vsix
```
