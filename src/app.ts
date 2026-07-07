import { config } from './config.js';
import { LotRepository } from './database/lotRepository.js';
import { createPostgresPool, runPostgresMigrations } from './database/postgres.js';
import { Logger } from './utils/logger.js';
import { createScraperFactory } from './scrapers/createScraperFactory.js';
import { LotService } from './services/lotService.js';
import { NotificationService } from './services/notificationService.js';
import { TelegramClient } from './bot/telegram.js';
import { CommandRouter } from './bot/commands/commandRouter.js';
import { MessageHandler } from './bot/handlers/messageHandler.js';
import { TelegramBot } from './bot/bot.js';
import { MonitorScheduler } from './scheduler/monitor.js';
import { SchedulerService } from './services/schedulerService.js';

const logger = new Logger(config.logLevel);
if (!config.telegramBotToken) {
  throw new Error('Missing required environment variable: TELEGRAM_BOT_TOKEN');
}

const pool = createPostgresPool(config.postgresUrl);
await runPostgresMigrations(pool);
const lotRepository = new LotRepository(pool);
const scraperFactory = createScraperFactory(config);
const lotService = new LotService(lotRepository, scraperFactory);
const telegram = new TelegramClient(config.telegramBotToken);
const knownChatIds = new Set<number>();
const chatIds = (): number[] =>
  config.allowedChatIds.size > 0 ? [...config.allowedChatIds] : [...knownChatIds];
const notificationService = new NotificationService(telegram, chatIds);
const commandRouter = new CommandRouter(lotService, notificationService, logger);
const messageHandler = new MessageHandler(telegram, commandRouter, config.allowedChatIds, knownChatIds, logger);
const bot = new TelegramBot(telegram, messageHandler, logger);
const monitor = new MonitorScheduler(config.monitorCron, lotRepository, lotService, notificationService, logger);
const scheduler = new SchedulerService(monitor);

bot.start();
scheduler.start();

async function shutdown(signal: string): Promise<void> {
  logger.info('Shutting down', { signal });
  bot.stop();
  scheduler.stop();
  await pool.end();
  process.exit(0);
}

process.on('SIGINT', (signal) => void shutdown(signal));
process.on('SIGTERM', (signal) => void shutdown(signal));
