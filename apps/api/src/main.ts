import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { existsSync, readFileSync } from 'fs';
import * as path from 'path';
import { AppModule } from './app.module';
import { AppConfig } from './config/app-config';

/** HTTPS opcional (necesario para usar la cámara del celular como lector). El .env ya fue cargado por ConfigModule. */
function opcionesHttps() {
  const pfx = process.env.HTTPS_PFX?.trim();
  if (!pfx) return undefined;
  if (!existsSync(pfx)) {
    Logger.warn(`HTTPS_PFX no existe (${pfx}); se usa HTTP`, 'Bootstrap');
    return undefined;
  }
  return { pfx: readFileSync(pfx), passphrase: process.env.HTTPS_PASSPHRASE ?? '' };
}

async function bootstrap() {
  const httpsOptions = opcionesHttps();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: true, httpsOptions });
  const config = app.get(AppConfig);

  app.setGlobalPrefix('api');
  app.useBodyParser('json', { limit: '20mb' });
  // Las cajas (Electron) y la web admin se conectan desde la LAN/VPN
  app.enableCors({ origin: true, credentials: true });
  app.enableShutdownHooks();

  // Actualizaciones de las cajas Electron (latest.yml + instalador), servidas por LAN sin internet
  const updatesDir = process.env.UPDATES_DIR;
  if (updatesDir && existsSync(updatesDir)) {
    app.useStaticAssets(updatesDir, { prefix: '/updates/' });
  }

  // Servir la web compilada (opcional): http://servidor:puerto/
  const webDist = config.webDist;
  if (webDist && existsSync(webDist)) {
    app.useStaticAssets(webDist);
    const index = path.join(webDist, 'index.html');
    // SPA: cualquier ruta que no sea /api devuelve index.html
    app.use((req: any, res: any, next: any) => {
      if (req.method !== 'GET' || req.path.startsWith('/api') || req.path.startsWith('/updates')) return next();
      res.sendFile(index);
    });
  }

  await app.listen(config.port, '0.0.0.0');
  Logger.log(
    `API POS en modo ${config.mode.toUpperCase()} escuchando en ${httpsOptions ? 'https' : 'http'} :${config.port}` +
      (config.sucursalId ? ` (sucursal ${config.sucursalId})` : ''),
    'Bootstrap',
  );
}

bootstrap();
