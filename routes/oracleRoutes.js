import express from 'express';
import oracledb from 'oracledb';
import { getConnection } from '../db/connection.js';

const router = express.Router();

/* ============================================================
   HELPERS
   ============================================================ */

function sendInternalError(res, message, err) {
  console.error(message, err);

  return res.status(500).json({
    error: message,
  });
}

async function closeConnection(conn) {
  if (!conn) return;

  try {
    await conn.close();
  } catch (err) {
    console.error('Error cerrando conexión Oracle:', err);
  }
}

function parseYear(value) {
  const year = Number(value);

  if (!Number.isInteger(year) || year < 1900 || year > 2100) {
    return null;
  }

  return year;
}

function normalizeRut(value) {
  return String(value ?? '')
    .replace(/\./g, '')
    .replace(/\s/g, '')
    .toUpperCase();
}

function isValidRut(rut) {
  const normalized = normalizeRut(rut);
  const match = normalized.match(/^(\d{7,8})-([\dK])$/);

  if (!match) return false;

  const body = match[1];
  const verifier = match[2];

  let sum = 0;
  let multiplier = 2;

  for (let i = body.length - 1; i >= 0; i--) {
    sum += Number(body[i]) * multiplier;
    multiplier = multiplier === 7 ? 2 : multiplier + 1;
  }

  const result = 11 - (sum % 11);

  let expected;

  if (result === 11) {
    expected = '0';
  } else if (result === 10) {
    expected = 'K';
  } else {
    expected = String(result);
  }

  return verifier === expected;
}

/*
 * Las mutaciones quedan BLOQUEADAS por defecto.
 *
 * Producción:
 * DEMO_READ_ONLY=true
 *
 * Desarrollo:
 * DEMO_READ_ONLY=false
 *
 * Si NODE_ENV=production y se habilitan mutaciones,
 * ADMIN_API_KEY pasa a ser obligatorio.
 */
function requireMutationAccess(req, res, next) {
  const readOnly = process.env.DEMO_READ_ONLY !== 'false';

  if (readOnly) {
    return res.status(403).json({
      error: 'Esta operación está deshabilitada en la demo pública.',
      demoReadOnly: true,
    });
  }

  const configuredKey = process.env.ADMIN_API_KEY;
  const suppliedKey = req.get('x-admin-key');

  if (process.env.NODE_ENV === 'production') {
    if (!configuredKey) {
      console.error(
        'ADMIN_API_KEY no está configurada y DEMO_READ_ONLY está deshabilitado.'
      );

      return res.status(503).json({
        error: 'Las operaciones administrativas no están disponibles.',
      });
    }

    if (suppliedKey !== configuredKey) {
      return res.status(401).json({
        error: 'No autorizado.',
      });
    }
  }

  next();
}


/* ============================================================
   DASHBOARD
   ============================================================ */

