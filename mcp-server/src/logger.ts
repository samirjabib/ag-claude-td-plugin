export type LogLevel = 'info' | 'warn' | 'error';

export interface LogFields {
  [key: string]: unknown;
}

export interface Logger {
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

function write(level: LogLevel, message: string, fields: LogFields = {}): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...fields,
  });
  const sink = level === 'error' ? console.error : console.log;
  sink(line);
}

export function createLogger(baseFields: LogFields = {}): Logger {
  return {
    info(message, fields) {
      write('info', message, { ...baseFields, ...fields });
    },
    warn(message, fields) {
      write('warn', message, { ...baseFields, ...fields });
    },
    error(message, fields) {
      write('error', message, { ...baseFields, ...fields });
    },
  };
}
