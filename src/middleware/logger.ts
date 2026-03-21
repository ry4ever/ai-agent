import winston from 'winston';
import { Request, Response, NextFunction } from 'express';

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL ?? 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    process.env.NODE_ENV === 'development'
      ? winston.format.prettyPrint()
      : winston.format.json()
  ),
  transports: [new winston.transports.Console()],
});

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();

  res.on('finish', () => {
    const ms = Date.now() - start;
    const logData = {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      ms,
      agent: req.headers['x-agent-address'] ?? req.ip,
      payment: req.headers['x-payment'] ? 'present' : 'absent',
    };

    if (res.statusCode >= 500) {
      logger.error('Request error', logData);
    } else if (res.statusCode === 402) {
      logger.info('Payment required', logData);
    } else {
      logger.info('Request completed', logData);
    }
  });

  next();
}

export function paymentLogger(params: {
  txHash: string;
  agentAddress: string;
  endpoint: string;
  amountUSDC: number;
}): void {
  logger.info('Payment received', {
    event: 'payment',
    ...params,
    timestamp: new Date().toISOString(),
  });
}
