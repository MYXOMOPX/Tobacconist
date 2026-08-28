import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import type { Db } from '../db/client.js';
import { createAuthenticate } from './middleware/authenticate.js';
import { catalogRoutes } from './routes/catalog.js';
import { availabilityRoutes } from './routes/availability.js';
import { roundsRoutes } from './routes/rounds.js';
import { ordersRoutes } from './routes/orders.js';
import { snapshotRoutes } from './routes/snapshot.js';
import { checklistRoutes } from './routes/checklist.js';
import { paymentsRoutes } from './routes/payments.js';
import { summariesRoutes } from './routes/summaries.js';
import { historyRoutes } from './routes/history.js';
import type { ChatMemberApi } from '../telegram/auth.js';
import type { GeminiClient } from '../gemini/client.js';
import type { DocumentSender, RoundAnnouncer } from '../telegram/notify.js';

export function buildApp(deps: {
  db: Db;
  botToken: string;
  groupChatId: string;
  adminTelegramId: string;
  chatMemberApi: ChatMemberApi;
  geminiClient: GeminiClient;
  uploadsDir: string;
  documentSender: DocumentSender;
  roundAnnouncer: RoundAnnouncer;
  miniAppDistPath?: string;
  onApiReady?: (api: FastifyInstance) => Promise<void>;
  /** Test seam: override the default stdout logger (e.g. to capture log output). */
  logger?: FastifyServerOptions['logger'];
}): FastifyInstance {
  const app = Fastify({ logger: deps.logger ?? true });
  app.setErrorHandler((err, req, reply) => {
    if (err.statusCode) {
      reply.code(err.statusCode).send({ error: err.message });
      return;
    }
    // No statusCode: this is either a domain-validation error (reported as 400 by
    // design) or a genuine unexpected bug. Fastify's default error logging is
    // replaced by this handler, so log it explicitly — otherwise real bugs are
    // invisible in the logs as well as mislabeled as 400.
    req.log.error({ err }, 'unhandled error');
    reply.code(400).send({ error: err.message });
  });
  app.register(multipart);

  if (deps.miniAppDistPath) {
    app.register(fastifyStatic, { root: deps.miniAppDistPath });
  }

  app.get('/api/health', async () => ({ status: 'ok' }));

  const authenticate = createAuthenticate({
    db: deps.db,
    botToken: deps.botToken,
    groupChatId: deps.groupChatId,
    adminTelegramId: deps.adminTelegramId,
    chatMemberApi: deps.chatMemberApi,
  });

  app.register(
    async (api) => {
      api.addHook('preHandler', authenticate);
      api.decorate('db', deps.db);
      if (deps.onApiReady) {
        await deps.onApiReady(api);
      }
      api.get('/me', async (req) => req.authedUser);
      api.register(catalogRoutes(deps.db), { prefix: '/admin' });
      api.register(availabilityRoutes(deps.db, deps.geminiClient, deps.uploadsDir), { prefix: '/admin/availability' });
      api.register(roundsRoutes(deps.db, deps.roundAnnouncer), { prefix: '/rounds' });
      api.register(ordersRoutes(deps.db), { prefix: '/orders' });
      api.register(snapshotRoutes(deps.db, deps.documentSender), { prefix: '/rounds/:roundId/snapshot' });
      api.register(checklistRoutes(deps.db), { prefix: '/rounds/:roundId/checklist' });
      api.register(paymentsRoutes(deps.db), { prefix: '/rounds/:roundId/payments' });
      api.register(summariesRoutes(deps.db), { prefix: '/rounds/:roundId/summaries' });
      api.register(historyRoutes(deps.db), { prefix: '/history' });
    },
    { prefix: '/api' }
  );

  return app;
}
