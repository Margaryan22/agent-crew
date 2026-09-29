// Chat WebviewView: strict CSP, nonce-gated script, local resources only, and validated
// messages in both directions. Every outgoing message passes through the secret redactor.

import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import type { Logger, SecretRedactor } from '../redact';
import { type ExtensionToWebview, parseWebviewMessage, type WebviewToExtension } from '../shared/protocol';

export const CHAT_VIEW_ID = 'crew.chat';

export class ChatViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly redactor: SecretRedactor,
    private readonly log: Logger,
    private readonly onMessage: (message: WebviewToExtension) => void,
    /** Test hook: sees exactly what is posted to the webview. */
    private readonly onPosted?: (message: ExtensionToWebview) => void,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    const assets = vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview');
    view.webview.options = { enableScripts: true, enableForms: false, localResourceRoots: [assets] };
    view.webview.html = this.html(view.webview, assets);
    this.disposables.push(
      view.webview.onDidReceiveMessage((raw: unknown) => {
        const message = parseWebviewMessage(raw);
        if (!message) {
          this.log.warn('Ignored a malformed message from the chat webview.');
          return;
        }
        this.onMessage(message);
      }),
      view.onDidDispose(() => {
        if (this.view === view) this.view = undefined;
      }),
    );
  }

  post(message: ExtensionToWebview): void {
    const safe = this.redactor.redactValue(message);
    this.onPosted?.(safe);
    if (this.view) void this.view.webview.postMessage(safe);
  }

  focus(): void {
    void vscode.commands.executeCommand(`${CHAT_VIEW_ID}.focus`);
  }

  private html(webview: vscode.Webview, assets: vscode.Uri): string {
    const nonce = randomBytes(16).toString('base64');
    const script = webview.asWebviewUri(vscode.Uri.joinPath(assets, 'chat.js'));
    const style = webview.asWebviewUri(vscode.Uri.joinPath(assets, 'chat.css'));
    const csp = [
      "default-src 'none'",
      `img-src ${webview.cspSource} data:`,
      `style-src ${webview.cspSource}`,
      `font-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
      "connect-src 'none'",
      "form-action 'none'",
      "base-uri 'none'",
    ].join('; ');
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${style.toString()}">
<title>Crew</title>
</head>
<body>
<div id="root"></div>
<script nonce="${nonce}" type="module" src="${script.toString()}"></script>
</body>
</html>`;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
