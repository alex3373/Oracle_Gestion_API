import express from 'express';import cors from 'cors';
import oracleRouter from './routes/oracleRoutes.js';

const app = express();

// CORS: permite localhost, ngrok, Firebase Hosting, etc.
app.use(
  cors({
    origin: [
      'http://localhost:3000',
      /\.ngrok-free\.app$/,
      /\.web\.app$/,
      /\.firebaseapp\.com$/,
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  })
);

// Middleware para parsear JSON
app.use(express.json());

// Endpoint raíz
app.get('/', (req, res) => {
  res.send('Servidor Oracle API activo 🚀');
});

// Prefijo API
app.use('/api', oracleRouter);

export default app;
