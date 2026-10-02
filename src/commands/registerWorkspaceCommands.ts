import * as vscode from 'vscode';
import { WorkspaceTreeItem } from '../models/WorkspaceTreeItem';
import { WorkspaceDecorationProvider } from '../providers/WorkspaceDecorationProvider';
import { WorkspaceSwitcherTreeDataProvider } from '../providers/WorkspaceSwitcherTreeDataProvider';
import { ProcessMonitorService } from '../services/ProcessMonitorService';
import { WorkspaceStateService } from '../services/WorkspaceStateService';

export function registerWorkspaceCommands(
  stateService: WorkspaceStateService,
  processMonitor: ProcessMonitorService,
  treeDataProvider: WorkspaceSwitcherTreeDataProvider,
  decorationProvider: WorkspaceDecorationProvider
): vscode.Disposable[] {
  const refreshCommand = vscode.commands.registerCommand('workspaceSwitcher.refresh', () => {
    treeDataProvider.refresh();
    decorationProvider.refresh();
  });

  const switchOpenedCommand = vscode.commands.registerCommand(
    'workspaceSwitcher.switchOpenedWorkspace',
    (item: WorkspaceTreeItem) => {
      if (item.workspacePath) {
        vscode.commands.executeCommand(
          'vscode.openFolder',
          vscode.Uri.file(item.workspacePath),
          { forceNewWindow: false }
        );
      } else {
        vscode.commands.executeCommand('workbench.action.switchWindow');
      }
    }
  );

  const openRecentCommand = vscode.commands.registerCommand(
    'workspaceSwitcher.openRecentWorkspace',
    (item: WorkspaceTreeItem) => {
      if (!item.workspacePath) {
        return;
      }

      const openPaths = processMonitor.getOpenPathsSet();
      const forceNewWindow = !openPaths.has(item.workspacePath);
      vscode.commands.executeCommand(
        'vscode.openFolder',
        vscode.Uri.file(item.workspacePath),
        { forceNewWindow }
      );
    }
  );

  const closeWorkspaceCommand = vscode.commands.registerCommand(
    'workspaceSwitcher.closeWorkspace',
    async (item: WorkspaceTreeItem) => {
      if (!item.pid) {
        return;
      }

      const confirmation = await vscode.window.showWarningMessage(
        `Forcefully close workspace "${item.label}"? Unsaved changes may be lost.`,
        { modal: true },
        'Force Close'
      );

      if (confirmation === 'Force Close') {
        const killed = processMonitor.forceCloseWorkspace(item.pid);
        if (killed) {
          treeDataProvider.refresh();
          decorationProvider.refresh();
          vscode.window.showInformationMessage(`Workspace process ${item.pid} terminated.`);
        }
      }
    }
  );

  const removeRecentCommand = vscode.commands.registerCommand(
    'workspaceSwitcher.removeRecentWorkspace',
    (item: WorkspaceTreeItem) => {
      if (item.workspacePath) {
        stateService.removeRecentWorkspace(item.workspacePath);
        treeDataProvider.refresh();
      }
    }
  );

  const configListener = vscode.workspace.onDidChangeConfiguration(event => {
    if (event.affectsConfiguration('workbench.workspaceSwitcher.maxRecentWorkspaces')) {
      treeDataProvider.refresh();
    }
  });

  return [
    refreshCommand,
    switchOpenedCommand,
    openRecentCommand,
    closeWorkspaceCommand,
    removeRecentCommand,
    configListener
  ];
}
