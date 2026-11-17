import { Body, Controller, Get, Post } from '@nestjs/common';
import { z } from 'zod';
import { TODOS_LOS_PERMISOS } from '@pos/shared';
import type { Permiso } from '@pos/shared';
import { CurrentUser, JwtUser, Public } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { AuthService } from './auth.service';

const loginSchema = z.object({ usuario: z.string().min(1), password: z.string().min(1) });
const pinSchema = z.object({
  usuarioId: z.string().uuid(),
  pin: z.string().regex(/^\d{4,6}$/, 'PIN de 4 a 6 dígitos'),
  cajaId: z.string().uuid().nullable().optional(),
});
const autorizarSchema = z
  .object({
    supervisorId: z.string().uuid().optional(),
    pin: z.string().optional(),
    codigoTarjeta: z.string().optional(),
    permiso: z.enum(TODOS_LOS_PERMISOS as [Permiso, ...Permiso[]]),
    motivo: z.string().max(300).optional(),
    consumir: z.boolean().optional(),
    detalle: z.any().optional(),
  })
  .refine((d) => d.codigoTarjeta || (d.supervisorId && d.pin), 'Indique supervisor y PIN, o tarjeta');

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Get('usuarios-caja')
  usuariosCaja() {
    return this.auth.usuariosCaja();
  }

  @Public()
  @Post('login')
  login(@Body(new ZodPipe(loginSchema)) b: z.infer<typeof loginSchema>) {
    return this.auth.login(b.usuario, b.password);
  }

  @Public()
  @Post('login-pin')
  loginPin(@Body(new ZodPipe(pinSchema)) b: z.infer<typeof pinSchema>) {
    return this.auth.loginPin(b.usuarioId, b.pin, b.cajaId ?? null);
  }

  @Get('me')
  me(@CurrentUser() user: JwtUser) {
    return this.auth.sesion(user.sub);
  }

  /** Autorización de supervisor (modal táctil con PIN o tarjeta) */
  @Post('autorizar')
  autorizar(@CurrentUser() user: JwtUser, @Body(new ZodPipe(autorizarSchema)) b: z.infer<typeof autorizarSchema>) {
    return this.auth.autorizar(user, b);
  }
}
