// Anthropic API key in VS Code SecretStorage (OS keychain). Never written to settings, logs or
// the webview.

import type * as vscode from 'vscode';
import type { SecretRedactor } from './redact';

const API_KEY = 'crew.anthropicApiKey';
const LICENSE_KEY = 'crew.licenseKey';

export function looksLikeAnthropicKey(value: string): boolean {
  return /^sk-ant-[A-Za-z0-9_-]{20,}$/.test(value.trim());
}

export class SecretStore {
  private readonly listeners = new Set<(hasKey: boolean) => void>();

  constructor(
    private readonly secrets: vscode.SecretStorage,
    private readonly redactor: SecretRedactor,
  ) {
    secrets.onDidChange(async (e) => {
      if (e.key !== API_KEY) return;
      const key = await this.getApiKey();
      for (const l of this.listeners) l(Boolean(key));
    });
  }

  onDidChangeApiKey(listener: (hasKey: boolean) => void): { dispose(): void } {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  async getApiKey(): Promise<string | undefined> {
    const key = await this.secrets.get(API_KEY);
    this.redactor.add(key);
    return key || undefined;
  }

  async setApiKey(key: string): Promise<void> {
    const trimmed = key.trim();
    this.redactor.add(trimmed);
    await this.secrets.store(API_KEY, trimmed);
  }

  async clearApiKey(): Promise<void> {
    await this.secrets.delete(API_KEY);
  }

  async getLicenseKey(): Promise<string | undefined> {
    const key = await this.secrets.get(LICENSE_KEY);
    this.redactor.add(key);
    return key || undefined;
  }

  async setLicenseKey(key: string): Promise<void> {
    this.redactor.add(key);
    await this.secrets.store(LICENSE_KEY, key);
  }

  async clearLicenseKey(): Promise<void> {
    await this.secrets.delete(LICENSE_KEY);
  }
}
