// Shows a file in the system's file manager. Node only.

import { spawn } from 'node:child_process';
import path from 'node:path';

/**
 * Opens the folder that holds `file`, with the file selected where the system can do that (Windows, macOS).
 * Resolves once the program has started and rejects when it could not be started.
 */
export function revealInFolder(file, platform = process.platform) {
  const run =
    platform === 'win32'
      ? ['explorer.exe', [`/select,"${file}"`], { windowsVerbatimArguments: true }]
      : platform === 'darwin'
        ? ['open', ['-R', file], {}]
        : ['xdg-open', [path.dirname(file)], {}];
  return new Promise((resolve, reject) => {
    const child = spawn(run[0], run[1], { detached: true, stdio: 'ignore', ...run[2] });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}
