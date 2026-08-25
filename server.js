import app from './app.js';
import dotenv from 'dotenv';

dotenv.config();

const PORT = process.env.PORT || 4000;

// Endpoint raíz informativo
app.get('/', (req, res) => {
  res.send(`
    <main style="font-family: system-ui; color: #222; padding: 40px; line-height: 1.6;">
      <h2 style="margin-bottom: 10px;">Servidor Oracle API activo</h2>
      <p>Instancia en ejecución dentro de Oracle Cloud (VM Ubuntu 22.04).</p>
      <p>Conectado a base de datos Oracle PL/SQL.</p>
      <p>Rutas disponibles:</p>
      <ul>
        <li><code>GET /api/vendedores</code></li>
        <li><code>GET /api/ventas</code></li>
        <li><code>GET /api/errores</code></li>
      </ul>
      <p style="margin-top: 25px; font-size: 0.9em; color: #666;">© ${new Date().getFullYear()} Gestión de Ventas – Oracle Cloud</p>
    </main>
  `);
});

// Escuchar en todas las interfaces de red
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor en ejecución en http://0.0.0.0:${PORT}`);
});

