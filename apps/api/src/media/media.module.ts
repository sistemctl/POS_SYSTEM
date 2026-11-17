import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Global,
  Injectable,
  Logger,
  Module,
  NotFoundException,
  OnModuleInit,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { existsSync, mkdirSync } from 'fs';
import { readFile, writeFile } from 'fs/promises';
import * as path from 'path';
import sharp from 'sharp';
import { z } from 'zod';
import { PERMISOS, type TicketLogo } from '@pos/shared';
import { CentralOnly, Public, RequirePermission } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { AppConfig } from '../config/app-config';
import { PrismaService } from '../prisma/prisma.service';

const ID = /^[a-f0-9]{64}$/;
/** Ancho del logo impreso en puntos (cabe en papel de 58 y de 80 mm) */
const ANCHO_LOGO_TICKET = 384;

const subirSchema = z.object({
  /** data:image/...;base64,.... */
  dataUrl: z.string().max(15_000_000).regex(/^data:image\/(png|jpe?g|webp|gif|bmp);base64,/, 'Formato de imagen no soportado'),
  tipo: z.enum(['producto', 'logo']).default('producto'),
});

@Injectable()
export class MediaService implements OnModuleInit {
  private readonly log = new Logger('Media');
  private descargando = new Map<string, Promise<boolean>>();

  constructor(
    private readonly config: AppConfig,
    private readonly prisma: PrismaService,
  ) {}

  get dir() {
    return this.config.mediaDir;
  }

  archivo(id: string) {
    if (!ID.test(id)) throw new BadRequestException('Id de imagen inválido');
    return path.join(this.dir, `${id}.webp`);
  }

  async onModuleInit() {
    mkdirSync(this.dir, { recursive: true });
    if (this.config.isCentral) {
      // Migración: imágenes guardadas antes en base64 dentro de la tabla Producto
      this.migrarBase64().catch((e) => this.log.error(`Migración de imágenes: ${e.message}`));
    }
  }

  /** Procesa y guarda una imagen. Devuelve su id (hash del archivo resultante). */
  async guardar(entrada: Buffer, tipo: 'producto' | 'logo'): Promise<string> {
    let img = sharp(entrada, { failOn: 'none' }).rotate();
    img =
      tipo === 'logo'
        ? img.resize({ width: 600, height: 300, fit: 'inside', withoutEnlargement: true })
        : img.resize({ width: 256, height: 256, fit: 'inside', withoutEnlargement: true });
    const webp = await img.webp({ quality: tipo === 'logo' ? 90 : 78 }).toBuffer();
    const id = createHash('sha256').update(webp).digest('hex');
    const f = this.archivo(id);
    if (!existsSync(f)) await writeFile(f, webp);
    return id;
  }

  async guardarDataUrl(dataUrl: string, tipo: 'producto' | 'logo') {
    const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    try {
      return await this.guardar(Buffer.from(b64, 'base64'), tipo);
    } catch {
      throw new BadRequestException('No se pudo leer la imagen');
    }
  }

  /** Asegura que la imagen exista localmente; en la tienda la descarga del central si falta. */
  async asegurar(id: string): Promise<boolean> {
    const f = this.archivo(id);
    if (existsSync(f)) return true;
    if (!this.config.isStore || !this.config.centralUrl) return false;
    let p = this.descargando.get(id);
    if (!p) {
      p = (async () => {
        try {
          const r = await fetch(`${this.config.centralUrl}/api/media/${id}`, { signal: AbortSignal.timeout(15_000) });
          if (!r.ok) return false;
          const buf = Buffer.from(await r.arrayBuffer());
          if (createHash('sha256').update(buf).digest('hex') !== id) return false;
          await writeFile(f, buf);
          return true;
        } catch {
          return false;
        } finally {
          this.descargando.delete(id);
        }
      })();
      this.descargando.set(id, p);
    }
    return p;
  }

  /** Descarga en segundo plano las imágenes que la tienda aún no tiene (para trabajar sin internet). */
  async sincronizarFaltantes(ids: string[]) {
    let n = 0;
    for (const id of new Set(ids)) {
      if (!ID.test(id) || existsSync(this.archivo(id))) continue;
      if (await this.asegurar(id)) n++;
    }
    if (n) this.log.log(`Descargadas ${n} imágenes del central`);
  }

  /** Logo convertido a mapa de bits 1-bit para ESC/POS. Se guarda en caché junto al archivo. */
  async logoTicket(id: string): Promise<TicketLogo | null> {
    if (!(await this.asegurar(id))) return null;
    const cache = path.join(this.dir, `${id}.ticket.json`);
    if (existsSync(cache)) return JSON.parse(await readFile(cache, 'utf8'));
    const { data, info } = await sharp(this.archivo(id))
      .flatten({ background: '#ffffff' })
      .resize({ width: ANCHO_LOGO_TICKET, height: 200, fit: 'inside', withoutEnlargement: true })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const anchoBytes = Math.ceil(info.width / 8);
    const bits = Buffer.alloc(anchoBytes * info.height);
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        if (data[y * info.width + x] < 128) bits[y * anchoBytes + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
    const logo: TicketLogo = { anchoBytes, alto: info.height, bits: bits.toString('base64'), url: `/api/media/${id}` };
    await writeFile(cache, JSON.stringify(logo));
    return logo;
  }

  private async migrarBase64() {
    const productos = await this.prisma.producto.findMany({
      where: { imagen: { startsWith: 'data:' } },
      select: { id: true, imagen: true },
    });
    for (const p of productos) {
      try {
        const id = await this.guardarDataUrl(p.imagen!, 'producto');
        await this.prisma.producto.update({ where: { id: p.id }, data: { imagen: id } });
      } catch {
        await this.prisma.producto.update({ where: { id: p.id }, data: { imagen: null } });
      }
    }
    if (productos.length) this.log.log(`Migradas ${productos.length} imágenes de productos a archivos`);
  }
}

@Controller('media')
class MediaController {
  constructor(private readonly svc: MediaService) {}

  @CentralOnly()
  @RequirePermission(PERMISOS.PRODUCTO_GESTIONAR)
  @Post()
  async subir(@Body(new ZodPipe(subirSchema)) b: z.infer<typeof subirSchema>) {
    const id = await this.svc.guardarDataUrl(b.dataUrl, b.tipo);
    return { id, url: `/api/media/${id}` };
  }

  /** Público: las imágenes no son sensibles y el <img> de la caja no envía token. Contenido inmutable (id = hash). */
  @Public()
  @Get(':id')
  async ver(@Param('id') id: string, @Res() res: any) {
    if (!(await this.svc.asegurar(id))) throw new NotFoundException('Imagen no encontrada');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.type('image/webp');
    res.sendFile(this.svc.archivo(id));
  }
}

@Global()
@Module({
  controllers: [MediaController],
  providers: [MediaService],
  exports: [MediaService],
})
export class MediaModule {}
