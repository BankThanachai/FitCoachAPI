import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserType } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateClientTrainerDto } from './dto/create-client-trainer.dto';

@Injectable()
export class ClientTrainersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    clientId: string,
    createClientTrainerDto: CreateClientTrainerDto,
  ) {
    const client = await this.prisma.user.findUnique({
      where: { id: clientId },
    });
    if (!client) {
      throw new NotFoundException('Client not found');
    }
    if (client.type !== UserType.Client) {
      throw new BadRequestException('Only clients can add a trainer');
    }

    const trainer = await this.prisma.user.findUnique({
      where: { id: createClientTrainerDto.trainerId },
    });
    if (!trainer) {
      throw new NotFoundException('Trainer not found');
    }
    if (trainer.type !== UserType.Trainer) {
      throw new BadRequestException('Target user is not a trainer');
    }

    try {
      return await this.prisma.clientTrainer.create({
        data: {
          clientId,
          trainerId: createClientTrainerDto.trainerId,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('This trainer has already been added');
      }
      throw error;
    }
  }

  async findByClient(clientId: string) {
    return this.prisma.clientTrainer.findMany({
      where: { clientId },
      include: { trainer: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByTrainer(trainerId: string) {
    return this.prisma.clientTrainer.findMany({
      where: { trainerId },
      include: { client: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async remove(clientId: string, trainerId: string) {
    const relation = await this.prisma.clientTrainer.findUnique({
      where: { clientId_trainerId: { clientId, trainerId } },
    });
    if (!relation) {
      throw new NotFoundException('Relation not found');
    }
    return this.prisma.clientTrainer.delete({
      where: { clientId_trainerId: { clientId, trainerId } },
    });
  }
}
