import * as path from 'path';

export function resolveWorkspaceLabel(fullPath: string): string {
  if (!fullPath) {
    return 'Untitled Workspace';
  }
  if (fullPath.endsWith('.code-workspace')) {
    return path.basename(fullPath, '.code-workspace');
  }
  return path.basename(fullPath);
}
