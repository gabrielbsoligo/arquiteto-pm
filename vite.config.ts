import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv, type Plugin} from 'vite';

/**
 * Middleware de dev que serve a via READ-ONLY do Labs em `npm run dev`.
 * A MESMA lógica (server/labsReadonly.ts) roda como função serverless em
 * api/labs/query.ts no deploy. O Postgres é acessado SÓ aqui, no servidor,
 * como usuário erick_readonly — o navegador nunca vê a connection string.
 */
function labsReadonlyApi(): Plugin {
  return {
    name: 'labs-readonly-api',
    configureServer(server) {
      server.middlewares.use('/api/labs/query', async (req, res) => {
        // ssrLoadModule carrega o módulo server-side pelo pipeline do Vite
        // (resolve TS + deps) e mantém `pg` FORA do bundle do cliente.
        const {handleLabsQuery} = (await server.ssrLoadModule(
          '/server/labsReadonly.ts',
        )) as typeof import('./server/labsReadonly');
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({error: 'Use POST.'}));
          return;
        }
        try {
          const chunks: Buffer[] = [];
          for await (const c of req) chunks.push(c as Buffer);
          const raw = Buffer.concat(chunks).toString('utf8').trim();
          const {status, body} = await handleLabsQuery(raw ? JSON.parse(raw) : {});
          res.statusCode = status;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(body));
        } catch (err) {
          res.statusCode = 400;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({error: (err as Error).message ?? 'Body inválido.'}));
        }
      });
    },
  };
}

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss(), labsReadonlyApi()],
    // IMPORTANTE: não injetar chaves de IA no bundle do cliente.
    // Claude API é chamada server-side via Edge Function `analyze-call`.
    // Se alguém puser ANTHROPIC_API_KEY no .env local, ela ficaria como
    // string literal no JS servido ao navegador.
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