router.get('/dashboard', async (req, res) => {
  let conn;

  try {
    conn = await getConnection();

    let anio = req.query.anio ? parseYear(req.query.anio) : null;

    if (req.query.anio && !anio) {
      return res.status(400).json({
        error: 'El año indicado no es válido.',
      });
    }

    /*
     * Si no se indicó año, se usa el año más reciente
     * existente entre boletas y facturas.
     */
    if (!anio) {
      const ultimoAnioResult = await conn.execute(`
        SELECT MAX(anio) AS anio
        FROM (
          SELECT EXTRACT(YEAR FROM fecha) AS anio
          FROM boleta
          WHERE fecha IS NOT NULL

          UNION ALL

          SELECT EXTRACT(YEAR FROM fecha) AS anio
          FROM factura
          WHERE fecha IS NOT NULL
        )
      `);

      anio = ultimoAnioResult.rows[0]?.ANIO ?? new Date().getFullYear();
    }

    const boletas = await conn.execute(
      `
      SELECT
        COUNT(*) AS cantidad,
        NVL(SUM(total), 0) AS total,
        NVL(AVG(total), 0) AS ticket_promedio
      FROM boleta
      WHERE EXTRACT(YEAR FROM fecha) = :anio
      `,
      { anio }
    );

    const facturas = await conn.execute(
      `
      SELECT
        COUNT(*) AS cantidad,
        NVL(SUM(total), 0) AS total,
        NVL(AVG(total), 0) AS ticket_promedio
      FROM factura
      WHERE EXTRACT(YEAR FROM fecha) = :anio
      `,
      { anio }
    );

    const clientes = await conn.execute(`
      SELECT COUNT(*) AS cantidad
      FROM cliente
      WHERE estado = 'A'
    `);

    const vendedores = await conn.execute(`
      SELECT COUNT(*) AS cantidad
      FROM vendedor
    `);

    const productos = await conn.execute(`
      SELECT
        COUNT(*) AS cantidad,
        COUNT(
          CASE
            WHEN totalstock IS NOT NULL
            THEN 1
          END
        ) AS con_stock_informado,
        COUNT(
          CASE
            WHEN totalstock IS NOT NULL
             AND stkseguridad IS NOT NULL
             AND totalstock <= stkseguridad
            THEN 1
          END
        ) AS stock_critico
      FROM producto
    `);

    const errores = await conn.execute(`
      SELECT COUNT(*) AS cantidad
      FROM error_procesos_mensuales
    `);

    const porMes = await conn.execute(
      `
      SELECT
        mes,
        SUM(boletas_cantidad) AS boletas_cantidad,
        SUM(boletas_total) AS boletas_total,
        SUM(facturas_cantidad) AS facturas_cantidad,
        SUM(facturas_total) AS facturas_total
      FROM (
        SELECT
          EXTRACT(MONTH FROM fecha) AS mes,
          COUNT(*) AS boletas_cantidad,
          NVL(SUM(total), 0) AS boletas_total,
          0 AS facturas_cantidad,
          0 AS facturas_total
        FROM boleta
        WHERE EXTRACT(YEAR FROM fecha) = :anio
        GROUP BY EXTRACT(MONTH FROM fecha)

        UNION ALL

        SELECT
          EXTRACT(MONTH FROM fecha) AS mes,
          0 AS boletas_cantidad,
          0 AS boletas_total,
          COUNT(*) AS facturas_cantidad,
          NVL(SUM(total), 0) AS facturas_total
        FROM factura
        WHERE EXTRACT(YEAR FROM fecha) = :anio
        GROUP BY EXTRACT(MONTH FROM fecha)
      )
      GROUP BY mes
      ORDER BY mes
      `,
      { anio }
    );

    const porVendedor = await conn.execute(
      `
      SELECT
        rutvendedor,
        nombre,

        SUM(
          CASE
            WHEN tipo = 'BOLETA'
            THEN 1
            ELSE 0
          END
        ) AS boletas_documentos,

        SUM(
          CASE
            WHEN tipo = 'BOLETA'
            THEN total
            ELSE 0
          END
        ) AS boletas_total,

        SUM(
          CASE
            WHEN tipo = 'FACTURA'
            THEN 1
            ELSE 0
          END
        ) AS facturas_documentos,

        SUM(
          CASE
            WHEN tipo = 'FACTURA'
            THEN total
            ELSE 0
          END
        ) AS facturas_total,

        SUM(total) AS total_documentado

      FROM (
        SELECT
          'BOLETA' AS tipo,
          b.rutvendedor,
          v.nombre,
          b.total
        FROM boleta b

        LEFT JOIN vendedor v
          ON v.rutvendedor = b.rutvendedor

        WHERE EXTRACT(YEAR FROM b.fecha) = :anio

        UNION ALL

        SELECT
          'FACTURA' AS tipo,
          f.rutvendedor,
          v.nombre,
          f.total
        FROM factura f

        LEFT JOIN vendedor v
          ON v.rutvendedor = f.rutvendedor

        WHERE EXTRACT(YEAR FROM f.fecha) = :anio
      )

      GROUP BY
        rutvendedor,
        nombre

      ORDER BY
        total_documentado DESC
      `,
      { anio }
    );

    const estados = await conn.execute(
      `
      SELECT
        tipo,
        estado,
        COUNT(*) AS cantidad,
        NVL(SUM(total), 0) AS total
      FROM (
        SELECT
          'BOLETA' AS tipo,
          estado,
          total
        FROM boleta
        WHERE EXTRACT(YEAR FROM fecha) = :anio

        UNION ALL

        SELECT
          'FACTURA' AS tipo,
          estado,
          total
        FROM factura
        WHERE EXTRACT(YEAR FROM fecha) = :anio
      )
      GROUP BY tipo, estado
      ORDER BY tipo, estado
      `,
      { anio }
    );

    res.json({
      periodo: {
        anio,
      },

      documentos: {
        boletas: boletas.rows[0],
        facturas: facturas.rows[0],
      },

      entidades: {
        clientesActivos: clientes.rows[0]?.CANTIDAD ?? 0,
        vendedores: vendedores.rows[0]?.CANTIDAD ?? 0,
        productos: productos.rows[0]?.CANTIDAD ?? 0,
        productosConStockInformado:
          productos.rows[0]?.CON_STOCK_INFORMADO ?? 0,
        stockCritico: productos.rows[0]?.STOCK_CRITICO ?? 0,
        errores: errores.rows[0]?.CANTIDAD ?? 0,
      },

      series: {
        porMes: porMes.rows,
        porVendedor: porVendedor.rows,
        estados: estados.rows,
      },
    });
  } catch (err) {
    return sendInternalError(
      res,
      'No fue posible obtener el resumen general.',
      err
    );
  } finally {
    await closeConnection(conn);
  }
});


