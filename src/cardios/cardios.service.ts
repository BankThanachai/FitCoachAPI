import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCardioDto } from './dto/create-cardio.dto';

@Injectable()
export class CardiosService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createdById: string, createCardioDto: CreateCardioDto) {
    const assignedTo = await this.prisma.user.findUnique({
      where: { id: createCardioDto.assignedToId },
    });
    if (!assignedTo) {
      throw new NotFoundException('Assigned user not found');
    }

    return this.prisma.cardio.create({
      data: {
        activity: createCardioDto.activity,
        durationMin: createCardioDto.durationMin,
        kcal: createCardioDto.kcal,
        avgHeartRate: createCardioDto.avgHeartRate,
        location: createCardioDto.location,
        distanceKm: createCardioDto.distanceKm,
        route: createCardioDto.route,
        assignedToId: createCardioDto.assignedToId,
        createdById,
      },
    });
  }

  async findAll() {
    return this.prisma.cardio.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const cardio = await this.prisma.cardio.findUnique({ where: { id } });
    if (!cardio) {
      throw new NotFoundException(`Cardio with id ${id} not found`);
    }
    return cardio;
  }

  async findByAssigned(assignedToId: string) {
    const assignedTo = await this.prisma.user.findUnique({
      where: { id: assignedToId },
    });
    if (!assignedTo) {
      throw new NotFoundException(`User with id ${assignedToId} not found`);
    }

    return this.prisma.cardio.findMany({
      where: { assignedToId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
