import express from 'express';
import cors from 'cors';
import oracleRouter from './routes/oracleRoutes.js';

const app = express();

// =======================
// CORS AVANZADO (PROD)
// =======================
app.use(
  cors({
    origin: (origin, callback) => {
      // Permitir requests sin origin (Postman, curl, server-to-server)
      if (!origin) return callback(null, true);

      const allowedOrigins = [
        'http://localhost:3000',
        'https://oracle.tramasys.cl',
        'https://oracle-dashboard.0003333.xyz',
        'https://ventasgestion331.firebaseapp.com',
      ];

      // Regex para subdominios permitidos
      const allowedPatterns = [
        /\.0003333\.xyz$/,
        /\.ngrok-free\.app$/,
        /\.firebaseapp\.com$/,
        /\.web\.app$/,
      ];

      if (
        allowedOrigins.includes(origin) ||
        allowedPatterns.some((pattern) => pattern.test(origin))
      ) {
        callback(null, true);
      } else {
        console.warn(`⛔ Bloqueado por CORS: ${origin}`);
        callback(new Error('No autorizado por CORS'));
      }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  })
);

// =======================
// MIDDLEWARES
// =======================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// =======================
// ENDPOINT RAÍZ
// =======================
app.get('/', (req, res) => {
  res.send(`
    <main style="font-family: system-ui, sans-serif; padding: 40px; color: #1a1a1a; line-height: 1.6;">
      <h2 style="margin-bottom: 8px;">Servidor Oracle API activo</h2>
      <p>
        Instancia desplegada en Oracle Cloud (VM Ubuntu 22.04) con conexión directa
        a base de datos Oracle PL/SQL.
      </p>

      <h3 style="margin-top: 25px;">Endpoints disponibles</h3>
      <ul>
        <li><code>GET /api/generar-informe/:anio</code> — Ejecuta procedimiento PL/SQL y genera informe anual</li>
        <li><code>GET /api/porcentaje-vendedor</code> — Consulta tabla de porcentajes por vendedor</li>
        <li><code>GET /api/errores</code> — Lista errores registrados en la bitácora</li>
        <li><code>GET /api/vendedores</code> — Obtiene listado de vendedores</li>
        <li><code>PUT /api/vendedor/:rut/sueldo</code> — Actualiza sueldo base del vendedor</li>
        <li><code>GET /api/clientes</code> — Lista clientes activos</li>
        <li><code>GET /api/boletas</code> — Consulta boletas (últimas 100)</li>
        <li><code>GET /api/facturas</code> — Consulta facturas (últimas 100)</li>
        <li><code>GET /api/productos</code> — Lista productos disponibles</li>
        <li><code>GET /api/bitacora</code> — Muestra registros de bitácora de cambios</li>
      </ul>

      <p style="margin-top: 25px; font-size: 0.9em; color: #555;">
        © ${new Date().getFullYear()} Gestión de Ventas – Oracle Cloud
      </p>
    </main>
  `);
});

// =======================
// ROUTES
// =======================
app.use('/api', oracleRouter);

export default app;

