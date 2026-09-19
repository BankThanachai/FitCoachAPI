import { Injectable, Logger } from '@nestjs/common';
import * as admin from 'firebase-admin';
import { PrismaService } from '../prisma/prisma.service';
import { firebaseConfig } from './firebase.config';

// FCM's code for a token that's expired or belongs to an uninstalled app —
// safe to delete outright rather than retry.
const UNREGISTERED_TOKEN_ERROR = 'messaging/registration-token-not-registered';

@Injectable()
export class PushNotificationService {
  private readonly logger = new Logger(PushNotificationService.name);
  private readonly app: admin.app.App;

  constructor(private readonly prisma: PrismaService) {
    this.app = admin.apps.length
      ? (admin.apps[0] as admin.app.App)
      : admin.initializeApp({
          credential: admin.credential.cert(firebaseConfig.serviceAccountPath),
        });
  }

  // Sends to every device registered for this user. A user can be logged in
  // on multiple devices (DeviceToken has no uniqueness constraint on
  // userId), so this fans out to all of them rather than just the latest.
  async sendToUser(
    userId: string,
    notification: { title: string; body: string },
    data?: Record<string, string>,
  ) {
    const deviceTokens = await this.prisma.deviceToken.findMany({
      where: { userId },
      select: { id: true, token: true },
    });
    if (deviceTokens.length === 0) {
      return;
    }

    const results = await Promise.allSettled(
      deviceTokens.map((deviceToken) =>
        this.app.messaging().send({
          token: deviceToken.token,
          notification,
          data,
        }),
      ),
    );

    const staleTokenIds: string[] = [];
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        const error = result.reason as { code?: string };
        if (error.code === UNREGISTERED_TOKEN_ERROR) {
          staleTokenIds.push(deviceTokens[index].id);
        } else {
          this.logger.warn(
            `Failed to send push to device token ${deviceTokens[index].id}: ${String(error.code ?? result.reason)}`,
          );
        }
      }
    });

    if (staleTokenIds.length > 0) {
      await this.prisma.deviceToken.deleteMany({
        where: { id: { in: staleTokenIds } },
      });
    }
  }
}