/* ============================================================
   VENTAS
   ============================================================ */

/*
 * Vista lógica unificada.
 *
 * NO existe una tabla VENTA.
 * Se combinan BOLETA y FACTURA manteniendo explícitamente
 * el tipo de documento.
 */
router.get('/ventas', async (req, res) => {
  let conn;

  try {
    conn = await getConnection();

    const result = await conn.execute(`
      SELECT *
      FROM (
        SELECT
          'BOLETA' AS tipo,
          b.numboleta AS numero,
          b.rutcliente,
          c.nombre AS cliente,
          b.rutvendedor,
          v.nombre AS vendedor,
          b.fecha,
          b.total,
          b.estado,
          fp.descripcion AS forma_pago,
          ba.descripcion AS banco
        FROM boleta b
        LEFT JOIN cliente c
          ON c.rutcliente = b.rutcliente
        LEFT JOIN vendedor v
          ON v.rutvendedor = b.rutvendedor
        LEFT JOIN forma_pago fp
          ON fp.codpago = b.codpago
        LEFT JOIN banco ba
          ON ba.codbanco = b.codbanco

        UNION ALL

        SELECT
          'FACTURA' AS tipo,
          f.numfactura AS numero,
          f.rutcliente,
          c.nombre AS cliente,
          f.rutvendedor,
          v.nombre AS vendedor,
          f.fecha,
          f.total,
          f.estado,
          fp.descripcion AS forma_pago,
          ba.descripcion AS banco
        FROM factura f
        LEFT JOIN cliente c
          ON c.rutcliente = f.rutcliente
        LEFT JOIN vendedor v
          ON v.rutvendedor = f.rutvendedor
        LEFT JOIN forma_pago fp
          ON fp.codpago = f.codpago
        LEFT JOIN banco ba
          ON ba.codbanco = f.codbanco
      )
      ORDER BY fecha DESC
      FETCH FIRST 200 ROWS ONLY
    `);

    res.json(result.rows);
  } catch (err) {
    return sendInternalError(
      res,
      'No fue posible obtener los documentos comerciales.',
      err
    );
  } finally {
    await closeConnection(conn);
  }
});


/* ============================================================
   DETALLE DE BOLETA
   ============================================================ */

