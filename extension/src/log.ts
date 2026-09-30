/** The slice of VS Code's LogOutputChannel the extension uses; tests pass a recorder. */
export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  debug(message: string): void;
}
