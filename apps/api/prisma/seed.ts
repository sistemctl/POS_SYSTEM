/**
 * Datos iniciales para el servidor CENTRAL: roles, sucursal y caja de ejemplo, usuarios y productos.
 * Ejecutar: pnpm db:seed   (las tiendas reciben estos datos por sincronización)
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { createHash } from 'crypto';
import { newId, ROLES_PREDEFINIDOS } from '@pos/shared';

const prisma = new PrismaClient();

export const SUCURSAL_DEMO_ID = '01930000-0000-7000-8000-000000000001';
export const CAJA_DEMO_ID = '01930000-0000-7000-8000-000000000101';
const CAJA_DEMO_2_ID = '01930000-0000-7000-8000-000000000102';

async function main() {
  // Roles
  const roles: Record<string, string> = {};
  for (const r of ROLES_PREDEFINIDOS) {
    const existente = await prisma.rol.findUnique({ where: { codigo: r.codigo } });
    const data = {
      nombre: r.nombre,
      permisos: r.permisos,
      descuentoMaximo: r.descuentoMaximo,
      retiroMaximo: r.retiroMaximo,
    };
    const rol = existente
      ? await prisma.rol.update({ where: { id: existente.id }, data })
      : await prisma.rol.create({ data: { id: newId(), codigo: r.codigo, ...data } });
    roles[r.codigo] = rol.id;
  }

  // Sucursal y cajas
  await prisma.sucursal.upsert({
    where: { id: SUCURSAL_DEMO_ID },
    update: {},
    create: {
      id: SUCURSAL_DEMO_ID,
      codigo: 'S01',
      nombre: 'Sucursal Principal',
      direccion: 'Calle 10 # 5-23',
      pieTicket: '¡Gracias por su compra!\nConserve su recibo para cambios.',
    },
  });
  // Desarrollo: vincular la tienda demo con el token de .env.store
  if (process.env.SEED_SYNC_TOKEN) {
    await prisma.sucursal.update({
      where: { id: SUCURSAL_DEMO_ID },
      data: { syncTokenHash: createHash('sha256').update(process.env.SEED_SYNC_TOKEN).digest('hex') },
    });
  }
  for (const [id, codigo, nombre, serie] of [
    [CAJA_DEMO_ID, 'C01', 'Caja 1', 'S01C01'],
    [CAJA_DEMO_2_ID, 'C02', 'Caja 2', 'S01C02'],
  ]) {
    await prisma.caja.upsert({
      where: { id },
      update: {},
      create: { id, sucursalId: SUCURSAL_DEMO_ID, codigo, nombre, serie },
    });
  }

  // Usuarios demo
  const usuarios = [
    { usuario: 'admin', nombre: 'Administrador General', password: 'admin123', pin: '9999', rol: 'ADMIN_GENERAL', sucursal: null, tarjeta: null },
    { usuario: 'gerente', nombre: 'Gerente Tienda', password: 'gerente123', pin: '3333', rol: 'ADMIN_TIENDA', sucursal: SUCURSAL_DEMO_ID, tarjeta: null },
    { usuario: 'supervisor', nombre: 'Sofía Supervisora', password: 'super123', pin: '2222', rol: 'SUPERVISOR', sucursal: SUCURSAL_DEMO_ID, tarjeta: 'SUP-0001' },
    { usuario: 'cajero1', nombre: 'Carlos Cajero', password: 'cajero123', pin: '1111', rol: 'CAJERO', sucursal: SUCURSAL_DEMO_ID, tarjeta: null },
    { usuario: 'cajero2', nombre: 'Camila Cajera', password: 'cajero123', pin: '1112', rol: 'CAJERO', sucursal: SUCURSAL_DEMO_ID, tarjeta: null },
    { usuario: 'almacen', nombre: 'Andrés Almacén', password: 'almacen123', pin: '4444', rol: 'ALMACEN', sucursal: SUCURSAL_DEMO_ID, tarjeta: null },
  ];
  for (const u of usuarios) {
    const existente = await prisma.usuario.findUnique({ where: { usuario: u.usuario } });
    if (existente) continue;
    const id = newId();
    await prisma.usuario.create({
      data: {
        id,
        usuario: u.usuario,
        nombre: u.nombre,
        passwordHash: await bcrypt.hash(u.password, 10),
        pinHash: await bcrypt.hash(u.pin, 10),
        codigoTarjeta: u.tarjeta,
        roles: { create: { id: newId(), rolId: roles[u.rol], sucursalId: u.sucursal } },
      },
    });
  }

  // Categorías
  const categorias = [
    ['Frutas', '#16a34a', 1],
    ['Verduras', '#65a30d', 2],
    ['Panadería', '#d97706', 3],
    ['Lácteos', '#0284c7', 4],
    ['Bebidas', '#7c3aed', 5],
    ['Abarrotes', '#b45309', 6],
    ['Limpieza', '#0891b2', 7],
    ['Carnes', '#dc2626', 8],
  ] as const;
  const cat: Record<string, string> = {};
  for (const [nombre, color, orden] of categorias) {
    const e = await prisma.categoria.findFirst({ where: { nombre } });
    cat[nombre] = e?.id ?? (await prisma.categoria.create({ data: { id: newId(), nombre, color, orden } })).id;
  }

  // Productos con precios de referencia de supermercado en Colombia (COP, IVA incluido; pesables por kg).
  // Impuesto: IVA19, IVA5, EXENTO (0 %) o EXCLUIDO (0 %). Verifique la clasificación con su contador.
  // [sku, nombre, categoría, precio, costo, pesable, plu, códigos, favorito, impuesto]
  type Imp = 'IVA19' | 'IVA5' | 'EXENTO' | 'EXCLUIDO';
  const TASA: Record<Imp, number> = { IVA19: 19, IVA5: 5, EXENTO: 0, EXCLUIDO: 0 };
  const productos: [string, string, string, number, number, boolean, string | null, string[], boolean, Imp][] = [
    ['FR001', 'Banano', 'Frutas', 4200, 2900, true, '00001', [], true, 'EXCLUIDO'],
    ['FR002', 'Manzana roja', 'Frutas', 9800, 6900, true, '00002', [], true, 'EXCLUIDO'],
    ['FR003', 'Naranja tangelo', 'Frutas', 3900, 2600, true, '00003', [], true, 'EXCLUIDO'],
    ['FR004', 'Aguacate Hass', 'Frutas', 9500, 6600, true, '00004', [], true, 'EXCLUIDO'],
    ['VE001', 'Tomate chonto', 'Verduras', 4800, 3200, true, '00010', [], true, 'EXCLUIDO'],
    ['VE002', 'Papa pastusa', 'Verduras', 3200, 2100, true, '00011', [], true, 'EXCLUIDO'],
    ['VE003', 'Cebolla cabezona roja', 'Verduras', 3900, 2600, true, '00012', [], true, 'EXCLUIDO'],
    ['VE004', 'Lechuga crespa', 'Verduras', 3200, 2000, false, null, [], true, 'EXCLUIDO'],
    ['PA001', 'Pan francés', 'Panadería', 500, 250, false, null, [], true, 'EXCLUIDO'],
    ['PA002', 'Pan tajado 600g', 'Panadería', 8900, 6400, false, null, ['7751271012345'], false, 'IVA19'],
    ['LA001', 'Leche entera bolsa 1,1L', 'Lácteos', 4900, 4000, false, null, ['7751271001010'], false, 'EXENTO'],
    ['LA002', 'Yogur fresa 1L', 'Lácteos', 9900, 7300, false, null, ['7751271002024'], false, 'IVA19'],
    ['LA003', 'Queso campesino', 'Lácteos', 22000, 16000, true, '00020', [], false, 'EXENTO'],
    ['BE001', 'Agua 600ml', 'Bebidas', 2000, 1000, false, null, ['7750182006088'], false, 'IVA19'],
    ['BE002', 'Gaseosa cola 1,5L', 'Bebidas', 6500, 4700, false, null, ['7750182000017'], false, 'IVA19'],
    ['BE003', 'Jugo de naranja 1L', 'Bebidas', 6900, 4900, false, null, ['7750182000024'], false, 'IVA19'],
    ['AB001', 'Arroz blanco 5kg', 'Abarrotes', 22900, 18500, false, null, ['7751234500017'], false, 'EXCLUIDO'],
    ['AB002', 'Azúcar blanca 1kg', 'Abarrotes', 4500, 3600, false, null, ['7751234500024'], false, 'IVA5'],
    ['AB003', 'Aceite vegetal 1L', 'Abarrotes', 11900, 9200, false, null, ['7751234500031'], false, 'IVA5'],
    ['AB004', 'Pasta spaghetti 500g', 'Abarrotes', 3900, 2800, false, null, ['7751234500048'], false, 'IVA5'],
    ['LI001', 'Detergente en polvo 900g', 'Limpieza', 12900, 9500, false, null, ['7751111000016'], false, 'IVA19'],
    ['LI002', 'Papel higiénico x4', 'Limpieza', 8900, 6300, false, null, ['7751111000023'], false, 'IVA19'],
    ['CA001', 'Pechuga de pollo', 'Carnes', 18900, 13500, true, '00030', [], true, 'EXENTO'],
    ['CA002', 'Carne molida de res', 'Carnes', 26000, 19000, true, '00031', [], false, 'EXENTO'],
  ];
  const idsPorSku: Record<string, string> = {};
  for (const [sku, nombre, categoria, precio, costo, pesable, plu, codigos, favorito, impuesto] of productos) {
    const e = await prisma.producto.findUnique({ where: { sku } });
    if (e) {
      idsPorSku[sku] = e.id;
      continue;
    }
    const id = newId();
    idsPorSku[sku] = id;
    await prisma.producto.create({
      data: {
        id,
        sku,
        nombre,
        categoriaId: cat[categoria],
        unidad: pesable ? 'KG' : 'UND',
        pesable,
        plu,
        precio,
        costo,
        tasaImpuesto: TASA[impuesto],
        impuestoCodigo: impuesto,
        stockMinimo: 10,
        favorito,
        codigos: { create: codigos.map((codigo) => ({ id: newId(), codigo })) },
      },
    });
  }

  // Promociones de ejemplo
  if (!(await prisma.promocion.count())) {
    await prisma.promocion.create({
      data: { id: newId(), nombre: 'Agua 600ml 2x1', tipo: 'NXM', productoIds: [idsPorSku['BE001']], llevar: 2, pagar: 1 },
    });
    await prisma.promocion.create({
      data: {
        id: newId(),
        nombre: 'Pan francés: 10 o más a $400',
        tipo: 'PRECIO_CANTIDAD',
        productoIds: [idsPorSku['PA001']],
        cantidadMinima: 10,
        precioPromo: 400,
      },
    });
  }

  console.log('Seed completado.');
  console.log(`  Sucursal demo: ${SUCURSAL_DEMO_ID}`);
  console.log('  Usuarios: admin/admin123 · gerente/gerente123 · supervisor/super123 (PIN 2222) · cajero1/cajero123 (PIN 1111)');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
