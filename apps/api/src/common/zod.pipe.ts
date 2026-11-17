import { BadRequestException, PipeTransform } from '@nestjs/common';
import { ZodSchema } from 'zod';

export class ZodPipe<T> implements PipeTransform {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown): T {
    const r = this.schema.safeParse(value);
    if (!r.success) {
      throw new BadRequestException({
        message: 'Datos inválidos',
        errores: r.error.issues.map((i) => ({ campo: i.path.join('.'), mensaje: i.message })),
      });
    }
    return r.data;
  }
}
