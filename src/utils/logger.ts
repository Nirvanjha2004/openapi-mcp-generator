export type LogLevel = "info" | "warn" | "error" | "debug";

export interface Logger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
  debug(msg: string): void;
}

export function createLogger(prefix = "[openapi-mcp-generator]"): Logger {
  const format = (level: LogLevel, msg: string): string => {
    const timestamp = new Date().toISOString();
    return `${timestamp} ${prefix} [${level.toUpperCase()}] ${msg}`;
  };

  return {
    info(msg: string): void {
      console.log(format("info", msg));
    },
    warn(msg: string): void {
      console.warn(format("warn", msg));
    },
    error(msg: string): void {
      console.error(format("error", msg));
    },
    debug(msg: string): void {
      if (process.env.DEBUG) {
        console.debug(format("debug", msg));
      }
    },
  };
}

export const logger = createLogger();