router.get('/ventas/boleta/:numero', async (req, res) => {
  const numero = Number(req.params.numero);

  if (!Number.isInteger(numero) || numero <= 0) {
    return res.status(400).json({
      error: 'Número de boleta inválido.',
    });
  }

  let conn;

  try {
    conn = await getConnection();

    const cabecera = await conn.execute(
      `
      SELECT
        b.numboleta,
        b.fecha,
        b.total,
        b.estado,
        b.num_docto_pago,

        c.rutcliente,
        c.nombre AS cliente,
        c.mail AS cliente_mail,
        c.telefono AS cliente_telefono,

        v.rutvendedor,
        v.nombre AS vendedor,

        fp.descripcion AS forma_pago,
        ba.descripcion AS banco

      FROM boleta b

      LEFT JOIN cliente c
        ON c.rutcliente = b.rutcliente

      LEFT JOIN vendedor v
        ON v.rutvendedor = b.rutvendedor

      LEFT JOIN forma_pago fp
        ON fp.codpago = b.codpago

      LEFT JOIN banco ba
        ON ba.codbanco = b.codbanco

      WHERE b.numboleta = :numero
      `,
      { numero }
    );

    if (!cabecera.rows.length) {
      return res.status(404).json({
        error: 'Boleta no encontrada.',
      });
    }

    const detalle = await conn.execute(
      `
      SELECT
        d.codproducto,
        p.descripcion AS producto,
        d.cantidad,
        d.vunitario,
        d.codpromocion,
        d.descri_prom,
        d.descuento,
        d.totallinea
      FROM detalle_boleta d
      INNER JOIN producto p
        ON p.codproducto = d.codproducto
      WHERE d.numboleta = :numero
      ORDER BY p.descripcion
      `,
      { numero }
    );

    res.json({
      tipo: 'BOLETA',
      documento: cabecera.rows[0],
      items: detalle.rows,
    });
  } catch (err) {
    return sendInternalError(
      res,
      'No fue posible obtener el detalle de la boleta.',
      err
    );
  } finally {
    await closeConnection(conn);
  }
});


/* ============================================================
   DETALLE DE FACTURA
   ============================================================ */

router.get('/ventas/factura/:numero', async (req, res) => {
  const numero = Number(req.params.numero);

  if (!Number.isInteger(numero) || numero <= 0) {
    return res.status(400).json({
      error: 'Número de factura inválido.',
    });
  }

  let conn;

  try {
    conn = await getConnection();

    const cabecera = await conn.execute(
      `
      SELECT
        f.numfactura,
        f.fecha,
        f.f_vencimiento,
        f.neto,
        f.iva,
        f.total,
        f.estado,
        f.num_docto_pago,

        c.rutcliente,
        c.nombre AS cliente,
        c.mail AS cliente_mail,
        c.telefono AS cliente_telefono,

        v.rutvendedor,
        v.nombre AS vendedor,

        fp.descripcion AS forma_pago,
        ba.descripcion AS banco

      FROM factura f

      LEFT JOIN cliente c
        ON c.rutcliente = f.rutcliente

      LEFT JOIN vendedor v
        ON v.rutvendedor = f.rutvendedor

      LEFT JOIN forma_pago fp
        ON fp.codpago = f.codpago

      LEFT JOIN banco ba
        ON ba.codbanco = f.codbanco

      WHERE f.numfactura = :numero
      `,
      { numero }
    );

    if (!cabecera.rows.length) {
      return res.status(404).json({
        error: 'Factura no encontrada.',
      });
    }

    const detalle = await conn.execute(
      `
      SELECT
        d.codproducto,
        p.descripcion AS producto,
        d.cantidad,
        d.vunitario,
        d.codpromocion,
        d.descri_prom,
        d.descuento,
        d.totallinea
      FROM detalle_factura d
      INNER JOIN producto p
        ON p.codproducto = d.codproducto
      WHERE d.numfactura = :numero
      ORDER BY p.descripcion
      `,
      { numero }
    );

    res.json({
      tipo: 'FACTURA',
      documento: cabecera.rows[0],
      items: detalle.rows,
    });
  } catch (err) {
    return sendInternalError(
      res,
      'No fue posible obtener el detalle de la factura.',
      err
    );
  } finally {
    await closeConnection(conn);
  }
});


/* ============================================================
   ENDPOINTS ORIGINALES DE BOLETAS / FACTURAS
   ============================================================ */

router.get('/boletas', async (req, res) => {
  let conn;

  try {
    conn = await getConnection();

    const result = await conn.execute(`
      SELECT
        numboleta,
        rutcliente,
        rutvendedor,
        fecha,
        total,
        estado
      FROM boleta
      ORDER BY fecha DESC
      FETCH FIRST 100 ROWS ONLY
    `);

    res.json(result.rows);
  } catch (err) {
    return sendInternalError(
      res,
      'No fue posible obtener las boletas.',
      err
    );
  } finally {
    await closeConnection(conn);
  }
});

