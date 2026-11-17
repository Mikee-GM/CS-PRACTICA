import { Global, Module } from '@nestjs/common';
import { LogMailer } from './log-mailer';
import { Mailer } from './mailer';

@Global()
@Module({
  providers: [{ provide: Mailer, useClass: LogMailer }],
  exports: [Mailer],
})
export class MailModule {}
