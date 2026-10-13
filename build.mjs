// Arma la web publicada en la carpeta "dist".
// Cloudflare lo corre solo cada vez que Aime guarda un cambio en el editor.
// 1. Copia la página (carpeta "sitio").
// 2. Lee las fichas de "contenido/piezas" y los datos de "contenido/sitio.json".
// 3. Achica cada foto subida para que la web cargue rápido.
// 4. Escribe todo en "dist/datos.json", que es lo que lee la página.
// Si una ficha tiene un error, la saltea y sigue: nunca deja la web caída.

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";

const RAIZ = process.cwd();
const DIST = path.join(RAIZ, "dist");
const ORDEN_CATEGORIAS = ["tazas", "cuencos", "platos", "saleros", "luz-y-aromas", "juegos"];
const avisos = [];

async function existe(ruta) {
  try { await fs.access(ruta); return true; } catch { return false; }
}

async function leerJson(ruta, porDefecto) {
  try { return JSON.parse(await fs.readFile(ruta, "utf8")); }
  catch (e) { avisos.push(`No se pudo leer ${path.relative(RAIZ, ruta)}: ${e.message}`); return porDefecto; }
}

async function prepararFoto(rutaFoto, id) {
  if (!rutaFoto || typeof rutaFoto !== "string") return null;
  const relativa = decodeURIComponent(rutaFoto.split("?")[0]).replace(/^\/+/, "");
  const origen = path.join(RAIZ, relativa);
  if (!origen.startsWith(RAIZ) || !(await existe(origen))) {
    avisos.push(`La foto de "${id}" no se encontró (${rutaFoto}).`);
    return null;
  }
  try {
    const datos = await fs.readFile(origen);
    const huella = crypto.createHash("md5").update(datos).digest("hex").slice(0, 8);
    const nombre = `${id}-${huella}.jpg`;
    await sharp(datos)
      .rotate() // respeta la orientación de las fotos del celular
      .resize({ width: 1100, height: 1100, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 80, mozjpeg: true })
      .toFile(path.join(DIST, "fotos", nombre));
    return `fotos/${nombre}`;
  } catch (e) {
    avisos.push(`La foto de "${id}" no se pudo procesar: ${e.message}`);
    return null;
  }
}

async function main() {
  if (!(await existe(path.join(RAIZ, "sitio", "index.html")))) {
    throw new Error("Falta sitio/index.html");
  }
  await fs.rm(DIST, { recursive: true, force: true });
  await fs.cp(path.join(RAIZ, "sitio"), DIST, { recursive: true });
  await fs.mkdir(path.join(DIST, "fotos"), { recursive: true });

  const carpeta = path.join(RAIZ, "contenido", "piezas");
  const archivos = (await existe(carpeta)) ? (await fs.readdir(carpeta)).filter((f) => f.endsWith(".json")) : [];
  const piezas = [];
  for (const archivo of archivos) {
    const id = archivo.replace(/\.json$/, "");
    const ficha = await leerJson(path.join(carpeta, archivo), null);
    if (!ficha || typeof ficha !== "object") continue;
    if (!ficha.nombre) { avisos.push(`"${archivo}" no tiene nombre: no se publica.`); continue; }
    if (ficha.publicada === false) continue;
    piezas.push({
      id,
      nombre: String(ficha.nombre).trim(),
      precio: Number(ficha.precio) || 0,
      categoria: ficha.categoria || "tazas",
      estado: ficha.estado || "disponible",
      esmaltes: Array.isArray(ficha.esmaltes) ? ficha.esmaltes : (ficha.esmaltes ? [ficha.esmaltes] : []),
      descripcion: ficha.descripcion || "",
      medidas: ficha.medidas || "",
      cuidados: ficha.cuidados || "",
      destacada: !!ficha.destacada,
      foto: await prepararFoto(ficha.foto, id),
    });
  }

  piezas.sort((a, b) => {
    const ca = ORDEN_CATEGORIAS.indexOf(a.categoria), cb = ORDEN_CATEGORIAS.indexOf(b.categoria);
    return (ca - cb) || a.nombre.localeCompare(b.nombre, "es");
  });

  const sitio = await leerJson(path.join(RAIZ, "contenido", "sitio.json"), {});
  await fs.writeFile(path.join(DIST, "datos.json"), JSON.stringify({ piezas, sitio, generado: new Date().toISOString() }));
  // Que el navegador siempre pida los datos nuevos
  await fs.writeFile(path.join(DIST, "_headers"), "/datos.json\n  Cache-Control: no-cache\n/\n  Cache-Control: no-cache\n");

  console.log(`Web armada: ${piezas.length} piezas publicadas.`);
  for (const a of avisos) console.warn("Aviso:", a);
}

main().catch((e) => { console.error("Error al armar la web:", e.message); process.exit(1); });