router.get('/facturas', async (req, res) => {
  let conn;

  try {
    conn = await getConnection();

    const result = await conn.execute(`
      SELECT
        numfactura,
        rutcliente,
        rutvendedor,
        fecha,
        f_vencimiento,
        neto,
        iva,
        total,
        estado
      FROM factura
      ORDER BY fecha DESC
      FETCH FIRST 100 ROWS ONLY
    `);

    res.json(result.rows);
  } catch (err) {
    return sendInternalError(
      res,
      'No fue posible obtener las facturas.',
      err
    );
  } finally {
    await closeConnection(conn);
  }
});


/* ============================================================
   VENDEDORES
   ============================================================ */

router.get('/vendedores', async (req, res) => {
  let conn;

  try {
    conn = await getConnection();

    const result = await conn.execute(`
      SELECT
        v.rutvendedor,
        v.nombre,
        v.mail,
        v.telefono,
        v.sueldo_base,
        v.comision,
        v.hora_inicio,
        v.hora_termino,
        v.fecha_nac,
        c.descripcion AS comuna
      FROM vendedor v
      LEFT JOIN comuna c
        ON c.codcomuna = v.codcomuna
      ORDER BY v.nombre
    `);

    res.json(result.rows);
  } catch (err) {
    return sendInternalError(
      res,
      'No fue posible obtener los vendedores.',
      err
    );
  } finally {
    await closeConnection(conn);
  }
});


router.get('/vendedores/:rut', async (req, res) => {
  const rut = normalizeRut(req.params.rut);

  let conn;

  try {
    conn = await getConnection();

    const vendedor = await conn.execute(
      `
      SELECT
        v.rutvendedor,
        v.nombre,
        v.direccion,
        v.telefono,
        v.mail,
        v.sueldo_base,
        v.comision,
        v.hora_inicio,
        v.hora_termino,
        v.fecha_nac,
        c.descripcion AS comuna
      FROM vendedor v
      LEFT JOIN comuna c
        ON c.codcomuna = v.codcomuna
      WHERE v.rutvendedor = :rut
      `,
      { rut }
    );

    if (!vendedor.rows.length) {
      return res.status(404).json({
        error: 'Vendedor no encontrado.',
      });
    }

    const documentos = await conn.execute(
      `
      SELECT *
      FROM (
        SELECT
          'BOLETA' AS tipo,
          numboleta AS numero,
          fecha,
          total,
          estado,
          rutcliente
        FROM boleta
        WHERE rutvendedor = :rut

        UNION ALL

        SELECT
          'FACTURA' AS tipo,
          numfactura AS numero,
          fecha,
          total,
          estado,
          rutcliente
        FROM factura
        WHERE rutvendedor = :rut
      )
      ORDER BY fecha DESC
      `,
      { rut }
    );

    const informes = await conn.execute(
      `
      SELECT
        anio,
        rutvendedor,
        nomvendedor,
        comuna,
        sueldo_base,
        aporte_ventas
      FROM porcentaje_vendedor
      WHERE rutvendedor = :rut
      ORDER BY anio DESC
      `,
      { rut }
    );

    const bitacora = await conn.execute(
      `
      SELECT
        id_bitacora,
        rutvendedor,
        anterior,
        actual,
        variacion
      FROM bitacora
      WHERE rutvendedor = :rut
      ORDER BY id_bitacora DESC
      `,
      { rut }
    );

    res.json({
      vendedor: vendedor.rows[0],
      documentos: documentos.rows,
      informes: informes.rows,
      bitacora: bitacora.rows,
    });
  } catch (err) {
    return sendInternalError(
      res,
      'No fue posible obtener el vendedor.',
      err
    );
  } finally {
    await closeConnection(conn);
  }
});


/* ============================================================
   CLIENTES
   ============================================================ */

router.get('/clientes', async (req, res) => {
  let conn;

  try {
    conn = await getConnection();

    const result = await conn.execute(`
      SELECT
        c.rutcliente,
        c.nombre,
        c.mail,
        c.telefono,
        c.credito,
        c.saldo,
        c.estado,
        c.fecha_carga,
        co.descripcion AS comuna,

        CASE
          WHEN c.credito IS NULL THEN NULL
          ELSE c.credito - NVL(c.saldo, 0)
        END AS credito_disponible,

        CASE
          WHEN NVL(c.credito, 0) = 0 THEN 0
          ELSE ROUND(
            (NVL(c.saldo, 0) / c.credito) * 100,
            2
          )
        END AS uso_credito_porcentaje

      FROM cliente c

      LEFT JOIN comuna co
        ON co.codcomuna = c.codcomuna

      WHERE c.estado = 'A'

      ORDER BY c.nombre
    `);

    res.json(result.rows);
  } catch (err) {
    return sendInternalError(
      res,
      'No fue posible obtener los clientes.',
      err
    );
  } finally {
    await closeConnection(conn);
  }
});


