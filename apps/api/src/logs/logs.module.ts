import { Body, Controller, Get, Global, HttpCode, Injectable, Ip, Logger, Module, OnModuleDestroy, OnModuleInit, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { newId, PERMISOS } from '@pos/shared';
import { Public, RequirePermission } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';

const logSchema = z.object({
  nivel: z.enum(['error', 'warn', 'info']).default('error'),
  mensaje: z.string().min(1).max(2000),
  detalle: z.string().max(8000).nullable().optional(),
  pantalla: z.string().max(200).nullable().optional(),
  version: z.string().max(40).nullable().optional(),
  cajaId: z.string().uuid().nullable().optional(),
  usuarioId: z.string().uuid().nullable().optional(),
});

const LIMITE_POR_MINUTO = 30;

@Injectable()
export class LogsService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Cajas');
  private conteo = new Map<string, { n: number; desde: number }>();
  private timer?: NodeJS.Timeout;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    this.timer = setInterval(() => this.purgar().catch(() => undefined), 6 * 3_600_000);
  }
  onModuleDestroy() {
    clearInterval(this.timer);
  }

  async registrar(equipo: string, d: z.infer<typeof logSchema>) {
    const ahora = Date.now();
    const c = this.conteo.get(equipo);
    if (!c || ahora - c.desde > 60_000) this.conteo.set(equipo, { n: 1, desde: ahora });
    else if (++c.n > LIMITE_POR_MINUTO) return { ok: false, limitado: true };

    this.log.warn(`[${d.nivel}] ${d.pantalla ?? ''} ${d.mensaje}`);
    await this.prisma.logCliente.create({
      data: {
        id: newId(),
        nivel: d.nivel,
        mensaje: d.mensaje,
        detalle: d.detalle ?? null,
        pantalla: d.pantalla ?? null,
        version: d.version ?? null,
        cajaId: d.cajaId ?? null,
        usuarioId: d.usuarioId ?? null,
        equipo,
      },
    });
    return { ok: true };
  }

  listar(limite = 200) {
    return this.prisma.logCliente.findMany({ orderBy: { creadoEn: 'desc' }, take: Math.min(limite, 1000) });
  }

  erroresUltimas24h() {
    return this.prisma.logCliente.count({ where: { nivel: 'error', creadoEn: { gte: new Date(Date.now() - 86_400_000) } } });
  }

  async purgar() {
    this.conteo.clear();
    await this.prisma.logCliente.deleteMany({ where: { creadoEn: { lt: new Date(Date.now() - 30 * 86_400_000) } } });
  }
}

@Controller('logs')
class LogsController {
  constructor(private readonly svc: LogsService) {}

  /** Las cajas reportan errores aunque no haya sesión (ej. falla en el login). Limitado por equipo. */
  @Public()
  @HttpCode(200)
  @Post('cliente')
  registrar(@Ip() ip: string, @Body(new ZodPipe(logSchema)) body: z.infer<typeof logSchema>) {
    return this.svc.registrar(ip, body);
  }

  @RequirePermission(PERMISOS.MONITOREO_VER)
  @Get('cliente')
  listar(@Query('limite') limite?: string) {
    return this.svc.listar(limite ? Number(limite) : undefined);
  }
}

@Global()
@Module({
  controllers: [LogsController],
  providers: [LogsService],
  exports: [LogsService],
})
export class LogsModule {}
