import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ClientTrainerStatus, UserType } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateClientTrainerDto } from './dto/create-client-trainer.dto';
import { UpdateClientTrainerStatusDto } from './dto/update-client-trainer-status.dto';

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

    const latest = await this.findLatest(
      clientId,
      createClientTrainerDto.trainerId,
    );
    if (
      latest &&
      (latest.status === ClientTrainerStatus.Pending ||
        latest.status === ClientTrainerStatus.Accepted)
    ) {
      throw new ConflictException(
        `This trainer has already been ${latest.status === ClientTrainerStatus.Pending ? 'requested' : 'added'}`,
      );
    }

    return this.prisma.clientTrainer.create({
      data: {
        clientId,
        trainerId: createClientTrainerDto.trainerId,
      },
    });
  }

  private async findLatest(clientId: string, trainerId: string) {
    return this.prisma.clientTrainer.findFirst({
      where: { clientId, trainerId },
      orderBy: { createdAt: 'desc' },
    });
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

  async updateStatus(
    trainerId: string,
    clientId: string,
    updateClientTrainerStatusDto: UpdateClientTrainerStatusDto,
  ) {
    const relation = await this.findLatest(clientId, trainerId);
    if (!relation) {
      throw new NotFoundException('Relation not found');
    }

    return this.prisma.clientTrainer.update({
      where: { id: relation.id },
      data: { status: updateClientTrainerStatusDto.status },
    });
  }

  async remove(clientId: string, trainerId: string) {
    const relation = await this.findLatest(clientId, trainerId);
    if (!relation) {
      throw new NotFoundException('Relation not found');
    }
    return this.prisma.clientTrainer.delete({
      where: { id: relation.id },
    });
  }
}