router.get('/clientes/:rut', async (req, res) => {
  const rut = normalizeRut(req.params.rut);

  let conn;

  try {
    conn = await getConnection();

    const cliente = await conn.execute(
      `
      SELECT
        c.rutcliente,
        c.nombre,
        c.direccion,
        c.telefono,
        c.estado,
        c.mail,
        c.credito,
        c.saldo,
        c.fecha_carga,
        co.descripcion AS comuna,

        CASE
          WHEN c.credito IS NULL THEN NULL
          ELSE c.credito - NVL(c.saldo, 0)
        END AS credito_disponible,

        CASE
          WHEN NVL(c.credito, 0) = 0 THEN 0
          ELSE ROUND(
            (NVL(c.saldo, 0) / c.credito) * 100,
            2
          )
        END AS uso_credito_porcentaje

      FROM cliente c

      LEFT JOIN comuna co
        ON co.codcomuna = c.codcomuna

      WHERE c.rutcliente = :rut
      `,
      { rut }
    );

    if (!cliente.rows.length) {
      return res.status(404).json({
        error: 'Cliente no encontrado.',
      });
    }

    const documentos = await conn.execute(
      `
      SELECT *
      FROM (
        SELECT
          'BOLETA' AS tipo,
          numboleta AS numero,
          fecha,
          total,
          estado,
          rutvendedor
        FROM boleta
        WHERE rutcliente = :rut

        UNION ALL

        SELECT
          'FACTURA' AS tipo,
          numfactura AS numero,
          fecha,
          total,
          estado,
          rutvendedor
        FROM factura
        WHERE rutcliente = :rut
      )
      ORDER BY fecha DESC
      `,
      { rut }
    );

    res.json({
      cliente: cliente.rows[0],
      documentos: documentos.rows,
    });
  } catch (err) {
    return sendInternalError(
      res,
      'No fue posible obtener el cliente.',
      err
    );
  } finally {
    await closeConnection(conn);
  }
});


/* ============================================================
   PRODUCTOS / INVENTARIO
   ============================================================ */

router.get('/productos', async (req, res) => {
  let conn;

  try {
    conn = await getConnection();

    const result = await conn.execute(`
      SELECT
        p.codproducto,
        p.descripcion,
        p.codcategoria,

        p.vunitario,
        p.valorcomprapeso,
        p.valorcompradolar,

        p.totalstock,
        p.stkseguridad,

        u.descripcion AS unidad,
        pa.nompais AS pais,

        p.procedencia,
        p.codproducto_rel,

        pr.descripcion AS producto_relacionado,

        CASE
          WHEN p.totalstock IS NULL
            THEN 'SIN_STOCK_INFORMADO'

          WHEN p.stkseguridad IS NOT NULL
           AND p.totalstock <= p.stkseguridad
            THEN 'CRITICO'

          ELSE 'OK'
        END AS estado_stock,

        CASE
          WHEN p.vunitario IS NULL
            OR p.valorcomprapeso IS NULL
            THEN NULL

          ELSE p.vunitario - p.valorcomprapeso
        END AS margen_unitario_referencia,

        CASE
          WHEN p.totalstock IS NULL
            OR p.vunitario IS NULL
            THEN NULL

          ELSE p.totalstock * p.vunitario
        END AS valor_stock_venta

      FROM producto p

      LEFT JOIN unidad_medida u
        ON u.codunidad = p.codunidad

      LEFT JOIN pais pa
        ON pa.codpais = p.codpais

      LEFT JOIN producto pr
        ON pr.codproducto = p.codproducto_rel

      ORDER BY p.descripcion
    `);

    res.json(result.rows);
  } catch (err) {
    return sendInternalError(
      res,
      'No fue posible obtener el inventario.',
      err
    );
  } finally {
    await closeConnection(conn);
  }
});


