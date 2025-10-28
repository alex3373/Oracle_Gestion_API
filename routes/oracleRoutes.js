import express from 'express';
import oracledb from 'oracledb';
import { getConnection } from '../db/connection.js';

const router = express.Router();

/* ============================================================
   RUTAS ORIGINALES
   ============================================================ */

// Ejecutar procedimiento PL/SQL (genera informe)
router.get('/generar-informe/:anio', async (req, res) => {
  const anio = Number(req.params.anio);
  if (isNaN(anio)) {
    return res.status(400).send('El parámetro "anio" debe ser un número válido.');
  }

  let conn;
  try {
    conn = await getConnection();

    await conn.execute(
      `BEGIN
         PKG_REPUESTOS_CAR.G_ANIO_PROCESO := :anio;
         GENERAR_INFORME_PORCENTAJE_VENDEDOR;
       END;`,
      { anio: { val: anio, dir: oracledb.BIND_IN, type: oracledb.NUMBER } }
    );

    await conn.commit();

    res.send(`✅ Informe generado correctamente para el año ${anio}`);
  } catch (err) {
    console.error('❌ Error ejecutando PL/SQL:', err);
    res.status(500).send('Error ejecutando PL/SQL: ' + err.message);
  } finally {
    if (conn) await conn.close();
  }
});

// para onsultar resultados del informe
router.get('/porcentaje-vendedor', async (req, res) => {
  let conn;
  try {
    conn = await getConnection();
    const result = await conn.execute('SELECT * FROM PORCENTAJE_VENDEDOR');
    res.json(result.rows);
  } catch (err) {
    console.error('Error consultando PORCENTAJE_VENDEDOR:', err);
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) await conn.close();
  }
});

// Ver errores registrados
router.get('/errores', async (req, res) => {
  let conn;
  try {
    conn = await getConnection();
    const result = await conn.execute('SELECT * FROM ERROR_PROCESOS_MENSUALES');
    res.json(result.rows);
  } catch (err) {
    console.error('Error consultando ERROR_PROCESOS_MENSUALES:', err);
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) await conn.close();
  }
});


//  Listar todos los vendedores
router.get('/vendedores', async (req, res) => {
  let conn;
  try {
    conn = await getConnection();
    const result = await conn.execute(`
      SELECT rutvendedor, nombre, mail, sueldo_base, comision
      FROM vendedor
      ORDER BY nombre
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Error consultando VENDEDORES:', err);
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) await conn.close();
  }
});

// Listar clientes activos
router.get('/clientes', async (req, res) => {
  let conn;
  try {
    conn = await getConnection();
    const result = await conn.execute(`
      SELECT rutcliente, nombre, mail, telefono, credito, saldo
      FROM cliente
      WHERE estado = 'A'
      ORDER BY nombre
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Error consultando CLIENTES:', err);
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) await conn.close();
  }
});

//  Consultar boletas (últimas 100)
router.get('/boletas', async (req, res) => {
  let conn;
  try {
    conn = await getConnection();
    const result = await conn.execute(`
      SELECT numboleta, rutcliente, rutvendedor, fecha, total, estado
      FROM boleta
      ORDER BY fecha DESC FETCH FIRST 100 ROWS ONLY
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Error consultando BOLETAS:', err);
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) await conn.close();
  }
});

//  Consultar facturas (últimas 100)
router.get('/facturas', async (req, res) => {
  let conn;
  try {
    conn = await getConnection();
    const result = await conn.execute(`
      SELECT numfactura, rutcliente, rutvendedor, fecha, total, estado
      FROM factura
      ORDER BY fecha DESC FETCH FIRST 100 ROWS ONLY
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Error consultando FACTURAS:', err);
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) await conn.close();
  }
});

// Listar productos disponibles
router.get('/productos', async (req, res) => {
  let conn;
  try {
    conn = await getConnection();
    const result = await conn.execute(`
      SELECT codproducto, descripcion, vunitario, totalstock, stkseguridad
      FROM producto
      ORDER BY descripcion
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Error consultando PRODUCTOS:', err);
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) await conn.close();
  }
});

router.get('/bitacora', async (req, res) => {
  let conn;
  try {
    conn = await getConnection();
    const result = await conn.execute(`
      SELECT id_bitacora, rutvendedor, anterior, actual, variacion
      FROM bitacora
      ORDER BY id_bitacora DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Error consultando BITACORA:', err);
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) await conn.close();
  }
});



router.put('/vendedor/:rut/sueldo', async (req, res) => {
  const rut = req.params.rut;
  const nuevoSueldo = req.body.sueldo_base;

  if (!nuevoSueldo || isNaN(nuevoSueldo)) {
    return res.status(400).json({ error: 'Debes enviar un sueldo válido.' });
  }

  let conn;
  try {
    conn = await getConnection();
    await conn.execute(
      `
      UPDATE vendedor
      SET sueldo_base = :nuevo
      WHERE rutvendedor = :rut
      `,
      { nuevo: nuevoSueldo, rut },
      { autoCommit: true }
    );

    res.json({ mensaje: `Sueldo actualizado correctamente para ${rut}`, nuevoSueldo });
  } catch (err) {
    console.error('Error actualizando sueldo:', err);
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) await conn.close();
  }
});



export default router;
