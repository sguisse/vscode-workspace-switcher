import * as vscode from 'vscode';
import { registerWorkspaceCommands } from './commands/registerWorkspaceCommands';
import { WorkspaceDecorationProvider } from './providers/WorkspaceDecorationProvider';
import { WorkspaceSwitcherTreeDataProvider } from './providers/WorkspaceSwitcherTreeDataProvider';
import { ProcessMonitorService } from './services/ProcessMonitorService';
import { WorkspaceStateService } from './services/WorkspaceStateService';

export { WorkspaceTreeItem } from './models/WorkspaceTreeItem';
export { WorkspaceDecorationProvider } from './providers/WorkspaceDecorationProvider';
export { WorkspaceSwitcherTreeDataProvider } from './providers/WorkspaceSwitcherTreeDataProvider';
export { ProcessMonitorService } from './services/ProcessMonitorService';
export { WorkspaceStateService } from './services/WorkspaceStateService';
export type { ItemType, WorkspaceRecord } from './types/workspace';

export function activate(context: vscode.ExtensionContext): void {
  const stateService = new WorkspaceStateService(context.globalState);
  const currentPath = stateService.getCurrentWindowPath();
  const processMonitor = new ProcessMonitorService(currentPath);

  if (currentPath) {
    stateService.recordWorkspaceAccess(currentPath);
  }

  processMonitor.startHeartbeat();

  const treeDataProvider = new WorkspaceSwitcherTreeDataProvider(stateService, processMonitor);
  const treeView = vscode.window.createTreeView('workspaceSwitcher', {
    treeDataProvider,
    showCollapseAll: false
  });

  const decorationProvider = new WorkspaceDecorationProvider(() => processMonitor.getOpenPathsSet());
  const decorationDisposable = vscode.window.registerFileDecorationProvider(decorationProvider);
  const commandDisposables = registerWorkspaceCommands(
    stateService,
    processMonitor,
    treeDataProvider,
    decorationProvider
  );

  context.subscriptions.push(
    treeView,
    decorationDisposable,
    ...commandDisposables,
    { dispose: () => processMonitor.stopHeartbeat() }
  );
}

export function deactivate(): void {
  // Disposable hooks clean up heartbeat process automatically.
}
