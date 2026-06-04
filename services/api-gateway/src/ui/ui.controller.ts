import { Controller, Get, Res } from '@nestjs/common';
import { Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Serves the single-page UI at GET /.
 * The HTML is a self-contained file (inline CSS + JS) under public/.
 * Read once at startup and cached in memory.
 */
@Controller()
export class UiController {
  private readonly html = fs.readFileSync(
    path.join(process.cwd(), 'public', 'index.html'),
    'utf-8',
  );

  @Get()
  index(@Res() res: Response) {
    res.type('html').send(this.html);
  }
}
