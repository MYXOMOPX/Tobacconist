import Fastify, { type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import type { Db } from '../db/client';
import { createAuthenticate } from './middleware/authenticate';
import { catalogRoutes } from './routes/catalog';
import { availabilityRoutes } from './routes/availability';
import { roundsRoutes } from './routes/rounds';
import { ordersRoutes } from './routes/orders';
import { snapshotRoutes } from './routes/snapshot';
import { checklistRoutes } from './routes/checklist';
import { paymentsRoutes } from './routes/payments';
import { historyRoutes } from './routes/history';
import type { ChatMemberApi } from '../telegram/auth';
import type { GeminiClient } from '../gemini/client';
import type { DocumentSender } from '../telegram/notify';

export function buildApp(deps: {
  db: Db;
  botToken: string;
  groupChatId: string;
  adminTelegramId: string;
  chatMemberApi: ChatMemberApi;
  geminiClient: GeminiClient;
  uploadsDir: string;
  documentSender: DocumentSender;
  miniAppDistPath?: string;
  onApiReady?: (api: FastifyInstance) => Promise<void>;
}): FastifyInstance {
  const app = Fastify({ logger: true });
  app.setErrorHandler((err, req, reply) => {
    if (err.statusCode) {
      reply.code(err.statusCode).send({ error: err.message });
      return;
    }
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
      api.register(catalogRoutes(deps.db), { prefix: '/admin' });
      api.register(availabilityRoutes(deps.db, deps.geminiClient, deps.uploadsDir), { prefix: '/admin/availability' });
      api.register(roundsRoutes(deps.db), { prefix: '/rounds' });
      api.register(ordersRoutes(deps.db), { prefix: '/orders' });
      api.register(snapshotRoutes(deps.db, deps.documentSender), { prefix: '/rounds/:roundId/snapshot' });
      api.register(checklistRoutes(deps.db), { prefix: '/rounds/:roundId/checklist' });
      api.register(paymentsRoutes(deps.db), { prefix: '/rounds/:roundId/payments' });
      api.register(historyRoutes(deps.db), { prefix: '/history' });
    },
    { prefix: '/api' }
  );

  return app;
}
