import { UnauthorizedException } from '@nestjs/common';
import { UserStatus } from '../../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtPayload } from '../types/jwt-payload.type';
import { JwtStrategy } from './jwt.strategy';

const PAYLOAD: JwtPayload = {
  sub: 'user-1',
  phone: '0812345678',
  type: 'Client',
};

describe('JwtStrategy.validate', () => {
  let findFirst: jest.Mock;
  let strategy: JwtStrategy;

  beforeAll(() => {
    process.env.JWT_ACCESS_SECRET = 'test-access-secret';
  });

  beforeEach(() => {
    findFirst = jest.fn();
    strategy = new JwtStrategy({
      user: { findFirst },
    } as unknown as PrismaService);
  });

  it('accepts a token whose user is still Active, handing the payload on unchanged', async () => {
    findFirst.mockResolvedValue({ id: 'user-1' });

    await expect(strategy.validate(PAYLOAD)).resolves.toBe(PAYLOAD);
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: 'user-1', status: UserStatus.Active },
      select: { id: true },
    });
  });

  it('rejects a still-valid token once its user has been deactivated (or no longer exists)', async () => {
    findFirst.mockResolvedValue(null);

    await expect(strategy.validate(PAYLOAD)).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
