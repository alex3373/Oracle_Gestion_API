import 'dotenv/config';
import app from './app.js';

const PORT = Number(process.env.PORT) || 4000;

const server = app.listen(
  PORT,
  '0.0.0.0',
  () => {
    console.log('');
    console.log('==========================================');
    console.log(' Gestión Comercial Oracle API');
    console.log('==========================================');
    console.log(`Puerto: ${PORT}`);
    console.log(
      `Entorno: ${process.env.NODE_ENV ?? 'development'}`
    );
    console.log(
      `Demo read-only: ${
        process.env.DEMO_READ_ONLY !== 'false'
      }`
    );
    console.log('==========================================');
    console.log('');
  }
);


function shutdown(signal) {
  console.log(`${signal} recibido. Cerrando servidor...`);

  server.close(() => {
    console.log('Servidor HTTP cerrado.');
    process.exit(0);
  });

  setTimeout(() => {
    console.error(
      'Cierre forzado después del timeout.'
    );

    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));