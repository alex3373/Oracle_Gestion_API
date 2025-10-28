import oracledb from "oracledb";
import dotenv from "dotenv";
import path from "path";

dotenv.config();

oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;

export async function getConnection() {
  try {
    const walletPath = path.resolve(process.env.DB_WALLET_DIR);

    console.log("Intentando conexión a Oracle (modo mTLS wallet)...");

    const connection = await oracledb.getConnection({
      user: process.env.DB_USER,
      password: process.env.DB_PASS,
      connectString: process.env.DB_CONNECT_STRING,
      configDir: walletPath,
      walletLocation: walletPath,
      walletPassword: process.env.DB_WALLET_PASSWORD
    });

    console.log("Conexión establecida correctamente");
    return connection;
  } catch (err) {
    console.error("Error al conectar con Oracle:", err);
    throw err;
  }
}