router.get('/productos/:codigo', async (req, res) => {
  const codigo = Number(req.params.codigo);

  if (!Number.isInteger(codigo) || codigo <= 0) {
    return res.status(400).json({
      error: 'Código de producto inválido.',
    });
  }

  let conn;

  try {
    conn = await getConnection();

    const producto = await conn.execute(
      `
      SELECT
        p.codproducto,
        p.descripcion,
        p.codcategoria,

        p.vunitario,
        p.valorcomprapeso,
        p.valorcompradolar,

        p.totalstock,
        p.stkseguridad,

        u.descripcion AS unidad,
        pa.nompais AS pais,

        p.procedencia,
        p.codproducto_rel,

        pr.descripcion AS producto_relacionado,

        CASE
          WHEN p.totalstock IS NULL
            THEN 'SIN_STOCK_INFORMADO'

          WHEN p.stkseguridad IS NOT NULL
           AND p.totalstock <= p.stkseguridad
            THEN 'CRITICO'

          ELSE 'OK'
        END AS estado_stock,

        CASE
          WHEN p.vunitario IS NULL
            OR p.valorcomprapeso IS NULL
            THEN NULL

          ELSE p.vunitario - p.valorcomprapeso
        END AS margen_unitario_referencia

      FROM producto p

      LEFT JOIN unidad_medida u
        ON u.codunidad = p.codunidad

      LEFT JOIN pais pa
        ON pa.codpais = p.codpais

      LEFT JOIN producto pr
        ON pr.codproducto = p.codproducto_rel

      WHERE p.codproducto = :codigo
      `,
      { codigo }
    );

    if (!producto.rows.length) {
      return res.status(404).json({
        error: 'Producto no encontrado.',
      });
    }

    const promociones = await conn.execute(
      `
      SELECT
        codpromocion,
        descri_prom,
        fecha_desde,
        fecha_hasta,
        codproducto,
        porc_dscto_prod,
        codproducto_rel
      FROM promocion
      WHERE codproducto = :codigo
         OR codproducto_rel = :codigo
      ORDER BY fecha_desde DESC
      `,
      { codigo }
    );

    res.json({
      producto: producto.rows[0],
      promociones: promociones.rows,
    });
  } catch (err) {
    return sendInternalError(
      res,
      'No fue posible obtener el producto.',
      err
    );
  } finally {
    await closeConnection(conn);
  }
});


/* ============================================================
   REPORTES DE VENDEDORES
   ============================================================ */

async function getReportes(req, res) {
  let conn;

  try {
    conn = await getConnection();

    const result = await conn.execute(`
      SELECT
        anio,
        rutvendedor,
        nomvendedor,
        comuna,
        sueldo_base,
        aporte_ventas
      FROM porcentaje_vendedor
      ORDER BY anio DESC, aporte_ventas DESC
    `);

    res.json(result.rows);
  } catch (err) {
    return sendInternalError(
      res,
      'No fue posible obtener los reportes.',
      err
    );
  } finally {
    await closeConnection(conn);
  }
}

router.get('/reportes', getReportes);

/*
 * Compatibilidad temporal con el frontend anterior.
 */
router.get('/porcentaje-vendedor', getReportes);


router.get('/reportes/:anio', async (req, res) => {
  const anio = parseYear(req.params.anio);

  if (!anio) {
    return res.status(400).json({
      error: 'El año indicado no es válido.',
    });
  }

  let conn;

  try {
    conn = await getConnection();

    const result = await conn.execute(
      `
      SELECT
        anio,
        rutvendedor,
        nomvendedor,
        comuna,
        sueldo_base,
        aporte_ventas
      FROM porcentaje_vendedor
      WHERE anio = :anio
      ORDER BY aporte_ventas DESC
      `,
      { anio }
    );

    res.json(result.rows);
  } catch (err) {
    return sendInternalError(
      res,
      'No fue posible obtener el reporte.',
      err
    );
  } finally {
    await closeConnection(conn);
  }
});


