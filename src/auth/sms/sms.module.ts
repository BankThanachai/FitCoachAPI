import { Module } from '@nestjs/common';
import { ConsoleSmsProvider } from './console-sms.provider';
import { SMS_PROVIDER } from './sms-provider.interface';
import { smsConfig } from './sms.config';

// Only "console" exists today (see sms.config.ts); a real gateway gets
// added as another `case` here once one is chosen, with no change needed
// in AuthService.
@Module({
  providers: [
    {
      provide: SMS_PROVIDER,
      useFactory: () => {
        switch (smsConfig.provider) {
          case 'console':
            return new ConsoleSmsProvider();
        }
      },
    },
  ],
  exports: [SMS_PROVIDER],
})
export class SmsModule {}
