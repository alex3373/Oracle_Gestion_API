import express from 'express';
import oracleRoutes from './routes/oracleRoutes.js';
import { getConnection } from './db/connection.js';

const app = express();


/* ============================================================
   CONFIGURACIÓN GENERAL
   ============================================================ */

app.disable('x-powered-by');

app.use(
  express.json({
    limit: '100kb',
  })
);


/* ============================================================
   CORS
   ============================================================ */

function getAllowedOrigins() {
  return String(process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allowedOrigins = getAllowedOrigins();

  /*
   * Requests como curl, healthchecks o tráfico server-to-server
   * normalmente no incluyen Origin.
   */
  if (!origin) {
    return next();
  }

  /*
   * En desarrollo, si no se configuraron orígenes,
   * permitimos localhost para facilitar trabajo local.
   */
  const developmentFallback =
    process.env.NODE_ENV !== 'production' &&
    allowedOrigins.length === 0 &&
    (
      origin.startsWith('http://localhost:') ||
      origin.startsWith('http://127.0.0.1:')
    );

  const allowed =
    allowedOrigins.includes(origin) ||
    developmentFallback;

  if (!allowed) {
    return res.status(403).json({
      error: 'Origen no permitido.',
    });
  }

  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');

  res.setHeader(
    'Access-Control-Allow-Methods',
    'GET,POST,PUT,OPTIONS'
  );

  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type,X-Admin-Key'
  );

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  next();
});


/* ============================================================
   ROOT
   ============================================================ */

app.get('/', (req, res) => {
  res.json({
    name: 'Gestión Comercial Oracle API',
    status: 'online',

    environment:
      process.env.NODE_ENV ?? 'development',

    demoReadOnly:
      process.env.DEMO_READ_ONLY !== 'false',

    endpoints: {
      health: '/health',

      dashboard: '/api/dashboard',

      ventas: '/api/ventas',
      boleta: '/api/ventas/boleta/:numero',
      factura: '/api/ventas/factura/:numero',

      vendedores: '/api/vendedores',
      vendedor: '/api/vendedores/:rut',

      clientes: '/api/clientes',
      cliente: '/api/clientes/:rut',

      productos: '/api/productos',
      producto: '/api/productos/:codigo',

      reportes: '/api/reportes',
      generarReporte: 'POST /api/reportes/:anio/generar',

      bitacora: '/api/bitacora',
      errores: '/api/errores',
    },
  });
});


/* ============================================================
   HEALTH CHECK
   ============================================================ */

app.get('/health', async (req, res) => {
  let conn;

  try {
    conn = await getConnection();

    await conn.execute(`
      SELECT 1 AS ok
      FROM dual
    `);

    res.json({
      status: 'ok',
      database: 'connected',
    });
  } catch (err) {
    console.error('Health check Oracle falló:', err);

    res.status(503).json({
      status: 'error',
      database: 'unavailable',
    });
  } finally {
    if (conn) {
      try {
        await conn.close();
      } catch (err) {
        console.error(
          'Error cerrando conexión del health check:',
          err
        );
      }
    }
  }
});


/* ============================================================
   API
   ============================================================ */

app.use('/api', oracleRoutes);


/* ============================================================
   404
   ============================================================ */

app.use((req, res) => {
  res.status(404).json({
    error: 'Ruta no encontrada.',
  });
});


/* ============================================================
   ERROR HANDLER GLOBAL
   ============================================================ */

app.use((err, req, res, next) => {
  console.error('Error no controlado:', err);

  if (res.headersSent) {
    return next(err);
  }

  res.status(500).json({
    error: 'Ocurrió un error interno en el servidor.',
  });
});


export default app;