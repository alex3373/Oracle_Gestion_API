import app from './app.js';
import dotenv from 'dotenv';

dotenv.config();

const PORT = process.env.PORT || 4000;

// Escuchar en todas las interfaces de red (permite acceso externo)
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor ejecutándose en http://0.0.0.0:${PORT}`);
});
