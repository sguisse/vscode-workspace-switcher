import * as fs from 'fs';
import * as vscode from 'vscode';

export class WorkspaceStateService {
  private static readonly STORAGE_KEY = 'workspaceSwitcher.recentHistory';

  constructor(private readonly globalState: vscode.Memento) {}

  public getRecentWorkspaces(openWorkspacePaths: Set<string>, limit: number): string[] {
    if (limit <= 0) {
      return [];
    }

    const history = this.getRawHistory();
    const currentWindowPath = this.getCurrentWindowPath();

    return history
      .filter(workspacePath => !openWorkspacePaths.has(workspacePath) && workspacePath !== currentWindowPath)
      .slice(0, limit);
  }

  public recordWorkspaceAccess(workspacePath: string): void {
    if (!workspacePath || !fs.existsSync(workspacePath)) {
      return;
    }

    const history = this.getRawHistory().filter(existingPath => existingPath !== workspacePath);
    history.unshift(workspacePath);
    this.globalState.update(WorkspaceStateService.STORAGE_KEY, history);
  }

  public removeRecentWorkspace(workspacePath: string): void {
    const history = this.getRawHistory().filter(existingPath => existingPath !== workspacePath);
    this.globalState.update(WorkspaceStateService.STORAGE_KEY, history);
  }

  public getRawHistory(): string[] {
    return this.globalState.get<string[]>(WorkspaceStateService.STORAGE_KEY, []);
  }

  public getCurrentWindowPath(): string | undefined {
    if (vscode.workspace.workspaceFile) {
      return vscode.workspace.workspaceFile.fsPath;
    }
    if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
      return vscode.workspace.workspaceFolders[0].uri.fsPath;
    }
    return undefined;
  }
}