async function generarInforme(req, res) {
  const anio = parseYear(req.params.anio);

  if (!anio) {
    return res.status(400).json({
      error: 'El año indicado no es válido.',
    });
  }

  let conn;

  try {
    conn = await getConnection();

    await conn.execute(
      `
      BEGIN
        PKG_REPUESTOS_CAR.G_ANIO_PROCESO := :anio;
        GENERAR_INFORME_PORCENTAJE_VENDEDOR;
      END;
      `,
      {
        anio: {
          val: anio,
          dir: oracledb.BIND_IN,
          type: oracledb.NUMBER,
        },
      }
    );

    await conn.commit();

    res.json({
      mensaje: 'Informe generado correctamente.',
      anio,
    });
  } catch (err) {
    return sendInternalError(
      res,
      'No fue posible generar el informe.',
      err
    );
  } finally {
    await closeConnection(conn);
  }
}

router.post(
  '/reportes/:anio/generar',
  requireMutationAccess,
  generarInforme
);

/*
 * Compatibilidad nominal con la ruta antigua,
 * pero ahora correctamente mediante POST.
 */
router.post(
  '/generar-informe/:anio',
  requireMutationAccess,
  generarInforme
);


/* ============================================================
   BITÁCORA
   ============================================================ */

router.get('/bitacora', async (req, res) => {
  let conn;

  try {
    conn = await getConnection();

    const result = await conn.execute(`
      SELECT
        b.id_bitacora,
        b.rutvendedor,
        v.nombre AS vendedor,
        b.anterior,
        b.actual,
        b.variacion
      FROM bitacora b
      LEFT JOIN vendedor v
        ON v.rutvendedor = b.rutvendedor
      ORDER BY b.id_bitacora DESC
    `);

    res.json(result.rows);
  } catch (err) {
    return sendInternalError(
      res,
      'No fue posible obtener la bitácora.',
      err
    );
  } finally {
    await closeConnection(conn);
  }
});


/* ============================================================
   ERRORES PL/SQL
   ============================================================ */

router.get('/errores', async (req, res) => {
  let conn;

  try {
    conn = await getConnection();

    const result = await conn.execute(`
      SELECT
        correl_error,
        rutina_error,
        descrip_error
      FROM error_procesos_mensuales
      ORDER BY correl_error DESC
    `);

    res.json(result.rows);
  } catch (err) {
    return sendInternalError(
      res,
      'No fue posible obtener los errores registrados.',
      err
    );
  } finally {
    await closeConnection(conn);
  }
});


/* ============================================================
   ACTUALIZACIÓN DE SUELDO
   ============================================================ */

router.put(
  '/vendedor/:rut/sueldo',
  requireMutationAccess,
  async (req, res) => {
    const rut = normalizeRut(req.params.rut);
    const nuevoSueldo = Number(req.body?.sueldo_base);

    if (!isValidRut(rut)) {
      return res.status(400).json({
        error: 'El RUT indicado no es válido.',
      });
    }

    /*
     * SUELDO_BASE es NUMBER(8), por lo tanto no aceptamos
     * valores superiores a 8 dígitos.
     *
     * No usamos RANGOS_SUELDOS como validación porque
     * esa tabla no representa actualmente una regla confiable.
     */
    if (
      !Number.isInteger(nuevoSueldo) ||
      nuevoSueldo <= 0 ||
      nuevoSueldo > 99_999_999
    ) {
      return res.status(400).json({
        error: 'Debe enviar un sueldo entero mayor a cero y válido.',
      });
    }

    let conn;

    try {
      conn = await getConnection();

      const result = await conn.execute(
        `
        UPDATE vendedor
        SET sueldo_base = :nuevo
        WHERE rutvendedor = :rut
        `,
        {
          nuevo: nuevoSueldo,
          rut,
        }
      );

      if (result.rowsAffected === 0) {
        await conn.rollback();

        return res.status(404).json({
          error: 'Vendedor no encontrado.',
        });
      }

      await conn.commit();

      res.json({
        mensaje: 'Sueldo actualizado correctamente.',
        rut,
        nuevoSueldo,
      });
    } catch (err) {
      if (conn) {
        try {
          await conn.rollback();
        } catch (rollbackError) {
          console.error('Error ejecutando rollback:', rollbackError);
        }
      }

      return sendInternalError(
        res,
        'No fue posible actualizar el sueldo.',
        err
      );
    } finally {
      await closeConnection(conn);
    }
  }
);


export default router;