// Keeps secrets (API key, license key) out of logs and webview messages.

const ANTHROPIC_KEY_PATTERN = /sk-ant-[A-Za-z0-9_-]{8,}/g;

export class SecretRedactor {
  private readonly secrets = new Set<string>();

  add(secret: string | undefined): void {
    if (secret && secret.length >= 8) this.secrets.add(secret);
  }

  delete(secret: string | undefined): void {
    if (secret) this.secrets.delete(secret);
  }

  redact(text: string): string {
    let out = text;
    for (const secret of this.secrets) {
      if (out.includes(secret)) out = out.split(secret).join('***');
    }
    return out.replace(ANTHROPIC_KEY_PATTERN, 'sk-ant-***');
  }

  /** Deep copy of a JSON-compatible value with every string redacted. */
  redactValue<T>(value: T): T {
    if (typeof value === 'string') return this.redact(value) as T;
    if (Array.isArray(value)) return value.map((v) => this.redactValue(v)) as T;
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) out[k] = this.redactValue(v);
      return out as T;
    }
    return value;
  }
}

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  debug(message: string): void;
}

export interface LogSink {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  debug(message: string): void;
}

export function redactingLogger(sink: LogSink, redactor: SecretRedactor): Logger {
  return {
    info: (m) => sink.info(redactor.redact(m)),
    warn: (m) => sink.warn(redactor.redact(m)),
    error: (m) => sink.error(redactor.redact(m)),
    debug: (m) => sink.debug(redactor.redact(m)),
  };
}
