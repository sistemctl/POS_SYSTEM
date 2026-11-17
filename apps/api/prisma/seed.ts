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
      direccion: 'Av. Principal 123',
      pieTicket: '¡Gracias por su compra!\nConserve su ticket para cambios.',
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

  // Productos: [sku, nombre, categoría, precio, costo, pesable, plu, códigos, favorito]
  const productos: [string, string, string, number, number, boolean, string | null, string[], boolean][] = [
    ['FR001', 'Plátano', 'Frutas', 3.5, 2.1, true, '00001', [], true],
    ['FR002', 'Manzana roja', 'Frutas', 6.9, 4.2, true, '00002', [], true],
    ['FR003', 'Naranja', 'Frutas', 3.2, 1.8, true, '00003', [], true],
    ['FR004', 'Palta fuerte', 'Frutas', 9.9, 6.5, true, '00004', [], true],
    ['VE001', 'Tomate', 'Verduras', 4.5, 2.8, true, '00010', [], true],
    ['VE002', 'Papa blanca', 'Verduras', 2.8, 1.6, true, '00011', [], true],
    ['VE003', 'Cebolla roja', 'Verduras', 3.0, 1.7, true, '00012', [], true],
    ['VE004', 'Lechuga', 'Verduras', 2.5, 1.2, false, null, [], true],
    ['PA001', 'Pan francés', 'Panadería', 0.3, 0.15, false, null, [], true],
    ['PA002', 'Pan de molde 600g', 'Panadería', 8.9, 6.2, false, null, ['7751271012345'], false],
    ['LA001', 'Leche evaporada 400g', 'Lácteos', 4.2, 3.4, false, null, ['7751271001010'], false],
    ['LA002', 'Yogurt fresa 1L', 'Lácteos', 7.5, 5.6, false, null, ['7751271002024'], false],
    ['LA003', 'Queso fresco', 'Lácteos', 22.0, 15.0, true, '00020', [], false],
    ['BE001', 'Agua mineral 625ml', 'Bebidas', 1.8, 0.9, false, null, ['7750182006088'], false],
    ['BE002', 'Gaseosa cola 1.5L', 'Bebidas', 6.5, 4.6, false, null, ['7750182000017'], false],
    ['BE003', 'Jugo de naranja 1L', 'Bebidas', 5.9, 4.1, false, null, ['7750182000024'], false],
    ['AB001', 'Arroz extra 5kg', 'Abarrotes', 24.9, 19.5, false, null, ['7751234500017'], false],
    ['AB002', 'Azúcar rubia 1kg', 'Abarrotes', 4.3, 3.5, false, null, ['7751234500024'], false],
    ['AB003', 'Aceite vegetal 1L', 'Abarrotes', 10.9, 8.4, false, null, ['7751234500031'], false],
    ['AB004', 'Fideos spaghetti 500g', 'Abarrotes', 3.6, 2.5, false, null, ['7751234500048'], false],
    ['LI001', 'Detergente 900g', 'Limpieza', 12.5, 9.1, false, null, ['7751111000016'], false],
    ['LI002', 'Papel higiénico x4', 'Limpieza', 6.9, 4.8, false, null, ['7751111000023'], false],
    ['CA001', 'Pechuga de pollo', 'Carnes', 15.9, 11.2, true, '00030', [], true],
    ['CA002', 'Carne molida', 'Carnes', 24.0, 17.5, true, '00031', [], false],
  ];
  const idsPorSku: Record<string, string> = {};
  for (const [sku, nombre, categoria, precio, costo, pesable, plu, codigos, favorito] of productos) {
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
        tasaImpuesto: 18,
        stockMinimo: 10,
        favorito,
        codigos: { create: codigos.map((codigo) => ({ id: newId(), codigo })) },
      },
    });
  }

  // Promociones de ejemplo
  if (!(await prisma.promocion.count())) {
    await prisma.promocion.create({
      data: { id: newId(), nombre: 'Agua 2x1', tipo: 'NXM', productoIds: [idsPorSku['BE001']], llevar: 2, pagar: 1 },
    });
    await prisma.promocion.create({
      data: {
        id: newId(),
        nombre: 'Pan francés: 10 o más a S/0.25',
        tipo: 'PRECIO_CANTIDAD',
        productoIds: [idsPorSku['PA001']],
        cantidadMinima: 10,
        precioPromo: 0.25,
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
